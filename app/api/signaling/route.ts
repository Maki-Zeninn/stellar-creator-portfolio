/**
 * GET  /api/signaling  — Returns ICE server configuration (STUN/TURN credentials)
 * POST /api/signaling  — HTTP fallback for SDP offer/answer relay
 *
 * This route is used by:
 *  1. Mobile clients (mobile/src/services/streaming.service.ts) that call
 *     `/api/signaling` for SDP signaling before switching to the standalone
 *     WebSocket signaling server.
 *  2. Web clients that need ICE server credentials without connecting to the
 *     signaling WebSocket first (e.g., to pre-warm the TURN connection).
 *
 * For production, clients should connect directly to the signaling WebSocket
 * server (server/signaling.ts) for the lowest latency.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { getServerSession } from '@/lib/auth/auth';

const MAX_PEERS_PER_ROOM = parseInt(process.env.MAX_PEERS_PER_ROOM ?? '2', 10);

// Tracks which authenticated user owns a given peerId, and which
// authenticated users are members of a given room. Both are populated
// on first use (first-come, first-served up to MAX_PEERS_PER_ROOM) since
// there is no separate call/stream-invite record in this codebase to check
// membership against — this is a real, self-contained substitute: it stops
// an unauthenticated caller from reading/writing at all, stops one
// authenticated user from impersonating another peerId, and caps how many
// distinct users can ever inject into a guessed/observed roomId.
const peerOwners = new Map<string, { userId: string; lastSeen: number }>(); // peerId -> owner
const roomMembers = new Map<string, Map<string, number>>(); // roomId -> userId -> lastSeen

/** Registers (or verifies) that `userId` owns `peerId`. Returns false on conflict. */
function claimPeerId(peerId: string, userId: string): boolean {
  const owner = peerOwners.get(peerId);
  if (owner === undefined) {
    peerOwners.set(peerId, { userId, lastSeen: Date.now() });
    return true;
  }
  if (owner.userId !== userId) return false;
  owner.lastSeen = Date.now();
  return true;
}

/** Registers (or verifies) `userId` as a member of `roomId`. Returns false if the room is full. */
function claimRoomMembership(roomId: string, userId: string): boolean {
  let members = roomMembers.get(roomId);
  if (!members) {
    members = new Map();
    roomMembers.set(roomId, members);
  }
  if (!members.has(userId) && members.size >= MAX_PEERS_PER_ROOM) return false;
  members.set(userId, Date.now());
  return true;
}

const TURN_SECRET = process.env.TURN_SECRET ?? 'insecure-dev-secret';
const TURN_HOST = process.env.TURN_HOST ?? 'turn.example.com';
const TURN_PORT = parseInt(process.env.TURN_PORT ?? '3478', 10);
const TURN_TLS_PORT = parseInt(process.env.TURN_TLS_PORT ?? '5349', 10);
const STUN_URL = process.env.STUN_URL ?? 'stun:stun.l.google.com:19302';
const TURN_CREDENTIAL_TTL = parseInt(process.env.TURN_CREDENTIAL_TTL ?? '86400', 10);

// In-memory relay store for HTTP signaling fallback
// In production this should be replaced with Redis for multi-instance support
interface SignalingEntry {
  type: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  peerId: string;
  ts: number;
  amount?: string;
  asset?: string;
}

const signalingStore = new Map<string, SignalingEntry[]>();

// Prune entries older than 5 minutes
const STORE_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - STORE_TTL_MS;
  for (const [key, entries] of signalingStore) {
    const fresh = entries.filter((e) => e.ts > cutoff);
    if (fresh.length === 0) signalingStore.delete(key);
    else signalingStore.set(key, fresh);
  }
  for (const [peerId, owner] of peerOwners) {
    if (owner.lastSeen <= cutoff) peerOwners.delete(peerId);
  }
  for (const [roomId, members] of roomMembers) {
    for (const [userId, lastSeen] of members) {
      if (lastSeen <= cutoff) members.delete(userId);
    }
    if (members.size === 0) roomMembers.delete(roomId);
  }
}, 60_000).unref?.();

interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}

function generateIceServers(peerId: string) {
  const expiry = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL;
  const username = `${expiry}:${peerId}`;
  const credential = createHmac('sha1', TURN_SECRET)
    .update(username)
    .digest('base64');

  return [
    { urls: STUN_URL },
    { urls: `turn:${TURN_HOST}:${TURN_PORT}`, username, credential },
    { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`, username, credential },
    { urls: `turns:${TURN_HOST}:${TURN_TLS_PORT}`, username, credential },
  ];
}

/**
 * GET /api/signaling?peerId=<id>
 * Returns ICE server configuration including STUN and time-limited TURN credentials.
 *
 * GET /api/signaling?roomId=<id>&peerId=<id>&since=<ts>
 * Polls for inbound signaling messages (HTTP fallback for mobile clients).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const roomId = req.nextUrl.searchParams.get('roomId');
  const sinceParam = req.nextUrl.searchParams.get('since');
  const peerIdParam = req.nextUrl.searchParams.get('peerId');

  if (roomId && peerIdParam) {
    if (!claimPeerId(peerIdParam, userId)) {
      return NextResponse.json(
        { error: 'peerId is already registered to another user' },
        { status: 403 },
      );
    }
    if (!claimRoomMembership(roomId, userId)) {
      return NextResponse.json(
        { error: 'Room is full' },
        { status: 403 },
      );
    }

    const since = sinceParam ? Number(sinceParam) : 0;
    const key = `${roomId}:${peerIdParam}`;
    const entries = signalingStore.get(key) ?? [];
    const messages = entries.filter((entry) => entry.ts > since && entry.peerId !== peerIdParam);

    return NextResponse.json({ messages });
  }

  const peerId = peerIdParam ?? `${userId}-${Date.now().toString(36)}`;
  if (!claimPeerId(peerId, userId)) {
    return NextResponse.json(
      { error: 'peerId is already registered to another user' },
      { status: 403 },
    );
  }

  return NextResponse.json({
    iceServers: generateIceServers(peerId),
    signalingWsUrl: process.env.NEXT_PUBLIC_SIGNALING_URL ?? 'ws://localhost:3001',
    peerId,
  });
}

/**
 * POST /api/signaling
 *
 * HTTP fallback relay for SDP and ICE candidates.
 * Clients poll GET /api/signaling?roomId=<id>&peerId=<id>&since=<ts> to fetch messages.
 *
 * Body:
 *   roomId   string   The signaling room
 *   peerId   string   Sender peer ID
 *   type     string   "offer" | "answer" | "ice"
 *   sdp      string?  SDP string (for offer/answer)
 *   candidate object? ICE candidate (for ice)
 *   to       string?  Target peer ID (optional, broadcasts if omitted)
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const body = await req.json();
    const { roomId, peerId, type, sdp, candidate, to, amount, asset } = body;

    if (!roomId || !peerId || !type) {
      return NextResponse.json(
        { error: 'Missing required fields: roomId, peerId, type' },
        { status: 400 },
      );
    }

    if (!claimPeerId(peerId, userId)) {
      return NextResponse.json(
        { error: 'peerId is already registered to another user' },
        { status: 403 },
      );
    }
    if (!claimRoomMembership(roomId, userId)) {
      return NextResponse.json(
        { error: 'Room is full' },
        { status: 403 },
      );
    }

    const key = to ? `${roomId}:${to}` : roomId;
    const existing = signalingStore.get(key) ?? [];
    existing.push({ type, sdp, candidate, peerId, ts: Date.now(), amount, asset });
    signalingStore.set(key, existing);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
