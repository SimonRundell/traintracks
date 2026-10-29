<?php
require_once __DIR__ . '/../cors.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers.php';

$body = readJsonBody();
$username = trim($body['username'] ?? '');
$password = (string) ($body['password'] ?? '');

$db = getDb();
$stmt = $db->prepare('SELECT id, username, password_hash FROM users WHERE username = ?');
$stmt->execute([$username]);
$user = $stmt->fetch();

if (!$user || !password_verify($password, $user['password_hash'])) {
    respond(['error' => 'Incorrect username or password'], 401);
}

$_SESSION['user_id'] = (int) $user['id'];

respond(['user' => ['id' => (int) $user['id'], 'username' => $user['username']]]);
