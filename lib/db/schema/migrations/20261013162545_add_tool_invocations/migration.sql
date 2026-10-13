-- CreateTable
CREATE TABLE `tool_invocations` (
    `id` VARCHAR(191) NOT NULL,
    `tool` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `status` ENUM('SUCCESS', 'FAILED', 'TIMEOUT') NOT NULL DEFAULT 'SUCCESS',
    `latencyMs` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tool_invocations_tool_createdAt_idx`(`tool`, `createdAt`),
    INDEX `tool_invocations_model_createdAt_idx`(`model`, `createdAt`),
    INDEX `tool_invocations_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
