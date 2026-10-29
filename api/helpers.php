<?php
/**
 * Small shared helpers used across endpoints. Included after cors.php + db.php.
 */

/**
 * Reads and JSON-decodes the request body.
 *
 * @return array Decoded body, or an empty array if there wasn't one / it wasn't valid JSON.
 */
function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/**
 * Ends the request with a JSON body and the given HTTP status.
 *
 * @param mixed $data
 * @param int $status
 * @return never
 */
function respond($data, int $status = 200)
{
    http_response_code($status);
    echo json_encode($data);
    exit;
}

/**
 * Ends the request with a 401 unless a logged-in session is present.
 *
 * @return int The logged-in user's id.
 */
function requireLogin(): int
{
    if (empty($_SESSION['user_id'])) {
        respond(['error' => 'Not logged in'], 401);
    }
    return $_SESSION['user_id'];
}
