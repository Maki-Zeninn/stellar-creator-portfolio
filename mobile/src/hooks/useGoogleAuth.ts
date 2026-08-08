/**
 * useGoogleAuth — Google sign-in via expo-auth-session (#onboarding-gap)
 *
 * Exchanges a Google ID token for the matching Tamgora user record by
 * calling the Next.js web app's /api/auth/mobile/google endpoint — the
 * same account-creation path (lib/auth/oauth-user.ts) the web app's Google
 * sign-in uses, so a creator who signs up on web and later opens the
 * mobile app lands on the same account.
 *
 * NOTE: this hits the Next.js app (Prisma/NextAuth's User table), which is
 * a *different* backend than the rest of this file's siblings talk to —
 * ApiClient.ts's bounty/creator/review endpoints go to the separate Rust
 * `stellar-api` service. Intentional for now (identity lives in Next.js),
 * but worth knowing if you're wiring up anything else here.
 *
 * TODO: untested end-to-end — no device/simulator available to exercise the
 * native Google consent screen against, and this needs real per-platform
 * GOOGLE_*_CLIENT_ID values from Google Cloud Console before it can work at
 * all. The returned user record also isn't yet a session token the rest of
 * the app can use for authenticated calls — see the TODO in the endpoint.
 */

import { useCallback, useEffect, useState } from 'react';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

const WEB_API_BASE = process.env.EXPO_PUBLIC_WEB_API_URL ?? 'http://localhost:3000';

export interface GoogleAuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  walletAddress: string | null;
  onboardingCompleted: boolean;
}

export type GoogleAuthStatus = 'idle' | 'requesting' | 'verifying' | 'success' | 'error';

export function useGoogleAuth() {
  const [status, setStatus] = useState<GoogleAuthStatus>('idle');
  const [user, setUser] = useState<GoogleAuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

  const verifyWithBackend = useCallback(async (idToken: string) => {
    setStatus('verifying');
    try {
      const res = await fetch(`${WEB_API_BASE}/api/auth/mobile/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? 'Google sign-in failed');
        setStatus('error');
        return;
      }
      setUser(body as GoogleAuthUser);
      setStatus('success');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (response?.type === 'success' && response.authentication?.idToken) {
      verifyWithBackend(response.authentication.idToken);
    } else if (response?.type === 'error') {
      setError(response.error?.message ?? 'Google sign-in was cancelled or failed');
      setStatus('error');
    }
  }, [response, verifyWithBackend]);

  const signIn = useCallback(() => {
    setError(null);
    setStatus('requesting');
    promptAsync();
  }, [promptAsync]);

  return {
    signIn,
    status,
    user,
    error,
    isReady: !!request,
  };
}
