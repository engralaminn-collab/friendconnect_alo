-- Forward-only migration: add `Attachment` and `VerificationToken`.
--
-- Why this exists
-- ---------------
-- `schema.prisma` declares both models but neither appeared in the init
-- migration nor in `schema.mysql.prisma`. `Attachment` is used by
-- POST /api/conversations/[id]/messages (attachmentIds -> attachments.connect)
-- and `VerificationToken` backs the email-verification flow.
--
-- Safety: additive only, IF NOT EXISTS, no existing object touched.
--
-- Rollback (manual, destructive):
--   DROP TABLE IF EXISTS `Attachment`;
--   DROP TABLE IF EXISTS `VerificationToken`;

CREATE TABLE IF NOT EXISTS `Attachment` (
  `id`        VARCHAR(191) NOT NULL,
  `messageId` VARCHAR(191) NULL,
  `ownerId`   VARCHAR(191) NOT NULL,
  `filename`  VARCHAR(255) NOT NULL,
  `mimeType`  VARCHAR(255) NOT NULL,
  `size`      INTEGER NOT NULL,
  `url`       TEXT NOT NULL,
  `thumbUrl`  TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `Attachment_messageId_idx` (`messageId`),
  INDEX `Attachment_ownerId_idx` (`ownerId`),
  CONSTRAINT `Attachment_messageId_fkey`
    FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `VerificationToken` (
  `id`         VARCHAR(191) NOT NULL,
  `identifier` VARCHAR(255) NOT NULL,
  `token`      VARCHAR(255) NOT NULL,
  `expires`    DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `VerificationToken_token_key` (`token`),
  UNIQUE INDEX `VerificationToken_identifier_token_key` (`identifier`, `token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
