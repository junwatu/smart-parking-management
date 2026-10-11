import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const bridge = fileURLToPath(new URL('../native-bridge/', import.meta.url));
const checks = [['Node.js 22+', Number(process.versions.node.split('.')[0]) >= 22]];
for (const name of ['gridstore.jar', 'gridstore-arrow.jar', 'gridstore-advanced.jar', 'arrow-memory-netty.jar']) checks.push([name, existsSync(join(bridge, 'lib', name))]);
checks.push(['native-bridge/.env', existsSync(join(bridge, '.env'))]);
const env = { ...process.env };
if (existsSync(join(bridge, '.env'))) {
  for (const line of readFileSync(join(bridge, '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (match && !(match[1] in env)) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
for (const name of ['GRIDDB_NOTIFICATION_PROVIDER', 'GRIDDB_CLUSTER_NAME', 'GRIDDB_DATABASE', 'GRIDDB_USERNAME', 'GRIDDB_PASSWORD']) checks.push([name, Boolean(env[name]) && !/your-|replace-me|example\.invalid/.test(env[name])]);
let python = env.PYTHON_BIN || join(bridge, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (python.includes('/')) python = resolve(bridge, python);
if (!env.JAVA_HOME && process.platform === 'darwin') env.JAVA_HOME = ['/opt/homebrew', '/usr/local'].map(p => `${p}/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`).find(existsSync);
env.JAVA_TOOL_OPTIONS = [env.JAVA_TOOL_OPTIONS, '--add-opens=java.base/java.nio=ALL-UNNAMED'].filter(Boolean).join(' ');
const runtime = spawnSync(python, ['-c', 'from pathlib import Path; import jpype; jpype.startJVM(classpath=[str(p) for p in Path("lib").glob("*.jar")]); import griddb_python, pyarrow; jpype.shutdownJVM()'], { cwd: bridge, env, stdio: 'ignore', timeout: 20000 });
checks.push(['Python / JVM / GridDB runtime', runtime.status === 0]);
for (const [label, passed] of checks) console.log(`${passed ? 'PASS' : 'MISS'}  ${label}`);
process.exitCode = checks.every(([, pass]) => pass) ? 0 : 1;
console.log('Doctor checks local prerequisites only. npm run dev:griddb performs a real database request.');
