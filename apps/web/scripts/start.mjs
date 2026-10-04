import { cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const standalone = join(root, '.next/standalone');
cpSync(join(root, 'public'), join(standalone, 'public'), { recursive: true });
cpSync(join(root, '.next/static'), join(standalone, '.next/static'), { recursive: true });
process.env.HOSTNAME ||= '127.0.0.1';
process.env.PORT ||= '3000';
await import(pathToFileURL(join(standalone, 'server.js')).href);
