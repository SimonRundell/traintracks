<?php
require_once __DIR__ . '/api/db.php';
$db = getDb();
$stmt = $db->prepare('DELETE FROM users WHERE username = ?');
$stmt->execute(['traincheck']);
echo "Deleted rows: " . $stmt->rowCount() . "\n";
