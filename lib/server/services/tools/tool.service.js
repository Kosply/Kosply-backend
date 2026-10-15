/**
 * @title AI tool benchmark service (ops dashboard)
 * @notice Aggregates `tool_invocations` into the numbers the admin Tools
 * @notice Benchmark page renders: usage ranking, success rate and average
 * @notice latency per tool, plus the busiest 3-hour window.
 * @dev `tool_invocations` is append-only and can grow without bound, so every
 * @dev read here is bounded: the ranking caps at MAX_TOOLS groups and the
 * @dev peak-window scan reads at most MAX_PEAK_ROWS timestamps instead of the
 * @dev whole table.
 * @dev The "local hour" comes from ANALYTICS_UTC_OFFSET_MINUTES (420 = WIB),
 * @dev the same convention the analytics window uses — never the server's own
 * @dev clock, so the same rows report the same peak window on every host.
 */
const { requireDb } = require('../../config/db');
const { toQueryInt } = require('../shared/validators');

/** @dev Window default and ceiling, in days. */
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 90;

/** @dev Bounds: tools listed per response, timestamps scanned for the peak window. */
const MAX_TOOLS = 20;
const MAX_PEAK_ROWS = 5000;

/** @dev Peak window width, in hours. */
const PEAK_WINDOW_HOURS = 3;

/** @dev Fallback offset (minutes east of UTC) when the env key is absent. */
const DEFAULT_UTC_OFFSET_MINUTES = 420;

/**
 * @notice Percentage rounded to one decimal, safe against a zero denominator.
 * @param {number} part Numerator.
 * @param {number} whole Denominator.
 * @returns {number} `0` when `whole` is 0, otherwise `part / whole * 100`.
 */
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/**
 * @notice Find the busiest `PEAK_WINDOW_HOURS`-hour window of a day.
 * @dev Hours are bucketed in the configured local offset, and the window wraps
 * @dev around midnight (so `23:00 - 02:00` is representable).
 * @param {Date[]} dates Timestamps to bucket (already bounded by the caller).
 * @returns {string|null} e.g. `19:00 - 22:00 WIB`, or null when there are no rows.
 */
const peakWindow = (dates) => {
  if (dates.length === 0) return null;

  const offsetMinutes =
    Number.parseInt(process.env.ANALYTICS_UTC_OFFSET_MINUTES, 10) || DEFAULT_UTC_OFFSET_MINUTES;

  const buckets = new Array(24).fill(0);
  for (const date of dates) {
    const local = new Date(date.getTime() + offsetMinutes * 60 * 1000);
    buckets[local.getUTCHours()] += 1;
  }

  let bestStart = 0;
  let bestSum = -1;
  for (let start = 0; start < 24; start += 1) {
    let sum = 0;
    for (let i = 0; i < PEAK_WINDOW_HOURS; i += 1) sum += buckets[(start + i) % 24];
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = start;
    }
  }

  const end = (bestStart + PEAK_WINDOW_HOURS) % 24;
  const label = (hour) => `${String(hour).padStart(2, '0')}:00`;
  return `${label(bestStart)} - ${label(end)} WIB`;
};

/**
 * @notice Aggregate tool-invocation metrics for the requested window.
 * @param {object} [query] Query string.
 * @param {string} [query.days] Window size in days (1-90, default 30).
 * @returns {Promise<{ range: { days: number, from: string }, item: object }>} Range plus
 *   `{ total, succeeded, failed, timeout, successRate, avgLatencyMs, peakWindow, tools }`,
 *   where `tools[]` is `{ tool, count, percent, successRate, avgLatencyMs }` sorted by count.
 * @throws {import('../../middlewares/errorCatalog').ApiError} `VALIDATION` for a bad `days`.
 */
const getStats = async (query = {}) => {
  const db = requireDb();
  const days = toQueryInt(query.days, 'days', {
    min: 1,
    max: MAX_RANGE_DAYS,
    fallback: DEFAULT_RANGE_DAYS,
  });
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  /** @dev `createdAt` only: tool is a free-text column with an index on (tool, createdAt). */
  const where = { createdAt: { gte: from } };

  // Six independent reads, issued together. `byTool` is capped at the top 20
  // tools while `byToolStatus` is deliberately *not* capped: the failure rates
  // fold into the capped set, so an uncapped source keeps those numbers right.
  const [total, byStatus, byTool, byToolStatus, latency, timestamps] = await Promise.all([
    db.count('tool_invocations', { where }),
    db.aggregate('tool_invocations', {
      groupBy: ['status'],
      where,
      aggregates: [{ fn: 'count', column: '*', alias: 'total' }],
    }),
    db.aggregate('tool_invocations', {
      groupBy: ['tool'],
      where,
      aggregates: [
        { fn: 'count', column: '*', alias: 'total' },
        { fn: 'avg', column: 'latencyMs', alias: 'avg_latency' },
      ],
      // Ranked by the aggregate alias, not a base column.
      orderBy: [{ total: { dir: 'desc' } }],
      limit: MAX_TOOLS,
    }),
    db.aggregate('tool_invocations', {
      groupBy: ['tool', 'status'],
      where,
      aggregates: [{ fn: 'count', column: '*', alias: 'total' }],
    }),
    db.aggregate('tool_invocations', {
      where: { ...where, latencyMs: { not: null } },
      aggregates: [{ fn: 'avg', column: 'latencyMs', alias: 'avg_latency' }],
    }),
    db.selectMany('tool_invocations', {
      where,
      columns: ['createdAt'],
      orderBy: { createdAt: 'desc' },
      limit: MAX_PEAK_ROWS,
    }),
  ]);

  /** @type {Record<string, number>} */
  const statusCounts = { SUCCESS: 0, FAILED: 0, TIMEOUT: 0 };
  for (const row of byStatus) statusCounts[row.status] = row.total;

  /** @dev Non-SUCCESS calls per tool, folded from the (tool, status) groups. */
  const failuresByTool = new Map();
  for (const row of byToolStatus) {
    if (row.status === 'SUCCESS') continue;
    failuresByTool.set(row.tool, (failuresByTool.get(row.tool) ?? 0) + row.total);
  }

  const tools = byTool.map((row) => {
    const count = row.total;
    const failures = failuresByTool.get(row.tool) ?? 0;
    return {
      tool: row.tool,
      count,
      percent: percent(count, total),
      successRate: percent(count - failures, count),
      // Null means "never measured", which is not the same as zero latency.
      avgLatencyMs: row.avg_latency === null ? null : Math.round(row.avg_latency),
    };
  });

  return {
    range: { days, from: from.toISOString() },
    item: {
      total,
      succeeded: statusCounts.SUCCESS,
      failed: statusCounts.FAILED,
      timeout: statusCounts.TIMEOUT,
      successRate: percent(statusCounts.SUCCESS, total),
      avgLatencyMs: latency[0].avg_latency === null ? null : Math.round(latency[0].avg_latency),
      peakWindow: peakWindow(timestamps.map((row) => row.createdAt)),
      tools,
    },
  };
};

module.exports = { getStats };
