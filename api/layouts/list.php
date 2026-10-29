<?php
require_once __DIR__ . '/../cors.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers.php';

$userId = requireLogin();

$db = getDb();
$stmt = $db->prepare('SELECT id, name, created_at, updated_at FROM layouts WHERE user_id = ? ORDER BY updated_at DESC');
$stmt->execute([$userId]);

respond(['layouts' => $stmt->fetchAll()]);
