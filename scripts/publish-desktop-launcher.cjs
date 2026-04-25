const fs = require('fs')
const path = require('path')

const projectRoot = path.join(__dirname, '..')
const releaseDir = path.join(projectRoot, 'release')
const publicDownloadsDir = path.join(projectRoot, 'public', 'downloads')
const publicName = 'Nightfall-Last-Survivor-Windows.exe'

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!fs.existsSync(releaseDir)) {
  fail('No release directory found. Run npm run dist:win first.')
}

const candidates = fs
  .readdirSync(releaseDir)
  .filter((name) => /^Nightfall-Last-Survivor-Windows.*\.exe$/i.test(name))
  .map((name) => {
    const filePath = path.join(releaseDir, name)
    const stat = fs.statSync(filePath)
    return { name, filePath, mtimeMs: stat.mtimeMs, size: stat.size }
  })
  .sort((a, b) => b.mtimeMs - a.mtimeMs)

if (candidates.length === 0) {
  fail('No Windows launcher executable was found in release/.')
}

const latest = candidates[0]
fs.mkdirSync(publicDownloadsDir, { recursive: true })
const destination = path.join(publicDownloadsDir, publicName)
fs.copyFileSync(latest.filePath, destination)

const manifest = {
  name: publicName,
  sourceArtifact: latest.name,
  size: latest.size,
  updatedAt: new Date().toISOString(),
  downloadPath: `/downloads/${publicName}`,
}
fs.writeFileSync(path.join(publicDownloadsDir, 'launcher-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Published ${latest.name} to public/downloads/${publicName}`)
console.log(`Size: ${(latest.size / (1024 * 1024)).toFixed(1)} MB`)
