<?php
require_once __DIR__ . '/../cors.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers.php';

if (empty($_SESSION['user_id'])) {
    respond(['user' => null]);
}

$db = getDb();
$stmt = $db->prepare('SELECT id, username FROM users WHERE id = ?');
$stmt->execute([$_SESSION['user_id']]);
$user = $stmt->fetch();

if (!$user) {
    // Session outlived the account (deleted elsewhere) — clear it rather than keep reporting a ghost login.
    $_SESSION = [];
    session_destroy();
    respond(['user' => null]);
}

respond(['user' => ['id' => (int) $user['id'], 'username' => $user['username']]]);
