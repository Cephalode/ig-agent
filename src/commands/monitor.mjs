/**
 * @module commands/monitor
 * Monitor command — MQTT-based realtime DM listener and auto-reply.
 */
import instaPkg from 'nodejs-insta-private-api';
const { RealtimeClient, useMultiFileAuthState } = instaPkg;
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    const myId = ig.state.cookieUserId;
    if (msg.userId?.toString() === myId) return;

    const username = msg.username || `user_${msg.userId}`;

    // Check if sender is in allowed list
    const mappedUsername = Object.entries(config.nameMap || {}).find(([display]) =>
      username.toLowerCase().includes(display.toLowerCase())
    )?.[1] || username;

    if (!(config.allowedSenders || []).includes(mappedUsername)) {
      log(`→ Skipping: @${username}`);
      return;
    }

    const itemType = msg.itemType || 'text';

    // Extract image URL for media messages
    let imageUrl = null;
    if (['media', 'raven_media'].includes(itemType)) {
      const raw = msg.rawData || {};
      const media = raw.media || raw.visual_media?.media;
      if (media?.image_versions2?.candidates?.[0]?.url) {
        imageUrl = media.image_versions2.candidates[0].url;
      }
    }

    // Text messages
    if (itemType === 'text' && msg.text) {
      log(`📩 @${username}: "${msg.text.slice(0, 50)}"`);
      await handleWithPi(username, msg.text, msg.thread_id, mappedUsername, config, realtime);
      return;
    }

    // Image messages
    if (imageUrl) {
      log(`📸 @${username}: sent an image`);
      await handleWithPi(username, '[user sent an image]', msg.thread_id, mappedUsername, config, realtime, imageUrl);
      return;
    }

    // Other types (links, reels, etc.) — log and skip
    log(`📨 @${username}: sent ${itemType} (skipped)`);
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

async function handleWithPi(sender, text, threadId, username, config, realtime, imageUrl = null) {
  const isDana = username === 'dana.seismo_';
  const danaHint = isDana ? '\nBe extra warm and friendly!' : '';
  const piBin = config.piPath || '/Users/sqibo/.local/bin/pi';
  const model = config.piModel || 'z-ai/glm-4.6v';
  const systemPrompt = `You are @bumblebeeclanker on Instagram — a chill, witty AI. Reply briefly and casually (1-2 sentences max).${danaHint}`;

  let prompt = text;
  let cleanup = null;

  // For images: download to temp file and reference in prompt
  if (imageUrl) {
    try {
      const resp = await fetch(imageUrl);
      const buf = Buffer.from(await resp.arrayBuffer());
      const tmpPath = join(tmpdir(), `ig-img-${Date.now()}.jpg`);
      await writeFile(tmpPath, buf);
      prompt = `[user sent an image — describe what you see and react to it casually]`;
      // pi supports image URLs inline; pass the local file path
      prompt += `\n\nImage: file://${tmpPath}`;
      cleanup = tmpPath;
    } catch (e) {
      log(`  ⚠ Image download failed: ${e.message.slice(0, 60)}`);
      prompt = '[user sent an image but it failed to load — react casually]';
    }
  }

  log('  → Generating reply...');
  try {
    const { stdout } = await execFileAsync('/bin/bash', ['-c',
      `${piBin} -p ${JSON.stringify(prompt)} --system-prompt ${JSON.stringify(systemPrompt)} --model ${model} --no-tools --no-session --thinking off --mode text 2>/dev/null`
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
  } finally {
    if (cleanup) { try { await unlink(cleanup); } catch {} }
  }
}
