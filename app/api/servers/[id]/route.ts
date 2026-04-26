import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getIdentity, parseFriendToken } from '@/lib/identity'

export const dynamic = 'force-dynamic'

type FriendToken = ReturnType<typeof parseFriendToken>

function isOwner(server: { ownerId: string | null; ownerGuestId: string | null }, identity: { kind: 'user'; userId: string } | { kind: 'guest'; guestId: string }) {
  if (identity.kind === 'user') return server.ownerId === identity.userId
  return server.ownerGuestId === identity.guestId
}

// Update friends list (owner only). Works for both signed-in owners and guest owners.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}))
    const identity = await getIdentity(req, body)
    if (!identity) return NextResponse.json({ error: 'Identity required' }, { status: 401 })

    const server = await prisma.server.findUnique({ where: { id: params.id } })
    if (!server) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!server.isPrivate || !isOwner(server, identity)) {
      return NextResponse.json({ error: 'not_owner' }, { status: 403 })
    }

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

    const friendUsers = usernames.length
      ? await prisma.user.findMany({
          where: { username: { in: usernames } },
          select: { id: true, username: true },
        })
      : []

    // Wipe existing and recreate — the list is a full replacement.
    await prisma.serverFriend.deleteMany({ where: { serverId: server.id } })
    const toCreate = [
      ...friendUsers.map((u: (typeof friendUsers)[number]) => ({
        serverId: server.id,
        userId: u.id,
        friendKey: `u:${u.id}`,
      })),
      ...guestIds.map((gid: string) => ({
        serverId: server.id,
        guestId: gid,
        guestName: 'Guest',
        friendKey: `g:${gid}`,
      })),
    ]
    if (toCreate.length) {
      await prisma.serverFriend.createMany({
        data: toCreate,
        skipDuplicates: true,
      })
    }

    const missingUsernames = usernames.filter((n: string) => !friendUsers.find((u: (typeof friendUsers)[number]) => u.username === n))
    return NextResponse.json({
      ok: true,
      friends: [...friendUsers.map((u: (typeof friendUsers)[number]) => u.username), ...guestIds],
      missing: [...missingUsernames, ...invalid],
    })
  } catch (e) {
    console.error('update server failed', e)
    return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    // For DELETE, the fetch doesn't typically send a JSON body in the browser.
    // We allow guestId to come via query string as a fallback.
    let body: any = null
    try { body = await req.json() } catch {}
    const identity = await getIdentity(req, body)
    if (!identity) return NextResponse.json({ error: 'Identity required' }, { status: 401 })

    const server = await prisma.server.findUnique({ where: { id: params.id } })
    if (!server) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!server.isPrivate || !isOwner(server, identity)) {
      return NextResponse.json({ error: 'not_owner' }, { status: 403 })
    }
    await prisma.server.delete({ where: { id: server.id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('delete server failed', e)
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }
}
