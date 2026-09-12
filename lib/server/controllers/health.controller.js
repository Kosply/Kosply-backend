/**
 * @notice Returns the service health payload.
 * @dev Consumed by load balancers and PM2 health checks. Keep it
 * @dev dependency-free so it works even when downstream systems are down.
 * @param {import('express').Request} req Incoming HTTP request (unused).
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {void} Sends `{ status, service, uptime, timestamp }` with status 200.
 */
const getHealth = (req, res) => {
  res.json({
    status: 'ok',
    service: 'kosply-backend',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
};

module.exports = { getHealth };
