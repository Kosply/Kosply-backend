"""Agent tools, grouped by function. All tools are basic on purpose."""

from .catalog import get_product_detail, search_catalog
from .contact import request_seller_contact

TOOLS = [search_catalog, get_product_detail, request_seller_contact]

SENSITIVE_TOOLS = {"request_seller_contact"}
