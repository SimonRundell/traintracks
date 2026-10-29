<?php
/**
 * Shared CORS + session bootstrap. Always included first, before db.php, in every endpoint.
 *
 * Reflects back the request Origin when it's localhost on any port, so Vite's dev server is accepted
 * regardless of which port it's running on. Credentialed (cookies) rather than wildcard, since the
 * session cookie carrying login state has to cross from Vite's port to Apache's. SameSite=Lax (not None)
 * is enough for that: "site" for cookie purposes is the registrable domain, not the port, so
 * localhost:5173 and localhost:80 are the *same* site as far as the browser's cookie jar is concerned —
 * Lax cookies are sent on same-site requests regardless of method. SameSite=None would also work, but
 * browsers reject it outright without Secure, which plain HTTP localhost can't set — Lax sidesteps that
 * requirement entirely rather than relying on a Secure exemption that doesn't actually apply here.
 */

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (preg_match('#^https?://localhost(:\d+)?$#', $origin)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Credentials: true');
}
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'samesite' => 'Lax',
    'secure' => false,
    'httponly' => true,
]);
session_start();
