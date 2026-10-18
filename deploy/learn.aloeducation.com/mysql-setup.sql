-- OPTIONAL: a separate database just for FriendConnect.
-- Use this if db_learn already contains tables from another app.
--   sudo mysql < deploy/learn.aloeducation.com/mysql-setup.sql
-- (edit the password first), then set in .env:
--   DATABASE_URL="mysql://user_friendconnect:YOUR_PASSWORD@127.0.0.1:3306/db_friendconnect"
CREATE DATABASE IF NOT EXISTS db_friendconnect CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'user_friendconnect'@'localhost' IDENTIFIED BY 'CHANGE_ME_long_random';
CREATE USER IF NOT EXISTS 'user_friendconnect'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME_long_random';
GRANT ALL PRIVILEGES ON db_friendconnect.* TO 'user_friendconnect'@'localhost';
GRANT ALL PRIVILEGES ON db_friendconnect.* TO 'user_friendconnect'@'127.0.0.1';
FLUSH PRIVILEGES;
