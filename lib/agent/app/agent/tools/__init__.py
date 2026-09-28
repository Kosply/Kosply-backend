"""Agent tools, grouped by function. All tools are basic on purpose."""

from .catalog import get_product_detail, search_catalog
from .contact import request_seller_contact
from .roles import get_user_role

TOOLS = [search_catalog, get_product_detail, request_seller_contact, get_user_role]

SENSITIVE_TOOLS = {"request_seller_contact"}
