/**
 * @module commands/send
 * Send command — send a DM.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { SESSION_FILE } from '../constants.mjs';
import { log } from '../utils.mjs';

export async function cmdSend(username, message) {
  if (!username || typeof username !== 'string') {
    log('✗ Invalid username'); process.exit(1);
  }
  if (!message || typeof message !== 'string') {
    log('✗ Message cannot be empty'); process.exit(1);
  }

  const require = createRequire(import.meta.url);
  const { IgApiClient } = require(join(homedir(), 'devel/argonauta/ig-cli/node_modules/instagram-private-api'));

  const sessionData = JSON.parse(await readFile(SESSION_FILE, 'utf8'));
  const ig = new IgApiClient();
  ig.state.generateDevice('bumblebeeclanker');
  await ig.state.deserialize(sessionData);

  const user = await ig.user.searchExact(username);
  if (!user) { log(`✗ User not found: ${username}`); process.exit(1); }

  const thread = ig.entity.directThread([user.pk.toString()]);
  await thread.broadcastText(message);
  log(`✓ Sent to @${username}: ${message}`);
}
