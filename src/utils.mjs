/**
 * @module utils
 * Shared logging utility. Writes to stdout and appends to the log file.
 */
import { appendFileSync } from 'node:fs';
import { LOG_FILE } from './constants.mjs';

/**
 * Log a timestamped message to console and file.
 * @param {string} msg
 */
export function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}
