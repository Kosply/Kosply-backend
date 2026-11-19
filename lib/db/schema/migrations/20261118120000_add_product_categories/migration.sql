-- Product categories the add-product dropdown offers.
--
-- `products.category` stays a free VARCHAR so older listings keep the words
-- the seller typed. New writes must use one of these names (or leave the
-- column empty). `isActive` hides a row from `GET /api/categories` without
-- deleting it. No foreign key, same as the rest of the schema.
--
-- The INSERT is idempotent: DDL on MariaDB commits itself, so a retry after
-- a partial failure must not die on a table or row that already exists.
-- Names match the dashboard seed products (Elektronik, Buku, Peralatan Kos,
-- Olahraga) plus the rest of the seller dropdown.

-- CreateTable
CREATE TABLE IF NOT EXISTS `product_categories` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE KEY `product_categories_name_key`(`name`),
    INDEX `product_categories_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `product_categories` (`id`, `name`, `sortOrder`, `isActive`, `createdAt`, `updatedAt`)
VALUES
    ('cat-elektronik', 'Elektronik', 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('cat-buku', 'Buku', 1, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('cat-peralatan-kos', 'Peralatan Kos', 2, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('cat-olahraga', 'Olahraga', 3, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('cat-pakaian', 'Pakaian', 4, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('cat-furnitur', 'Furnitur', 5, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('cat-alat-tulis', 'Alat Tulis', 6, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('cat-kecantikan', 'Kecantikan', 7, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('cat-hobi', 'Hobi', 8, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('cat-lainnya', 'Lainnya', 9, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
    `name` = VALUES(`name`),
    `sortOrder` = VALUES(`sortOrder`),
    `isActive` = true,
    `updatedAt` = CURRENT_TIMESTAMP(3);
