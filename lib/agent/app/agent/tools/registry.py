"""Agent tools registry: everything the graph may call, plus sensitivity flags."""

from .catalog.catalog import get_product_detail, search_catalog
from .chat.chat import read_conversation, send_chat_message
from .contact.contact import request_seller_contact
from .roles.roles import get_user_role
from .ui.ui import perform_callback, read_ui_state

TOOLS = [search_catalog, get_product_detail, request_seller_contact,
         get_user_role, read_ui_state, perform_callback,
         read_conversation, send_chat_message]

SENSITIVE_TOOLS = {"request_seller_contact", "send_chat_message"}

__all__ = [
    "SENSITIVE_TOOLS",
    "TOOLS",
    "get_product_detail",
    "get_user_role",
    "perform_callback",
    "read_conversation",
    "read_ui_state",
    "request_seller_contact",
    "search_catalog",
    "send_chat_message",
]
