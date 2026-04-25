import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

// Called via navigator.sendBeacon on unload, or via explicit Leave Server button.
// Idempotent: deletes this identity's membership for the given server if present.
// navigator.sendBeacon sends as Content-Type: text/plain, so we parse body as text.
async function parseBody(req: Request): Promise<any> {
  const ct = req.headers.get('content-type') || ''
  try {
    if (ct.includes('application/json')) return await req.json()
    const text = await req.text()
    if (!text) return {}
    try { return JSON.parse(text) } catch { return {} }
  } catch {
    return {}
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await parseBody(req)
    const identity = await getIdentity(req, body)
    if (identity) {
      await prisma.serverMember.deleteMany({
        where: { serverId: params.id, memberKey: identity.key },
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'leave_failed' }, { status: 500 })
  }
}
