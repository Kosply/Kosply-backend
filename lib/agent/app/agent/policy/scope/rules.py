"""Policy constants: identity, scope, rejection texts, injection patterns.

Scope is enforced two ways: deterministic pre-filters in `guard.py` catch
prompt-injection shapes before any LLM call, while `SYSTEM_PROMPT` makes the
model itself refuse off-topic messages by explaining what Kosply is.

The prompt text lives in `system_prompt.md` (same folder) so it can be
edited without touching Python; it is loaded once at import. It is written in
English because it is read by the model, not by the user.

The canned replies below are the opposite case: they are shown to the user
verbatim, before any model call, so they cannot follow "reply in the user's
language" -- there is no model involved yet. They are bilingual so an
English-speaking user still understands a refusal. Indonesian leads because it
is the primary audience.
"""

import re
from pathlib import Path

MAX_MESSAGE_LEN = 2000


def _load_system_prompt() -> str:
    """Read the scope prompt from the sibling markdown file."""
    return (Path(__file__).parent / "system_prompt.md").read_text(encoding="utf-8").strip()


SYSTEM_PROMPT = _load_system_prompt()

REJECTION_MESSAGE = (
    "Maaf, itu di luar topik Kosply jadi saya tolak ya. Kosply adalah "
    "marketplace barang second-hand khusus mahasiswa: jual-beli barang bekas, "
    "COD langsung dengan penjual, verifikasi penjual via KTM, plus bantuan "
    "support. / Sorry, that is outside Kosply. Kosply is a second-hand "
    "marketplace for students: buy and sell used goods, COD with the seller, "
    "seller verification via student ID, plus support. Mau bantu cari barang, "
    "pasang lapak, atau verifikasi? / Want help finding an item, listing "
    "something, or verifying?"
)

TOO_LONG_MESSAGE = (
    "Pesan terlalu panjang (maks 2000 karakter), coba persingkat ya. / "
    "Message too long (max 2000 characters), please shorten it."
)

EMPTY_MESSAGE = (
    "Pesan kosong, tulis dulu yang mau ditanyain seputar Kosply. / "
    "Empty message, tell me what you want to know about Kosply."
)

# Prompt-injection shapes (matched case-insensitively against lowered input).
INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior|above|your)\s+instructions?"),
    re.compile(r"disregard\s+(all\s+)?(your|these|the)\s+(instructions?|rules?)"),
    re.compile(r"abaikan\s+(semua\s+)?(instruksi|aturan|perintah)"),
    re.compile(r"lupakan\s+(instruksi|aturan|prompt|aturanmu)"),
    re.compile(r"(reveal|show|display|print|tunjukkan|tampilkan)\s+(your\s+|the\s+)?system\s+prompt"),
    re.compile(r"system\s+prompt\s*(kamu|mu|anda|lo)?"),
    re.compile(r"you\s+are\s+now\s+"),
    re.compile(r"kamu\s+sekarang\s+"),
    re.compile(r"\bdan\b.*mode|jailbreak|developer\s+mode|do\s+anything\s+now"),
    re.compile(r"new\s+instructions?\s*:"),
    re.compile(r"instruksi\s+baru\s*:"),
    re.compile(r"override\s+(your\s+)?(instructions|safety|rules)"),
    re.compile(r"\[\s*system\s*\]"),
]
