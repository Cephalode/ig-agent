/**
 * @module commands/install
 * Install command — set up directories and dependencies.
 */
import { mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { BASE, AUTH_DIR, CHATS_DIR } from '../constants.mjs';
import { loadConfig, saveConfig } from '../config.mjs';
import { log } from '../utils.mjs';

export async function cmdInstall() {
  log('Installing ig-agent...');

  // Create directories
  await mkdir(BASE, { recursive: true });
  await mkdir(AUTH_DIR, { recursive: true });
  await mkdir(CHATS_DIR, { recursive: true });
  log(`✓ Created directories in ${BASE}`);

  // Check node version
  try {
    const version = execSync('node --version', { encoding: 'utf8' }).trim();
    const major = parseInt(version.replace(/^v/, ''), 10);
    if (major < 20) {
      log(`✗ Node.js ${version} found — need >= 20. Please upgrade.`);
      process.exit(1);
    }
    log(`✓ Node.js ${version}`);
  } catch {
    log('✗ Node.js not found. Install node >= 20 first.');
    process.exit(1);
  }

  // Install npm dependencies (nodejs-insta-private-api etc.)
  log('Installing npm dependencies...');
  const projectDir = new URL('..', import.meta.url).pathname;
  execSync('npm install', { cwd: projectDir, stdio: 'inherit' });
  log('✓ npm dependencies installed');

  // Save default config
  const cfg = await loadConfig();
  await saveConfig(cfg);
  log('✓ Default config saved');

  log('');
  log('✓ ig-agent installed successfully!');
  log(`  Config:  ${join(BASE, 'config.json')}`);
  log(`  Auth:    ${AUTH_DIR}`);
  log(`  Logs:    ${join(BASE, 'ig-agent.log')}`);
  log('');
  log('Next: run `ig-agent login` to authenticate');
}
