import PlayClient from './play-client'

export const dynamic = 'force-dynamic'

// Play page does not require database at render time.
// Guest users can continue in offline mode when database-backed multiplayer is unavailable.
export default function PlayPage() {
  return <PlayClient />
}
