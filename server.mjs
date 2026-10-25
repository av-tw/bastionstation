// Serves site/ and a tg-style /serverinfo.json built from the game server's BYOND "?status" topic.
// Usage: node server.mjs   (env: PORT, HOST, BYOND_HOST, BYOND_PORT, PUBLIC_ADDRESS; see README)
import http from 'node:http';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8790);
// Loopback by default: run this behind a reverse proxy that terminates TLS. Use 0.0.0.0 in a container.
const HOST = process.env.HOST || '127.0.0.1';
const BYOND_HOST = process.env.BYOND_HOST || 'www.bastionstation.com';
const BYOND_PORT = Number(process.env.BYOND_PORT || 1336);
const PUBLIC_ADDRESS = process.env.PUBLIC_ADDRESS || `${BYOND_HOST}:${BYOND_PORT}`;
const IDENTIFIER = 'bastion';
// Every visitor shares one cached query, so page traffic never reaches the game server directly.
const CACHE_MS = 10_000;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// BYOND topic packet: 0x0083, BE uint16 length, 5 zero bytes, query, NUL. Reply type 0x06 is a NUL-terminated string.
function topic(query) {
  return new Promise((resolve, reject) => {
    const q = Buffer.from(query, 'latin1');
    const packet = Buffer.alloc(q.length + 10);
    packet.writeUInt16BE(0x0083, 0);
    packet.writeUInt16BE(q.length + 6, 2);
    q.copy(packet, 9);
    let reply = Buffer.alloc(0);
    const socket = net.connect(BYOND_PORT, BYOND_HOST, () => socket.write(packet));
    socket.setTimeout(5000, () => socket.destroy(new Error('timeout')));
    socket.on('data', (chunk) => {
      reply = Buffer.concat([reply, chunk]);
      if (reply.length >= 4 && reply.length >= 4 + reply.readUInt16BE(2)) socket.end();
    });
    socket.on('error', reject);
    socket.on('close', () => {
      if (reply[4] !== 0x06) return reject(new Error('unexpected reply'));
      resolve(reply.subarray(5).toString('latin1').replace(/\0+$/, ''));
    });
  });
}

// Matches what tg's banner reads: numbers as numbers, hub/bunkered as booleans, bare keys as null.
function parseStatus(text) {
  const data = {};
  for (const part of text.split('&')) {
    const [rawKey, ...rest] = part.split('=');
    const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    if (!rest.length) { data[key] = null; continue; }
    const value = decodeURIComponent(rest.join('=').replace(/\+/g, ' '));
    if (key === 'hub' || key === 'bunkered') data[key] = value === '1';
    else if (key !== 'revision' && key !== 'round_id' && /^-?\d+(\.\d+)?$/.test(value)) data[key] = Number(value);
    else data[key] = value;
  }
  data.public_address = PUBLIC_ADDRESS;
  return data;
}

let cached = null;
let cachedAt = 0;
let inflight = null;

async function serverinfo() {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  inflight ??= topic('?status')
    .then(parseStatus, (error) => {
      console.error(`status query to ${BYOND_HOST}:${BYOND_PORT} failed: ${error.message}`);
      return { ERROR: String(error.message) };
    })
    .then((data) => {
      cached = { servers: [{ identifier: IDENTIFIER, retry_wait: 0, data }], last_update: new Date().toISOString() };
      cachedAt = Date.now();
      return cached;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

// Maps a request path to a file under site/, or null when it is malformed, escapes site/, or has a type we don't serve.
function staticFile(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const file = path.join(ROOT, path.normalize(decoded));
  const target = pathname.endsWith('/') ? path.join(file, 'index.html') : file;
  return target.startsWith(ROOT + path.sep) && TYPES[path.extname(target)] ? target : null;
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/serverinfo.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify(await serverinfo()));
    }
    const target = staticFile(url.pathname);
    const body = target && await readFile(target).catch(() => null);
    if (!body) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(target)] });
    res.end(body);
  } catch (error) {
    // One bad request must never take the process down.
    console.error(`${req.method} ${req.url}: ${error.message}`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(PORT, HOST, () => console.log(`http://${HOST}:${PORT}`));
