"""Context compaction: shrink long histories so small-window models survive.

When a thread grows past message/token budgets, older turns are summarized
into one `SystemMessage` and the originals are dropped via `RemoveMessage`
(plus `REMOVE_ALL_MESSAGES`). Recent turns always stay verbatim, so resume
quality holds while token usage stays bounded.
"""

from langchain_core.messages import HumanMessage, SystemMessage

SUMMARIZE_PROMPT = (
    "Summarize this conversation history for continuation. "
    "Preserve: the user's goal, key facts and decisions, pending items, "
    "and open questions. Be concise (under 300 words).\n\nHistory:\n"
)

SUMMARY_ID = "context-summary"

_tokenizer = None


def get_tokenizer():
    """cl100k tokenizer, cached; None when tiktoken is missing (heuristic fallback)."""
    global _tokenizer
    if _tokenizer is None:
        try:
            import tiktoken

            _tokenizer = tiktoken.get_encoding("cl100k_base")
        except Exception:
            _tokenizer = False
    return _tokenizer or None


def count_tokens(messages: list) -> int:
    """Real token count via tiktoken (~chars/4 fallback without it)."""
    tokenizer = get_tokenizer()
    total = 0
    for message in messages:
        content = getattr(message, "content", "")
        text = content if isinstance(content, str) else str(content)
        total += len(tokenizer.encode(text)) if tokenizer else len(text) / 4
    return int(total)


def estimate_tokens(messages: list) -> int:
    """Alias kept for callers (now tokenizer-backed)."""
    return count_tokens(messages)


def needs_compaction(messages: list, *, max_messages: int,
                     threshold_pct: float, context_total: int) -> bool:
    """True past the message cap or past threshold % of the total window."""
    if len(messages) > max_messages:
        return True
    if context_total <= 0:
        return False
    return count_tokens(messages) > context_total * threshold_pct / 100


async def summarize_history(old_messages: list, llm) -> SystemMessage:
    """Condense older turns into one system message (rolling: summaries re-summarize)."""
    transcript = "\n".join(
        f"{getattr(m, 'type', 'msg')}: {getattr(m, 'content', '')}" for m in old_messages
    )
    out = await llm.ainvoke([HumanMessage(content=SUMMARIZE_PROMPT + transcript)])
    text = out.content if isinstance(out.content, str) else str(out.content)
    return SystemMessage(
        content=f"[Compacted context — summary of {len(old_messages)} earlier messages]\n{text}",
        id=SUMMARY_ID,
    )
