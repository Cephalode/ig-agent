// Emulator command — start/stop Android emulator
import { execSync, spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { PID_FILE } from '../constants.mjs';
import { loadConfig, findEmulator } from '../config.mjs';
import { log } from '../utils.mjs';

/**
 * Start or stop the Android emulator.
 * @param {'start'|'stop'} [action='start'] - Action to perform.
 */
export async function cmdEmulator(action = 'start') {
  const config = await loadConfig();
  const emulatorPath = findEmulator();

  if (action === 'stop') {
    try {
      const adb = config.adb || 'adb';
      execSync(`${adb} emu kill`, { stdio: 'pipe', timeout: 10000 });
      log('✓ Emulator stopped');
    } catch (e) {
      log(`✗ Stop error: ${e.message.slice(0, 60)}`);
    }
    return;
  }

  const avd = config.emulatorAvd || 'ig-phone';
  const memory = config.emulatorMemory || 2048;
  const headless = config.emulatorHeadless !== false;

  const args = ['-avd', avd, '-gpu', 'host', '-memory', String(memory)];
  if (headless) args.push('-no-window', '-no-audio');
  args.push('-no-snapshot-save');

  log(`Starting emulator ${avd} (${headless ? 'headless' : 'GUI'}, ${memory}MB)...`);
  const proc = spawn(emulatorPath, args, { detached: true, stdio: 'ignore' });
  proc.unref();
  await writeFile(PID_FILE, String(proc.pid));
  log(`✓ Emulator started (PID ${proc.pid})`);
}
