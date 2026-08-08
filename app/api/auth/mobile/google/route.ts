import { NextRequest, NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { upsertOAuthUser } from '@/lib/auth/oauth-user';

const client = new OAuth2Client();

/**
 * POST /api/auth/mobile/google
 *
 * Mobile equivalent of the web Google sign-in path: the app gets an ID
 * token from Google via expo-auth-session, sends it here, we verify it
 * server-side (never trust a client-supplied token without verification)
 * and find-or-create the matching User.
 *
 * TODO: this returns the user record but doesn't issue anything mobile can
 * use as a bearer token on later authenticated API calls — there's no
 * server-side session for mobile yet. Untested end-to-end: this repo has no
 * device/simulator to exercise the native Google OAuth screen against, and
 * needs real GOOGLE_CLIENT_ID values (separate iOS/Android OAuth clients
 * from Google Cloud Console, not just the web one) before it can work at all.
 */
export async function POST(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Google sign-in is not configured' }, { status: 501 });
  }

  const body = await req.json().catch(() => null);
  const idToken = typeof body?.idToken === 'string' ? body.idToken : '';
  if (!idToken) {
    return NextResponse.json({ error: 'idToken is required' }, { status: 422 });
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    payload = ticket.getPayload();
  } catch {
    return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 });
  }

  if (!payload?.email) {
    return NextResponse.json({ error: 'Google account has no email' }, { status: 422 });
  }

  const user = await upsertOAuthUser({
    email: payload.email,
    name: payload.name,
    image: payload.picture,
  });

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    walletAddress: user.walletAddress,
    onboardingCompleted: !!user.onboardingCompletedAt,
  });
}
