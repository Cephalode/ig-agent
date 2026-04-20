/**
 * @module commands/read
 * Read command — read DMs from a user.
 */
import { getAuthenticatedClient } from '../lib/ig-client.mjs';
import { log } from '../utils.mjs';

export async function cmdRead(username, count = 10) {
  if (!username || typeof username !== 'string') {
    log('✗ Invalid username'); process.exit(1);
  }
  if (!Number.isFinite(count) || count < 1) count = 10;

  const { ig } = await getAuthenticatedClient();

  // Get inbox and find thread with target user
  const inbox = await ig.direct.getInbox();
  const threads = inbox.threads || [];
  const thread = threads.find(t =>
    t.users?.some(u => u.username.toLowerCase() === username.toLowerCase())
  );
  if (!thread) { log(`✗ No thread with @${username}`); process.exit(1); }

  // Get messages from thread
  const threadData = await ig.directThread.getThread(thread.thread_id);
  const msgs = threadData.items || thread.items || [];
  const myId = ig.state.cookieUserId;

  for (const msg of [...msgs].reverse().slice(-count)) {
    const sender = msg.user_id?.toString() === myId ? 'you' : username;
    const text = msg.text || '[media]';
    const ts = msg.timestamp ? new Date(parseInt(msg.timestamp) / 1000).toLocaleString() : '';
    console.log(`[${ts}] ${sender}: ${text}`);
  }
}
