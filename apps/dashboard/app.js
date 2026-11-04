const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const time = value => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
let snapshot;
let polling = false;
let pendingArrival;
let mutating = false;

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').className = error ? 'notice error' : 'notice';
  $('notice').hidden = !message;
}
async function api(path, payload) {
  const response = await fetch(path, { ...(payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(35000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderSpaces() {
  const selected = $('space-select').value;
  const select = $('space-select');
  select.replaceChildren(new Option('Choose a space', ''));
  for (const space of snapshot.spaces.filter(s => s.enabled && !s.session)) select.add(new Option(`${space.id} · Zone ${space.zone} · ${money(space.hourlyRateCents)}/hour`, space.id));
  // A saved arrival may already occupy its space after a lost response.
  // Keep a valid selection so native form validation still allows its UUID retry.
  if (pendingArrival && ![...select.options].some(option => option.value === pendingArrival.spaceId)) {
    select.add(new Option(`${pendingArrival.spaceId} · Pending arrival — retry to confirm`, pendingArrival.spaceId));
  }
  select.value = selected;
  $('spaces').replaceChildren();
  for (const zone of ['A', 'B', 'C']) {
    const row = element('div', 'zone');
    row.append(element('span', 'zone-label', zone));
    for (const space of snapshot.spaces.filter(s => s.zone === zone)) {
      const occupied = Boolean(space.session);
      const button = element('button', `space${occupied ? ' occupied' : ''}${space.id === select.value ? ' selected' : ''}`);
      button.type = 'button';
      button.disabled = occupied || !space.enabled;
      button.setAttribute('aria-label', `${space.id}, ${occupied ? 'occupied' : 'available'}, ${space.type}`);
      button.append(element('strong', '', space.id), element('span', 'car', occupied ? '▰' : 'P'), element('small', '', occupied ? 'IN USE' : space.type === 'accessible' ? 'ACCESSIBLE' : 'AVAILABLE'));
      button.addEventListener('click', () => { select.value = space.id; changeSpace(); $('vehicle-tag').focus(); });
      row.append(button);
    }
    $('spaces').append(row);
  }
}
function renderSessions() {
  $('session-count').textContent = `${snapshot.sessions.length} ${snapshot.sessions.length === 1 ? 'vehicle' : 'vehicles'}`;
  $('sessions').replaceChildren();
  for (const session of snapshot.sessions) {
    const ms = Math.max(0, Date.now() - new Date(session.enteredAt));
    const minutes = Math.floor(ms / 60000);
    const tr = element('tr');
    for (const value of [session.vehicleTag, session.spaceId, time(session.enteredAt), `${Math.floor(minutes / 60)}h ${minutes % 60}m`, money(Math.ceil(ms / 3600000) * session.hourlyRateCents)]) tr.append(element('td', '', value));
    const cell = element('td');
    const button = element('button', '', 'Register departure');
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const result = await api('/api/departures', { sessionId: session.id });
        notice(`Departure recorded. Fee: ${money(result.session.feeCents)}.${result.warnings.length ? ' ' + result.warnings.join(' ') : ''}`);
        await refresh();
      } catch (error) { notice(error.message, true); }
      finally { button.disabled = false; }
    });
    cell.append(button); tr.append(cell); $('sessions').append(tr);
  }
  if (!snapshot.sessions.length) {
    const tr = element('tr'); const td = element('td', 'empty', 'No active sessions. Register an arrival to get started.'); td.colSpan = 6; tr.append(td); $('sessions').append(tr);
  }
}
function renderEvents(events) {
  $('events').replaceChildren();
  for (const event of events.slice(0, 10)) {
    const row = element('div', `event ${event.type}`);
    row.append(element('span', 'event-icon', event.type === 'arrival' ? '↗' : '↙'));
    const text = element('div');
    text.append(element('strong', '', `${event.vehicleTag} · ${event.type}`), element('p', '', `Space ${event.spaceId}${event.type === 'departure' ? ' · ' + money(event.feeCents) : ''}`));
    row.append(text, element('time', '', time(event.timestamp))); $('events').append(row);
  }
  if (!events.length) $('events').append(element('p', 'empty', 'No events yet. Register a vehicle or start the simulator.'));
}
function svg(tag, attributes, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderHistory(history) {
  const chart = $('history-chart'); chart.replaceChildren();
  for (const percent of [0, 25, 50, 75, 100]) {
    const y = 175 - percent * 1.5;
    chart.append(svg('line', { x1: 42, x2: 706, y1: y, y2: y, stroke: '#e6ece5' }), svg('text', { x: 0, y: y + 4, fill: '#778681', 'font-size': 10 }, `${percent}%`));
  }
  const points = history.points;
  if (points.length) {
    const first = new Date(points[0].timestamp).getTime();
    const last = new Date(points.at(-1).timestamp).getTime();
    const xy = points.map((p, i) => [points.length === 1 ? 375 : 42 + (new Date(p.timestamp).getTime() - first) / Math.max(1, last - first) * 664, 175 - (p.capacity ? p.occupied / p.capacity : 0) * 150]);
    chart.append(svg('polyline', { points: xy.map(p => p.join(',')).join(' '), fill: 'none', stroke: '#216c52', 'stroke-width': 2.5 }));
    const latest = xy.at(-1); chart.append(svg('circle', { cx: latest[0], cy: latest[1], r: 4, fill: '#216c52' }));
    chart.append(svg('text', { x: 42, y: 200, fill: '#778681', 'font-size': 10 }, time(points[0].timestamp)), svg('text', { x: 706, y: 200, 'text-anchor': 'end', fill: '#778681', 'font-size': 10 }, time(points.at(-1).timestamp)));
  }
  $('history-caption').textContent = points.length ? `${points.length} recorded samples. History begins when this application records activity.` : 'No history yet. Start the simulator or register an arrival.';
  $('chart-note').textContent = history.possiblyTruncated ? 'Newest 1,000 only' : '';
}
async function refresh() {
  if (polling) return;
  polling = true;
  try {
    // Sequential calls avoid building a queue in the synchronous native worker.
    snapshot = await api('/api/parking');
    const events = await api('/api/events');
    const history = await api('/api/history?hours=24');
    $('mode').textContent = snapshot.mode === 'demo' ? 'DEMO · memory only' : 'GridDB native';
    $('updated').textContent = `Updated ${time(snapshot.generatedAt)}`;
    $('available').textContent = snapshot.stats.available;
    $('occupied').textContent = snapshot.stats.occupied;
    $('capacity').textContent = `of ${snapshot.stats.capacity} total spaces`;
    $('occupancy').textContent = `${snapshot.stats.occupancyPercent}%`;
    $('revenue').textContent = money(snapshot.stats.revenueTodayCents);
    $('completed').textContent = `${snapshot.stats.completedToday} ${snapshot.stats.completedToday === 1 ? 'departure' : 'departures'} · UTC${snapshot.stats.revenueTruncated ? ' · partial total' : ''}`;
    $('simulator').textContent = snapshot.simulator.running ? 'Stop simulator' : 'Start simulator';
    renderSpaces(); renderSessions(); renderEvents(events); renderHistory(history);
    if (snapshot.simulator.lastError) notice(`Simulator stopped: ${snapshot.simulator.lastError}`, true);
    else if (snapshot.simulator.warnings.length) notice(snapshot.simulator.warnings.join(' '), true);
  } catch (error) { $('mode').textContent = 'Connection error'; notice(`${error.message} Displayed values may be stale.`, true); }
  finally { polling = false; }
}
function changeSpace() {
  pendingArrival = undefined;
  if (snapshot) renderSpaces();
}
$('space-select').addEventListener('change', changeSpace);
$('vehicle-tag').addEventListener('input', () => { pendingArrival = undefined; if (snapshot) renderSpaces(); });
$('arrival-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (mutating) return;
  mutating = true; $('arrival-submit').disabled = true;
  // Retain this UUID after an uncertain response; an unchanged form retries it.
  pendingArrival ||= { sessionId: crypto.randomUUID(), spaceId: $('space-select').value, vehicleTag: $('vehicle-tag').value };
  try {
    const result = await api('/api/arrivals', pendingArrival);
    pendingArrival = undefined;
    $('vehicle-tag').value = ''; $('space-select').value = '';
    notice(`Arrival recorded in ${result.session.spaceId}.${result.warnings.length ? ' ' + result.warnings.join(' ') : ''}`);
    await refresh();
  } catch (error) { notice(error.message, true); }
  finally { mutating = false; $('arrival-submit').disabled = false; }
});
$('simulator').addEventListener('click', async () => {
  if (!snapshot) return;
  $('simulator').disabled = true;
  try { await api(`/api/simulator/${snapshot.simulator.running ? 'stop' : 'start'}`, {}); notice(''); await refresh(); }
  catch (error) { notice(error.message, true); }
  finally { $('simulator').disabled = false; }
});
$('refresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, 5000);
