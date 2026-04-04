#!/usr/bin/env node
// ig-agent — All-in-one Instagram agent CLI
// ESM module — use require() for CJS imports
// Install, login, monitor notifications, auto-reply via Hermes
//
// Usage:
//   ig-agent install          — Install dependencies
//   ig-agent login            — Login and save session
//   ig-agent monitor          — Start notification monitor
//   ig-agent send <user> <msg>— Send a DM
//   ig-agent read <user> [n]  — Read DMs
//   ig-agent status           — Check system status
//   ig-agent daemon           — Start background monitor daemon

import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// ─── Config ──────────────────────────────────────────────────────────
const HOME = homedir();
const BASE = join(HOME, '.ig-agent');
const SESSION_FILE = join(BASE, 'session.json');
const CONFIG_FILE = join(BASE, 'config.json');
const SEEN_FILE = join(BASE, 'seen.json');
const LOG_FILE = join(BASE, 'ig-agent.log');
const PID_FILE = join(BASE, 'daemon.pid');
const CHATS_DIR = join(BASE, 'chats');

const DEFAULT_CONFIG = {
  allowedSenders: ['ydkshad', 'cephalode', 'dana.seismo_', 'fenpolt', 'pbnjaney'],
  nameMap: {
    'Mesonycho': 'ydkshad',
    'Cephalode': 'cephalode',
    'Dana': 'dana.seismo_',
    'Fenpolt': 'fenpolt',
    'Pbnjaney': 'pbnjaney',
  },
  adb: findADB(),
  pollInterval: 5000,
  replyEnabled: true,
  hermesPath: findHermes(),
  sendPath: findIgCli(),
  emulatorAvd: 'ig-phone',
  emulatorMemory: 2048,
  emulatorHeadless: true,
};

function findADB() {
  try { return execSync('which adb 2>/dev/null || find /nix/store -maxdepth 4 -name adb -type f 2>/dev/null | head -1', { encoding: 'utf8' }).trim(); } catch { return 'adb'; }
}
function findHermes() {
  try { return execSync('which hermes 2>/dev/null || echo /Users/sqibo/.local/bin/hermes', { encoding: 'utf8' }).trim(); } catch { return 'hermes'; }
}
function findIgCli() {
  const p = join(HOME, 'devel/argonauta/ig-cli/index.mjs');
  try { accessSync(p); return p; } catch { return 'node ' + p; }
}
function accessSync(p) { try { require('fs').accessSync(p); return true; } catch { return false; } }

// ─── Utils ───────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
  try { require('fs').appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

async function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(await readFile(CONFIG_FILE, 'utf8')) }; }
  catch { return DEFAULT_CONFIG; }
}

async function saveConfig(cfg) {
  await mkdir(BASE, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

async function loadSeen() {
  try { return new Set(JSON.parse(await readFile(SEEN_FILE, 'utf8'))); }
  catch { return new Set(); }
}

async function saveSeen(seen) {
  await writeFile(SEEN_FILE, JSON.stringify([...seen].slice(-2000)));
}

async function getIgClient() {
  const { IgApiClient } = require(join(HOME, 'devel/argonauta/ig-cli/node_modules/instagram-private-api'));
  const sessionData = JSON.parse(await readFile(SESSION_FILE, 'utf8'));
  const ig = new IgApiClient();
  ig.state.generateDevice('bumblebeeclanker');
  await ig.state.deserialize(sessionData);
  return ig;
}

// ─── Commands ────────────────────────────────────────────────────────
async function cmdInstall() {
  log('Installing ig-agent...');
  await mkdir(BASE, { recursive: true });
  await mkdir(CHATS_DIR, { recursive: true });

  // Check node
  try { execSync('node --version', { stdio: 'pipe' }); }
  catch { log('✗ Node.js not found. Install node >= 20 first.'); process.exit(1); }

  // Check/install instagram-private-api
  const igCliPath = join(HOME, 'devel/argonauta/ig-cli');
  try { await access(join(igCliPath, 'node_modules/instagram-private-api')); }
  catch {
    log('Installing instagram-cli...');
    execSync(`mkdir -p ${igCliPath} && cd ${igCliPath} && npm init -y && npm install instagram-private-api`, { stdio: 'inherit' });
  }

  // Save default config
  const cfg = await loadConfig();
  await saveConfig(cfg);

  log('✓ ig-agent installed');
  log(`  Config: ${CONFIG_FILE}`);
  log(`  Session: ${SESSION_FILE}`);
  log(`  Logs: ${LOG_FILE}`);
  log('\nNext: run `ig-agent login` to authenticate');
}

async function cmdLogin() {
  await mkdir(BASE, { recursive: true });
  const rl = readline.createInterface({ input, output });

  const username = await rl.question('Username: ');
  const password = await rl.question('Password: ', { hideEchoBack: true });

  const { IgApiClient } = require(join(HOME, 'devel/argonauta/ig-cli/node_modules/instagram-private-api'));
  const ig = new IgApiClient();
  ig.state.generateDevice(username);

  try {
    await ig.simulate.preLoginFlow();
    const loggedInUser = await ig.account.login(username, password);
    log(`✓ Logged in as @${loggedInUser.username}`);
  } catch (e) {
    if (e.name === 'IgCheckpointError') {
      log('⚠ Verification required — check your email/phone');
      const code = await rl.question('Enter code: ');
      await ig.challenge.sendSecurityCode(code);
      log('✓ Verified!');
    } else if (e.name === 'IgLoginTwoFactorRequiredError') {
      const info = e.response.body.two_factor_info;
      log(`⚠ 2FA required (${info.totp_two_factor_on ? 'authenticator app' : 'SMS'})`);
      const code = await rl.question('Enter 2FA code: ');
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
  await writeFile(SESSION_FILE, JSON.stringify(sessionData));
  log(`✓ Session saved to ${SESSION_FILE}`);
  rl.close();
}

async function cmdEmulator(config) {
  const { start, memory, headless } = config;
  const avd = config.emulatorAvd || 'ig-phone';
  const emulatorPath = findEmulator();

  if (!emulatorPath) {
    log('✗ Android emulator not found. Install Android SDK emulator.');
    process.exit(1);
  }

  const args = ['-avd', avd, '-gpu', 'host', '-memory', String(memory || 2048)];
  if (headless) args.push('-no-window', '-no-audio');
  args.push('-no-snapshot-save');

  log(`Starting emulator ${avd} (${headless ? 'headless' : 'GUI'}, ${memory}MB)...`);
  const proc = spawn(emulatorPath, args, { detached: true, stdio: 'ignore' });
  proc.unref();
  log(`✓ Emulator started (PID ${proc.pid})`);
  await writeFile(PID_FILE, String(proc.pid));
}

function findEmulator() {
  try {
    return execSync(
      'find /nix/store -maxdepth 4 -name emulator -path "*/android-sdk/emulator/emulator" -type f 2>/dev/null | head -1',
      { encoding: 'utf8' }
    ).trim() || join(HOME, 'android-sdk/emulator/emulator');
  } catch { return join(HOME, 'android-sdk/emulator/emulator'); }
}

async function cmdSend(username, message) {
  const ig = await getIgClient();
  const user = await ig.user.searchExact(username);
  if (!user) { log(`✗ User not found: ${username}`); process.exit(1); }
  const thread = ig.entity.directThread([user.pk.toString()]);
  await thread.broadcastText(message);
  log(`✓ Sent to @${username}: ${message}`);
}

async function cmdRead(username, count = 10) {
  const ig = await getIgClient();
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

async function cmdStatus(config) {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   ig-agent status                    ║');
  console.log('╠══════════════════════════════════════╣');

  // Session
  try {
    await readFile(SESSION_FILE);
    console.log('║ Session: ✓ valid');
  } catch {
    console.log('║ Session: ✗ not found (run ig-agent login)');
  }

  // Emulator
  try {
    const adb = config.adb || 'adb';
    const devices = execSync(`${adb} devices`, { encoding: 'utf8' });
    const hasEmulator = devices.includes('emulator');
    console.log(`║ Emulator: ${hasEmulator ? '✓ running' : '✗ not running'}`);
  } catch {
    console.log('║ Emulator: ✗ adb not found');
  }

  // Daemon
  try {
    const pid = await readFile(PID_FILE, 'utf8');
    process.kill(parseInt(pid.trim()), 0);
    console.log(`║ Daemon: ✓ running (PID ${pid.trim()})`);
  } catch {
    console.log('║ Daemon: ✗ not running');
  }

  // Hermes
  try {
    execSync(`${config.hermesPath} chat -q "ping"`, { timeout: 15000, stdio: 'pipe' });
    console.log('║ Hermes: ✓ responding');
  } catch {
    console.log('║ Hermes: ✗ not responding');
  }

  // Config
  const allowed = config.allowedSenders?.length || 0;
  console.log(`║ Allowed senders: ${allowed}`);
  console.log(`║ Config: ${CONFIG_FILE}`);
  console.log(`║ Logs: ${LOG_FILE}`);
  console.log('╚══════════════════════════════════════╝');
}

// ─── Monitor ─────────────────────────────────────────────────────────
async function cmdMonitor(config) {
  const seen = await loadSeen();
  let processing = false;

  log('=== ig-agent monitor started ===');

  async function check() {
    if (processing) return;
    processing = true;
    try {
      const output = execSync(`${config.adb} shell dumpsys notification --noredact`, {
        timeout: 15000, encoding: 'utf8'
      });

      const re = /sender=([^,]+),\s*text=([^,]+),\s*time=(\d+)/g;
      let match;
      while ((match = re.exec(output)) !== null) {
        const sender = match[1].trim();
        const text = match[2].trim();
        const time = match[3];
        const key = `${sender}:${text}:${time}`;

        if (seen.has(key) || text.length === 0) continue;

        const ctx = output.slice(Math.max(0, match.index - 2000), match.index);
        if (!ctx.includes('com.instagram.android')) continue;
        seen.add(key);

        const username = Object.entries(config.nameMap).find(([display]) =>
          sender.includes(display)
        )?.[1];

        if (!username || !config.allowedSenders.includes(username)) {
          log(`→ Skipping: ${sender}`);
          continue;
        }

        log(`📩 ${sender} (@${username}): "${text.slice(0, 50)}"`);
        await handleWithHermes(sender, text, username, config);
      }
      await saveSeen(seen);
    } finally {
      processing = false;
    }
  }

  async function handleWithHermes(sender, text, username, config) {
    const isDana = username === 'dana.seismo_';
    const danaHint = isDana ? '\nNOTE: Be extra warm and friendly!' : '';
    const prompt = `You are @bumblebeeclanker on Instagram. Reply briefly and casually (1-2 sentences).${danaHint}\n\nDM from ${sender}: "${text}"\n\nJust output the reply text, nothing else.`;

    log('  → Generating reply...');
    try {
      const { stdout } = await execFileAsync('/bin/bash', ['-c', `${config.hermesPath} chat -q ${JSON.stringify(prompt)}`], {
        timeout: 60000, maxBuffer: 1024 * 1024, encoding: 'utf8'
      });

      const reply = stdout.trim();
      if (!reply) { log('  ✗ Empty reply'); return; }

      log(`  ← Reply: "${reply.slice(0, 60)}"`);

      // Send via ig-cli
      try {
        execSync(`node ${config.sendPath} send ${username} "${reply.replace(/"/g, '\\"')}"`, {
          timeout: 30000, encoding: 'utf8'
        });
        log(`  ✓ Sent to @${username}`);
      } catch (e) {
        log(`  ✗ Send error: ${e.message.slice(0, 80)}`);
      }
    } catch (e) {
      log(`  ✗ Hermes error: ${e.message.slice(0, 80)}`);
    }
  }

  await check();
  setInterval(check, config.pollInterval);
}

// ─── Daemon ──────────────────────────────────────────────────────────
async function cmdDaemon(config) {
  log('Starting ig-agent as daemon...');
  const child = spawn('node', [import.meta.url.replace('file://', ''), 'monitor'], {
    detached: true, stdio: 'ignore',
    env: { ...process.env, IG_AGENT_DAEMON: '1' }
  });
  child.unref();
  await writeFile(PID_FILE, String(child.pid));
  log(`✓ Daemon started (PID ${child.pid})`);
}

// ─── Main ────────────────────────────────────────────────────────────
const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case 'install':
    await cmdInstall();
    break;
  case 'login':
    await cmdLogin();
    break;
  case 'emulator':
    await cmdEmulator(await loadConfig());
    break;
  case 'send':
    if (!args[0] || !args[1]) { console.log('Usage: ig-agent send <username> <message>'); process.exit(1); }
    await cmdSend(args[0], args.slice(1).join(' '));
    break;
  case 'read':
    if (!args[0]) { console.log('Usage: ig-agent read <username> [count]'); process.exit(1); }
    await cmdRead(args[0], parseInt(args[1]) || 10);
    break;
  case 'status':
    await cmdStatus(await loadConfig());
    break;
  case 'monitor':
    await cmdMonitor(await loadConfig());
    break;
  case 'daemon':
    await cmdDaemon(await loadConfig());
    break;
  default:
    console.log(`
🐙 ig-agent — All-in-one Instagram agent CLI

Usage:
  ig-agent install            Install dependencies
  ig-agent login              Login and save session
  ig-agent emulator           Start Android emulator
  ig-agent send <user> <msg>  Send a DM
  ig-agent read <user> [n]    Read DMs (default: 10)
  ig-agent status             Check system status
  ig-agent monitor            Start notification monitor (foreground)
  ig-agent daemon             Start monitor as background daemon

Config: ${join(HOME, '.ig-agent/config.json')}
    `);
}
