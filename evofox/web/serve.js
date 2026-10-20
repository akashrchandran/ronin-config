/**
 * Static server for the Ronin configurator, with an optional local bridge.
 *
 *   node web/serve.js            serve the app on http://localhost:5173
 *   node web/serve.js --no-bridge serve without the WebSocket bridge
 *
 * The bridge exposes the connected keyboard to the page over a WebSocket, so
 * the app also works in browsers without WebHID and can be automated.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Ronin } from '../ronin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = Number(process.env.PORT || 5173);
const useBridge = !process.argv.includes('--no-bridge');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const ALLOWED = [
  /^\/web\/[\w./-]+$/,
  /^\/protocol\.js$/,
  /^\/keys\.js$/,
  /^\/effects\.js$/,
  /^\/art\.js$/,
  /^\/layout\/[\w.-]+\.json$/,
];

function resolveFile(urlPath) {
  if (urlPath === '/web' || urlPath === '/web/') return path.join(root, 'web', 'index.html');
  if (!ALLOWED.some(pattern => pattern.test(urlPath))) return null;
  const target = path.join(root, decodeURIComponent(urlPath));
  if (!target.startsWith(root)) return null;
  return fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
}

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  if (urlPath === '/' || urlPath === '') {
    res.writeHead(302, { location: '/web/' });
    res.end();
    return;
  }
  const file = resolveFile(urlPath);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
});

if (useBridge) {
  const wss = new WebSocketServer({ server, path: '/bridge' });
  let keyboard = null;

  const getKeyboard = () => {
    if (!keyboard) {
      keyboard = new Ronin();
      keyboard.open();
    }
    return keyboard;
  };

  // A USB re-enumeration leaves the cached handle dead. Drop it and open the
  // device again instead of failing the request.
  const reopenKeyboard = () => {
    try { keyboard?.close(); } catch { /* already gone */ }
    keyboard = new Ronin();
    keyboard.open();
    return keyboard;
  };

  wss.on('connection', socket => {
    socket.on('message', async raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      try {
        if (message.t === 'info') {
          const kb = getKeyboard();
          socket.send(JSON.stringify({
            id: message.id,
            productName: kb.path ? 'Ronin keyboard' : 'unknown',
            path: kb.path,
          }));
          return;
        }
        if (message.t === 'frame') {
          const frame = Buffer.from(message.frame, 'base64');
          let reply;
          try {
            reply = await getKeyboard().rawRequest(frame);
          } catch (error) {
            reply = await reopenKeyboard().rawRequest(frame);
          }
          socket.send(JSON.stringify({ id: message.id, frame: Buffer.from(reply).toString('base64') }));
          return;
        }
        socket.send(JSON.stringify({ id: message.id, error: 'unknown request' }));
      } catch (error) {
        socket.send(JSON.stringify({ id: message.id, error: error.message }));
      }
    });
    socket.on('close', () => { /* the keyboard handle stays open for the next client */ });
  });
}

server.listen(port, '127.0.0.1', () => {
  console.log(`Ronin configurator: http://localhost:${port}`);
  if (useBridge) console.log('Local bridge ready on ws://localhost:' + port + '/bridge');
});
