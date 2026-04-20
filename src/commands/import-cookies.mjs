/**
 * @module commands/import-cookies
 * Import session from browser cookies when API login is blocked.
 */
import instaPkg from 'nodejs-insta-private-api';
const { IgApiClient, useMultiFileAuthState } = instaPkg;
import { mkdir } from 'node:fs/promises';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { AUTH_DIR, BASE } from '../constants.mjs';
import { log } from '../utils.mjs';

export async function cmdImportCookies() {
  await mkdir(BASE, { recursive: true });
  await mkdir(AUTH_DIR, { recursive: true });
  const rl = readline.createInterface({ input, output });

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🍪 Import Instagram session from browser cookies                   ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  STEP 1: Open instagram.com in your browser and log in               ║
║                                                                      ║
║  STEP 2: Open DevTools                                               ║
║     Chrome / Edge / Brave:                                           ║
║       → Press F12  (or Ctrl+Shift+I / Cmd+Option+I on Mac)          ║
║       → Or right-click the page → "Inspect"                         ║
║     Firefox:                                                         ║
║       → Press F12  (or Ctrl+Shift+I / Cmd+Option+I on Mac)          ║
║     Safari (Mac):                                                    ║
║       → First enable: Safari → Settings → Advanced                  ║
║         → tick "Show Develop menu in menu bar"                       ║
║       → Then press Cmd+Option+I                                      ║
║                                                                      ║
║  STEP 3: Find the cookies                                            ║
║     Chrome/Edge/Brave:                                               ║
║       → Click the "Application" tab at the top of DevTools           ║
║       → Left sidebar: expand "Cookies" → click "https://www.instagr ║
║     Firefox:                                                         ║
║       → Click the "Storage" tab                                      ║
║       → Left sidebar: expand "Cookies" → click "https://www.instagr ║
║     Safari:                                                          ║
║       → Click the "Storage" tab                                      ║
║       → Left sidebar: expand "Cookies" → click "www.instagram.com"  ║
║                                                                      ║
║  STEP 4: Copy these 3 cookie values (double-click the Value cell):   ║
║     • sessionid   — long string, looks like "12345678901%3AABC..."   ║
║     • ds_user_id  — your numeric user ID, e.g. "7012345678"         ║
║     • csrftoken   — random-looking alphanumeric string               ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const sessionId = await rl.question('sessionid: ');
  const dsUserId = await rl.question('ds_user_id: ');
  const csrfToken = await rl.question('csrftoken: ');

  if (!sessionId || !dsUserId || !csrfToken) {
    log('✗ All three cookies are required');
    rl.close();
    return;
  }

  log('Building session from cookies...');

  const ig = new IgApiClient();
  const authState = await useMultiFileAuthState(AUTH_DIR);

  // Construct the IGT:2 authorization token from sessionid
  // The authorization is a base64-encoded JSON with session details
  const authPayload = {
    ds_user_id: dsUserId,
    sessionid: sessionId,
    should_use_header_over_cookies: true,
  };
  const authBase64 = Buffer.from(JSON.stringify(authPayload)).toString('base64');
  ig.state.authorization = `Bearer IGT:2:${authBase64}`;

  // Set cookies on the cookie jar
  const instagramHost = 'https://www.instagram.com';
  const cookies = [
    { key: 'sessionid', value: sessionId },
    { key: 'ds_user_id', value: dsUserId },
    { key: 'csrftoken', value: csrfToken },
    { key: 'ig_did', value: ig.state.deviceId },
    { key: 'rur', value: '"NA"' },
  ];

  for (const cookie of cookies) {
    try {
      await ig.state.cookieJar.setCookie(
        `${cookie.key}=${cookie.value}; Domain=.instagram.com; Path=/; Secure; HttpOnly`,
        instagramHost
      );
    } catch {}
  }

  // Verify the session works
  log('Verifying session...');
  try {
    const currentUser = await ig.account.currentUser();
    log(`✓ Session valid — logged in as @${currentUser.username} (ID: ${currentUser.pk})`);
  } catch (e) {
    log(`✗ Session verification failed: ${e.message}`);
    log('  The cookies may be expired or incomplete. Try again with fresh cookies.');
    rl.close();
    return;
  }

  // Save auth state
  await authState.saveCreds(ig);
  log(`✓ Auth state saved to ${AUTH_DIR}`);
  log('  You can now run: ig-agent monitor');

  rl.close();
}
