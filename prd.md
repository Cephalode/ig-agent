# PRD: ig-agent — All-in-One Instagram Agent CLI

## Overview
A production-ready CLI tool that monitors Instagram DMs via Android emulator notifications, generates AI replies via Hermes agent, and sends them automatically.

## User Stories

### US-001: Interactive Login
**As a user**, I want to login to Instagram via the CLI with username/password and 2FA support, so my session is saved for automated use.
- Acceptance: Login flow prompts for credentials, handles IgCheckpointError and IgLoginTwoFactorRequiredError, saves session to `~/.ig-agent/session.json`

### US-002: Emulator Management
**As a user**, I want to start/stop the Android emulator from the CLI, so Instagram runs in the background receiving notifications.
- Acceptance: `ig-agent emulator start` launches emulator, `ig-agent emulator stop` kills it, detects headless vs GUI mode

### US-003: Notification Monitoring
**As a user**, I want the CLI to poll Android notifications for new Instagram DMs and auto-reply, so I don't have to check manually.
- Acceptance: Polls `adb dumpsys notification` every 5s, parses sender/text/time, deduplicates via seen-set, only processes allowed senders

### US-004: AI Auto-Reply
**As a user**, I want incoming DMs to get natural AI-generated replies via Hermes, so conversations continue autonomously.
- Acceptance: Calls Hermes agent with context, gets reply text, sends via ig-cli, handles Dana with extra warmth per SOUL.md rules

### US-005: Send DMs
**As a user**, I want to send DMs directly from the CLI, so I can manually message people.
- Acceptance: `ig-agent send <username> <message>` sends via instagram-private-api

### US-006: Read DMs
**As a user**, I want to read recent DMs from a specific user, so I can check conversations.
- Acceptance: `ig-agent read <username> [count]` displays formatted message history

### US-007: Background Daemon
**As a user**, I want the monitor to run as a background daemon, so it survives terminal closure.
- Acceptance: `ig-agent daemon` spawns detached process, saves PID, `ig-agent status` shows daemon state

### US-008: System Status
**As a user**, I want to check if all components are healthy, so I know the system is working.
- Acceptance: `ig-agent status` checks session, emulator, daemon, hermes, ig-cli availability

### US-009: Configuration
**As a user**, I want to configure allowed senders, name mappings, and polling interval, so the agent behaves correctly.
- Acceptance: Reads/writes `~/.ig-agent/config.json`, sensible defaults

### US-010: Logging
**As a user**, I want all activity logged to a file, so I can review what happened.
- Acceptance: All events written to `~/.ig-agent/ig-agent.log` with timestamps

## Technical Constraints
- Node.js >= 20, ESM modules
- Modular command architecture in `src/commands/`
- Instagram Private API for direct messaging
- Android SDK emulator + adb for notification polling
- Hermes agent for AI reply generation
- One git commit per feature
