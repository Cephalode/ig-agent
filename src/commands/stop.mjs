// Stop command — kill the daemon process
import { readFile, unlink } from 'node:fs/promises';
import { PID_FILE } from '../constants.mjs';
import { log } from '../utils.mjs';

/**
 * Stop the background daemon by reading its PID file and sending SIGTERM.
 */
export async function cmdStop() {
  let pid;
  try {
    pid = parseInt((await readFile(PID_FILE, 'utf8')).trim(), 10);
    if (!Number.isFinite(pid)) throw new Error('Invalid PID');
  } catch {
    log('✗ Daemon is not running (no PID file found)');
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    log(`✓ Daemon stopped (PID ${pid})`);
  } catch {
    log(`✗ Could not stop daemon (PID ${pid} — process may have exited)`);
  }

  try { await unlink(PID_FILE); } catch {}
}
