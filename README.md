# 🐙 ig-agent

All-in-one Instagram agent CLI — login, monitor notifications, auto-reply via AI.

## Install

```bash
node src/cli.mjs install
```

## Login

```bash
node src/cli.mjs login
```

Supports 2FA (authenticator app and SMS).

## Commands

| Command | Description |
|---------|-------------|
| `install` | Install dependencies and create config |
| `login` | Login and save Instagram session |
| `emulator` | Start/stop Android emulator |
| `send <user> <msg>` | Send a DM |
| `read <user> [n]` | Read DMs (default: 10) |
| `status` | Check system status |
| `monitor` | Start notification monitor (foreground) |
| `daemon` | Start monitor as background daemon |

## How it works

1. **Android emulator** runs Instagram in the background
2. **Monitor** polls `adb dumpsys notification` for new DMs
3. **Hermes agent** generates natural replies
4. **ig-cli** sends the reply via Instagram API

## Config

Config stored at `~/.ig-agent/config.json`:

```json
{
  "allowedSenders": ["user1", "user2"],
  "nameMap": { "DisplayName": "username" },
  "pollInterval": 5000,
  "emulatorAvd": "ig-phone",
  "emulatorMemory": 2048,
  "emulatorHeadless": true
}
```

## Requirements

- Node.js >= 20
- Android SDK (emulator + adb)
- Hermes agent (for AI replies)
- instagram-private-api (installed automatically)
