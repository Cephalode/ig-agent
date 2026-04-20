# ig-agent MQTT Rewrite Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the Android emulator + ADB polling architecture with direct Instagram MQTT real-time messaging using `nodejs-insta-private-api`.

**Architecture:** The bot will connect directly to Instagram's MQTT service via WebSocket (`wss://edge-chat.instagram.com`), receiving real-time DM events instead of polling Android notifications. Session persistence uses Baileys-style multi-file auth state. No emulator, no ADB, no external `ig-cli` dependency.

**Tech Stack:** Node.js ESM, `nodejs-insta-private-api` (v5.61.12+), Instagram MQTT over WebSocket

**Branch:** `feat/websocket-mqtt` (already checked out)

---

## Task 1: Update package.json

**Objective:** Replace old `instagram-private-api` dependency with `nodejs-insta-private-api`.

**Files:**
- Modify: `package.json`

**Changes:**
```json
{
  "name": "ig-agent",
  "version": "2.0.0",
  "description": "Instagram DM agent — real-time MQTT auto-reply via AI",
  "type": "module",
  "bin": {
    "ig-agent": "./src/cli.mjs"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "nodejs-insta-private-api": "^5.61.12"
  }
}
```

---

## Task 2: Rewrite constants.mjs

**Objective:** Add auth directory for multi-file auth state, remove emulator config defaults.

**Files:**
- Modify: `src/constants.mjs`

**Changes:**
- Add `AUTH_DIR = join(BASE, 'auth_info_instagram')` export
- Remove `emulatorAvd`, `emulatorMemory`, `emulatorHeadless` from `DEFAULT_CONFIG`
- Remove `pollInterval` (no longer polling)
- Keep `allowedSenders`, `nameMap`, `replyEnabled`

---

## Task 3: Rewrite config.mjs

**Objective:** Remove ADB/emulator/ig-cli path helpers, keep config load/save.

**Files:**
- Modify: `src/config.mjs`

**Remove:** `findADB()`, `findIgCli()`, `findEmulator()`
**Keep:** `loadConfig()`, `saveConfig()`, `loadSeen()`, `saveSeen()`
**Add:** `findHermes()` stays as-is (still used for AI reply generation)

---

## Task 4: Create src/lib/ig-client.mjs

**Objective:** Shared factory module that creates an authenticated IgApiClient with multi-file auth state. Used by login, send, read, and monitor commands.

**Files:**
- Create: `src/lib/ig-client.mjs`

**Exports:**
- `getAuthenticatedClient()` — loads auth state from `AUTH_DIR`, creates IgApiClient, deserializes state, returns `{ ig, state }`
- `saveAuthState(state)` — saves auth state to multi-file store
- Uses `IgApiClient` from `nodejs-insta-private-api`
- Uses `useMultiFileAuthState` from `nodejs-insta-private-api` for Baileys-style persistence
- Device: `iPhone 14 Pro Max` preset

---

## Task 5: Rewrite login.mjs

**Objective:** Use new `nodejs-insta-private-api` with multi-file auth state for login.

**Files:**
- Modify: `src/commands/login.mjs`

**Changes:**
- Import `IgApiClient` from `nodejs-insta-private-api` (not via `createRequire`)
- Use `useMultiFileAuthState(AUTH_DIR)` for session persistence
- Keep interactive username/password prompts
- Keep 2FA/checkpoint handling (adapted to new API signatures)
- Save state via `saveAuthState()`

---

## Task 6: Rewrite send.mjs

**Objective:** Use shared ig-client module instead of createRequire hack.

**Files:**
- Modify: `src/commands/send.mjs`

**Changes:**
- Import `getAuthenticatedClient()` from `../lib/ig-client.mjs`
- Remove `createRequire` and hardcoded path to ig-cli node_modules
- Keep input validation and send logic, adapt to new API if signatures differ

---

## Task 7: Rewrite read.mjs

**Objective:** Use shared ig-client module instead of createRequire hack.

**Files:**
- Modify: `src/commands/read.mjs`

**Changes:**
- Import `getAuthenticatedClient()` from `../lib/ig-client.mjs`
- Remove `createRequire` and hardcoded path
- Keep inbox reading logic, adapt to new API if signatures differ

---

## Task 8: Rewrite monitor.mjs

**Objective:** **The core rewrite.** Replace ADB notification polling with MQTT RealtimeClient subscriptions for real-time DM events.

**Files:**
- Modify: `src/commands/monitor.mjs`

**Architecture:**
1. Create `IgApiClient` and authenticate via shared module
2. Create `RealtimeClient` connected to the same client
3. Subscribe to `message` events from the realtime client
4. On incoming DM: check sender against `allowedSenders` + `nameMap`
5. If allowed: generate reply via `hermes chat`, send via `ig.entity.directThread(...).broadcastText()`
6. No more polling interval — event-driven
7. Keep the `handleWithHermes` logic for AI reply generation
8. Graceful shutdown on SIGINT/SIGTERM

**Key API:**
```javascript
import { IgApiClient, RealtimeClient } from 'nodejs-insta-private-api';
const ig = new IgApiClient();
// ... auth ...
const realtime = new RealtimeClient(ig);
realtime.on('message', (msg) => { /* handle DM */ });
await realtime.connect();
```

---

## Task 9: Rewrite status.mjs

**Objective:** Remove emulator/adb status checks, add MQTT connection status.

**Files:**
- Modify: `src/commands/status.mjs`

**Changes:**
- Remove emulator/ADB checks
- Remove ig-cli check
- Add auth state check (AUTH_DIR exists and has files)
- Keep daemon, Hermes, config checks

---

## Task 10: Remove emulator.mjs, update cli.mjs and install.mjs

**Objective:** Clean up emulator command and simplify install.

**Files:**
- Delete: `src/commands/emulator.mjs`
- Modify: `src/cli.mjs` — remove `emulator` case from switch, update help text
- Modify: `src/commands/install.mjs` — remove ig-cli path checks, just run `npm install` locally

---

## Task 11: Verify and commit

**Objective:** Install dependencies, verify syntax, commit all changes.

**Steps:**
1. `cd ~/devel/ig-agent && npm install`
2. `node --check src/cli.mjs` for all files
3. `git add -A && git commit -m "feat: rewrite ig-agent with MQTT real-time messaging"`
