import { NextResponse } from 'next/server'
import { NIGHTFALL_BUILD_VERSION } from '@/lib/generated/build-version'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    app: 'Nightfall: Last Survivor',
    version: NIGHTFALL_BUILD_VERSION,
  })
}
