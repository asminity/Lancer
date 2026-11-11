import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let loaded = false;

export function loadEnv() {
  if (loaded) return;
  loaded = true;

  const envPaths = [
    'D:\\AUTONEX\\.env',
    'D:\\AUTONEX\\frontend\\.env',
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../.env')
  ];

  for (const ep of envPaths) {
    if (fs.existsSync(ep)) {
      const content = fs.readFileSync(ep, 'utf-8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq > 0) {
          const k = line.slice(0, eq).trim();
          let v = line.slice(eq + 1).trim();
          const commentIdx = v.indexOf('#');
          if (commentIdx >= 0) {
            v = v.slice(0, commentIdx).trim();
          }
          v = v.replace(/^["']|["']$/g, '').trim();
          if (v) {
            process.env[k] = v;
          }
        }
      }
    }
  }
}

loadEnv();

