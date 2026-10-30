<?php
require_once __DIR__ . '/../cors.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers.php';

requireLogin();

$db = getDb();
$rows = $db->query('SELECT item_key, category, label, glb_url, length_m FROM rolling_stock ORDER BY category, label')->fetchAll();

$items = array_map(function ($row) {
    return [
        'key' => $row['item_key'],
        'category' => $row['category'],
        'label' => $row['label'],
        'glbUrl' => $row['glb_url'],
        'lengthM' => $row['length_m'] !== null ? (float) $row['length_m'] : null,
    ];
}, $rows);

respond(['items' => $items]);
