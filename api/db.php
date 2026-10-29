<?php
/**
 * Shared PDO connection, configured from .config.json (gitignored — see .config.example.json for the
 * template). Always first in any endpoint's include order, after cors.php.
 *
 * @return PDO
 */
function getDb(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $configPath = __DIR__ . '/.config.json';
    if (!file_exists($configPath)) {
        http_response_code(500);
        echo json_encode(['error' => 'Missing api/.config.json — copy api/.config.example.json and fill in your DB credentials.']);
        exit;
    }
    $config = json_decode(file_get_contents($configPath), true)['db'];

    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $config['host'],
        $config['port'],
        $config['database'],
    );

    try {
        $pdo = new PDO($dsn, $config['username'], $config['password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
        exit;
    }

    return $pdo;
}
