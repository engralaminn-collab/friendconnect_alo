-- Forward-only migration: add the five Jara governance tables.
--
-- Why this exists
-- ---------------
-- `prisma/migrations/20260807120000_init` creates 23 tables, but
-- `prisma/schema.mysql.prisma` declares 28 models. The five `Jara*` models were
-- added to the schema after the init migration was written and no migration was
-- ever generated for them, so `prisma migrate deploy` on a MySQL database
-- produced a schema that did not match the code.
--
-- Safety
-- ------
-- * Purely additive: CREATE TABLE only. No ALTER, DROP, RENAME or DELETE.
-- * No existing table, row, index or constraint is touched.
-- * Safe to run on a database that already has the 23 init tables.
-- * Uses IF NOT EXISTS so a partially-applied state can be re-run safely.
-- * No backfill required: the application seeds Jara config on first use.
--
-- Rollback: see the commented DROP statements at the end. They are intentionally
-- left commented out; dropping these tables deletes Jara governance history.

-- ---------------------------------------------------------------------------
-- JaraConfig: versioned, hash-approved live configuration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `JaraConfig` (
  `id`                 VARCHAR(191) NOT NULL,
  `version`            INTEGER NOT NULL DEFAULT 1,
  `face`               VARCHAR(100) NOT NULL DEFAULT 'friendly',
  `avatar`             VARCHAR(100) NOT NULL DEFAULT 'default',
  `avatarUrl`          TEXT NULL,
  `background`         VARCHAR(100) NOT NULL DEFAULT 'gradient-emerald',
  `backgroundUrl`      TEXT NULL,
  `theme`              VARCHAR(50) NOT NULL DEFAULT 'light',
  `colors`             TEXT NULL,
  `animation`          TEXT NULL,
  `clothing`           TEXT NULL,
  `voiceModel`         VARCHAR(100) NOT NULL DEFAULT 'default',
  `voiceLanguage`      VARCHAR(20) NOT NULL DEFAULT 'bn',
  `voiceAccent`        VARCHAR(50) NULL,
  `speakingSpeed`      DOUBLE NOT NULL DEFAULT 1.0,
  `pitch`              DOUBLE NOT NULL DEFAULT 1.0,
  `personality`        VARCHAR(100) NOT NULL DEFAULT 'friendly',
  `responseLength`     VARCHAR(20) NOT NULL DEFAULT 'medium',
  `communicationStyle` VARCHAR(100) NOT NULL DEFAULT 'conversational',
  `llmProvider`        VARCHAR(100) NOT NULL DEFAULT 'ollama',
  `llmModel`           VARCHAR(100) NOT NULL DEFAULT 'llama3.2',
  `sttModel`           VARCHAR(100) NOT NULL DEFAULT 'whisper',
  `ttsModel`           VARCHAR(100) NOT NULL DEFAULT 'default',
  `memoryEnabled`      BOOLEAN NOT NULL DEFAULT TRUE,
  `isLive`             BOOLEAN NOT NULL DEFAULT FALSE,
  `createdBy`          VARCHAR(191) NULL,
  `createdAt`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`          DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `JaraConfig_version_key` (`version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- JaraProposal: proposed config changes awaiting Super Admin approval
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `JaraProposal` (
  `id`              VARCHAR(191) NOT NULL,
  `version`         INTEGER NOT NULL,
  `previousVersion` INTEGER NULL,
  `configJson`      LONGTEXT NOT NULL,
  `configHash`      VARCHAR(128) NOT NULL,
  `status`          VARCHAR(50) NOT NULL DEFAULT 'pending',
  `createdBy`       VARCHAR(191) NOT NULL,
  `createdAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt`       DATETIME(3) NOT NULL,
  `approvedBy`      VARCHAR(191) NULL,
  `approvedAt`      DATETIME(3) NULL,
  `appliedAt`       DATETIME(3) NULL,
  `changeSummary`   TEXT NULL,
  PRIMARY KEY (`id`),
  INDEX `JaraProposal_status_idx` (`status`),
  INDEX `JaraProposal_createdBy_idx` (`createdBy`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- JaraAuditLog: append-only record of governance attempts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `JaraAuditLog` (
  `id`         VARCHAR(191) NOT NULL,
  `proposalId` VARCHAR(191) NULL,
  `version`    INTEGER NULL,
  `action`     VARCHAR(100) NOT NULL,
  `actorId`    VARCHAR(191) NULL,
  `actorRole`  VARCHAR(50) NULL,
  `detail`     TEXT NULL,
  `ip`         VARCHAR(100) NULL,
  `userAgent`  TEXT NULL,
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `JaraAuditLog_action_idx` (`action`),
  INDEX `JaraAuditLog_createdAt_idx` (`createdAt`),
  CONSTRAINT `JaraAuditLog_proposalId_fkey`
    FOREIGN KEY (`proposalId`) REFERENCES `JaraProposal`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- JaraMemory: per-user memory, isolated by userId
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `JaraMemory` (
  `id`        VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `key`       VARCHAR(255) NOT NULL,
  `value`     TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `JaraMemory_userId_key_key` (`userId`, `key`),
  INDEX `JaraMemory_userId_idx` (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- JaraGroupConsent: explicit per-group opt-in for Jara participation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `JaraGroupConsent` (
  `id`            VARCHAR(191) NOT NULL,
  `groupId`       VARCHAR(191) NOT NULL,
  `enabled`       BOOLEAN NOT NULL DEFAULT FALSE,
  `listenEnabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `consentedBy`   VARCHAR(191) NULL,
  `consentedAt`   DATETIME(3) NULL,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `JaraGroupConsent_groupId_key` (`groupId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Rollback (manual, destructive — takes Jara governance history with it):
--   DROP TABLE IF EXISTS `JaraAuditLog`;
--   DROP TABLE IF EXISTS `JaraProposal`;
--   DROP TABLE IF EXISTS `JaraConfig`;
--   DROP TABLE IF EXISTS `JaraMemory`;
--   DROP TABLE IF EXISTS `JaraGroupConsent`;
-- ---------------------------------------------------------------------------
