import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// The DSH Client module loader evaluates client.js as a classic script.
// TypeScript marks every module with `export {};`, which is invalid there.
const file = resolve('dist/client.js');
const source = await readFile(file, 'utf8');
const marker = '\nexport {};\n//# sourceMappingURL=client.js.map';
if (!source.endsWith(marker)) {
  throw new Error('dist/client.js does not end with the expected module marker');
}
await writeFile(file, `${source.slice(0, -marker.length)}\n//# sourceMappingURL=client.js.map`);
