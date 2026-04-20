/**
 * @module commands/monitor
 * Monitor command — MQTT-based realtime DM listener with message queue.
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

/**
 * Simple async message queue — processes one message at a time.
 * Incoming messages are pushed to the queue; a single consumer loop
 * picks them up sequentially so no message gets dropped.
 */
class MessageQueue {
  constructor() {
    this._queue = [];
    this._processing = false;
    this._stats = { queued: 0, processed: 0, dropped: 0 };
  }

  async enqueue(handler, payload) {
    this._stats.queued++;
    this._queue.push({ handler, payload });
    log(`  📋 Queued (depth: ${this._queue.length}, total: ${this._stats.queued})`);
    this._drain();
  }

  async _drain() {
    if (this._processing) return;
    this._processing = true;

    while (this._queue.length > 0) {
      const { handler, payload } = this._queue.shift();
      try {
        await handler(payload);
        this._stats.processed++;
      } catch (err) {
        this._stats.dropped++;
        log(`  ✗ Queue handler error: ${err.message?.slice(0, 80) || err}`);
      }
    }

    this._processing = false;
  }

  get stats() {
    return { ...this._stats, depth: this._queue.length };
  }
}

export async function cmdMonitor() {
  const config = await loadConfig();
  const queue = new MessageQueue();
  log('=== ig-agent monitor starting (MQTT + queue) ===');

  // Authenticate
  const { ig, authState } = await getAuthenticatedClient();
  log('✓ Authenticated');

  // Create realtime client
  const realtime = new RealtimeClient(ig);

  // The MessageSync mixin emits 'message' (not 'message_live')
  // Payload shape: { message: { thread_id, ...raw }, parsed: { username, userId, text, itemType, threadId, rawData } }
  realtime.on('message', (msg) => {
    const p = msg.parsed || {};
    const threadId = p.threadId || msg.message?.thread_id;
    const username = p.username || 'unknown';
    const userId = p.userId;
    const text = p.text || '';
    const itemType = p.itemType || 'text';
    const rawData = p.rawData || {};

    // Skip own messages
    const myId = ig.state.cookieUserId;
    if (String(userId) === String(myId)) return;

    // Resolve display name → username mapping
    const mappedUsername = Object.entries(config.nameMap || {}).find(([display]) =>
      username.toLowerCase().includes(display.toLowerCase())
    )?.[1] || username;

    // Check allowed senders
    if (!(config.allowedSenders || []).includes(mappedUsername)) {
      log(`→ Skipping: @${username}`);
      return;
    }

    // Extract image URL for media messages
    let imageUrl = null;
    if (['media', 'raven_media'].includes(itemType)) {
      const media = rawData.media || rawData.visual_media?.media;
      if (media?.image_versions2?.candidates?.[0]?.url) {
        imageUrl = media.image_versions2.candidates[0].url;
      }
    }

    const payload = { username, mappedUsername, userId, text, itemType, threadId, imageUrl, rawData, config, realtime };

    if (itemType === 'text' && text) {
      log(`📩 @${username}: "${text.slice(0, 50)}"`);
      queue.enqueue(handleWithPi, payload);
    } else if (imageUrl) {
      log(`📸 @${username}: sent an image`);
      payload.text = '[user sent an image]';
      queue.enqueue(handleWithPi, payload);
    } else {
      log(`📨 @${username}: sent ${itemType} (skipped)`);
    }
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

    try { await authState.saveMqttSession(realtime); } catch {}
  } catch (e) {
    log(`✗ MQTT connection failed: ${e.message}`);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    log('Shutting down...');
    const stats = queue.stats;
    log(`  Queue stats: ${stats.processed} processed, ${stats.dropped} dropped, ${stats.depth} pending`);
    try { await realtime.disconnect(); } catch {}
    try { await authState.saveMqttSession(realtime); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function handleWithPi({ username, mappedUsername, text, threadId, imageUrl, config, realtime }) {
  const isDana = mappedUsername === 'dana.seismo_';
  const danaHint = isDana ? '\nBe extra warm and friendly!' : '';
  const piBin = config.piPath || '/Users/sqibo/.local/bin/pi';
  const model = config.piModel || 'z-ai/glm-4.7-flash';
  const systemPrompt = `You are @bumblebeeclanker on Instagram — a chill, witty AI. Reply briefly and casually (1-2 sentences max).${danaHint}`;

  let prompt = text;
  let cleanup = null;

  // For images: download to temp file
  if (imageUrl) {
    try {
      const resp = await fetch(imageUrl);
      const buf = Buffer.from(await resp.arrayBuffer());
      const tmpPath = join(tmpdir(), `ig-img-${Date.now()}.jpg`);
      await writeFile(tmpPath, buf);
      prompt = `[user sent an image — describe what you see and react to it casually]`;
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
      timeout: 30000, maxBuffer: 1024 * 1024, encoding: 'utf8',
      cwd: '/tmp'
    });

    const reply = stdout.trim();
    if (!reply) { log('  ✗ Empty reply'); return; }
    log(`  ← Reply: "${reply.slice(0, 60)}"`);

    try {
      await realtime.directCommands.sendTextViaRealtime(threadId, reply);
      log(`  ✓ Sent to @${mappedUsername}`);
    } catch (e) {
      log(`  ✗ Send error: ${e.message.slice(0, 80)}`);
    }
  } catch (e) {
    log(`  ✗ PI error: ${e.message.slice(0, 80)}`);
  } finally {
    if (cleanup) { try { await unlink(cleanup); } catch {} }
  }
}
