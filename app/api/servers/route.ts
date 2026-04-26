import { NextResponse } from 'next/server'
import { isDatabaseConfigured, prisma } from '@/lib/db'
import { getIdentity, parseFriendToken } from '@/lib/identity'

export const dynamic = 'force-dynamic'

const HEARTBEAT_TTL_SEC = 15

type FriendToken = ReturnType<typeof parseFriendToken>

function offlineServerList() {
  return {
    public: [
      {
        id: 'offline',
        slotNumber: 0,
        name: 'Offline (Local Guest Mode)',
        isPrivate: false as const,
        maxPlayers: 1,
        playerCount: 1,
      },
    ],
    private: [],
  }
}

export async function GET(req: Request) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(offlineServerList())
    }

    const identity = await getIdentity(req)
    const cutoff = new Date(Date.now() - HEARTBEAT_TTL_SEC * 1000)

    let publicServers: any[] = []
    try {
      publicServers = await prisma.server.findMany({
        where: { isPrivate: false },
        orderBy: { slotNumber: 'asc' },
        include: {
          _count: { select: { members: { where: { lastSeen: { gte: cutoff } } } } },
        },
      })
    } catch (error) {
      console.warn('Nightfall servers GET: failed to read public servers, falling back offline', error)
      return NextResponse.json(offlineServerList())
    }

    let privateServers: any[] = []
    if (identity) {
      const ownedWhere = identity.kind === 'user'
        ? { isPrivate: true, ownerId: identity.userId }
        : { isPrivate: true, ownerGuestId: identity.guestId }

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

      try {
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
      } catch (error) {
        console.warn('Nightfall servers GET: failed to read private servers', error)
      }
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
    return NextResponse.json(offlineServerList())
  }
}

export async function POST(req: Request) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        { error: 'Database is unavailable. Private server hosting is disabled in offline mode.' },
        { status: 503 }
      )
    }

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

    let friendUsers: Array<{ id: string; username: string }> = []
    try {
      friendUsers = usernames.length
        ? await prisma.user.findMany({
            where: { username: { in: usernames } },
            select: { id: true, username: true },
          })
        : []
    } catch (error) {
      console.warn('Nightfall servers POST: failed to resolve friend usernames', error)
      friendUsers = []
    }

    try {
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
    } catch (error) {
      console.error('create server failed', error)
      return NextResponse.json(
        { error: 'Database is unavailable. Private server hosting is temporarily disabled.' },
        { status: 503 }
      )
    }
  } catch (e) {
    console.error('create server failed', e)
    return NextResponse.json({ error: 'create_failed' }, { status: 500 })
  }
}
