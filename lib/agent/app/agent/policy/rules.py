"""Policy constants: identity, scope, rejection texts, injection patterns.

Scope is enforced two ways: deterministic pre-filters in `guard.py` catch
prompt-injection shapes before any LLM call, while `SYSTEM_PROMPT` makes the
model itself refuse off-topic messages by explaining what Kosply is.

The prompt text lives in `system_prompt.md` (same folder) so it can be
edited without touching Python; it is loaded once at import.
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
    "marketplace barang second-hand khusus mahasiswa — buat jual-beli barang "
    "bekas, COD-an langsung, verifikasi penjual pakai KTM, dan ada bantuan "
    "support. Mau dibantu cari barang, pasang lapak, atau verifikasi?"
)

TOO_LONG_MESSAGE = "Pesan terlalu panjang (maks 2000 karakter). Coba persingkat ya."

EMPTY_MESSAGE = "Pesan kosong — tulis dulu yang mau ditanyain seputar Kosply."

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
