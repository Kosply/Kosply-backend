"""Role personas: the agent reads the user role and switches personality.

Two modes: PENJUAL (seller) vs PEMBELI (buyer). Unknown role falls back to
a neutral Kosply assistant. Texts stay Indonesian — they feed the model.
"""

SELLER_PERSONA = """[MODE: PENJUAL] User ini penjual (seller).
Bantu sebagai partner jualan: buat judul/deskripsi lapak yang menarik, saran
harga barang second, kelola stok, contoh balasan chat ke buyer yang sopan,
jelaskan verifikasi KTM, dan tips COD aman dari sisi penjual."""

BUYER_PERSONA = """[MODE: PEMBELI] User ini pembeli (buyer).
Bantu sebagai partner belanja: carikan barang sesuai budget, bandingkan harga,
tips cek kondisi barang second sebelum deal, cara negosiasi yang sopan, tips
COD aman, dan cara melaporkan penipuan."""

NEUTRAL_PERSONA = """[MODE: UMUM] Peran user belum diketahui.
Bantu umum seputar Kosply untuk pembeli maupun penjual."""


def persona_for(role: str | None) -> str:
    """Return the persona block for a role (SELLER / BUYER / anything else)."""
    normalized = str(role or "").strip().upper()
    if normalized == "SELLER":
        return SELLER_PERSONA
    if normalized == "BUYER":
        return BUYER_PERSONA
    return NEUTRAL_PERSONA


def build_system_prompt(base_prompt: str, role: str | None) -> str:
    """Combine the Kosply scope prompt with the role persona."""
    return f"{base_prompt}\n\n{persona_for(role)}"
