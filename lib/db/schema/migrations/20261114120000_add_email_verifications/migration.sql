-- Email proof for registration. The account does not exist yet, so there is
-- no userId. Requesting a new code voids every older unconsumed row for that
-- address, the same rule password_resets uses for an existing user.
--
-- CreateTable
CREATE TABLE `email_verifications` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `email_verifications_email_idx`(`email`),
    PRIMARY KEY (`id`),
    CONSTRAINT `email_verifications_attempts_nonneg` CHECK (`attempts` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
