import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bridge = fileURLToPath(new URL('../native-bridge/', import.meta.url));
const command = process.argv[2];
const allowed = new Set(['server', 'demo', 'init', 'seed', 'health']);
if (!allowed.has(command)) throw new Error('Unknown workspace command');
const envFile = join(bridge, '.env');
const env = {};
if (existsSync(envFile)) {
  for (const raw of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error('Invalid .env line; use KEY=value');
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[match[1]] = value;
  }
}
Object.assign(env, process.env);
if (command === 'demo') env.PARKING_MODE = 'demo';
else env.PARKING_MODE = 'native';
if (command !== 'demo' && !existsSync(envFile)) {
  throw new Error('Copy native-bridge/.env.example to native-bridge/.env and configure GridDB first.');
}
const args = command === 'server' || command === 'demo'
  ? ['src/server.js'] : ['src/index.js', command];
const child = spawn(process.execPath, args, { cwd: bridge, env, stdio: 'inherit' });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
