import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getIdentity, parseFriendToken } from '@/lib/identity'

export const dynamic = 'force-dynamic'

// Players whose heartbeat is older than this many seconds are treated as offline.
const HEARTBEAT_TTL_SEC = 15

type FriendToken = ReturnType<typeof parseFriendToken>

export async function GET(req: Request) {
  try {
    const identity = await getIdentity(req)
    const cutoff = new Date(Date.now() - HEARTBEAT_TTL_SEC * 1000)

    // Public servers (50 slots) always returned
    const publicServers = await prisma.server.findMany({
      where: { isPrivate: false },
      orderBy: { slotNumber: 'asc' },
      include: {
        _count: { select: { members: { where: { lastSeen: { gte: cutoff } } } } },
      },
    })

    // Private servers: ones the caller owns + ones they've been allowlisted to.
    // Supports both logged-in users and guests (who get a localStorage guestId).
    let privateServers: any[] = []
    if (identity) {
      const ownedWhere = identity.kind === 'user'
        ? { isPrivate: true, ownerId: identity.userId }
        : { isPrivate: true, ownerGuestId: identity.guestId }

      // Use the canonical friendKey for allow-list matching.  That makes newly
      // invited signed-in users and guests show up immediately in their Private
      // Server list, using the same key format as join authorization.
      const allowedWhere = identity.kind === 'user'
        ? {
            isPrivate: true,
            friends: { some: { friendKey: identity.key } },
            NOT: { ownerId: identity.userId },
          }
        : {
            isPrivate: true,
            friends: { some: { friendKey: identity.key } },
            NOT: { ownerGuestId: identity.guestId },
          }

      const owned = await prisma.server.findMany({
        where: ownedWhere,
        include: {
          _count: { select: { members: { where: { lastSeen: { gte: cutoff } } } } },
          owner: { select: { username: true } },
          friends: {
            include: { user: { select: { id: true, username: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      const allowedServers = await prisma.server.findMany({
        where: allowedWhere,
        include: {
          _count: { select: { members: { where: { lastSeen: { gte: cutoff } } } } },
          owner: { select: { username: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      privateServers = [
        ...owned.map((s: (typeof owned)[number]) => ({
          id: s.id,
          slotNumber: s.slotNumber,
          name: s.name,
          isPrivate: true,
          maxPlayers: s.maxPlayers,
          playerCount: s._count.members,
          isOwner: true,
          ownerUsername: s.owner ? null : (s.ownerGuestName ?? null),
          ownerGuest: !s.ownerId,
          friends: s.friends.map((f: (typeof s.friends)[number]) => ({
            kind: (f.userId ? 'user' : 'guest') as 'user' | 'guest',
            name: f.userId ? (f.user?.username ?? '?') : (f.guestName || 'Guest'),
            id: f.userId ?? f.guestId ?? '',
          })),
        })),
        ...allowedServers.map((s: (typeof allowedServers)[number]) => ({
          id: s.id,
          slotNumber: s.slotNumber,
          name: s.name,
          isPrivate: true,
          maxPlayers: s.maxPlayers,
          playerCount: s._count.members,
          isOwner: false,
          ownerUsername: s.owner?.username ?? s.ownerGuestName ?? null,
          ownerGuest: !s.ownerId,
          friends: [] as { kind: 'user' | 'guest'; name: string; id: string }[],
        })),
      ]
    }

    return NextResponse.json({
      public: publicServers.map((s: (typeof publicServers)[number]) => ({
        id: s.id,
        slotNumber: s.slotNumber,
        name: s.name,
        isPrivate: false,
        maxPlayers: s.maxPlayers,
        playerCount: s._count.members,
      })),
      private: privateServers,
    })
  } catch (e) {
    console.error('servers list failed', e)
    return NextResponse.json({ error: 'list_failed' }, { status: 500 })
  }
}

// Create a new private server. Works for both signed-in users and guests.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const identity = await getIdentity(req, body)
    if (!identity) {
      return NextResponse.json({ error: 'Identity required to create a private server' }, { status: 401 })
    }
    const name = String(body?.name ?? '').trim().slice(0, 40) || 'Private Server'
    const tokensRaw: unknown[] = Array.isArray(body?.friends) ? body.friends : []
    const tokens = tokensRaw.map((s: unknown) => parseFriendToken(String(s ?? '')))

    const usernames = tokens
      .filter((t: FriendToken): t is { kind: 'username'; username: string } => t.kind === 'username')
      .map((t: { kind: 'username'; username: string }) => t.username)
    const guestIds = tokens
      .filter((t: FriendToken): t is { kind: 'guestId'; guestId: string } => t.kind === 'guestId')
      .map((t: { kind: 'guestId'; guestId: string }) => t.guestId)
    const invalid = tokens
      .filter((t: FriendToken): t is { kind: 'invalid'; raw: string } => t.kind === 'invalid' && !!t.raw.trim())
      .map((t: { kind: 'invalid'; raw: string }) => t.raw)

    // Resolve usernames to user IDs
    const friendUsers = usernames.length
      ? await prisma.user.findMany({
          where: { username: { in: usernames } },
          select: { id: true, username: true },
        })
      : []

    const server = await prisma.server.create({
      data: {
        name,
        isPrivate: true,
        maxPlayers: 100,
        ownerId: identity.kind === 'user' ? identity.userId : null,
        ownerGuestId: identity.kind === 'guest' ? identity.guestId : null,
        ownerGuestName: identity.kind === 'guest' ? identity.guestName : null,
        friends: {
          create: [
            ...friendUsers.map((u: (typeof friendUsers)[number]) => ({
              userId: u.id,
              friendKey: `u:${u.id}`,
            })),
            ...guestIds.map((gid: string) => ({
              guestId: gid,
              guestName: 'Guest',
              friendKey: `g:${gid}`,
            })),
          ],
        },
      },
    })

    const missingUsernames = usernames.filter((n: string) => !friendUsers.find((u: (typeof friendUsers)[number]) => u.username === n))
    return NextResponse.json({
      ok: true,
      serverId: server.id,
      added: [
        ...friendUsers.map((u: (typeof friendUsers)[number]) => u.username),
        ...guestIds,
      ],
      missing: [...missingUsernames, ...invalid],
    })
  } catch (e) {
    console.error('create server failed', e)
    return NextResponse.json({ error: 'create_failed' }, { status: 500 })
  }
}
