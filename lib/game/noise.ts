// Simple deterministic value noise (good enough for a demo)
// Based on hash of integer coordinates + bilinear interpolation + octaves.

function hash2(ix: number, iz: number) {
  let h = (ix * 374761393 + iz * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967295 // 0..1
}

function smooth(t: number) {
  return t * t * (3 - 2 * t)
}

function valueNoise2D(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z)
  const fx = x - ix, fz = z - iz
  const v00 = hash2(ix, iz)
  const v10 = hash2(ix + 1, iz)
  const v01 = hash2(ix, iz + 1)
  const v11 = hash2(ix + 1, iz + 1)
  const sx = smooth(fx), sz = smooth(fz)
  const a = v00 * (1 - sx) + v10 * sx
  const b = v01 * (1 - sx) + v11 * sx
  return a * (1 - sz) + b * sz
}

export function heightAt(x: number, z: number) {
  // Octaves of noise for gentle hills
  const s = 0.03
  let h = 0
  let amp = 1
  let freq = 1
  let total = 0
  for (let i = 0; i < 4; i++) {
    h += valueNoise2D(x * s * freq, z * s * freq) * amp
    total += amp
    amp *= 0.5
    freq *= 2
  }
  const n = h / total // 0..1
  return (n - 0.5) * 12 // height in world units, roughly -6..6
}

export function hash2Pub(ix: number, iz: number) {
  return hash2(ix, iz)
}
