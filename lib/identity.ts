import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export type Identity =
  | { kind: 'user'; userId: string; username: string; key: string }
  | { kind: 'guest'; guestId: string; guestName: string; key: string }

// Guest IDs are client-generated: "g_" followed by 8–30 url-safe chars.
const GUEST_ID_RE = /^g_[A-Za-z0-9_-]{4,30}$/

function sanitizeGuestName(raw: unknown): string {
  const s = String(raw ?? '').trim().slice(0, 20)
  return s || 'Guest'
}

// Identify the caller from either a logged-in session OR a guestId provided
// in the request body or URL query. Returns null if neither is present.
export async function getIdentity(req: Request, body?: any): Promise<Identity | null> {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as any)?.id ?? null
  if (userId) {
    return {
      kind: 'user',
      userId,
      username: session!.user!.name || 'Survivor',
      key: `u:${userId}`,
    }
  }
  let url: URL | null = null
  try { url = new URL(req.url) } catch {}
  const guestIdRaw = body?.guestId ?? url?.searchParams.get('guestId') ?? null
  const guestNameRaw = body?.guestName ?? url?.searchParams.get('guestName') ?? null
  if (typeof guestIdRaw === 'string' && GUEST_ID_RE.test(guestIdRaw)) {
    return {
      kind: 'guest',
      guestId: guestIdRaw,
      guestName: sanitizeGuestName(guestNameRaw),
      key: `g:${guestIdRaw}`,
    }
  }
  return null
}

// Parse a single "friend" token from the create/edit form. Callers can mix
// usernames and guest invite codes in the same textarea.
export type FriendToken =
  | { kind: 'username'; username: string }
  | { kind: 'guestId'; guestId: string }
  | { kind: 'invalid'; raw: string }

export function parseFriendToken(raw: string): FriendToken {
  const s = String(raw ?? '').trim()
  if (!s) return { kind: 'invalid', raw: s }
  // Guest invite code (starts with g_)
  if (GUEST_ID_RE.test(s)) return { kind: 'guestId', guestId: s }
  // Username — lowercase
  const lower = s.toLowerCase()
  if (/^[a-z0-9_]{3,20}$/.test(lower)) return { kind: 'username', username: lower }
  return { kind: 'invalid', raw: s }
}
