-- Saved listings (the product-detail heart) and the Help desk FAQ.
--
-- Design notes worth keeping:
--
--  * `favorites` has no surrogate id: a save *is* the (`userId`, `productId`)
--    pair. A duplicate save is therefore a duplicate-key event the service can
--    absorb with an upsert, instead of a second row the list would render twice.
--    A save is immutable until it is removed, so it carries `createdAt` only —
--    which is also the ordering key for the saved list.
--
--  * No foreign keys, same as the rest of the schema: this project manages
--    referential integrity in the data layer (and `testkit.cleanup` walks the
--    order), and a real FK would also block the soft-delete story — an
--    ARCHIVED product stays in the table so chat history keeps resolving, so a
--    `ON DELETE` rule would never fire anyway and would only add write cost.
--
--  * `help_topics` is a read-only catalog served publicly at
--    `GET /api/support/help-topics`. `isActive` is the soft-remove switch so a
--    pulled answer disappears from the app without deleting the row that
--    ticket categories or future links may still reference by id.
--
-- CreateTable
CREATE TABLE `favorites` (
    `userId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `favorites_productId_idx`(`productId`),
    PRIMARY KEY (`userId`, `productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `help_topics` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `answer` TEXT NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `help_topics_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
