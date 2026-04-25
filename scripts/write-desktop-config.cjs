const fs = require('fs')
const path = require('path')

const url = process.env.NIGHTFALL_GAME_URL || process.env.NEXT_PUBLIC_GAME_URL || null
if (url && !/^https?:\/\//i.test(url)) {
  console.error('NIGHTFALL_GAME_URL must start with http:// or https://')
  process.exit(1)
}

const file = path.join(__dirname, '..', 'desktop', 'game-url.json')
fs.writeFileSync(file, `${JSON.stringify({ url }, null, 2)}\n`)
console.log(url ? `Desktop app will load ${url}` : 'Desktop app built without a bundled game URL.')
