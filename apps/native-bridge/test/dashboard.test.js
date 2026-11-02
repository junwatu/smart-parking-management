import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const source = await readFile(new URL('../../dashboard/app.js', import.meta.url), 'utf8');

// Minimal DOM for exercising the actual dashboard handlers and polling renders.
class Node {
  constructor() { this.children = []; this.listeners = {}; this._value = ''; }
  get options() { return this.children; }
  get value() { return this._value; }
  set value(value) { this._value = this.isSelect && !this.options.some(o => o.value === value) ? '' : value; }
  replaceChildren(...nodes) { this.children = nodes; if (this.isSelect) this.value = ''; }
  append(...nodes) { this.children.push(...nodes); }
  add(node) { this.append(node); }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  setAttribute() {}
  focus() {}
}

async function dashboard() {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, new Node());
    return nodes.get(id);
  };
  get('space-select').isSelect = true;
  const spaces = ['A01', 'A02'].map(id => ({ id, zone: 'A', type: 'standard', enabled: true, hourlyRateCents: 250, session: null }));
  const snapshot = { spaces, sessions: [], stats: {}, simulator: { running: false, warnings: [] }, generatedAt: new Date().toISOString() };
  const posts = [];
  const context = createContext({
    document: { getElementById: get, createElement: () => new Node(), createElementNS: () => new Node() },
    Option: function(text, value) { return { text, value }; },
    crypto: { randomUUID }, AbortSignal, setInterval() {},
    fetch: async (path, options) => {
      if (options.method === 'POST') {
        posts.push(JSON.parse(options.body));
        throw new Error('Response lost');
      }
      const result = path === '/api/parking' ? snapshot : path === '/api/events' ? [] : { points: [] };
      return { ok: true, json: async () => result };
    },
  });
  runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return {
    get, posts, spaces,
    refresh: () => runInContext('refresh()', context),
    submit: () => get('arrival-form').listeners.submit({ preventDefault() {} }),
    clickSpace: id => get('spaces').children.flatMap(row => row.children).find(button => button.children?.[0]?.textContent === id).listeners.click(),
  };
}

test('lost arrival response remains retryable after polling shows the space occupied', async () => {
  const app = await dashboard();
  app.get('space-select').value = 'A01';
  app.get('vehicle-tag').value = 'RETRY-01';
  await app.submit();
  app.spaces[0].session = { id: app.posts[0].sessionId };
  await app.refresh();
  assert.equal(app.get('space-select').value, 'A01');
  assert.ok(app.get('space-select').options.some(o => o.value === 'A01'));
  await app.submit();
  assert.deepEqual(app.posts[1], app.posts[0]);
});

test('tile and dropdown selection changes both discard the previous arrival payload', async () => {
  for (const selection of ['tile', 'dropdown']) {
    const app = await dashboard();
    app.get('space-select').value = 'A01';
    app.get('vehicle-tag').value = 'RETRY-02';
    await app.submit();
    if (selection === 'tile') app.clickSpace('A02');
    else {
      app.get('space-select').value = 'A02';
      app.get('space-select').listeners.change();
    }
    await app.submit();
    assert.equal(app.posts[1].spaceId, 'A02');
    assert.notEqual(app.posts[1].sessionId, app.posts[0].sessionId);
  }
});
