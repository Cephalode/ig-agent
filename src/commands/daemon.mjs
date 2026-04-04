// Daemon command — run monitor in background
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { PID_FILE } from '../constants.mjs';
import { log } from '../utils.mjs';

/**
 * Start the notification monitor as a background daemon process.
 */
export async function cmdDaemon() {
  log('Starting ig-agent daemon...');

  const child = spawn('node', [
    import.meta.url.replace('daemon.mjs', 'monitor.mjs')
  ], {
    detached: true, stdio: 'ignore',
    env: { ...process.env, IG_AGENT_DAEMON: '1' }
  });

  child.unref();
  await writeFile(PID_FILE, String(child.pid));
  log(`✓ Daemon started (PID ${child.pid})`);
}
