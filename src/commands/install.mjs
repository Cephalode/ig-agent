// Install command — set up dependencies
import { mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BASE, CHATS_DIR } from '../constants.mjs';
import { loadConfig, saveConfig } from '../config.mjs';
import { log } from '../utils.mjs';

export async function cmdInstall() {
  log('Installing ig-agent...');
  await mkdir(BASE, { recursive: true });
  await mkdir(CHATS_DIR, { recursive: true });

  // Check node
  try { execSync('node --version', { stdio: 'pipe' }); }
  catch { log('✗ Node.js not found. Install node >= 20 first.'); process.exit(1); }

  // Check instagram-private-api
  const igCliPath = join(homedir(), 'devel/argonauta/ig-cli');
  try {
    const { access } = await import('node:fs/promises');
    await access(join(igCliPath, 'node_modules/instagram-private-api/package.json'));
    log('✓ instagram-private-api found');
  } catch {
    log('Installing instagram-cli dependencies...');
    execSync(`cd ${igCliPath} && npm install`, { stdio: 'inherit' });
  }

  // Save config
  const cfg = await loadConfig();
  await saveConfig(cfg);

  log('✓ ig-agent installed');
  log(`  Config: ${join(BASE, 'config.json')}`);
  log(`  Session: ${join(BASE, 'session.json')}`);
  log(`  Logs: ${join(BASE, 'ig-agent.log')}`);
  log('\nNext: run `ig-agent login` to authenticate');
}
