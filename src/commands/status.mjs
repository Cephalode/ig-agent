// Status command — check system status
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { SESSION_FILE, PID_FILE, CONFIG_FILE, LOG_FILE, BASE } from '../constants.mjs';
import { loadConfig } from '../config.mjs';

export async function cmdStatus() {
  const config = await loadConfig();

  console.log('╔══════════════════════════════════════╗');
  console.log('║   🐙 ig-agent status                 ║');
  console.log('╠══════════════════════════════════════╣');

  // Session
  try {
    await readFile(SESSION_FILE);
    console.log('║ Session:     ✓ valid');
  } catch {
    console.log('║ Session:     ✗ not found (run ig-agent login)');
  }

  // Emulator
  try {
    const adb = config.adb || 'adb';
    const devices = execSync(`${adb} devices`, { encoding: 'utf8' });
    console.log(`║ Emulator:    ${devices.includes('emulator') ? '✓ running' : '✗ not running'}`);
  } catch {
    console.log('║ Emulator:    ✗ adb not found');
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
    execSync(`which hermes 2>/dev/null || echo found`, { timeout: 5000, stdio: 'pipe' });
    console.log('║ Hermes:      ✓ available');
  } catch {
    console.log('║ Hermes:      ✗ not found');
  }

  // IG CLI
  try {
    const igCliPath = require('node:path').join(require('node:os').homedir(), 'devel/argonauta/ig-cli/index.mjs');
    require('node:fs').accessSync(igCliPath);
    console.log('║ IG CLI:      ✓ found');
  } catch {
    console.log('║ IG CLI:      ✗ not found');
  }

  const allowed = config.allowedSenders?.length || 0;
  console.log(`║ Allowed:     ${allowed} senders`);
  console.log(`║ Config:      ${CONFIG_FILE}`);
  console.log(`║ Logs:        ${LOG_FILE}`);
  console.log('╚══════════════════════════════════════╝');
}
