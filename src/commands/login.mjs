// Login command — authenticate and save session
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { SESSION_FILE, BASE } from '../constants.mjs';
import { log } from '../utils.mjs';

/**
 * Prompt for credentials, authenticate with Instagram, and save the session.
 * Handles 2FA and checkpoint challenges.
 */
export async function cmdLogin() {
  await mkdir(BASE, { recursive: true });
  const rl = readline.createInterface({ input, output });

  const username = (await rl.question('Username: ')).trim();
  if (!username) { console.error('Username is required.'); rl.close(); process.exit(1); }
  const password = (await rl.question('Password: ')).trim();
  if (!password) { console.error('Password is required.'); rl.close(); process.exit(1); }

  const require = createRequire(import.meta.url);
  const { IgApiClient } = require(join(homedir(), 'devel/argonauta/ig-cli/node_modules/instagram-private-api'));

  const ig = new IgApiClient();
  ig.state.generateDevice(username);

  try {
    await ig.simulate.preLoginFlow();
    const loggedInUser = await ig.account.login(username, password);
    log(`✓ Logged in as @${loggedInUser.username}`);
  } catch (e) {
    if (e.name === 'IgCheckpointError') {
      log('⚠ Verification required — check your email/phone');
      const code = (await rl.question('Enter code: ')).trim();
      await ig.challenge.sendSecurityCode(code);
      log('✓ Verified!');
    } else if (e.name === 'IgLoginTwoFactorRequiredError') {
      const info = e.response?.body?.two_factor_info;
      if (!info) { rl.close(); throw e; }
      log(`⚠ 2FA required (${info.totp_two_factor_on ? 'authenticator app' : 'SMS'})`);
      const code = (await rl.question('Enter 2FA code: ')).trim();
      await ig.account.twoFactorLogin({
        username, verificationCode: code,
        twoFactorIdentifier: info.two_factor_identifier,
        verificationMethod: info.totp_two_factor_on ? '0' : '1',
        trustThisDevice: '1',
      });
      log('✓ 2FA verified!');
    } else {
      rl.close();
      throw e;
    }
  }

  const sessionData = await ig.state.serialize();
  await writeFile(SESSION_FILE, JSON.stringify(sessionData, null, 2));
  log(`✓ Session saved to ${SESSION_FILE}`);
  rl.close();
}
