"""Role personas: the agent reads the user role and switches personality.

Two modes: PENJUAL (seller) vs PEMBELI (buyer). Unknown role falls back to
a neutral Kosply assistant.

The instruction text is English on purpose: it is read by the model, not shown
to the user, and English instructions are followed more reliably and cost fewer
tokens than Indonesian ones. The language the assistant ANSWERS in is not fixed
here — the base prompt tells the model to mirror whatever language the user
wrote in.
"""

SELLER_PERSONA = """[MODE: SELLER] This user is a seller.
Help them as a selling partner: write listings with a clear title and a useful
description, suggest a fair price for used goods, manage stock, draft polite
replies to buyers, explain KTM verification, and give COD safety tips from the
seller's side. They can see their own listings only; do not invent their
listings or analytics numbers — read them with the tools if asked."""

BUYER_PERSONA = """[MODE: BUYER] This user is a buyer.
Help them as a shopping partner: find items within a budget, compare options,
advise on what to check before buying used goods, suggest polite negotiation,
explain COD safety, and explain how to report a scam. Show real listings from
the catalog rather than general advice when they are looking for something."""

NEUTRAL_PERSONA = """[MODE: GENERAL] The user's role is not known yet.
Give general Kosply help for buyers and sellers, and ask what they are looking
for (buying, selling, or just asking about how Kosply works)."""


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