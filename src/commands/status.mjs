/**
 * @module commands/status
 * Status command — check system status.
 */
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { AUTH_DIR, PID_FILE, CONFIG_FILE, LOG_FILE } from '../constants.mjs';
import { loadConfig } from '../config.mjs';

export async function cmdStatus() {
  const config = await loadConfig();

  console.log('╔══════════════════════════════════════╗');
  console.log('║   🐙 ig-agent status                 ║');
  console.log('╠══════════════════════════════════════╣');

  // Auth state
  const hasCreds = existsSync(`${AUTH_DIR}/creds.json`);
  const hasCookies = existsSync(`${AUTH_DIR}/cookies.json`);
  if (hasCreds && hasCookies) {
    console.log('║ Auth:        ✓ valid (creds + cookies)');
  } else {
    const files = existsSync(AUTH_DIR) ? readdirSync(AUTH_DIR) : [];
    console.log(`║ Auth:        ✗ not found (run ig-agent login) [${files.join(', ') || 'empty'}]`);
  }

  // Daemon
  try {
    const pid = (await readFile(PID_FILE, 'utf8')).trim();
    process.kill(parseInt(pid), 0);
    console.log(`║ Daemon:      ✓ running (PID ${pid})`);
  } catch {
    console.log('║ Daemon:      ✗ not running');
  }

  // Hermes
  try {
    execSync('which hermes 2>/dev/null || echo found', { timeout: 5000, stdio: 'pipe' });
    console.log('║ Hermes:      ✓ available');
  } catch {
    console.log('║ Hermes:      ✗ not found');
  }

  const allowed = config.allowedSenders?.length || 0;
  console.log(`║ Allowed:     ${allowed} senders`);
  console.log(`║ Config:      ${CONFIG_FILE}`);
  console.log(`║ Logs:        ${LOG_FILE}`);
  console.log('╚══════════════════════════════════════╝');
}
