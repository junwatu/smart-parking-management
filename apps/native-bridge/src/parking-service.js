function invalid(message) { throw Object.assign(new Error(message), { name: 'ValueError' }); }
export function hourlyRateCents(value = '2.50') {
  if (typeof value !== 'string' || !/^\d{1,4}(?:\.\d{1,2})?$/.test(value)) invalid('Hourly rate must have at most two decimal places');
  const [dollars, cents = ''] = value.split('.');
  const result = Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
  if (result > 100000) invalid('Hourly rate must be from 0 to 1000');
  return result;
}
export function arrivalPayload(body) {
  const sessionId = body.sessionId;
  const spaceId = body.spaceId;
  const vehicleTag = typeof body.vehicleTag === 'string' ? body.vehicleTag.trim().toUpperCase() : '';
  if (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) invalid('Provide a UUID sessionId so arrival retries are idempotent');
  if (typeof spaceId !== 'string' || !/^[ABC]0[1-8]$/.test(spaceId)) invalid('Invalid parking space');
  if (!/^[A-Z0-9 -]{1,16}$/.test(vehicleTag)) invalid('Vehicle tag must contain 1–16 letters, digits, spaces or hyphens');
  return { sessionId: sessionId.toLowerCase(), spaceId, vehicleTag };
}
export function departurePayload(body) {
  if (typeof body.sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.sessionId)) invalid('Invalid sessionId');
  return { sessionId: body.sessionId.toLowerCase() };
}
export class ParkingService {
  #timer;
  #busy = false;
  #lastError = null;
  #lastWarnings = [];
  constructor(store) { this.store = store; }
  get simulator() { return { running: Boolean(this.#timer), busy: this.#busy, lastError: this.#lastError, warnings: this.#lastWarnings }; }
  async snapshot() { return { ...await this.store.request('snapshot'), simulator: this.simulator }; }
  async park(body) { return this.store.request('park', arrivalPayload(body)); }
  async depart(body) { return this.store.request('depart', departurePayload(body)); }
  async history(hours) {
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) invalid('hours must be an integer from 1 to 168');
    return this.store.request('history', { hours });
  }
  startSimulator() {
    if (this.#timer) return this.simulator;
    this.#lastError = null;
    this.#timer = setInterval(async () => {
      if (this.#busy) return;
      this.#busy = true;
      try {
        const result = await this.store.request('simulate');
        this.#lastWarnings = result.warnings || [];
      } catch (error) {
        this.#lastError = error.message;
        this.stopSimulator();
      } finally { this.#busy = false; }
    }, 5000);
    return this.simulator;
  }
  stopSimulator() { clearInterval(this.#timer); this.#timer = null; return this.simulator; }
  async close() { this.stopSimulator(); await this.store.close(); }
}
