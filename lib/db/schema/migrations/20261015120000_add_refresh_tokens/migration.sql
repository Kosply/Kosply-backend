-- Refresh tokens, so a session can be renewed and — more importantly — revoked.
--
-- The access token stayed a stateless JWT, which meant there was no way to end
-- a session: `logout` cleared a cookie on one machine while the bearer token
-- stayed valid until its own `exp`. These rows are what make revocation real.
--
-- Design notes worth keeping:
--
--  * The token is 256 bits of CSPRNG output and only its HMAC-SHA256 is stored.
--    A database dump therefore yields no usable token, and the HMAC key lives in
--    the environment rather than beside the rows.
--
--  * `familyId` groups every token descended from one login. Rotation consumes
--    the presented token and issues its successor in the same family, so a
--    replayed token is recognisable: it is a token that was already consumed.
--    Reuse revokes the whole family rather than just that row, because a replay
--    means either an attacker or a stolen client has a copy and neither can be
--    told apart from the legitimate holder.
--
--  * `consumedAt` (rotated away) and `revokedAt` (ended deliberately) are kept
--    apart on purpose. Collapsing them would make every logout look like theft
--    and tear down every other session the account has open.
--
--  * `subjectType`/`subjectId` instead of a `users` foreign key: dashboard
--    operators live in `admins`, whose id namespace is disjoint from `users`
--    (the same reason `seller_verifications.reviewedBy` carries no FK). A real
--    FK would have made refresh impossible for exactly half the accounts that
--    sign in through `/api/admin/login`.
--
-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `subjectType` VARCHAR(191) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL,
    `familyId` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `replacedById` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `ip` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `refresh_tokens_subjectIdx`(`subjectType`, `subjectId`),
    INDEX `refresh_tokens_familyId_idx`(`familyId`),
    INDEX `refresh_tokens_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Housekeeping is deliberately NOT a scheduled event here.
-- `CREATE EVENT` needs the EVENT privilege and `event_scheduler=ON`, which is
-- off by default in MariaDB, so putting one in a migration makes the migration
-- fail on a stock server — and because DDL commits implicitly, the table above
-- would be left behind without its ledger row, exactly the half-applied state
-- the runner warns about. Expired rows are instead swept opportunistically by
-- `refresh.service.js` whenever a token is issued. A deployment that wants a
-- scheduled sweep can add one out of band:
--
--   SET GLOBAL event_scheduler = ON;
--   CREATE EVENT refresh_tokens_purge_expired
--     ON SCHEDULE EVERY 1 DAY
--     DO DELETE FROM refresh_tokens WHERE expiresAt < NOW() - INTERVAL 30 DAY;
