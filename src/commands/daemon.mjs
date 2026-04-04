/**
 * @module commands/daemon
 * Daemon command — run monitor in background.
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PID_FILE } from '../constants.mjs';
import { log } from '../utils.mjs';

export async function cmdDaemon() {
  log('Starting ig-agent daemon...');

  const child = spawn('node', [
    join(import.meta.dirname, '..', 'cli.mjs'), 'monitor'
  ], {
    detached: true, stdio: 'ignore',
    env: { ...process.env, IG_AGENT_DAEMON: '1' }
  });

  child.unref();
  await writeFile(PID_FILE, String(child.pid));
  log(`✓ Daemon started (PID ${child.pid})`);
}
