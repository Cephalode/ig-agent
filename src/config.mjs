import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { CONFIG_FILE, BASE, DEFAULT_CONFIG, SEEN_FILE } from './constants.mjs';

export async function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(await readFile(CONFIG_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}

export async function saveConfig(cfg) {
  await mkdir(BASE, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

export function findHermes() {
  try { return execSync('which hermes 2>/dev/null || echo /Users/sqibo/.local/bin/hermes', { encoding: 'utf8' }).trim(); } catch { return 'hermes'; }
}

export async function loadSeen() {
  try { return new Set(JSON.parse(await readFile(SEEN_FILE, 'utf8'))); }
  catch { return new Set(); }
}

export async function saveSeen(seen) {
  await writeFile(SEEN_FILE, JSON.stringify([...seen].slice(-2000)));
}
