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

-- Global catalogue of available rolling stock (not per-user) — what the Train panel's loco/wagon lists are
-- built from, and what a saved layout's consist (a layout_assets row, asset_type='consist', just an
-- ordered array of these item_keys) resolves against when a layout loads. length_m is nullable: locos and
-- carriages have a known real-world length, but a new wagon model can be added here without measuring it
-- by hand first — see rollingStock.js's measureModelLength, which fills the gap from the glTF's own
-- bounding box.
CREATE TABLE IF NOT EXISTS rolling_stock (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_key VARCHAR(50) NOT NULL,
  category ENUM('loco', 'carriage', 'wagon') NOT NULL,
  label VARCHAR(100) NOT NULL,
  glb_url VARCHAR(255) NOT NULL,
  length_m DECIMAL(5,2) NULL,
  UNIQUE KEY uniq_item_key (item_key)
) ENGINE=InnoDB;

INSERT INTO rolling_stock (item_key, category, label, glb_url, length_m) VALUES
  ('loco-020', 'loco', 'HST Power Car', '/models/loco-020.glb', 17.46),
  ('loco-034', 'loco', 'Class 08 Shunter', '/models/loco-034.glb', 8.92),
  ('carriage-020', 'carriage', 'Mk3 Carriage', '/models/carriage-020.glb', 23.00),
  ('freight-001', 'wagon', 'Freight Wagon A', '/models/freight-001.glb', NULL),
  ('freight-003', 'wagon', 'Freight Wagon B', '/models/freight-003.glb', NULL)
ON DUPLICATE KEY UPDATE
  category = VALUES(category),
  label = VALUES(label),
  glb_url = VALUES(glb_url),
  length_m = VALUES(length_m);
