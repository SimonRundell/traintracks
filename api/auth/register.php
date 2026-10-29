<?php
require_once __DIR__ . '/../cors.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers.php';

$body = readJsonBody();
$username = trim($body['username'] ?? '');
$password = (string) ($body['password'] ?? '');
$email = trim($body['email'] ?? '') ?: null;

if (mb_strlen($username) < 3 || mb_strlen($username) > 50) {
    respond(['error' => 'Username must be 3-50 characters'], 422);
}
if (mb_strlen($password) < 8) {
    respond(['error' => 'Password must be at least 8 characters'], 422);
}

$db = getDb();

$existing = $db->prepare('SELECT id FROM users WHERE username = ?');
$existing->execute([$username]);
if ($existing->fetch()) {
    respond(['error' => 'That username is already taken'], 409);
}

$insert = $db->prepare('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)');
$insert->execute([$username, password_hash($password, PASSWORD_DEFAULT), $email]);

$userId = (int) $db->lastInsertId();
$_SESSION['user_id'] = $userId;

respond(['user' => ['id' => $userId, 'username' => $username]], 201);
