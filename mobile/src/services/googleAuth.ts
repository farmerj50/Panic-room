import { Platform } from 'react-native';

import { apiRequest } from './apiClient';

// Google Sign-In on Android via Credential Manager
// (react-native-credentials-manager, pinned). Everything that touches the
// native module lives here, so it can be swapped without touching screens.
// Google only proves identity — Bes still issues its own session (see
// AuthContext.signInWithGoogle and POST /api/auth/google).

// The Web OAuth client ID: Credential Manager's serverClientId, and the
// audience the backend checks on every ID token.
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

export class GoogleSignInCancelled extends Error {
  constructor() {
    super('Google sign-in was cancelled.');
    this.name = 'GoogleSignInCancelled';
  }
}

// Native-only (no web build support) and only when this build was given a
// client ID. The server must also report Google as configured — see
// fetchGoogleEnabled.
export function isGoogleSignInSupported(): boolean {
  return Platform.OS === 'android' && Boolean(WEB_CLIENT_ID);
}

let serverEnabled: Promise<boolean> | null = null;
export function fetchGoogleEnabled(): Promise<boolean> {
  if (!isGoogleSignInSupported()) return Promise.resolve(false);
  if (!serverEnabled) {
    serverEnabled = apiRequest<{ enabled: boolean }>('/api/auth/google/config', { auth: false })
      .then((r) => Boolean(r.enabled))
      .catch(() => {
        serverEnabled = null; // retry next time
        return false;
      });
  }
  return serverEnabled;
}

function isCancellation(error: unknown) {
  const text = `${(error as { code?: string })?.code ?? ''} ${(error as Error)?.message ?? error}`;
  return /cancel/i.test(text);
}

// Shows Google's account picker and returns a fresh ID token. Pass a nonce
// when the server issued one (account deletion). Throws
// GoogleSignInCancelled if the user backs out.
export async function getGoogleIdToken({ nonce }: { nonce?: string } = {}): Promise<string> {
  if (!isGoogleSignInSupported()) throw new Error("Google sign-in isn't available on this device.");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { signUpWithGoogle } = require('react-native-credentials-manager');
  try {
    const credential = await signUpWithGoogle({
      serverClientId: WEB_CLIENT_ID,
      nonce,
      // Always show the picker: never silently reuse an account.
      autoSelectEnabled: false,
      filterByAuthorizedAccounts: false,
    });
    if (!credential?.idToken) throw new Error('Google did not return a sign-in token.');
    return credential.idToken;
  } catch (error) {
    if (isCancellation(error)) throw new GoogleSignInCancelled();
    throw error;
  }
}

// Clears Credential Manager's state so the next sign-in shows the picker.
export async function signOutGoogle(): Promise<void> {
  if (!isGoogleSignInSupported()) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { signOut } = require('react-native-credentials-manager');
    await signOut();
  } catch {
    // Best-effort.
  }
}
