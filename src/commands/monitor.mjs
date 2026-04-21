/**
 * @module commands/monitor
 * Monitor command — MQTT-based realtime DM listener with message queue.
 * Calls z.ai API directly (no pi CLI) for fast ~1s replies.
 * Per-thread conversation memory in ~/.ig-agent/memory/.
 */
import instaPkg from 'nodejs-insta-private-api';
const { RealtimeClient, useMultiFileAuthState } = instaPkg;
import { writeFile, unlink, mkdir, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAuthenticatedClient } from '../lib/ig-client.mjs';
import { loadConfig } from '../config.mjs';
import { log } from '../utils.mjs';
import { MEMORY_DIR } from '../constants.mjs';

const ZAI_API_URL = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const MAX_HISTORY = 20; // last 20 messages (10 turns)

/**
 * Simple async message queue — processes one message at a time.
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

// ── Conversation memory helpers ──────────────────────────────────────────────

/**
 * Load conversation history for a thread.
 * Migrates old pi JSONL format on first encounter, otherwise reads simple array.
 */
async function loadHistory(threadId) {
  const filePath = join(MEMORY_DIR, `${threadId}.json`);
  try {
    const raw = await readFile(filePath, 'utf8');
    const trimmed = raw.trim();

    // Detect pi JSONL format: multiple JSON objects separated by newlines
    if (trimmed.startsWith('{"type":"session"') || trimmed.includes('\n{"type":')) {
      return migratePiJsonl(trimmed, filePath);
    }

    // Our format: JSON array of {role, content}
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

/**
 * Migrate pi JSONL session → simple message array.
 * Extracts user/assistant text pairs, then replaces the file.
 */
async function migratePiJsonl(raw, filePath) {
  const messages = [];
  for (const line of raw.split('\n')) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'message' && entry.message?.role && Array.isArray(entry.message?.content)) {
        const textPart = entry.message.content.find(c => c.type === 'text');
        if (textPart?.text) {
          messages.push({ role: entry.message.role, content: textPart.text });
        }
      }
    } catch {}
  }
  // Keep only user/assistant pairs, filter out errors and system
  const cleaned = messages.filter(m => m.role === 'user' || m.role === 'assistant');
  // Save migrated format
  try {
    const backupPath = filePath + '.pi.bak';
    await rename(filePath, backupPath);
    await writeFile(filePath, JSON.stringify(cleaned, null, 2));
    log(`  📦 Migrated pi session → new format (${cleaned.length} messages)`);
  } catch {}
  return cleaned;
}

/**
 * Save conversation history, keeping only last MAX_HISTORY messages.
 */
async function saveHistory(threadId, messages) {
  const filePath = join(MEMORY_DIR, `${threadId}.json`);
  const trimmed = messages.slice(-MAX_HISTORY);
  await writeFile(filePath, JSON.stringify(trimmed, null, 2));
}

// ── z.ai API call ────────────────────────────────────────────────────────────

/**
 * Call z.ai chat completions API with retry on 429.
 */
async function callZai({ apiKey, model, messages }) {
  const body = { model, messages, stream: false };

  const doFetch = async () => {
    const resp = await fetch(ZAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (resp.status === 429) {
      const err = new Error(`429 rate limited`);
      err.status = 429;
      throw err;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`z.ai ${resp.status}: ${text.slice(0, 120)}`);
    }

    return resp.json();
  };

  try {
    return await doFetch();
  } catch (err) {
    if (err.status === 429) {
      log('  ⏳ Rate limited, retrying in 2s...');
      await new Promise(r => setTimeout(r, 2000));
      return await doFetch();
    }
    throw err;
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function cmdMonitor() {
  const config = await loadConfig();
  const queue = new MessageQueue();
  log('=== ig-agent monitor starting (MQTT + z.ai) ===');

  // Ensure memory directory exists
  await mkdir(MEMORY_DIR, { recursive: true });

  // Authenticate
  const { ig, authState } = await getAuthenticatedClient();
  log('✓ Authenticated');

  // Create realtime client
  const realtime = new RealtimeClient(ig);

  // Handle incoming messages
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

    // Skip ghost events (no real user or text)
    if (!userId || String(userId) === 'unknown') return;

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
      queue.enqueue(handleWithZai, payload);
    } else if (imageUrl) {
      log(`📸 @${username}: sent an image`);
      payload.text = '[user sent an image]';
      queue.enqueue(handleWithZai, payload);
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

async function handleWithZai({ mappedUsername, text, threadId, imageUrl, config, realtime }) {
  const isDana = mappedUsername === 'dana.seismo_';
  const danaHint = isDana ? '\nBe extra warm and friendly!' : '';
  const apiKey = config.zaiApiKey;
  const model = config.zaiModel || 'glm-4.7-flash';
  const systemPrompt = `You are @bumblebeeclanker on Instagram — a chill, witty AI. Reply briefly and casually (1-2 sentences max).${danaHint}`;

  // Per-thread session file for persistent memory
  const sessionFile = join(MEMORY_DIR, `${threadId}.json`);

  let prompt = text;
  let cleanup = null;

  // For images: download to temp file
  if (imageUrl) {
    try {
      const resp = await fetch(imageUrl);
      const buf = Buffer.from(await resp.arrayBuffer());
      const tmpPath = join(tmpdir(), `ig-img-${Date.now()}.jpg`);
      await writeFile(tmpPath, buf);
      prompt = '[user sent an image — describe what you see and react to it casually]';
      cleanup = tmpPath;
    } catch (e) {
      log(`  ⚠ Image download failed: ${e.message.slice(0, 60)}`);
      prompt = '[user sent an image but it failed to load — react casually]';
    }
  }

  log('  → Generating reply...');
  try {
    // Load conversation history
    const history = await loadHistory(threadId);

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: prompt },
    ];

    // Call z.ai API
    const data = await callZai({ apiKey, model, messages });
    const reply = data?.choices?.[0]?.message?.content?.trim();

    if (!reply) { log('  ✗ Empty reply'); return; }
    log(`  ← Reply: "${reply.slice(0, 60)}"`);

    // Save updated history
    const updated = [...history, { role: 'user', content: prompt }, { role: 'assistant', content: reply }];
    await saveHistory(threadId, updated);

    try {
      await realtime.directCommands.sendTextViaRealtime(threadId, reply);
      log(`  ✓ Sent to @${mappedUsername}`);
    } catch (e) {
      log(`  ✗ Send error: ${e.message.slice(0, 80)}`);
    }
  } catch (e) {
    log(`  ✗ API error: ${e.message?.slice(0, 80) || e}`);
  } finally {
    if (cleanup) { try { await unlink(cleanup); } catch {} }
  }
}
