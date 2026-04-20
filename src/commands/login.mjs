/**
 * @module commands/login
 * Login command — authenticate and save session using multi-file auth state.
 */
import instaPkg from 'nodejs-insta-private-api';
const { IgApiClient, useMultiFileAuthState } = instaPkg;
import { mkdir } from 'node:fs/promises';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { AUTH_DIR, BASE } from '../constants.mjs';
import { log } from '../utils.mjs';

export async function cmdLogin() {
  await mkdir(BASE, { recursive: true });
  await mkdir(AUTH_DIR, { recursive: true });
  const rl = readline.createInterface({ input, output });

  const username = await rl.question('Username: ');
  const password = await rl.question('Password: ');

  const ig = new IgApiClient();
  const authState = await useMultiFileAuthState(AUTH_DIR);

  // Load existing device/cookies if available
  if (authState.hasSession()) {
    await authState.loadCreds(ig);
  }

  try {
    const loggedInUser = await ig.login({ username, password });
    log(`✓ Logged in as @${loggedInUser.username}`);
    await authState.saveCreds(ig);
    log(`✓ Session saved to ${AUTH_DIR}`);
  } catch (e) {
    if (e.name === 'IgLoginTwoFactorRequiredError' ||
        e.message.includes('two_factor') ||
        e.message.includes('Two factor')) {
      log('⚠ 2FA required — this login flow does not support inline 2FA yet.');
      log('  Please disable 2FA temporarily or use an app password.');
      log(`  Error: ${e.message}`);
    } else {
      log(`✗ Login failed: ${e.message}`);
    }
  }

  rl.close();
}
