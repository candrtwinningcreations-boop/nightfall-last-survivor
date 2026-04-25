import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

// Build a slot string that is unique per identity + server. Saves are now
// scoped to a specific server so progress doesn't leak between worlds.
//
//   user_<userId>_server_<serverId>
//   guest_<guestId>_server_<serverId>
//   "default" — legacy single-slot fallback (when no serverId is known)
function slotFor(identity: Awaited<ReturnType<typeof getIdentity>>, serverId: string | null): string {
  if (!serverId) return 'default'
  if (!identity) return `default_server_${serverId}`
  if (identity.kind === 'user') return `user_${identity.userId}_server_${serverId}`
  return `guest_${identity.guestId}_server_${serverId}`
}

async function parseBody(req: Request): Promise<any> {
  try {
    const ct = req.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await req.json()
    // sendBeacon uses text/plain
    const t = await req.text()
    if (!t) return {}
    return JSON.parse(t)
  } catch {
    return {}
  }
}

function getServerIdFrom(req: Request, body?: any): string | null {
  const fromBody = body?.serverId
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim()
  try {
    const url = new URL(req.url)
    const s = url.searchParams.get('serverId')
    if (s && s.trim()) return s.trim()
  } catch {}
  return null
}

export async function GET(req: Request) {
  try {
    const identity = await getIdentity(req)
    const serverId = getServerIdFrom(req)
    const slot = slotFor(identity, serverId)
    const save = await prisma.playerSave.findUnique({ where: { slot } })
    if (!save) return NextResponse.json(null)
    return NextResponse.json({
      health: save.health,
      level: save.level,
      xp: save.xp,
      posX: save.posX,
      posY: save.posY,
      posZ: save.posZ,
      timeOfDay: save.timeOfDay,
      equippedItem: save.equippedItem,
      inventoryJson: save.inventoryJson,
      structuresJson: save.structuresJson,
      deaths: save.deaths,
      zombiesKilled: save.zombiesKilled,
    })
  } catch (e) {
    return NextResponse.json({ error: 'load_failed' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await parseBody(req)
    const identity = await getIdentity(req, body)
    const serverId = getServerIdFrom(req, body)
    const slot = slotFor(identity, serverId)
    const userId = identity?.kind === 'user' ? identity.userId : null
    const data = {
      health: Math.max(0, Math.min(100, Math.floor(body?.health ?? 100))),
      level: Math.max(1, Math.floor(body?.level ?? 1)),
      xp: Math.max(0, Math.floor(body?.xp ?? 0)),
      posX: Number(body?.posX ?? 0),
      posY: Number(body?.posY ?? 2),
      posZ: Number(body?.posZ ?? 0),
      timeOfDay: Number(body?.timeOfDay ?? 0.25),
      equippedItem: typeof body?.equippedItem === 'string' ? body.equippedItem : null,
      inventoryJson: JSON.stringify(body?.inventory ?? []),
      structuresJson: JSON.stringify(body?.structures ?? []),
      deaths: Math.max(0, Math.floor(body?.deaths ?? 0)),
      zombiesKilled: Math.max(0, Math.floor(body?.zombiesKilled ?? 0)),
      serverId,
    }
    const save = await prisma.playerSave.upsert({
      where: { slot },
      create: { slot, userId, ...data },
      update: { ...data, userId },
    })
    return NextResponse.json({ ok: true, id: save.id })
  } catch (e) {
    console.error('save failed', e)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const identity = await getIdentity(req)
    const serverId = getServerIdFrom(req)
    const slot = slotFor(identity, serverId)
    await prisma.playerSave.deleteMany({ where: { slot } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }
}
