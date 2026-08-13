import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { appendFile } from 'node:fs/promises';

export async function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const lines = [];
  const rl = createInterface({ input: createReadStream(filePath) });
  for await (const line of rl) {
    const t = line.trim();
    if (t) lines.push(JSON.parse(t));
  }
  return lines;
}

export async function appendJsonl(filePath, obj) {
  await appendFile(filePath, JSON.stringify(obj) + '\n', 'utf8');
}

export async function writeJsonlAll(filePath, arr) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(filePath, arr.map(o => JSON.stringify(o)).join('\n') + '\n', 'utf8');
}
