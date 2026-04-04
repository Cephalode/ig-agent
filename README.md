# 🐙 ig-agent

**All-in-one Instagram DM agent** — monitors incoming messages via Android emulator push notifications, generates AI-powered replies with Hermes, and sends them back through the Instagram API.

Runs autonomously as a background daemon. Only responds to a configured allowlist of senders.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Commands](#commands)
- [Configuration](#configuration)
- [File Layout](#file-layout)
- [Quick Start](#quick-start)
- [Acknowledgments](#acknowledgments)
- [Contributing](#contributing)
- [License](#license)

---

## How It Works

1. An **Android emulator** runs Instagram in the background, receiving push notifications for new DMs
2. The **monitor** polls `adb shell dumpsys notification` every few seconds, parsing notification text for new messages
3. When a DM from an allowed sender is detected, **Hermes** (an AI agent) generates a natural, casual reply
4. The reply is sent back via **instagram-private-api**, the same library powering instagram-cli

The whole loop runs unattended — start the daemon and it handles everything.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        ig-agent                              │
│                                                              │
│  ┌──────────────┐    adb     ┌──────────────┐               │
│  │   Android     │◄─────────►│   Monitor    │               │
│  │   Emulator    │  dumpsys  │  (poll loop) │               │
│  │  (Instagram)  │           └──────┬───────┘               │
│  └──────────────┘                  │                        │
│                           new DM detected                    │
│                           from allowed sender                │
│                                    │                         │
│                            ┌───────▼───────┐                │
│                            │    Hermes     │                 │
│                            │  (AI reply)   │                 │
│                            └───────┬───────┘                │
│                                    │                         │
│                            generated reply                   │
│                                    │                         │
│                            ┌───────▼───────┐                │
│                            │  ig-private   │                 │
│                            │  -api (send)  │                 │
│                            └───────────────┘                 │
│                                    │                         │
│                              DM delivered ✅                  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Instagram Server
    │
    ▼ (push notification)
Android Emulator
    │
    ▼ (adb dumpsys notification)
Monitor (polls every N ms)
    │
    ├─► Skip if not from allowed sender
    │
    ├─► Skip if already seen (dedup via seen.json)
    │
    └─► Hermes generates reply
            │
            ▼ (instagram-private-api)
        DM sent back to user
```

## Prerequisites

| Dependency | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | >= 20 | Runtime |
| **Android SDK** | any recent | Emulator + `adb` for notification monitoring |
| **Hermes** | any | AI agent for generating replies (`hermes chat -q ...`) |
| **instagram-cli** | local | Provides `instagram-private-api` dependency |
| **AVD** | `ig-phone` | Android Virtual Device with Instagram installed |

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/cephalode/ig-agent.git
cd ig-agent
```

### 2. Set up instagram-cli dependency

ig-agent uses `instagram-private-api` from a local instagram-cli installation:

```bash
git clone https://github.com/supreme-gg-gg/instagram-cli.git ~/devel/argonauta/ig-cli
cd ~/devel/argonauta/ig-cli && npm install
```

### 3. Install ig-agent

```bash
cd ~/devel/ig-agent
node src/cli.mjs install
```

This creates `~/.ig-agent/` with default config, session placeholder, and logs directory.

### 4. Log in

```bash
node src/cli.mjs login
```

Enter your Instagram credentials. Supports 2FA (authenticator app and SMS). Session is saved to `~/.ig-agent/session.json`.

### 5. Set up the Android emulator

Create an AVD named `ig-phone` (or configure a custom name in config):

```bash
avdmanager create avd -n ig-phone -k "system-images;android-34;google_apis;arm64-v8a"
```

Install Instagram on the emulator and log in. The app needs to be running to generate push notifications.

## Commands

All commands are run via `node src/cli.mjs <command>`.

| Command | Description |
|---------|-------------|
| `install` | Install dependencies, create directories and default config |
| `login` | Authenticate with Instagram and save session (supports 2FA) |
| `emulator [start\|stop]` | Start or stop the Android emulator |
| `send <user> <msg>` | Send a DM to a user |
| `read <user> [n]` | Read last `n` DMs with a user (default: 10) |
| `status` | Show system status (session, emulator, daemon, hermes, ig-cli) |
| `monitor` | Start the notification monitor in the foreground |
| `daemon` | Start the monitor as a background daemon |
| `stop` | Stop the background daemon |

### Examples

```bash
# Send a message
node src/cli.mjs send dana.seismo_ "Hey! How's it going?"

# Read last 20 messages with someone
node src/cli.mjs read fenpolt 20

# Check if everything is running
node src/cli.mjs status

# Start emulator headlessly
node src/cli.mjs emulator start

# Run as background daemon
node src/cli.mjs daemon

# Stop the daemon
node src/cli.mjs stop
```

## Configuration

Config is stored at `~/.ig-agent/config.json`. Edit it directly or let `install` create defaults.

```json
{
  "allowedSenders": ["user1", "user2"],
  "nameMap": { "DisplayName": "username" },
  "pollInterval": 5000,
  "replyEnabled": true,
  "emulatorAvd": "ig-phone",
  "emulatorMemory": 2048,
  "emulatorHeadless": true,
  "adb": "adb",
  "hermesPath": "hermes",
  "sendPath": null
}
```

### Options Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `allowedSenders` | `string[]` | (see defaults) | Instagram usernames the agent will respond to |
| `nameMap` | `object` | (see defaults) | Maps notification display names to Instagram usernames |
| `pollInterval` | `number` | `5000` | Milliseconds between notification checks |
| `replyEnabled` | `boolean` | `true` | Enable/disable auto-reply (monitor still logs) |
| `emulatorAvd` | `string` | `"ig-phone"` | Android Virtual Device name |
| `emulatorMemory` | `number` | `2048` | Emulator RAM in MB |
| `emulatorHeadless` | `boolean` | `true` | Run emulator without GUI (`-no-window -no-audio`) |
| `adb` | `string` | `"adb"` | Path to `adb` binary |
| `hermesPath` | `string` | `"hermes"` | Path to Hermes CLI |
| `sendPath` | `string\|null` | `null` | Custom path for send command (defaults to ig-cli) |

## File Layout

```
~/.ig-agent/
├── config.json      # Configuration
├── session.json     # Instagram auth session (created by `login`)
├── seen.json        # Dedup record of processed notifications
├── daemon.pid       # PID file for background daemon
├── ig-agent.log     # Timestamped log file
└── chats/           # Chat history storage
```

## Quick Start

```bash
# 1. Install
node src/cli.mjs install

# 2. Log in to Instagram
node src/cli.mjs login

# 3. Start the emulator
node src/cli.mjs emulator start

# 4. Check status
node src/cli.mjs status

# 5. Run as daemon (or `monitor` for foreground)
node src/cli.mjs daemon
```

## Acknowledgments

- **[instagram-private-api](https://www.npmjs.com/package/instagram-private-api)** — the Instagram API library used for login, sending, and reading DMs
- **[instagram-cli](https://github.com/supreme-gg-gg/instagram-cli)** by [supreme-gg-gg](https://github.com/supreme-gg-gg) — the IG CLI tool we wrap for sending messages
- **Hermes agent** — the AI agent framework used for generating natural, contextual replies
- **[OpenClaw](https://openclaw.com)** — the agent platform that orchestrates everything
- **Android Emulator** — Google's emulator for running Instagram and receiving push notifications
- **Alex Finn / ThePonderingOne** — inspiration for the Discord workflow and mission control concepts

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-thing`)
3. Make your changes
4. Test with `node src/cli.mjs status` and `node src/cli.mjs monitor`
5. Commit and push (`git commit -m "feat: description"`)
6. Open a pull request

Keep it simple. No build step — this is plain Node.js ESM.

## License

[MIT](LICENSE)
