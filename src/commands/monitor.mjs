/**
 * @module commands/monitor
 * Monitor command — MQTT-based realtime DM listener with message queue.
 * Calls z.ai API directly (no pi CLI) for fast ~1s replies.
 * Per-thread conversation memory in ~/.ig-agent/memory/.
 */
import instaPkg from 'nodejs-insta-private-api';
const { RealtimeClient, useMultiFileAuthState } = instaPkg;
import fs from 'node:fs';
import { writeFile, unlink, mkdir, readFile, rename, stat, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAuthenticatedClient } from '../lib/ig-client.mjs';
import { loadConfig } from '../config.mjs';
import { log } from '../utils.mjs';
import { MEMORY_DIR, CHATS_DIR, BASE, NOTES_DIR } from '../constants.mjs';

const KNOWN_PEOPLE_FILE = join(BASE, 'known_people.json');
const BOT_USERNAME = 'bumblebeeclanker';

/**
 * Append a chat line to the per-thread daily log file.
 * Fix #4: ~/.ig-agent/chats/{threadId}/YYYY-MM-DD.txt
 * Fire-and-forget via fs.appendFile (callback-based, non-blocking).
 */
function appendChatLog(threadId, sender, text) {
  const now = new Date();
  const ts = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const line = `[${ts}] ${sender}: ${text}\n`;
  const threadDir = join(CHATS_DIR, threadId);
  const filePath = join(threadDir, `${dateStr}.txt`);
  // Ensure directory exists, then append
  fs.mkdir(threadDir, { recursive: true }, (mkdirErr) => {
    if (mkdirErr && mkdirErr.code !== 'EEXIST') {
      log(`  ⚠ Chat log mkdir error: ${mkdirErr.message}`);
      return;
    }
    fs.appendFile(filePath, line, (err) => {
      if (err) log(`  ⚠ Chat log write error: ${err.message}`);
    });
  });
}

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

// ── Thread cache (Fix #1: group detection) ──────────────────────────────────

/**
 * Thread info cache populated by threadUpdate events.
 * Maps threadId → { isGroup, title, users: [{username, pk}], ... }
 */
const threadCache = new Map();

/**
 * Get thread info, falling back to API fetch if not cached.
 */
async function getThreadInfo(realtime, ig, threadId) {
  if (threadCache.has(threadId)) {
    return threadCache.get(threadId);
  }
  // Try realtime.threads map (populated by some library versions)
  if (realtime.threads?.has(threadId)) {
    const t = realtime.threads.get(threadId);
    const info = {
      isGroup: !!t.isGroup || !!t.is_group,
      title: t.title || t.thread_title || '',
      users: (t.users || []).map(u => ({ username: u.username, pk: u.pk })),
    };
    threadCache.set(threadId, info);
    return info;
  }
  // Fallback: try to fetch via API
  try {
    const thread = await ig.direct.thread.getThread(threadId);
    const isGroup = thread?.is_group || thread?.isGroup || (thread?.users?.length > 2);
    const info = {
      isGroup: !!isGroup,
      title: thread?.thread_title || thread?.title || '',
      users: (thread?.users || []).map(u => ({ username: u.username, pk: String(u.pk) })),
    };
    threadCache.set(threadId, info);
    return info;
  } catch (e) {
    log(`  ⚠ Could not fetch thread info for ${threadId}: ${e.message?.slice(0, 60)}`);
    // Default: assume DM
    const info = { isGroup: false, title: '', users: [] };
    threadCache.set(threadId, info);
    return info;
  }
}

// ── Per-user notes (Fix #5) ─────────────────────────────────────────────────

/**
 * Load notes for a specific user from ~/.ig-agent/notes/{username}.md
 */
async function loadUserNotes(username) {
  const filePath = join(NOTES_DIR, `${username}.md`);
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Save notes for a specific user.
 */
async function saveUserNotes(username, content) {
  const filePath = join(NOTES_DIR, `${username}.md`);
  await mkdir(NOTES_DIR, { recursive: true });
  await writeFile(filePath, content);
}

/**
 * Build notes section for the system prompt.
 * Loads notes for the sender and any @mentioned users.
 */
async function buildNotesSection(text, mappedUsername) {
  const usernames = new Set([mappedUsername]);
  // Extract @mentions from text
  const mentionRegex = /@([a-zA-Z0-9._]+)/g;
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    usernames.add(match[1]);
  }

  const notesLines = [];
  for (const uname of usernames) {
    const notes = await loadUserNotes(uname);
    if (notes && notes.trim()) {
      notesLines.push(`Notes about @${uname}: ${notes.trim()}`);
    }
  }

  return notesLines.length > 0
    ? '\n\n' + notesLines.join('\n')
    : '';
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

  // Ensure memory, chats, and notes directories exist
  await mkdir(MEMORY_DIR, { recursive: true });
  await mkdir(CHATS_DIR, { recursive: true });
  await mkdir(NOTES_DIR, { recursive: true });

  // Load known people map
  await loadKnownPeople();

  // Migrate known_people.json → per-user notes (Fix #5)
  await migrateKnownPeopleToNotes();

  // Authenticate
  const { ig, authState } = await getAuthenticatedClient();
  log('✓ Authenticated');

  // Create realtime client
  const realtime = new RealtimeClient(ig);

  // Fix #1: Listen for threadUpdate events to populate thread cache
  realtime.on('threadUpdate', (data) => {
    try {
      const update = data.update || data;
      const threadId = update.thread_id || update.thread_v2_id || data.meta?.thread_id;
      if (!threadId) return;

      const users = (update.users || []).map(u => ({
        username: u.username,
        pk: String(u.pk),
      }));

      threadCache.set(threadId, {
        isGroup: !!(update.is_group || update.isGroup),
        title: update.thread_title || '',
        users,
      });

      // Also populate realtime.threads for library-internal use
      try {
        if (!realtime.threads.has(threadId)) {
          realtime.threads.set(threadId, {
            isGroup: !!(update.is_group || update.isGroup),
            title: update.thread_title || '',
            users,
          });
        }
      } catch {}
    } catch {}
  });

  // Handle incoming messages
  realtime.on('message', async (msg) => {
    const p = msg.parsed || {};
    const threadId = p.threadId || msg.message?.thread_id;
    const username = p.username || 'unknown';
    const userId = p.userId;
    const text = p.text || '';
    const itemType = p.itemType || 'text';
    const rawData = p.rawData || {};
    const messageId = p.messageId || rawData.item_id || rawData.id;
    const replyToItemId = rawData.reply_to_item_id || rawData.reply?.item_id || null;

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

    // Fix #1: Group chat — only respond when @mentioned or replied-to
    const threadInfo = await getThreadInfo(realtime, ig, threadId);
    if (threadInfo.isGroup) {
      const mentioned = text.toLowerCase().includes(`@${BOT_USERNAME}`);
      const isReplyToBot = replyToItemId ? true : false; // reply to any message in group triggers
      if (!mentioned && !isReplyToBot) {
        log(`  📭 Group chat: skipping (no mention/reply) "@${username}: ${text.slice(0, 40)}"`);
        return;
      }
    }

    // Extract image URL for media messages
    let imageUrl = null;
    if (['media', 'raven_media'].includes(itemType)) {
      const media = rawData.media || rawData.visual_media?.media;
      if (media?.image_versions2?.candidates?.[0]?.url) {
        imageUrl = media.image_versions2.candidates[0].url;
      }
    }

    const payload = {
      username, mappedUsername, userId, text, itemType,
      threadId, imageUrl, rawData, config, realtime, ig,
      messageId, replyToItemId, threadInfo,
    };

    if (itemType === 'text' && text) {
      log(`📩 @${username}: "${text.slice(0, 50)}"`);
      appendChatLog(threadId, username, text);
      queue.enqueue(handleWithZai, payload);
    } else if (imageUrl) {
      log(`📸 @${username}: sent an image`);
      appendChatLog(threadId, username, '[sent an image]');
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

/** Known people: loaded from ~/.ig-agent/known_people.json at startup. */
let knownPeople = {};

async function loadKnownPeople() {
  try {
    const raw = await readFile(KNOWN_PEOPLE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    // Filter out meta keys like _readme
    knownPeople = Object.fromEntries(
      Object.entries(parsed).filter(([k]) => !k.startsWith('_'))
    );
    const count = Object.keys(knownPeople).length;
    if (count) log(`✓ Loaded ${count} known people from ${KNOWN_PEOPLE_FILE}`);
  } catch {
    knownPeople = {};
    log('  ℹ No known_people.json found, using empty known people map');
  }
}

/**
 * Migrate known_people.json entries → per-user notes files (Fix #5).
 */
async function migrateKnownPeopleToNotes() {
  for (const [handle, info] of Object.entries(knownPeople)) {
    const existing = await loadUserNotes(handle);
    if (!existing) {
      await saveUserNotes(handle, info);
      log(`  📝 Migrated known_people → notes for @${handle}`);
    }
  }
}

async function handleWithZai({
  mappedUsername, text, threadId, imageUrl, config, realtime, ig,
  messageId, replyToItemId, threadInfo,
}) {
  const apiKey = config.zaiApiKey;
  // Fix #6: Config model takes precedence; default to glm-5 (fast flagship)
  const model = config.zaiModel || 'glm-5';

  // Build persona context for known people
  // Include ALL known people as general knowledge so the bot can answer questions about them
  const allPeople = Object.entries(knownPeople);
  const knownPeopleSection = allPeople.length > 0
    ? '\n\nKnown people (you know who they are, reference this when asked):\n' +
      allPeople.map(([handle, info]) => `- @${handle}: ${info}`).join('\n')
    : '';

  // Extra warmth hint if the sender is a known person
  const senderEntry = knownPeople[mappedUsername];
  const warmthHint = senderEntry
    ? `\n\nBe extra warm and kind with @${mappedUsername}!`
    : '';

  // Fix #3: Group vs DM context awareness
  let contextSection = '';
  if (threadInfo?.isGroup) {
    const participants = threadInfo.users?.map(u => `@${u.username}`).join(', ') || 'unknown participants';
    contextSection = `\n\nYou are in a GROUP CHAT with participants: ${participants}`;
  } else {
    contextSection = `\n\nYou are in a private DM with @${mappedUsername}`;
  }

  // Fix #5: Load per-user notes
  const notesSection = await buildNotesSection(text, mappedUsername);

  const systemPrompt = `You are @bumblebeeclanker on Instagram — a chill, witty AI. Reply briefly and casually (1-2 sentences max).${knownPeopleSection}${warmthHint}${contextSection}${notesSection}`;

  // Per-thread session file for persistent memory
  const sessionFile = join(MEMORY_DIR, `${threadId}.json`);

  // Fix #2: Include sender username in user message content
  let prompt = `[${mappedUsername}]: ${text}`;
  let cleanup = null;

  // For images: download to temp file
  if (imageUrl) {
    try {
      const resp = await fetch(imageUrl);
      const buf = Buffer.from(await resp.arrayBuffer());
      const tmpPath = join(tmpdir(), `ig-img-${Date.now()}.jpg`);
      await writeFile(tmpPath, buf);
      prompt = `[${mappedUsername}]: [user sent an image — describe what you see and react to it casually]`;
      cleanup = tmpPath;
    } catch (e) {
      log(`  ⚠ Image download failed: ${e.message.slice(0, 60)}`);
      prompt = `[${mappedUsername}]: [user sent an image but it failed to load — react casually]`;
    }
  }

  console.log('[DEBUG] System prompt:', systemPrompt);
  log('  → Generating reply...');
  try { await realtime.directCommands.indicateActivity({ threadId }); } catch {}
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

    // Fix #7: Reply to specific message if incoming was a reply
    // Fix #1: Also use replyToMessage for group chat mentions to maintain context
    try {
      if (replyToItemId) {
        await realtime.directCommands.replyToMessage(threadId, replyToItemId, reply);
        log(`  ✓ Sent reply-to ${replyToItemId} to @${mappedUsername}`);
      } else {
        await realtime.directCommands.sendTextViaRealtime(threadId, reply);
        log(`  ✓ Sent to @${mappedUsername}`);
      }
      appendChatLog(threadId, 'bumblebeeclanker', reply);
    } catch (e) {
      log(`  ✗ Send error: ${e.message.slice(0, 80)}`);
    }

    // Fix #5: Per-user notes — ask model to note any new facts
    try {
      await updateNotesFromConversation(mappedUsername, text, reply, apiKey, model);
    } catch (e) {
      log(`  ⚠ Notes update error: ${e.message?.slice(0, 60)}`);
    }
  } catch (e) {
    log(`  ✗ API error: ${e.message?.slice(0, 80) || e}`);
  } finally {
    if (cleanup) { try { await unlink(cleanup); } catch {} }
  }
}

/**
 * Fix #5: After generating a reply, ask the model to extract any new facts
 * about the user and update their notes file.
 */
async function updateNotesFromConversation(mappedUsername, userText, botReply, apiKey, model) {
  const existingNotes = await loadUserNotes(mappedUsername);
  const notesContext = existingNotes
    ? `Current notes about @${mappedUsername}:\n${existingNotes}\n`
    : `No existing notes about @${mappedUsername}.\n`;

  const notesPrompt = `You are managing notes about users. Based on the conversation below, extract any NEW facts or preferences learned about @${mappedUsername}. 

${notesContext}
Conversation:
User: ${userText}
Bot: ${botReply}

If there are new facts, respond with ONLY the updated notes (merge with existing). If nothing new was learned, respond with just "NO_CHANGE". Keep notes concise and factual, one fact per line.`;

  try {
    const data = await callZai({
      apiKey,
      model,
      messages: [
        { role: 'system', content: 'You extract and maintain concise user notes. Respond with updated notes or NO_CHANGE.' },
        { role: 'user', content: notesPrompt },
      ],
    });

    const notesReply = data?.choices?.[0]?.message?.content?.trim();
    if (notesReply && notesReply !== 'NO_CHANGE' && notesReply.length > 5) {
      await saveUserNotes(mappedUsername, notesReply);
      log(`  📝 Updated notes for @${mappedUsername}`);
    }
  } catch {}
}
