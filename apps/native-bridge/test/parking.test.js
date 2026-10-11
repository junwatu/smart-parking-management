import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DemoStore, feeCents } from '../src/demo-store.js';
import { ParkingService, hourlyRateCents } from '../src/parking-service.js';
import { createParkingServer } from '../src/server.js';

test('fees use integer cents and started hours, including exact boundaries', () => {
  assert.equal(hourlyRateCents('2.55'), 255);
  assert.equal(hourlyRateCents('0.29'), 29);
  assert.throws(() => hourlyRateCents('2.555'), { name: 'ValueError' });
  const start = '2026-10-11T00:00:00Z';
  assert.equal(feeCents(start, start, 250), 0);
  assert.equal(feeCents(start, '2026-10-11T00:00:01Z', 250), 250);
  assert.equal(feeCents(start, '2026-10-11T01:00:00Z', 250), 250);
  assert.equal(feeCents(start, '2026-10-11T01:00:01Z', 250), 500);
});

test('session retries, occupancy conflicts, duplicate vehicles and final fees', async () => {
  let now = new Date('2026-10-11T12:00:00Z');
  const store = new DemoStore({ now: () => now });
  const service = new ParkingService(store);
  const arrival = { sessionId: randomUUID(), spaceId: 'A01', vehicleTag: '  b 123 pk ' };
  const first = await service.park(arrival);
  assert.equal(first.session.vehicleTag, 'B 123 PK');
  assert.equal((await service.park(arrival)).replayed, true);
  await assert.rejects(service.park({ ...arrival, sessionId: randomUUID() }), { name: 'ConflictError' });
  await assert.rejects(service.park({ ...arrival, spaceId: 'B01', sessionId: randomUUID() }), { name: 'ConflictError' });
  now = new Date('2026-10-11T13:00:01Z');
  const departed = await service.depart({ sessionId: arrival.sessionId });
  assert.equal(departed.session.feeCents, 500);
  assert.equal((await service.depart({ sessionId: arrival.sessionId })).replayed, true);
  assert.equal((await store.request('events')).length, 2);
  assert.equal((await service.snapshot()).stats.revenueTodayCents, 500);
});

test('validation rejects malformed IDs, tags and unbounded history', async () => {
  const service = new ParkingService(new DemoStore());
  await assert.rejects(service.park({ sessionId: 'bad', spaceId: 'A01', vehicleTag: 'TAG' }), { name: 'ValueError' });
  await assert.rejects(service.park({ sessionId: randomUUID(), spaceId: 'A01', vehicleTag: "x' OR true" }), { name: 'ValueError' });
  await assert.rejects(service.history(169), { name: 'ValueError' });
  await assert.rejects(service.history(1.5), { name: 'ValueError' });
});

test('HTTP dashboard, health, arrival, departure, simulator and error contracts', async t => {
  const origin = 'http://127.0.0.1:3002';
  const { server, service } = createParkingServer(new DemoStore(), { origin });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function get(path) { const r = await fetch(base + path); return [r.status, await r.json()]; }
  async function post(path, value, extra = {}) {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(value) });
    return [r.status, await r.json()];
  }
  assert.equal((await fetch(base)).status, 200);
  assert.match(await (await fetch(base + '/app.js')).text(), /Register departure/);
  assert.equal((await get('/api/health'))[1].database, 'not-connected');
  assert.equal((await get('/api/parking'))[1].stats.capacity, 24);
  const arrival = { sessionId: randomUUID(), spaceId: 'A01', vehicleTag: 'HTTP-01' };
  assert.equal((await post('/api/arrivals', arrival))[0], 201);
  assert.equal((await post('/api/arrivals', arrival))[0], 200);
  assert.equal((await post('/api/arrivals', { ...arrival, sessionId: randomUUID() }))[0], 409);
  assert.equal((await post('/api/departures', { sessionId: arrival.sessionId }))[0], 200);
  assert.equal((await post('/api/departures', { sessionId: randomUUID() }))[0], 404);
  assert.equal((await post('/api/arrivals', arrival, { Origin: 'https://untrusted.example' }))[0], 403);
  assert.equal((await get('/api/history?hours=999'))[0], 400);
  assert.equal((await post('/api/simulator/start', {}))[1].running, true);
  assert.equal((await post('/api/simulator/stop', {}))[1].running, false);
  assert.equal((await get('/api/events'))[1].length, 2);
});
