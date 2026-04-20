/**
 * @module commands/send
 * Send command — send a DM to a user.
 */
import { getAuthenticatedClient } from '../lib/ig-client.mjs';
import { log } from '../utils.mjs';

export async function cmdSend(username, message) {
  if (!username || typeof username !== 'string') {
    log('✗ Invalid username'); process.exit(1);
  }
  if (!message || typeof message !== 'string') {
    log('✗ Message cannot be empty'); process.exit(1);
  }

  const { ig } = await getAuthenticatedClient();

  // Use the high-level dm.send which resolves username → thread → broadcast
  try {
    await ig.dm.send({ to: username, message });
    log(`✓ Sent to @${username}: ${message}`);
  } catch (e) {
    log(`✗ Failed to send: ${e.message}`);
    process.exit(1);
  }
}
