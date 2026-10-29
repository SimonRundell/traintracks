<?php
require_once __DIR__ . '/../cors.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers.php';

$userId = requireLogin();
$layoutId = (int) ($_GET['id'] ?? 0);

$db = getDb();
$stmt = $db->prepare('DELETE FROM layouts WHERE id = ? AND user_id = ?');
$stmt->execute([$layoutId, $userId]);

if ($stmt->rowCount() === 0) {
    respond(['error' => 'Layout not found'], 404);
}

respond(['ok' => true]);
