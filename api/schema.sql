-- TrainTracks database schema.
--
-- Run this once against a fresh database to set up accounts and layout storage. layout_assets is
-- deliberately generic (asset_type + a JSON payload) so future non-track items — station buildings,
-- scenery, trackside signals — can be stored as new asset_type values without a schema change.

CREATE DATABASE IF NOT EXISTS traintracks CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE traintracks;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_username (username)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS layouts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_layouts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_user_layout_name (user_id, name)
) ENGINE=InnoDB;

-- One row per piece/junction (or, later, per station/scenery/signal placement) in a layout.
-- ref_id is the id that piece/junction had *within that layout* (not this table's own id) — links and
-- junction host/divert references are stored pointing at ref_id, and resolved back to real objects by the
-- frontend when a layout is loaded (see layoutSerializer.js).
CREATE TABLE IF NOT EXISTS layout_assets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  layout_id INT UNSIGNED NOT NULL,
  asset_type VARCHAR(30) NOT NULL,
  ref_id INT NOT NULL,
  data JSON NOT NULL,
  CONSTRAINT fk_assets_layout FOREIGN KEY (layout_id) REFERENCES layouts(id) ON DELETE CASCADE,
  INDEX idx_layout_type (layout_id, asset_type)
) ENGINE=InnoDB;
