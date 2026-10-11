import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GridDBClient } from './griddb-client.js';
import { DemoStore } from './demo-store.js';
import { ParkingService, hourlyRateCents } from './parking-service.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const dashboard = fileURLToPath(new URL('../../dashboard/', import.meta.url));
const statuses = { ValueError: 400, ConflictError: 409, LookupError: 404 };

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8192) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw Object.assign(new Error('Provide a JSON object'), { name: 'ValueError' }); }
}

export function createParkingServer(store, { origin = 'http://127.0.0.1:3002' } = {}) {
  const service = new ParkingService(store);
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [name, mime] = assets.get(url.pathname);
        const data = await readFile(dashboard + name);
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
        return;
      }
      if (req.method === 'POST') {
        // Browser writes must come from this dashboard; no permissive CORS.
        if (req.headers.origin && req.headers.origin !== origin) {
          json(res, 403, { error: 'Cross-origin writes are disabled' }); return;
        }
        if (!(req.headers['content-type'] || '').startsWith('application/json')) {
          json(res, 415, { error: 'Use application/json' }); return;
        }
      }
      let result;
      let status = 200;
      if (req.method === 'GET' && url.pathname === '/api/health') result = await store.request('health');
      else if (req.method === 'GET' && url.pathname === '/api/parking') result = await service.snapshot();
      else if (req.method === 'GET' && url.pathname === '/api/events') result = await store.request('events');
      else if (req.method === 'GET' && url.pathname === '/api/history') result = await service.history(Number(url.searchParams.get('hours') ?? 24));
      else if (req.method === 'POST' && url.pathname === '/api/arrivals') {
        result = await service.park(await body(req)); status = result.replayed ? 200 : 201;
      } else if (req.method === 'POST' && url.pathname === '/api/departures') result = await service.depart(await body(req));
      else if (req.method === 'POST' && url.pathname === '/api/simulator/start') { await body(req); result = service.startSimulator(); }
      else if (req.method === 'POST' && url.pathname === '/api/simulator/stop') { await body(req); result = service.stopSimulator(); }
      else { json(res, 404, { error: 'Endpoint not found' }); return; }
      json(res, status, result);
    } catch (error) {
      const status = error.status || statuses[error.name] || 503;
      json(res, status, { error: error.message });
    }
  });
  return { server, service };
}

export async function main() {
  const mode = process.env.PARKING_MODE || 'native';
  if (!['native', 'demo'].includes(mode)) throw new Error('PARKING_MODE must be native or demo');
  const host = process.env.PARKING_API_HOST || '127.0.0.1';
  const port = Number(process.env.PARKING_API_PORT || 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API port');
  const rate = hourlyRateCents(process.env.PARKING_HOURLY_RATE || '2.50');
  const store = mode === 'demo' ? new DemoStore({ rate }) : new GridDBClient();
  const origin = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  const { server, service } = createParkingServer(store, { origin });
  try {
    await store.request('health');
    const initial = await service.snapshot();
    if (!initial.stats.capacity) throw new Error('No parking spaces found; run npm run seed');
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  } catch (error) { await service.close(); throw error; }
  console.log(`Smart Parking: ${origin} (${mode === 'demo' ? 'DEMO — in-memory, no GridDB' : 'GridDB native'})`);
  console.log('Simulator is stopped. Start it explicitly from the dashboard.');
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    service.stopSimulator();
    server.close();
    server.closeIdleConnections();
    const timer = setTimeout(() => process.exit(1), 3000);
    timer.unref();
    await service.close();
    server.closeAllConnections();
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
