/**
 * @module lib/ig-client
 * Shared IgApiClient factory with multi-file auth state persistence.
 */
import { IgApiClient } from 'nodejs-insta-private-api';
import { AUTH_DIR } from '../constants.mjs';
import { mkdir } from 'node:fs/promises';

/**
 * Create and authenticate an IgApiClient using saved auth state.
 * @returns {{ ig: IgApiClient, authState: object }}
 * @throws if no valid session found
 */
export async function getAuthenticatedClient() {
  const ig = new IgApiClient();
  const { useMultiFileAuthState } = await import('nodejs-insta-private-api');
  const authState = await useMultiFileAuthState(AUTH_DIR);

  if (!authState.hasSession()) {
    throw new Error('No saved session. Run `ig-agent login` first.');
  }

  await authState.loadCreds(ig);
  return { ig, authState };
}

/**
 * Save the current auth state after login/session changes.
 * @param {IgApiClient} ig
 * @param {object} authState
 */
export async function saveAuthState(ig, authState) {
  await authState.saveCreds(ig);
}

export { AUTH_DIR };
