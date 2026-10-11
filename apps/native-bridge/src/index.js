import { GridDBClient } from './griddb-client.js';
const operation = process.argv[2] || 'health';
if (!['init', 'seed', 'health'].includes(operation)) throw new Error('Unsupported CLI operation');
const client = new GridDBClient();
try {
  console.log(JSON.stringify(await client.request(operation), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await client.close(); }
