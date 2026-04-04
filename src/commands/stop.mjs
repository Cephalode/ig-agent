// Stop command — kill the background daemon
import { readFile, unlink } from 'node:fs/promises';
import { PID_FILE } from '../constants.mjs';
import { log } from '../utils.mjs';

/**
 * Stop the ig-agent background daemon.
 * Reads PID from file and sends SIGTERM.
 */
export async function cmdStop() {
  let pid;
  try {
    pid = parseInt((await readFile(PID_FILE, 'utf8')).trim(), 10);
  } catch {
    log('✗ No daemon PID file found (daemon not running?)');
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    log(`✓ Daemon stopped (PID ${pid})`);
  } catch {
    log(`✗ Daemon process ${pid} not found (already stopped?)`);
  }

  try { await unlink(PID_FILE); } catch {}
}
