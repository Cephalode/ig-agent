// Utility functions
import { appendFileSync } from 'node:fs';
import { LOG_FILE } from './constants.mjs';

export function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}
