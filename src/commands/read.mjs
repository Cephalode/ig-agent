// Read command — read DMs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { SESSION_FILE } from '../constants.mjs';
import { log } from '../utils.mjs';

/**
 * Read recent DMs from an Instagram user.
 * @param {string} username - Instagram username to read messages from.
 * @param {number} [count=10] - Number of recent messages to display.
 */
export async function cmdRead(username, count = 10) {
  if (!username) {
    console.error('Usage: ig-agent read <username> [count]');
    process.exit(1);
  }

  const require = createRequire(import.meta.url);
  const { IgApiClient } = require(join(homedir(), 'devel/argonauta/ig-cli/node_modules/instagram-private-api'));

  const sessionData = JSON.parse(await readFile(SESSION_FILE, 'utf8'));
  const ig = new IgApiClient();
  ig.state.generateDevice('bumblebeeclanker');
  await ig.state.deserialize(sessionData);

  const userId = await ig.user.searchExact(username);
  if (!userId) { log(`✗ User not found: ${username}`); process.exit(1); }

  const inbox = ig.feed.directInbox();
  const threads = await inbox.items();
  const thread = threads.find(t =>
    t.users?.some(u => u.username.toLowerCase() === username.toLowerCase())
  );
  if (!thread) { log(`✗ No thread with @${username}`); process.exit(1); }

  const feed = ig.feed.directThread({ thread_id: thread.thread_id });
  const msgs = await feed.items();
  const myId = ig.state.cookieUserId;

  for (const msg of [...msgs].reverse().slice(-count)) {
    const sender = msg.user_id?.toString() === myId ? 'you' : username;
    const text = msg.text || '[media]';
    const ts = msg.timestamp ? new Date(parseInt(msg.timestamp) / 1000).toLocaleString() : '';
    console.log(`[${ts}] ${sender}: ${text}`);
  }
}
