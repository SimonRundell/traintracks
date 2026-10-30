<?php
require_once __DIR__ . '/../cors.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers.php';

$userId = requireLogin();
$layoutId = (int) ($_GET['id'] ?? 0);

$db = getDb();

$layoutStmt = $db->prepare('SELECT id, name FROM layouts WHERE id = ? AND user_id = ?');
$layoutStmt->execute([$layoutId, $userId]);
$layout = $layoutStmt->fetch();
if (!$layout) {
    respond(['error' => 'Layout not found'], 404);
}

$assetsStmt = $db->prepare('SELECT asset_type, data FROM layout_assets WHERE layout_id = ?');
$assetsStmt->execute([$layoutId]);

$pieces = [];
$junctions = [];
$platforms = [];
$stations = [];
foreach ($assetsStmt->fetchAll() as $row) {
    $data = json_decode($row['data'], true);
    if ($row['asset_type'] === 'track_piece') {
        $pieces[] = $data;
    } elseif ($row['asset_type'] === 'junction') {
        $junctions[] = $data;
    } elseif ($row['asset_type'] === 'platform') {
        $platforms[] = $data;
    } elseif ($row['asset_type'] === 'station') {
        $stations[] = $data;
    }
}

respond(['layout' => $layout, 'pieces' => $pieces, 'junctions' => $junctions, 'platforms' => $platforms, 'stations' => $stations]);
