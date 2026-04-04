#!/usr/bin/env node
// ig-agent — All-in-one Instagram agent CLI
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BASE } from './constants.mjs';

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  switch (command) {
    case 'install': {
      const { cmdInstall } = await import('./commands/install.mjs');
      await cmdInstall();
      break;
    }
    case 'login': {
      const { cmdLogin } = await import('./commands/login.mjs');
      await cmdLogin();
      break;
    }
    case 'emulator': {
      const { cmdEmulator } = await import('./commands/emulator.mjs');
      await cmdEmulator(args[0] || 'start');
      break;
    }
    case 'send': {
      if (!args[0] || !args[1]) { console.log('Usage: ig-agent send <username> <message>'); process.exit(1); }
      const { cmdSend } = await import('./commands/send.mjs');
      await cmdSend(args[0], args.slice(1).join(' '));
      break;
    }
    case 'read': {
      if (!args[0]) { console.log('Usage: ig-agent read <username> [count]'); process.exit(1); }
      const { cmdRead } = await import('./commands/read.mjs');
      await cmdRead(args[0], parseInt(args[1]) || 10);
      break;
    }
    case 'status': {
      const { cmdStatus } = await import('./commands/status.mjs');
      await cmdStatus();
      break;
    }
    case 'monitor': {
      const { cmdMonitor } = await import('./commands/monitor.mjs');
      await cmdMonitor();
      break;
    }
    case 'daemon': {
      const { cmdDaemon } = await import('./commands/daemon.mjs');
      await cmdDaemon();
      break;
    }
    default:
      console.log(`
🐙 ig-agent — All-in-one Instagram agent CLI

Usage:
  ig-agent install              Install dependencies
  ig-agent login                Login and save session
  ig-agent emulator [start|stop] Start/stop Android emulator
  ig-agent send <user> <msg>    Send a DM
  ig-agent read <user> [n]      Read DMs (default: 10)
  ig-agent status               Check system status
  ig-agent monitor              Start notification monitor (foreground)
  ig-agent daemon               Start monitor as background daemon

Config: ${join(BASE, 'config.json')}
Session: ${join(BASE, 'session.json')}
Logs: ${join(BASE, 'ig-agent.log')}
      `);
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
