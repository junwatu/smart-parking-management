import { randomUUID } from 'node:crypto';

function fail(name, message) { throw Object.assign(new Error(message), { name }); }
export function feeCents(enteredAt, exitedAt, rate) {
  return Math.ceil(Math.max(0, new Date(exitedAt) - new Date(enteredAt)) / 3_600_000) * rate;
}

// Explicit preview mode. Nothing in this class connects to GridDB or persists.
export class DemoStore {
  #spaces = [];
  #sessions = new Map();
  #events = [];
  #history = [];
  constructor({ rate = 250, now = () => new Date() } = {}) {
    this.rate = rate;
    this.now = now;
    for (const zone of ['A', 'B', 'C']) for (let number = 1; number <= 8; number++) {
      this.#spaces.push({ id: `${zone}${String(number).padStart(2, '0')}`, zone, type: number === 1 ? 'accessible' : 'standard', hourlyRateCents: rate, enabled: true });
    }
    // A useful preview, with vehicles parked long enough to demonstrate billing.
    for (const space of this.#spaces.filter((_, i) => i % 3 === 1)) {
      const enteredAt = new Date(this.now().getTime() - 75 * 60_000).toISOString();
      const id = randomUUID();
      this.#sessions.set(id, { id, spaceId: space.id, vehicleTag: `DEMO-${space.id}`, enteredAt, exitedAt: enteredAt, active: true, hourlyRateCents: rate, feeCents: 0, simulated: true });
    }
    this.#record();
  }
  async request(operation, payload = {}) {
    switch (operation) {
      case 'health': return { status: 'ok', mode: 'demo', database: 'not-connected' };
      case 'snapshot': return this.snapshot();
      case 'events': return structuredClone(this.#events.slice(-100).reverse());
      case 'history': {
        const cutoff = this.now().getTime() - payload.hours * 3_600_000;
        const points = this.#history.filter(p => new Date(p.timestamp).getTime() > cutoff);
        return { points: structuredClone(points.slice(-1000)), limit: 1000, possiblyTruncated: points.length >= 1000 };
      }
      case 'park': return this.park(payload);
      case 'depart': return this.depart(payload);
      case 'simulate': return this.simulate();
      default: fail('ValueError', 'Unsupported demo operation');
    }
  }
  snapshot() {
    const sessions = [...this.#sessions.values()].filter(s => s.active);
    const day = this.now().toISOString().slice(0, 10);
    const completed = [...this.#sessions.values()].filter(s => !s.active && s.exitedAt.startsWith(day));
    const spaces = this.#spaces.map(s => ({ ...s, session: sessions.find(p => p.spaceId === s.id) || null }));
    return structuredClone({ mode: 'demo', generatedAt: this.now().toISOString(), spaces, sessions, stats: { capacity: spaces.length, occupied: sessions.length, available: spaces.length - sessions.length, occupancyPercent: Math.round(sessions.length / spaces.length * 1000) / 10, revenueTodayCents: completed.reduce((total, s) => total + s.feeCents, 0), completedToday: completed.length, revenueTruncated: false } });
  }
  park({ sessionId, spaceId, vehicleTag, simulated = false }) {
    const existing = this.#sessions.get(sessionId);
    if (existing) {
      if (existing.spaceId !== spaceId || existing.vehicleTag !== vehicleTag) fail('ConflictError', 'Session ID was already used for a different arrival');
      return { session: structuredClone(existing), replayed: true, warnings: [] };
    }
    const space = this.#spaces.find(s => s.id === spaceId && s.enabled);
    if (!space) fail('LookupError', 'Space is missing or disabled');
    const active = this.snapshot().sessions;
    if (active.some(s => s.spaceId === spaceId)) fail('ConflictError', 'Space is already occupied');
    if (active.some(s => s.vehicleTag === vehicleTag)) fail('ConflictError', 'Vehicle already has an active parking session');
    const now = this.now().toISOString();
    const session = { id: sessionId, spaceId, vehicleTag, enteredAt: now, exitedAt: now, active: true, hourlyRateCents: space.hourlyRateCents, feeCents: 0, simulated };
    this.#sessions.set(sessionId, session);
    this.#event(session, 'arrival');
    this.#record();
    return { session: structuredClone(session), replayed: false, warnings: [] };
  }
  depart({ sessionId }) {
    const session = this.#sessions.get(sessionId);
    if (!session) fail('LookupError', 'Session not found');
    if (!session.active) return { session: structuredClone(session), replayed: true, warnings: [] };
    session.exitedAt = this.now().toISOString();
    session.active = false;
    session.feeCents = feeCents(session.enteredAt, session.exitedAt, session.hourlyRateCents);
    this.#event(session, 'departure');
    this.#record();
    return { session: structuredClone(session), replayed: false, warnings: [] };
  }
  simulate() {
    const snapshot = this.snapshot();
    const available = snapshot.spaces.filter(s => !s.session);
    const simulated = snapshot.sessions.filter(s => s.simulated);
    if (simulated.length && (!available.length || Math.random() < 0.45)) return this.depart({ sessionId: simulated[Math.floor(Math.random() * simulated.length)].id });
    if (available.length) return this.park({ sessionId: randomUUID(), spaceId: available[Math.floor(Math.random() * available.length)].id, vehicleTag: `SIM-${randomUUID().slice(0, 6).toUpperCase()}`, simulated: true });
    this.#record();
    return { warnings: [] };
  }
  #event(session, type) {
    this.#events.push({ id: `${session.id}_${type}`, timestamp: this.now().toISOString(), type, spaceId: session.spaceId, sessionId: session.id, vehicleTag: session.vehicleTag, feeCents: session.feeCents });
  }
  #record() {
    this.#history.push({ timestamp: this.now().toISOString(), occupied: [...this.#sessions.values()].filter(s => s.active).length, capacity: this.#spaces.length });
    if (this.#history.length > 5000) this.#history.shift();
  }
  async close() {}
}
