import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (['node_modules', '.venv', '.build', '__pycache__'].includes(entry.name)) return [];
    return entry.isDirectory() ? files(path) : [path];
  });
}
const sources = files(root);
for (const path of sources.filter(path => /\.(js|mjs)$/.test(path))) {
  const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(1);
}
// Parse only; no imports, database access, or .pyc output.
const python = process.env.PYTHON_BIN || 'python3';
const py = sources.filter(path => path.endsWith('.py'));
const result = spawnSync(python, ['-c', 'import ast, pathlib, sys; [ast.parse(pathlib.Path(p).read_text(), filename=p) for p in sys.argv[1:]]', ...py], { stdio: 'inherit' });
if (result.status !== 0) process.exit(1);
console.log('JavaScript and Python syntax checks passed.');
