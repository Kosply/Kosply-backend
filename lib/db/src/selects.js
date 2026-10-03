/**
 * @title Public Prisma selects (leak prevention)
 * @notice Whitelisted field sets for machine/public responses.
 * @dev Import these in controllers instead of hand-writing `select`
 * @dev so sensitive columns (email, passwordHash, nim, ktmImageUrl)
 * @dev can never leak through a new endpoint by accident.
 */
const PUBLIC_SELLER_SELECT = {
  username: true,
  name: true,
  role: true,
  universitas: true,
};

const PUBLIC_PRODUCT_LIST_SELECT = {
  id: true,
  title: true,
  price: true,
  stock: true,
  imageUrls: true,
  category: true,
  latitude: true,
  longitude: true,
  locationLabel: true,
  seller: { select: PUBLIC_SELLER_SELECT },
};

const PUBLIC_PRODUCT_DETAIL_SELECT = {
  ...PUBLIC_PRODUCT_LIST_SELECT,
  description: true,
  status: true,
};

const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
  name: true,
  role: true,
  universitas: true,
};

/**
 * Seller-private analytics read set. Owner-only fields (sellerId) are added
 * by the service after the ownership check, never returned to the client.
 */
const SELLER_ANALYTICS_PRODUCT_SELECT = {
  id: true,
  title: true,
  status: true,
  price: true,
  stock: true,
  createdAt: true,
  soldAt: true,
};

module.exports = {
  PUBLIC_SELLER_SELECT,
  PUBLIC_PRODUCT_LIST_SELECT,
  PUBLIC_PRODUCT_DETAIL_SELECT,
  PUBLIC_USER_SELECT,
  SELLER_ANALYTICS_PRODUCT_SELECT,
};
