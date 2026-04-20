/**
 * @module commands/monitor
 * Monitor command — MQTT-based realtime DM listener and auto-reply.
 */
import instaPkg from 'nodejs-insta-private-api';
const { RealtimeClient, useMultiFileAuthState } = instaPkg;
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getAuthenticatedClient } from '../lib/ig-client.mjs';
import { loadConfig } from '../config.mjs';
import { log } from '../utils.mjs';

const execFileAsync = promisify(execFile);

export async function cmdMonitor() {
  const config = await loadConfig();
  log('=== ig-agent monitor starting (MQTT) ===');

  // Authenticate
  const { ig, authState } = await getAuthenticatedClient();
  log('✓ Authenticated');

  // Create realtime client
  const realtime = new RealtimeClient(ig);

  // Handle incoming messages
  realtime.on('message_live', async (msg) => {
    if (!msg || !msg.text || msg.itemType !== 'text') return;

    // Don't reply to own messages
    const myId = ig.state.cookieUserId;
    if (msg.userId?.toString() === myId) return;

    const username = msg.username || `user_${msg.userId}`;
    log(`📩 @${username}: "${msg.text.slice(0, 50)}"`);

    // Check if sender is in allowed list
    const mappedUsername = Object.entries(config.nameMap || {}).find(([display]) =>
      username.toLowerCase().includes(display.toLowerCase())
    )?.[1] || username;

    if (!(config.allowedSenders || []).includes(mappedUsername)) {
      log(`→ Skipping: @${username}`);
      return;
    }

    await handleWithPi(username, msg.text, msg.thread_id, mappedUsername, config, realtime);
  });

  realtime.on('error', (err) => {
    log(`✗ MQTT error: ${err.message?.slice(0, 80) || err}`);
  });

  realtime.on('warning', (warn) => {
    log(`⚠ MQTT warning: ${warn.message?.slice(0, 80) || warn}`);
  });

  // Connect
  try {
    await realtime.startRealTimeListener();
    log('✓ MQTT connected — listening for DMs');

    // Save MQTT session for faster reconnects
    try { await authState.saveMqttSession(realtime); } catch {}
  } catch (e) {
    log(`✗ MQTT connection failed: ${e.message}`);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    log('Shutting down...');
    try { await realtime.disconnect(); } catch {}
    try { await authState.saveMqttSession(realtime); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function handleWithPi(sender, text, threadId, username, config, realtime) {
  const isDana = username === 'dana.seismo_';
  const danaHint = isDana ? '\nBe extra warm and friendly!' : '';
  const piBin = config.piPath || '/Users/sqibo/.local/bin/pi';
  const model = config.piModel || 'z-ai/glm-4.7-flash';
  const systemPrompt = `You are @bumblebeeclanker on Instagram — a chill, witty AI. Reply briefly and casually (1-2 sentences max).${danaHint}`;

  log('  → Generating reply...');
  try {
    const { stdout } = await execFileAsync('/bin/bash', ['-c',
      `${piBin} -p ${JSON.stringify(text)} --system-prompt ${JSON.stringify(systemPrompt)} --model ${model} --no-tools --no-session --thinking off --mode text 2>/dev/null`
    ], {
      timeout: 30000, maxBuffer: 1024 * 1024, encoding: 'utf8'
    });

    const reply = stdout.trim();
    if (!reply) { log('  ✗ Empty reply'); return; }
    log(`  ← Reply: "${reply.slice(0, 60)}"`);

    try {
      await realtime.dmSender.sendTextMessage(threadId, reply);
      log(`  ✓ Sent to @${username}`);
    } catch (e) {
      log(`  ✗ Send error: ${e.message.slice(0, 80)}`);
    }
  } catch (e) {
    log(`  ✗ PI error: ${e.message.slice(0, 80)}`);
  }
}
