-- Forward-only migration: add the social, conversation, poll and star tables.
--
-- Why this exists
-- ---------------
-- The API queries ten models that `prisma/migrations/20260807120000_init` never
-- created and that were also absent from `schema.mysql.prisma`. On a MySQL
-- deployment those routes fail at runtime with
--   "Cannot read properties of undefined (reading 'findMany')"
-- (reproduced against the SQLite runtime, where the same models were missing:
--  GET /api/conversations -> 500, GET /api/reports -> 500, message starring -> 500).
--
-- Affected routes include /api/conversations, /api/conversations/[id]/messages,
-- /api/posts, /api/reports, /api/polls, /api/messages/[id]/star and
-- /api/friends (block list).
--
-- Safety
-- ------
-- * Purely additive: CREATE TABLE only. No ALTER, DROP, RENAME or DELETE.
-- * No existing table or row is touched.
-- * IF NOT EXISTS, so a partially-applied run can be retried.
-- * Foreign keys point only at tables the init migration already created.
-- * No backfill: these are new features with no historical rows to migrate.
--
-- Rollback: DROP statements at the end (commented; dropping them loses data).

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Block` (
  `id`        VARCHAR(191) NOT NULL,
  `fromId`    VARCHAR(191) NOT NULL,
  `toId`      VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Block_fromId_toId_key` (`fromId`, `toId`),
  INDEX `Block_toId_idx` (`toId`),
  CONSTRAINT `Block_fromId_fkey` FOREIGN KEY (`fromId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Block_toId_fkey`   FOREIGN KEY (`toId`)   REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Friend requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `FriendRequest` (
  `id`        VARCHAR(191) NOT NULL,
  `fromId`    VARCHAR(191) NOT NULL,
  `toId`      VARCHAR(191) NOT NULL,
  `message`   TEXT NULL,
  `status`    VARCHAR(50) NOT NULL DEFAULT 'pending',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `FriendRequest_fromId_toId_key` (`fromId`, `toId`),
  INDEX `FriendRequest_toId_status_idx` (`toId`, `status`),
  CONSTRAINT `FriendRequest_fromId_fkey` FOREIGN KEY (`fromId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `FriendRequest_toId_fkey`   FOREIGN KEY (`toId`)   REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Posts, comments, reactions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Post` (
  `id`         VARCHAR(191) NOT NULL,
  `authorId`   VARCHAR(191) NOT NULL,
  `content`    TEXT NOT NULL,
  `mediaUrl`   TEXT NULL,
  `visibility` VARCHAR(50) NOT NULL DEFAULT 'friends',
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `Post_authorId_createdAt_idx` (`authorId`, `createdAt`),
  CONSTRAINT `Post_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `PostComment` (
  `id`        VARCHAR(191) NOT NULL,
  `postId`    VARCHAR(191) NOT NULL,
  `authorId`  VARCHAR(191) NOT NULL,
  `content`   TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `PostComment_postId_createdAt_idx` (`postId`, `createdAt`),
  CONSTRAINT `PostComment_postId_fkey`   FOREIGN KEY (`postId`)   REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PostComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `PostReaction` (
  `id`        VARCHAR(191) NOT NULL,
  `postId`    VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `emoji`     VARCHAR(32) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PostReaction_postId_userId_emoji_key` (`postId`, `userId`, `emoji`),
  CONSTRAINT `PostReaction_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PostReaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- User reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Report` (
  `id`        VARCHAR(191) NOT NULL,
  `fromId`    VARCHAR(191) NOT NULL,
  `toId`      VARCHAR(191) NOT NULL,
  `reason`    VARCHAR(255) NOT NULL,
  `detail`    TEXT NULL,
  `status`    VARCHAR(50) NOT NULL DEFAULT 'open',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `Report_status_createdAt_idx` (`status`, `createdAt`),
  INDEX `Report_toId_idx` (`toId`),
  CONSTRAINT `Report_fromId_fkey` FOREIGN KEY (`fromId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Report_toId_fkey`   FOREIGN KEY (`toId`)   REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Conversations (thread model used by the chat API)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Conversation` (
  `id`          VARCHAR(191) NOT NULL,
  `type`        VARCHAR(50) NOT NULL DEFAULT 'direct',
  `title`       VARCHAR(255) NULL,
  `avatarUrl`   TEXT NULL,
  `description` TEXT NULL,
  `ownerId`     VARCHAR(191) NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ConversationMember` (
  `id`             VARCHAR(191) NOT NULL,
  `conversationId` VARCHAR(191) NOT NULL,
  `userId`         VARCHAR(191) NOT NULL,
  `role`           VARCHAR(50) NOT NULL DEFAULT 'member',
  `joinedAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastReadAt`     DATETIME(3) NULL,
  `muted`          BOOLEAN NOT NULL DEFAULT FALSE,
  `pinned`         BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ConversationMember_conversationId_userId_key` (`conversationId`, `userId`),
  INDEX `ConversationMember_userId_idx` (`userId`),
  CONSTRAINT `ConversationMember_conversationId_fkey`
    FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ConversationMember_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Polls
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Poll` (
  `id`        VARCHAR(191) NOT NULL,
  `messageId` VARCHAR(191) NOT NULL,
  `question`  TEXT NOT NULL,
  `options`   TEXT NOT NULL,
  `expiresAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `Poll_messageId_idx` (`messageId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `PollVote` (
  `id`        VARCHAR(191) NOT NULL,
  `pollId`    VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `optionIdx` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PollVote_pollId_userId_key` (`pollId`, `userId`),
  CONSTRAINT `PollVote_pollId_fkey` FOREIGN KEY (`pollId`) REFERENCES `Poll`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PollVote_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
-- Rollback (manual, destructive):
--   DROP TABLE IF EXISTS `PollVote`;
--   DROP TABLE IF EXISTS `Poll`;
--   DROP TABLE IF EXISTS `ConversationMember`;
--   DROP TABLE IF EXISTS `Conversation`;
--   DROP TABLE IF EXISTS `Report`;
--   DROP TABLE IF EXISTS `PostReaction`;
--   DROP TABLE IF EXISTS `PostComment`;
--   DROP TABLE IF EXISTS `Post`;
--   DROP TABLE IF EXISTS `FriendRequest`;
--   DROP TABLE IF EXISTS `Block`;
-- ---------------------------------------------------------------------------
