<?php
require_once __DIR__ . '/../cors.php';
require_once __DIR__ . '/../helpers.php';

$_SESSION = [];
session_destroy();

respond(['ok' => true]);
