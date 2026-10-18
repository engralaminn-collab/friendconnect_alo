-- Widen columns that could overflow VARCHAR(191) on MySQL ("Data too long" → HTTP 500):
--  * Message.deletedFor grows by one user id (~26 chars) per "delete for me" in a group
--  * free-text profile fields, original file names and custom wallpaper values
ALTER TABLE `Message` MODIFY `deletedFor` VARCHAR(4096) NOT NULL DEFAULT '',
    MODIFY `fileName` TEXT NULL;

ALTER TABLE `Profile` MODIFY `location` TEXT NULL,
    MODIFY `education` TEXT NULL,
    MODIFY `work` TEXT NULL;

ALTER TABLE `ChatPreference` MODIFY `wallpaper` TEXT NULL;
