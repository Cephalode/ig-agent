// Monitor command — poll adb notifications and auto-reply
import { execSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig, loadSeen, saveSeen } from '../config.mjs';
import { log } from '../utils.mjs';

const execFileAsync = promisify(execFile);

/**
 * Start the notification monitor. Polls adb for Instagram notifications
 * and auto-replies to messages from allowed senders.
 */
export async function cmdMonitor() {
  const config = await loadConfig();
  const seen = await loadSeen();
  let processing = false;

  log('=== ig-agent monitor started ===');

  async function check() {
    if (processing) return;
    processing = true;
    try {
      const adb = config.adb || 'adb';
      const output = execSync(`${adb} shell dumpsys notification --noredact`, {
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

        const username = Object.entries(config.nameMap || {}).find(([display]) =>
          sender.includes(display)
        )?.[1];

        if (!username || !(config.allowedSenders || []).includes(username)) {
          log(`→ Skipping: ${sender}`);
          continue;
        }

        log(`📩 ${sender} (@${username}): "${text.slice(0, 50)}"`);
        await handleWithHermes(sender, text, username, config);
      }
      await saveSeen(seen);
    } catch (e) {
      log(`✗ Check error: ${e.message.slice(0, 60)}`);
    } finally {
      processing = false;
    }
  }

  /**
   * Generate a reply via hermes and send it.
   * @param {string} sender - Display name of sender.
   * @param {string} text - Message text.
   * @param {string} username - Instagram username.
   * @param {object} config - Current config.
   */
  async function handleWithHermes(sender, text, username, config) {
    const isDana = username === 'dana.seismo_';
    const danaHint = isDana ? '\nBe extra warm and friendly!' : '';
    const hermes = config.hermesPath || 'hermes';
    const prompt = `You are @bumblebeeclanker on Instagram. Reply briefly and casually (1-2 sentences).${danaHint}\n\nDM from ${sender}: "${text}"\n\nJust output the reply text, nothing else.`;

    log('  → Generating reply...');
    try {
      const { stdout } = await execFileAsync('/bin/bash', ['-c', `${hermes} chat -q ${JSON.stringify(prompt)}`], {
        timeout: 60000, maxBuffer: 1024 * 1024, encoding: 'utf8'
      });

      const reply = stdout.trim();
      if (!reply) { log('  ✗ Empty reply'); return; }
      log(`  ← Reply: "${reply.slice(0, 60)}"`);

      try {
        const igCli = config.sendPath || `node ${require('node:path').join(require('node:os').homedir(), 'devel/argonauta/ig-cli/index.mjs')}`;
        execSync(`${igCli} send ${username} "${reply.replace(/"/g, '\\"')}"`, {
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
  setInterval(check, config.pollInterval || 5000);
}
