<?php
require_once __DIR__ . '/../cors.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers.php';

$userId = requireLogin();
$body = readJsonBody();

$name = trim($body['name'] ?? '');
$pieces = $body['pieces'] ?? null;
$junctions = $body['junctions'] ?? null;
$platforms = $body['platforms'] ?? [];
$stations = $body['stations'] ?? [];

if ($name === '' || mb_strlen($name) > 100) {
    respond(['error' => 'Layout name must be 1-100 characters'], 422);
}
if (!is_array($pieces) || !is_array($junctions) || !is_array($platforms) || !is_array($stations)) {
    respond(['error' => 'pieces, junctions, platforms, and stations must be arrays'], 422);
}

$db = getDb();
$db->beginTransaction();
try {
    // Upsert the layout row by (user_id, name) — saving under a name you already used overwrites that
    // layout; a new name creates a new one. See schema.sql's uniq_user_layout_name.
    $upsert = $db->prepare(
        'INSERT INTO layouts (user_id, name) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP',
    );
    $upsert->execute([$userId, $name]);

    $idStmt = $db->prepare('SELECT id FROM layouts WHERE user_id = ? AND name = ?');
    $idStmt->execute([$userId, $name]);
    $layoutId = (int) $idStmt->fetchColumn();

    // Full replace: simplest correct way to keep layout_assets consistent with whatever was just sent,
    // including pieces/junctions that were deleted since the layout was last saved.
    $db->prepare('DELETE FROM layout_assets WHERE layout_id = ?')->execute([$layoutId]);

    $insertAsset = $db->prepare(
        'INSERT INTO layout_assets (layout_id, asset_type, ref_id, data) VALUES (?, ?, ?, ?)',
    );
    foreach ($pieces as $piece) {
        $insertAsset->execute([$layoutId, 'track_piece', (int) $piece['id'], json_encode($piece)]);
    }
    foreach ($junctions as $junction) {
        $insertAsset->execute([$layoutId, 'junction', (int) $junction['id'], json_encode($junction)]);
    }
    foreach ($platforms as $platform) {
        $insertAsset->execute([$layoutId, 'platform', (int) $platform['id'], json_encode($platform)]);
    }
    foreach ($stations as $station) {
        $insertAsset->execute([$layoutId, 'station', (int) $station['id'], json_encode($station)]);
    }

    $db->commit();
} catch (Exception $e) {
    $db->rollBack();
    respond(['error' => 'Save failed: ' . $e->getMessage()], 500);
}

respond(['layout' => ['id' => $layoutId, 'name' => $name]]);
