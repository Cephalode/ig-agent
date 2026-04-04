// Config management
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { CONFIG_FILE, BASE, SEEN_FILE, DEFAULT_CONFIG } from './constants.mjs';

/**
 * Load config from disk, falling back to defaults.
 * @returns {Promise<object>} Merged config object.
 */
export async function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(await readFile(CONFIG_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}

/**
 * Save config to disk, creating the base directory if needed.
 * @param {object} cfg - Config object to persist.
 */
export async function saveConfig(cfg) {
  await mkdir(BASE, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

/**
 * Locate the adb binary.
 * @returns {string} Path to adb.
 */
export function findADB() {
  try { return execSync('which adb 2>/dev/null', { encoding: 'utf8' }).trim() || 'adb'; } catch { return 'adb'; }
}

/**
 * Locate the hermes CLI.
 * @returns {string} Path or command name for hermes.
 */
export function findHermes() {
  try { return execSync('which hermes 2>/dev/null', { encoding: 'utf8' }).trim(); } catch { return 'hermes'; }
}

/**
 * Build the ig-cli invocation command.
 * @returns {string} Shell command string to invoke ig-cli.
 */
export function findIgCli() {
  const { join } = require('node:path');
  const { homedir } = require('node:os');
  return 'node ' + join(homedir(), 'devel/argonauta/ig-cli/index.mjs');
}

/**
 * Locate the Android emulator binary.
 * @returns {string} Path to emulator binary.
 */
export function findEmulator() {
  try {
    const result = execSync('which emulator 2>/dev/null', { encoding: 'utf8' }).trim();
    if (result) return result;
  } catch {}
  const { join } = require('node:path');
  const { homedir } = require('node:os');
  return join(homedir(), 'android-sdk/emulator/emulator');
}

/**
 * Load the set of seen notification keys from disk.
 * @returns {Promise<Set<string>>} Set of seen keys.
 */
export async function loadSeen() {
  try { return new Set(JSON.parse(await readFile(SEEN_FILE, 'utf8'))); }
  catch { return new Set(); }
}

/**
 * Persist the seen set to disk (truncated to last 2000 entries).
 * @param {Set<string>} seen - Set of notification keys.
 */
export async function saveSeen(seen) {
  await writeFile(SEEN_FILE, JSON.stringify([...seen].slice(-2000)));
}
