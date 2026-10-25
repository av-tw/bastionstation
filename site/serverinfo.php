<?php
// PHP counterpart of server.mjs for shared hosting: builds a tg-style serverinfo.json from the game
// server's BYOND "?status" topic. Upload site/ to a PHP web host and .htaccess routes serverinfo.json here.
// Every visitor shares one cached query, so page traffic never reaches the game server directly.
// Settings can be overridden with SetEnv lines in .htaccess or by editing the defaults below.

declare(strict_types=1);

$byondHost = getenv('BYOND_HOST') ?: 'www.bastionstation.com';
$byondPort = (int) (getenv('BYOND_PORT') ?: 1336);
$publicAddress = getenv('PUBLIC_ADDRESS') ?: "$byondHost:$byondPort";
$identifier = 'bastion';
$cacheSeconds = 10;
// On a host where /tmp is shared between accounts, point this at a private writable directory instead.
$cacheFile = sys_get_temp_dir() . '/bastionstation-serverinfo.json';

// BYOND topic packet: 0x0083, BE uint16 length, 5 zero bytes, query, NUL. Reply type 0x06 is a NUL-terminated string.
function topic(string $host, int $port, string $query): string
{
    $socket = @fsockopen($host, $port, $errno, $errstr, 5);
    if ($socket === false) {
        throw new RuntimeException($errstr !== '' ? $errstr : "connect failed ($errno)");
    }
    stream_set_timeout($socket, 5);
    fwrite($socket, "\x00\x83" . pack('n', strlen($query) + 6) . "\x00\x00\x00\x00\x00" . $query . "\x00");
    $reply = '';
    while (!feof($socket)) {
        $chunk = fread($socket, 4096);
        if ($chunk === false || $chunk === '') {
            break;
        }
        $reply .= $chunk;
        if (strlen($reply) >= 4 && strlen($reply) >= 4 + unpack('n', $reply, 2)[1]) {
            break;
        }
    }
    $timedOut = stream_get_meta_data($socket)['timed_out'];
    fclose($socket);
    if ($timedOut) {
        throw new RuntimeException('timeout');
    }
    if (strlen($reply) < 5 || $reply[4] !== "\x06") {
        throw new RuntimeException('unexpected reply');
    }
    return rtrim(substr($reply, 5), "\0");
}

// Matches what tg's banner reads: numbers as numbers, hub/bunkered as booleans, bare keys as null.
function parseStatus(string $text, string $publicAddress): array
{
    $data = [];
    foreach (explode('&', $text) as $part) {
        $pair = explode('=', $part, 2);
        $key = urldecode($pair[0]);
        if (count($pair) === 1) {
            $data[$key] = null;
            continue;
        }
        $value = urldecode($pair[1]);
        if ($key === 'hub' || $key === 'bunkered') {
            $data[$key] = $value === '1';
        } elseif ($key !== 'revision' && $key !== 'round_id' && preg_match('/^-?\d+(\.\d+)?$/', $value) === 1) {
            $data[$key] = $value + 0;
        } else {
            $data[$key] = $value;
        }
    }
    $data['public_address'] = $publicAddress;
    return $data;
}

function build(string $host, int $port, string $publicAddress, string $identifier): string
{
    try {
        $data = parseStatus(topic($host, $port, '?status'), $publicAddress);
    } catch (RuntimeException $e) {
        error_log("status query to $host:$port failed: " . $e->getMessage());
        $data = ['ERROR' => $e->getMessage()];
    }
    return json_encode([
        'servers' => [['identifier' => $identifier, 'retry_wait' => 0, 'data' => $data]],
        'last_update' => gmdate('Y-m-d\TH:i:s\Z'),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
}

function serveCached(string $cacheFile, int $maxAge): bool
{
    clearstatcache(true, $cacheFile);
    if (@filemtime($cacheFile) <= time() - $maxAge) {
        return false;
    }
    $json = @file_get_contents($cacheFile);
    if ($json === false || $json === '') {
        return false;
    }
    echo $json;
    return true;
}

header('Content-Type: application/json');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');

if (serveCached($cacheFile, $cacheSeconds)) {
    exit;
}
// One refresh at a time: concurrent requests wait on the lock, then read what the first one wrote.
// The lock is released when the script ends.
$lock = @fopen($cacheFile . '.lock', 'c');
if ($lock !== false) {
    flock($lock, LOCK_EX);
    if (serveCached($cacheFile, $cacheSeconds)) {
        exit;
    }
}
$json = build($byondHost, $byondPort, $publicAddress, $identifier);
$tmp = @tempnam(dirname($cacheFile), 'serverinfo');
if ($tmp !== false && @file_put_contents($tmp, $json) !== false) {
    @rename($tmp, $cacheFile); // Atomic replace, so readers never see a partial file.
}
echo $json;
