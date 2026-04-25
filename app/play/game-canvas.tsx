'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useGame } from '@/lib/game/store'
import { heightAt, hash2Pub } from '@/lib/game/noise'
import { FIST_DAMAGE, ITEMS, rollShirtRarity } from '@/lib/game/items'
import type { ItemId, StructureData, StructureKind } from '@/lib/game/types'
import { getGameAudio } from '@/lib/game/audio'

// --- Constants ---
const CHUNK_SIZE = 32 // world units
const CHUNK_SEG = 16
const VIEW_CHUNKS = 3 // radius in chunks
const DAY_LENGTH_SEC = 10 * 60
const NIGHT_LENGTH_SEC = 15 * 60
const PLAYER_HEIGHT = 1.75
const PLAYER_RADIUS = 0.4
const REACH = 4.5
const GRAVITY = 22
const WALK_SPEED = 5.5
const SPRINT_SPEED = 9
const JUMP_VELOCITY = 8.5
const ATTACK_COOLDOWN = 0.35
const ZOMBIE_SPEED = 3.2
const ZOMBIE_HEALTH = 50
const ZOMBIE_DAMAGE = 8
const ZOMBIE_ATTACK_RANGE = 1.8
const MAX_ZOMBIES = 12
// Vampires: boss-class enemies that appear at night
const VAMPIRE_SPEED = 4.2
const VAMPIRE_HEALTH = 180
const VAMPIRE_DAMAGE = 18
const VAMPIRE_ATTACK_RANGE = 2.2
const MAX_VAMPIRES = 2
// Goblins: pint-sized night thieves. They sprint in, snatch
// one random stack from the player's inventory, then bolt for the tree-line.
// Slay them before they escape to recover your loot.
const GOBLIN_SPEED = 5.2
const GOBLIN_HEALTH = 28
const GOBLIN_ATTACK_RANGE = 1.1
const MAX_GOBLINS = 1
// Huge green orc: roaming boss with weak spots, knockdowns, club attacks,
// and a close-range grab/throw move.
const ORC_SPEED = 2.45
const ORC_HEALTH = 520
const ORC_CLUB_DAMAGE = 24
const ORC_ATTACK_RANGE = 2.9
const ORC_GRAB_RANGE = 1.75
const ORC_GRAB_DAMAGE = 30
const ORC_GRAB_COOLDOWN = 30
const MAX_ORCS = 1

type Biome = 'forest' | 'plains' | 'desert'

const DAY_START = 0.2
const NIGHT_START = 0.8
const DAY_SPAN = NIGHT_START - DAY_START
const NIGHT_SPAN = 1 - DAY_SPAN
const CYCLE_LENGTH_SEC = DAY_LENGTH_SEC + NIGHT_LENGTH_SEC

function isNightTimeValue(t: number) {
  return t < DAY_START || t > NIGHT_START
}

function timeOfDayToCycleSeconds(t: number) {
  const wrapped = ((t % 1) + 1) % 1
  if (wrapped >= DAY_START && wrapped <= NIGHT_START) {
    return ((wrapped - DAY_START) / DAY_SPAN) * DAY_LENGTH_SEC
  }
  const nightProgress = wrapped > NIGHT_START ? wrapped - NIGHT_START : wrapped + (1 - NIGHT_START)
  return DAY_LENGTH_SEC + (nightProgress / NIGHT_SPAN) * NIGHT_LENGTH_SEC
}

function cycleSecondsToTimeOfDay(seconds: number) {
  const age = ((seconds % CYCLE_LENGTH_SEC) + CYCLE_LENGTH_SEC) % CYCLE_LENGTH_SEC
  if (age < DAY_LENGTH_SEC) return DAY_START + (age / DAY_LENGTH_SEC) * DAY_SPAN
  return (NIGHT_START + ((age - DAY_LENGTH_SEC) / NIGHT_LENGTH_SEC) * NIGHT_SPAN) % 1
}

function phaseInfoForTimeOfDay(t: number) {
  const age = timeOfDayToCycleSeconds(t)
  if (age < DAY_LENGTH_SEC) return { phase: 'day' as const, secondsLeft: DAY_LENGTH_SEC - age }
  return { phase: 'night' as const, secondsLeft: CYCLE_LENGTH_SEC - age }
}

function biomeAt(x: number, z: number): Biome {
  // Low-frequency deterministic noise creates broad, contiguous biome regions.
  // The origin is intentionally biased toward forest/plains so new players do
  // not start resource-starved inside a desert.
  const v =
    Math.sin(x * 0.008 + z * 0.003) * 0.55 +
    Math.cos(x * 0.0035 - z * 0.007) * 0.35 +
    (hash2Pub(Math.floor(x / 96), Math.floor(z / 96)) - 0.5) * 0.35
  if (v > 0.46 && Math.hypot(x, z) > 45) return 'desert'
  if (v < -0.22) return 'plains'
  return 'forest'
}

type ChunkData = {
  cx: number
  cz: number
  group: THREE.Group
  trees: { mesh: THREE.Object3D; hp: number; px: number; pz: number; collider: boolean }[]
  stones: { mesh: THREE.Object3D; px: number; py: number; pz: number; hp: number; maxHp: number; oreKind: 'stone' | 'iron'; initialScale: number }[]
  cacti: { mesh: THREE.Object3D; hp: number; px: number; pz: number; collider: boolean }[]
  caves: { mesh: THREE.Object3D; x: number; y: number; z: number; radius: number; yaw: number }[]
  droppedItems: { netId: string; mesh: THREE.Object3D; id: ItemId; count: number; px: number; py: number; pz: number; vy: number; life: number }[]
  terrain: THREE.Mesh
}

type Zombie = {
  id: string
  mesh: THREE.Group
  pos: THREE.Vector3
  vel: THREE.Vector3
  hp: number
  attackTimer: number
  hurtTimer: number
  // Limb refs for walking/running animations
  armL: THREE.Object3D
  armR: THREE.Object3D
  legL: THREE.Object3D
  legR: THREE.Object3D
  body: THREE.Object3D
  head: THREE.Object3D
  walkPhase: number
}

type Vampire = {
  id: string
  mesh: THREE.Group
  pos: THREE.Vector3
  vel: THREE.Vector3
  hp: number
  attackTimer: number
  hurtTimer: number
  // "fleeing" state activated at dawn — vampire transforms into a bat and flies off
  fleeing: boolean
  fleeTimer: number
  bat?: THREE.Group
  cape?: THREE.Mesh
  armL: THREE.Object3D
  armR: THREE.Object3D
  legL: THREE.Object3D
  legR: THREE.Object3D
  walkPhase: number
}

type GoblinPhase = 'approach' | 'grabbing' | 'fleeing'
type GoblinBackpack = { items: { id: ItemId; count: number }[]; mesh: THREE.Object3D }

type Goblin = {
  id: string
  mesh: THREE.Group
  pos: THREE.Vector3
  vel: THREE.Vector3
  hp: number
  hurtTimer: number
  phase: GoblinPhase
  fleeDir: THREE.Vector2
  grabTimer: number
  stolen: { id: ItemId; count: number } | null
  // Backpack system: stolen stacks live here and are dropped back on death.
  backpack: GoblinBackpack
  // Legacy visible sack, retained as an extra loot-full tell.
  sack?: THREE.Object3D
  armL: THREE.Object3D
  armR: THREE.Object3D
  legL: THREE.Object3D
  legR: THREE.Object3D
  body: THREE.Object3D
  walkPhase: number
}

type OrcState = 'walking' | 'roaring' | 'down' | 'gettingUp' | 'dying'
type OrcWeakSpot = { mesh: THREE.Object3D; name: string; active: boolean }

type OrcBoss = {
  id: string
  mesh: THREE.Group
  pos: THREE.Vector3
  vel: THREE.Vector3
  hp: number
  state: OrcState
  stateTimer: number
  attackTimer: number
  grabCooldown: number
  hurtTimer: number
  walkPhase: number
  weakSpots: OrcWeakSpot[]
  body: THREE.Object3D
  head: THREE.Object3D
  jaw: THREE.Object3D
  armL: THREE.Object3D
  armR: THREE.Object3D
  legL: THREE.Object3D
  legR: THREE.Object3D
  club: THREE.Object3D
}

type StructureMesh = {
  id: string
  kind: StructureKind
  mesh: THREE.Object3D
}

export default function GameCanvas() {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const gameRef = useRef<any>(null)

  useEffect(() => {
    if (!mountRef.current) return
    const mount = mountRef.current

    // --- Renderer ---
    // Wrap WebGL creation in try/catch so sandboxed iframes, older GPUs or
    // browsers without hardware acceleration show a friendly fallback message
    // instead of surfacing an unhandled runtime exception to the user.
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Nightfall: Unable to initialise WebGL renderer.', err)
      mount.innerHTML = [
        '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#0b0b11;color:#f5d16a;padding:2rem;text-align:center;font-family:serif;">',
        '<div style="max-width:440px;">',
        '<h2 style="font-size:1.75rem;font-weight:700;margin-bottom:0.75rem;">\uD83C\uDF11 Nightfall needs WebGL</h2>',
        '<p style="color:#cbd5e1;margin-bottom:0.5rem;">Your browser couldn\u2019t initialise a 3D graphics context.</p>',
        '<p style="color:#94a3b8;font-size:0.9rem;">Try enabling hardware acceleration in your browser settings, updating your graphics drivers, or loading the game in Chrome / Firefox on a desktop.</p>',
        '</div></div>',
      ].join('')
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    mount.appendChild(renderer.domElement)

    // Gracefully handle context-lost events (driver crash, tab backgrounding on
    // mobile, etc.) — the browser otherwise throws an error into our render loop.
    renderer.domElement.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault()
      // eslint-disable-next-line no-console
      console.warn('Nightfall: WebGL context lost — pausing renderer.')
    })

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x8fa7bd, 0.0085)

    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 500)
    camera.position.set(0, 10, 0)

    // --- Lights ---
    const ambient = new THREE.AmbientLight(0x99aabb, 0.5)
    scene.add(ambient)
    const hemi = new THREE.HemisphereLight(0xbcd9ff, 0x3b2a1a, 0.7)
    scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.2)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 0.5
    sun.shadow.camera.far = 120
    const shadowSize = 50
    sun.shadow.camera.left = -shadowSize
    sun.shadow.camera.right = shadowSize
    sun.shadow.camera.top = shadowSize
    sun.shadow.camera.bottom = -shadowSize
    sun.shadow.bias = -0.0004
    scene.add(sun)
    scene.add(sun.target)
    const moonLight = new THREE.DirectionalLight(0xbccbff, 0.35)
    scene.add(moonLight)
    scene.add(moonLight.target)

    // Visible moon disc on the firmament + subtle halo for atmosphere.
    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(10, 28, 18),
      new THREE.MeshBasicMaterial({ color: 0xf2f3f7, transparent: true, fog: false })
    )
    moonMesh.renderOrder = -1
    scene.add(moonMesh)
    const moonGlow = new THREE.Mesh(
      new THREE.SphereGeometry(18, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xaabbff, transparent: true, opacity: 0.18, fog: false })
    )
    moonGlow.renderOrder = -1
    scene.add(moonGlow)
    const playerTorch = new THREE.PointLight(0xffdda0, 0.0, 14, 2)
    scene.add(playerTorch)

    // --- Skydome ---
    const skyGeo = new THREE.SphereGeometry(300, 32, 16)
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x5c8fbf) },
        bottomColor: { value: new THREE.Color(0xd9c2a1) },
        offset: { value: 0 },
        exponent: { value: 0.6 },
      },
      vertexShader: `varying vec3 vWorldPosition;
        void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorldPosition = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent;
        varying vec3 vWorldPosition;
        void main(){ float h = normalize(vWorldPosition + offset).y; gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h,0.0), exponent), 0.0)), 1.0); }`,
    })
    const sky = new THREE.Mesh(skyGeo, skyMat)
    scene.add(sky)

    // --- Flat Earth Firmament: stars on the inside of a crystal dome ---
    // The world is flat; the stars are fixed points on the dome of the firmament above us.
    const starCount = 900
    const starPositions = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i++) {
      // distribute on upper hemisphere of a sphere (firmament is above the disc)
      const u = Math.random()
      const v = Math.random() * 0.92 + 0.04 // avoid exact horizon
      const theta = 2 * Math.PI * u
      const phi = Math.acos(1 - v) // skewed toward top
      const r = 280
      starPositions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta)
      starPositions[i * 3 + 1] = r * Math.cos(phi) + 4
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    })
    const stars = new THREE.Points(starGeo, starMat)
    scene.add(stars)

    // --- Firmament edge: a subtle horizon ring to suggest the edge of the flat earth ---
    const edgeRingGeo = new THREE.RingGeometry(240, 260, 64)
    const edgeRingMat = new THREE.MeshBasicMaterial({
      color: 0x1a1420,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    })
    const edgeRing = new THREE.Mesh(edgeRingGeo, edgeRingMat)
    edgeRing.rotation.x = -Math.PI / 2
    edgeRing.position.y = -0.8
    scene.add(edgeRing)

    // --- Materials (shared) - PBR for hyper-realistic look ---
    const grassMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: false,
    })
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.95, metalness: 0 })
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2b4d22, roughness: 0.8, metalness: 0 })
    const leafMatDark = new THREE.MeshStandardMaterial({ color: 0x1c3818, roughness: 0.85, metalness: 0 })
    const pineLeafMat = new THREE.MeshStandardMaterial({ color: 0x25402a, roughness: 0.9, metalness: 0 })
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x7a7a80, roughness: 0.95, metalness: 0.05 })
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x385e2a, roughness: 0.9, metalness: 0 })
    const grassBladeMat = new THREE.MeshStandardMaterial({ color: 0x5a8c3d, roughness: 0.95, metalness: 0, side: THREE.DoubleSide })
    const cactusMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.88, metalness: 0 })
    const cactusRidgeMat = new THREE.MeshStandardMaterial({ color: 0x4fa84f, roughness: 0.9, metalness: 0 })
    const sapMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0x7c2d12, emissiveIntensity: 0.22, roughness: 0.28, metalness: 0, transparent: true, opacity: 0.9 })
    const sapPuddleMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    const caveFloorMat = new THREE.MeshStandardMaterial({ color: 0x090a0d, roughness: 1, metalness: 0 })
    const caveRockMat = new THREE.MeshStandardMaterial({ color: 0x2b2c33, roughness: 0.98, metalness: 0.04 })
    const caveMouthMat = new THREE.MeshBasicMaterial({ color: 0x020204, transparent: true, opacity: 0.96, side: THREE.DoubleSide })
    const caveCrystalMat = new THREE.MeshBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.82 })
    const bedFrameMat = new THREE.MeshStandardMaterial({ color: 0x5a3720, roughness: 0.92, metalness: 0 })
    const bedRollMat = new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.95, metalness: 0 })
    const pillowMat = new THREE.MeshStandardMaterial({ color: 0xe7d8bf, roughness: 0.9, metalness: 0 })
    const woodWallMat = new THREE.MeshStandardMaterial({ color: 0x6b432a, roughness: 0.9, metalness: 0 })
    const woodWallPlankMat = new THREE.MeshStandardMaterial({ color: 0x7d4e2f, roughness: 0.92, metalness: 0 })
    const woodWallPlankAltMat = new THREE.MeshStandardMaterial({ color: 0x5f3b23, roughness: 0.92, metalness: 0 })
    const woodWallBeamMat = new THREE.MeshStandardMaterial({ color: 0x4e2f1a, roughness: 0.95, metalness: 0 })
    const nailMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.7 })
    const woodFloorMat = new THREE.MeshStandardMaterial({ color: 0x7a5131, roughness: 0.85, metalness: 0 })
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x55ff88, transparent: true, opacity: 0.45, depthWrite: false })
    const ghostBadMat = new THREE.MeshBasicMaterial({ color: 0xff4455, transparent: true, opacity: 0.45, depthWrite: false })
    // Stone wall — mortared block palette
    const stoneBlockMat = new THREE.MeshStandardMaterial({ color: 0x8e8e95, roughness: 0.92, metalness: 0.05 })
    const stoneBlockAltMat = new THREE.MeshStandardMaterial({ color: 0x74747b, roughness: 0.94, metalness: 0.05 })
    const stoneBlockDarkMat = new THREE.MeshStandardMaterial({ color: 0x5d5d64, roughness: 0.95, metalness: 0.05 })
    const mortarMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 1.0, metalness: 0 })

    // Geometries
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.8, 10)
    const trunkGeoLarge = new THREE.CylinderGeometry(0.5, 0.7, 5.2, 10)
    const leafGeo = new THREE.ConeGeometry(1.8, 3.6, 8)
    const leafGeoSphere = new THREE.SphereGeometry(1.6, 10, 8)
    const pineGeo = new THREE.ConeGeometry(1.6, 4.2, 8)
    const stoneGeo = new THREE.DodecahedronGeometry(0.5, 0)
    const bushGeo = new THREE.SphereGeometry(0.55, 8, 6)
    const grassBladeGeo = new THREE.PlaneGeometry(0.15, 0.45)
    const cactusStemGeo = new THREE.CylinderGeometry(0.22, 0.28, 2.1, 9)
    const cactusArmGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.85, 8)
    const cactusRidgeGeo = new THREE.BoxGeometry(0.035, 1.85, 0.035)
    const sapDropGeo = new THREE.SphereGeometry(0.22, 18, 14)
    const sapTipGeo = new THREE.ConeGeometry(0.12, 0.28, 14)
    const sapPuddleGeo = new THREE.CircleGeometry(0.28, 24)
    const caveFloorGeo = new THREE.CircleGeometry(1, 40)
    const caveMouthGeo = new THREE.CircleGeometry(1, 32)
    const caveCrystalGeo = new THREE.ConeGeometry(0.08, 0.42, 6)
    const bedGhostGeo = new THREE.BoxGeometry(1.8, 0.55, 2.4)
    const wallGeo = new THREE.BoxGeometry(2, 2.4, 0.2)
    const floorGeo = new THREE.BoxGeometry(2, 0.15, 2)
    const dropGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35)
    // Shared assets for log drops (cylindrical log body + circle end caps)
    const logDropBodyGeo = new THREE.CylinderGeometry(0.26, 0.26, 1.05, 12)
    const logDropCapGeo = new THREE.CircleGeometry(0.26, 12)
    const logDropBarkMat = new THREE.MeshStandardMaterial({ color: 0x5a3720, roughness: 0.95, metalness: 0 })
    const logDropCoreMat = new THREE.MeshStandardMaterial({ color: 0xc79a6b, roughness: 0.85, metalness: 0 })
    // Log-based structures
    const logWallMat = new THREE.MeshStandardMaterial({ color: 0x3e2918, roughness: 0.95, metalness: 0 })
    const logFloorMat = new THREE.MeshStandardMaterial({ color: 0x4a311e, roughness: 0.9, metalness: 0 })
    const logWallGeo = new THREE.BoxGeometry(2, 2.8, 0.35)
    const logFloorGeo = new THREE.BoxGeometry(2, 0.2, 2)
    // Stone wall — thicker and slightly taller than wood plank wall
    const stoneWallGeo = new THREE.BoxGeometry(2, 2.6, 0.4)
    // Spike trap
    const trapBaseGeo = new THREE.BoxGeometry(1.7, 0.12, 1.7)
    const trapBaseMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.95, metalness: 0 })
    const spikeGeo = new THREE.ConeGeometry(0.09, 0.55, 6)
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.6, metalness: 0.5 })
    // Tree stand
    const standPlatformGeo = new THREE.BoxGeometry(2.4, 0.22, 2.4)
    const standPlatformMat = new THREE.MeshStandardMaterial({ color: 0x6b432a, roughness: 0.9, metalness: 0 })
    const standLegGeo = new THREE.CylinderGeometry(0.14, 0.16, 3.0, 6)
    const standLegMat = new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.95, metalness: 0 })
    const rungGeo = new THREE.BoxGeometry(0.35, 0.05, 0.05)

    // Stone furnace / forge — placed as a structure, enables smelting nearby
    const furnaceGeo = new THREE.BoxGeometry(1.6, 1.8, 1.2)
    const furnaceMat = new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.95, metalness: 0.05 })
    const furnaceMouthGeo = new THREE.BoxGeometry(0.9, 0.75, 0.08)
    const furnaceMouthMat = new THREE.MeshStandardMaterial({ color: 0x1a0f08, roughness: 0.6, emissive: 0xff4a10, emissiveIntensity: 1.1 })
    const furnaceChimneyGeo = new THREE.CylinderGeometry(0.22, 0.28, 0.7, 8)
    const furnaceChimneyMat = new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 0.95 })

    // Iron ore boulder — brownish-grey rock with rust veins (visible color only)
    const ironOreMat = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.85, metalness: 0.25 })

    // --- Chunk manager ---
    const chunks = new Map<string, ChunkData>()

    function chunkKey(cx: number, cz: number) { return `${cx},${cz}` }

    function buildTerrainMesh(cx: number, cz: number) {
      // Higher resolution for more realistic terrain
      const seg = CHUNK_SEG * 2
      const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, seg, seg)
      geo.rotateX(-Math.PI / 2)
      const pos = geo.attributes.position
      const count = pos.count
      const colors = new Float32Array(count * 3)
      // Base palette colors
      const cGrassDark = new THREE.Color(0x3a5c28)
      const cGrassLight = new THREE.Color(0x6e9a46)
      const cDirt = new THREE.Color(0x6b4a2a)
      const cRock = new THREE.Color(0x6d6d72)
      const cSand = new THREE.Color(0xb59a6a)
      const caveSpec = caveSpecForChunk(cx, cz)
      for (let i = 0; i < count; i++) {
        const x = pos.getX(i) + cx * CHUNK_SIZE
        const z = pos.getZ(i) + cz * CHUNK_SIZE
        const h = heightAt(x, z)
        pos.setY(i, h)
        // deterministic variation
        const hn = (Math.sin(x * 0.37 + z * 0.13) + Math.cos(x * 0.09 - z * 0.21)) * 0.5
        const mix = Math.max(0, Math.min(1, (h + 1) / 6 + hn * 0.15))
        const biome = biomeAt(x, z)
        const c = new THREE.Color().copy(cGrassDark).lerp(cGrassLight, mix)
        if (biome === 'desert') {
          // Desert terrain: warm sand with subtle dune/rock variation.
          c.copy(cSand).lerp(new THREE.Color(0xd9bd7a), Math.max(0, Math.min(1, 0.5 + hn * 0.35)))
          if (h > 2.8) c.lerp(new THREE.Color(0x9c8054), Math.min(1, (h - 2.8) * 0.25))
        } else if (biome === 'plains') {
          c.copy(new THREE.Color(0x6f8541)).lerp(new THREE.Color(0xa7a35a), mix)
          if (h < 0.4) c.lerp(cSand, Math.max(0, 0.4 - h) * 0.35)
        } else {
          // Low areas get a bit of sand/dirt
          if (h < 0.4) c.lerp(cSand, Math.max(0, 0.4 - h) * 0.6)
          // High areas get rocky
          if (h > 3.5) c.lerp(cRock, Math.min(1, (h - 3.5) * 0.4))
        }
        // Add some random dirt patches outside deserts.
        const patchN = Math.sin(x * 1.7) * Math.cos(z * 1.3)
        if (biome !== 'desert' && patchN > 0.7) c.lerp(cDirt, 0.3)
        if (caveSpec) {
          const caveD = Math.hypot(x - caveSpec.x, z - caveSpec.z)
          if (caveD < caveSpec.radius * 1.35) {
            const caveMix = Math.max(0, 1 - caveD / (caveSpec.radius * 1.35))
            c.lerp(new THREE.Color(0x17181d), 0.75 * caveMix)
          }
        }
        colors[i * 3] = c.r
        colors[i * 3 + 1] = c.g
        colors[i * 3 + 2] = c.b
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      geo.computeVertexNormals()
      const mesh = new THREE.Mesh(geo, grassMat)
      mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE)
      mesh.receiveShadow = true
      return mesh
    }

    function caveSpecForChunk(cx: number, cz: number) {
      // Caves are intentionally rare and use a local-minimum test so they do
      // not cluster. The origin stays cave-free to keep new-player starts calm.
      const seed = hash2Pub(cx * 1777 + 91, cz * 2441 - 37)
      if (seed > 0.11) return null
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          if (ox === 0 && oz === 0) continue
          const ns = hash2Pub((cx + ox) * 1777 + 91, (cz + oz) * 2441 - 37)
          if (ns < seed) return null
        }
      }
      const rx = hash2Pub(cx * 911 + 13, cz * 619 + 29)
      const rz = hash2Pub(cx * 353 + 71, cz * 827 + 5)
      const x = cx * CHUNK_SIZE + (rx - 0.5) * CHUNK_SIZE * 0.62
      const z = cz * CHUNK_SIZE + (rz - 0.5) * CHUNK_SIZE * 0.62
      if (Math.hypot(x, z) < 85) return null
      const y = heightAt(x, z)
      if (y < 0.2 || biomeAt(x, z) === 'desert') return null
      const radius = 4.8 + hash2Pub(cx * 41 + 9, cz * 73 + 17) * 1.8
      const yaw = hash2Pub(cx * 97 + 3, cz * 151 + 11) * Math.PI * 2
      return { x, y, z, radius, yaw }
    }

    function generateChunk(cx: number, cz: number): ChunkData {
      const group = new THREE.Group()
      group.name = `chunk_${cx}_${cz}`
      const terrain = buildTerrainMesh(cx, cz)
      group.add(terrain)
      const trees: ChunkData['trees'] = []
      const stones: ChunkData['stones'] = []
      const cacti: ChunkData['cacti'] = []
      const caves: ChunkData['caves'] = []
      const dropped: ChunkData['droppedItems'] = []
      // Deterministic scatter
      const rand = (a: number, b: number) => {
        const h = hash2Pub(cx * 131 + a, cz * 311 + b)
        return h
      }
      const caveSpec = caveSpecForChunk(cx, cz)
      const nearCave = (wx: number, wz: number, pad = 0) => !!caveSpec && Math.hypot(wx - caveSpec.x, wz - caveSpec.z) < caveSpec.radius + pad
      // trees - varied species (oak, pine, large oak), with randomized sizes
      for (let i = 0; i < 16; i++) {
        const rx = rand(i, i * 2 + 1)
        const rz = rand(i * 3 + 7, i)
        const wx = cx * CHUNK_SIZE + (rx - 0.5) * CHUNK_SIZE
        const wz = cz * CHUNK_SIZE + (rz - 0.5) * CHUNK_SIZE
        const wy = heightAt(wx, wz)
        const biome = biomeAt(wx, wz)
        if (wy < 0.1 || biome === 'desert' || nearCave(wx, wz, 2.5)) continue // skip lowlands, deserts, and cave clearings
        const tree = new THREE.Group()
        const species = rand(i + 13, i * 2) // 0..1
        const sizeVar = 0.8 + rand(i + 31, i + 7) * 0.6
        if (species > 0.66) {
          // pine
          const trunk = new THREE.Mesh(trunkGeo, trunkMat)
          trunk.position.y = 1.9 * sizeVar
          trunk.scale.y = sizeVar
          trunk.castShadow = true
          trunk.receiveShadow = true
          tree.add(trunk)
          for (let k = 0; k < 3; k++) {
            const cone = new THREE.Mesh(pineGeo, pineLeafMat)
            cone.position.y = (3.0 + k * 1.1) * sizeVar
            cone.scale.setScalar((1 - k * 0.18) * sizeVar)
            cone.castShadow = true
            tree.add(cone)
          }
        } else if (species > 0.33) {
          // large oak
          const trunk = new THREE.Mesh(trunkGeoLarge, trunkMat)
          trunk.position.y = 2.6 * sizeVar
          trunk.scale.y = sizeVar
          trunk.castShadow = true
          trunk.receiveShadow = true
          tree.add(trunk)
          const leaves = new THREE.Mesh(leafGeoSphere, leafMatDark)
          leaves.position.y = 5.6 * sizeVar
          leaves.scale.setScalar(1.8 * sizeVar)
          leaves.castShadow = true
          tree.add(leaves)
          const leaves2 = new THREE.Mesh(leafGeoSphere, leafMat)
          leaves2.position.set(1.1 * sizeVar, 5.0 * sizeVar, 0.4 * sizeVar)
          leaves2.scale.setScalar(1.2 * sizeVar)
          leaves2.castShadow = true
          tree.add(leaves2)
          const leaves3 = new THREE.Mesh(leafGeoSphere, leafMat)
          leaves3.position.set(-0.9 * sizeVar, 4.8 * sizeVar, -0.6 * sizeVar)
          leaves3.scale.setScalar(1.1 * sizeVar)
          leaves3.castShadow = true
          tree.add(leaves3)
        } else {
          // classic oak
          const trunk = new THREE.Mesh(trunkGeo, trunkMat)
          trunk.position.y = 1.9 * sizeVar
          trunk.scale.y = sizeVar
          trunk.castShadow = true
          trunk.receiveShadow = true
          tree.add(trunk)
          const leaves = new THREE.Mesh(leafGeoSphere, leafMat)
          leaves.position.y = 4.3 * sizeVar
          leaves.scale.setScalar(1.6 * sizeVar)
          leaves.castShadow = true
          tree.add(leaves)
          const leaves2 = new THREE.Mesh(leafGeoSphere, leafMatDark)
          leaves2.position.y = 5.3 * sizeVar
          leaves2.scale.setScalar(1.1 * sizeVar)
          leaves2.castShadow = true
          tree.add(leaves2)
        }
        tree.position.set(wx, wy, wz)
        tree.rotation.y = rand(i, i + 99) * Math.PI * 2
        // slight lean for realism
        tree.rotation.z = (rand(i, i + 17) - 0.5) * 0.08
        group.add(tree)
        // Tree HP = 12 balances cleanly against tool damages below:
        //   axe=6  → 2 hits, pickaxe=4 → 3 hits, sword=3 → 4 hits, fist=1 → 12 hits.
        trees.push({ mesh: tree, hp: 12, px: wx, pz: wz, collider: true })
      }
      // Desert cactus plants. They replace trees/rocks in sandy biomes and
      // can be broken for sap, the key material for beds.
      for (let i = 0; i < 9; i++) {
        const rx = rand(i + 901, i * 7 + 4)
        const rz = rand(i * 11 + 17, i + 909)
        const wx = cx * CHUNK_SIZE + (rx - 0.5) * CHUNK_SIZE
        const wz = cz * CHUNK_SIZE + (rz - 0.5) * CHUNK_SIZE
        const wy = heightAt(wx, wz)
        if (wy < 0.05 || biomeAt(wx, wz) !== 'desert' || nearCave(wx, wz, 1.5)) continue
        const cactus = new THREE.Group()
        const stem = new THREE.Mesh(cactusStemGeo, cactusMat)
        stem.position.y = 1.05
        stem.castShadow = true
        stem.receiveShadow = true
        cactus.add(stem)
        for (let r = 0; r < 4; r++) {
          const ridge = new THREE.Mesh(cactusRidgeGeo, cactusRidgeMat)
          const a = (r / 4) * Math.PI * 2
          ridge.position.set(Math.cos(a) * 0.22, 1.05, Math.sin(a) * 0.22)
          ridge.rotation.y = -a
          cactus.add(ridge)
        }
        for (const side of [-1, 1] as const) {
          if (rand(i + 30 + side, i + 71) < 0.35) continue
          const arm = new THREE.Group()
          const up = new THREE.Mesh(cactusArmGeo, cactusMat)
          up.position.y = 0.42
          up.castShadow = true
          arm.add(up)
          const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), cactusMat)
          arm.add(elbow)
          arm.position.set(side * 0.34, 0.95 + rand(i + 77, i + side) * 0.55, 0)
          arm.rotation.z = side * Math.PI / 2
          cactus.add(arm)
        }
        cactus.position.set(wx, wy, wz)
        cactus.rotation.y = rand(i, i + 404) * Math.PI * 2
        const size = 0.85 + rand(i + 501, i + 17) * 0.5
        cactus.scale.setScalar(size)
        group.add(cactus)
        cacti.push({ mesh: cactus, hp: 8, px: wx, pz: wz, collider: true })
      }

      // Rare cave entrance: an unmistakably dark rocky hollow cut into the
      // surface. Orc bosses are allowed to spawn only in these cave areas.
      if (caveSpec) {
        const cave = new THREE.Group()
        const floor = new THREE.Mesh(caveFloorGeo, caveFloorMat)
        floor.rotation.x = -Math.PI / 2
        floor.scale.set(caveSpec.radius * 1.05, caveSpec.radius * 0.72, 1)
        floor.position.y = 0.035
        floor.receiveShadow = true
        cave.add(floor)

        const mouth = new THREE.Mesh(caveMouthGeo, caveMouthMat)
        mouth.scale.set(caveSpec.radius * 0.68, caveSpec.radius * 0.48, 1)
        mouth.position.set(0, 1.15, -caveSpec.radius * 0.42)
        cave.add(mouth)

        for (let r = 0; r < 12; r++) {
          const a = Math.PI * (0.05 + (r / 11) * 0.9)
          const sx = Math.cos(a) * caveSpec.radius * (0.88 + rand(r + 404, r + 1) * 0.18)
          const sz = -Math.sin(a) * caveSpec.radius * 0.62
          const rock = new THREE.Mesh(stoneGeo, caveRockMat)
          const rs = 0.7 + rand(r + 701, r + 8) * 1.15
          rock.scale.set(rs * 1.1, rs * (0.7 + Math.sin(a) * 1.15), rs)
          rock.position.set(sx, 0.25 + rock.scale.y * 0.22, sz)
          rock.rotation.set(rand(r, 61) * Math.PI, rand(r, 67) * Math.PI, rand(r, 71) * Math.PI)
          rock.castShadow = true
          rock.receiveShadow = true
          cave.add(rock)
        }

        for (let k = 0; k < 5; k++) {
          const crystal = new THREE.Mesh(caveCrystalGeo, caveCrystalMat)
          const side = k % 2 === 0 ? -1 : 1
          crystal.position.set(side * (1.15 + rand(k + 500, k) * 1.15), 0.25, -1.4 - rand(k + 55, k + 4) * 1.1)
          crystal.rotation.z = (rand(k + 6, k + 7) - 0.5) * 0.5
          cave.add(crystal)
        }

        const glow = new THREE.PointLight(0x3b82f6, 0.85, caveSpec.radius * 2.7, 2)
        glow.position.set(0, 0.7, -caveSpec.radius * 0.25)
        cave.add(glow)
        cave.position.set(caveSpec.x, caveSpec.y + 0.015, caveSpec.z)
        cave.rotation.y = caveSpec.yaw
        group.add(cave)
        caves.push({ mesh: cave, ...caveSpec })
      }

      // stones on ground — includes occasional iron-ore variants that require a pickaxe.
      // Boulders are rare (2-3 per chunk) and iron ore is scarcer still (~10%)
      // so the world feels less cluttered and iron stays meaningful as a
      // progression gate.
      const boulderCount = 2 + Math.floor(rand(cx * 13 + 1, cz * 7 + 3) * 2)
      for (let i = 0; i < boulderCount; i++) {
        const rx = rand(i + 55, i * 2)
        const rz = rand(i * 4 + 3, i + 12)
        const wx = cx * CHUNK_SIZE + (rx - 0.5) * CHUNK_SIZE
        const wz = cz * CHUNK_SIZE + (rz - 0.5) * CHUNK_SIZE
        const wy = heightAt(wx, wz)
        if (biomeAt(wx, wz) === 'desert' || nearCave(wx, wz, 1.2)) continue // deserts and cave clearings intentionally have no rocks
        // ~10% of boulders are iron ore (rustier, tougher)
        const isIron = rand(i + 777, i * 19) < 0.10
        const s = new THREE.Mesh(stoneGeo, isIron ? ironOreMat : stoneMat)
        s.position.set(wx, wy + 0.35, wz)
        s.rotation.set(rand(i, 1) * 3, rand(i, 2) * 3, rand(i, 3) * 3)
        s.castShadow = true
        s.receiveShadow = true
        const scale = (isIron ? 0.75 : 0.6) + rand(i, 7) * 0.9
        s.scale.setScalar(scale)
        // Add rust streaks for iron ore (a few smaller rust-colored chunks)
        if (isIron) {
          for (let k = 0; k < 3; k++) {
            const chunk = new THREE.Mesh(stoneGeo, ironOreMat)
            chunk.scale.setScalar(0.25 + rand(i + k * 5, 3) * 0.15)
            chunk.position.set(
              (rand(i + k, 2) - 0.5) * 0.3,
              (rand(i + k, 5) - 0.3) * 0.25,
              (rand(i + k, 7) - 0.5) * 0.3,
            )
            s.add(chunk)
          }
        }
        group.add(s)
        // Every boulder — regular or iron ore — breaks in exactly 3 pickaxe
        // hits. Uniform HP keeps mining predictable; ore toughness comes from
        // being a rarer drop, not a longer grind.
        const boulderHp = 3
        stones.push({ mesh: s, px: wx, py: wy + 0.35, pz: wz, hp: boulderHp, maxHp: boulderHp, oreKind: isIron ? 'iron' : 'stone', initialScale: scale })
      }
      // --- Small ground stones that the player can pick up with [E] without a tool.
      // Very scarce (1-3 per chunk) so boulders are the primary source of stone.
      const smallStoneCount = 1 + Math.floor(rand(cx + 11, cz + 31) * 3)
      for (let i = 0; i < smallStoneCount; i++) {
        const rx = rand(i * 13 + 7, cx + 41 + i)
        const rz = rand(i * 17 + 3, cz + 29 + i)
        const wx = cx * CHUNK_SIZE + (rx - 0.5) * CHUNK_SIZE
        const wz = cz * CHUNK_SIZE + (rz - 0.5) * CHUNK_SIZE
        const wy = heightAt(wx, wz)
        if (wy < 0.15 || biomeAt(wx, wz) === 'desert' || nearCave(wx, wz, 0.8)) continue
        // Use a tiny stone mesh attached to the chunk group.  We'll treat these
        // as pick-up drops by adding to droppedItems — the main render loop's
        // `tryPickupNearest()` picks them up when player comes close.
        const sm = new THREE.Mesh(stoneGeo, stoneMat)
        // Larger, chunky pickup rocks so they read as real stones on the
        // ground rather than pebbles (were 0.22+0.08 — tiny).
        sm.scale.setScalar(0.45 + rand(i * 3, 11) * 0.25)
        sm.position.set(wx, wy + 0.2, wz)
        sm.rotation.set(rand(i, 19) * 3, rand(i, 23) * 3, rand(i, 29) * 3)
        sm.castShadow = true
        sm.receiveShadow = true
        scene.add(sm)
        // Attach a small "1× stone" dropped-item record for pickup.
        // Matches the droppedItems shape used by dropItemToWorld().
        // life = 1e9 => effectively never despawn naturally.
        dropped.push({ netId: `ground_stone_${wx.toFixed(1)}_${wz.toFixed(1)}`, mesh: sm, id: 'stone', count: 1, px: wx, py: wy + 0.1, pz: wz, vy: 0, life: 1e9 })
      }
      // bushes (non-colliding decoration)
      for (let i = 0; i < 12; i++) {
        const rx = rand(i + 111, i * 3)
        const rz = rand(i * 5 + 2, i + 47)
        const wx = cx * CHUNK_SIZE + (rx - 0.5) * CHUNK_SIZE
        const wz = cz * CHUNK_SIZE + (rz - 0.5) * CHUNK_SIZE
        const wy = heightAt(wx, wz)
        if (wy < 0.1 || biomeAt(wx, wz) === 'desert' || nearCave(wx, wz, 1.5)) continue
        const bush = new THREE.Mesh(bushGeo, bushMat)
        const bs = 0.8 + rand(i, 21) * 0.9
        bush.scale.set(bs, bs * 0.7, bs)
        bush.position.set(wx, wy + 0.35 * bs, wz)
        bush.rotation.y = rand(i, 9) * Math.PI * 2
        bush.castShadow = true
        bush.receiveShadow = true
        group.add(bush)
      }
      // grass blades (visual tufts - use instanced-like scatter)
      const grassTufts = 60
      const bladeInst = new THREE.InstancedMesh(grassBladeGeo, grassBladeMat, grassTufts)
      bladeInst.castShadow = false
      bladeInst.receiveShadow = true
      const dummy = new THREE.Object3D()
      for (let i = 0; i < grassTufts; i++) {
        const rx = rand(i + 333, i * 7)
        const rz = rand(i * 11 + 5, i + 77)
        const wx = cx * CHUNK_SIZE + (rx - 0.5) * CHUNK_SIZE
        const wz = cz * CHUNK_SIZE + (rz - 0.5) * CHUNK_SIZE
        const wy = heightAt(wx, wz)
        if (wy < 0.2 || biomeAt(wx, wz) === 'desert' || nearCave(wx, wz, 1.5)) { dummy.scale.setScalar(0); dummy.updateMatrix(); bladeInst.setMatrixAt(i, dummy.matrix); continue }
        dummy.position.set(wx, wy + 0.22, wz)
        dummy.rotation.y = rand(i, 55) * Math.PI * 2
        dummy.scale.setScalar(0.8 + rand(i, 3) * 0.8)
        dummy.updateMatrix()
        bladeInst.setMatrixAt(i, dummy.matrix)
      }
      bladeInst.instanceMatrix.needsUpdate = true
      group.add(bladeInst)
      scene.add(group)
      return { cx, cz, group, trees, stones, cacti, caves, droppedItems: dropped, terrain }
    }

    function disposeChunk(c: ChunkData) {
      scene.remove(c.group)
      c.group.traverse((obj: any) => {
        if (obj.geometry && !sharedGeos.has(obj.geometry)) obj.geometry.dispose?.()
      })
      // Dropped items + small-ground-stones are added directly to the scene.
      // Clean them up when the chunk is unloaded so we don't leak meshes.
      for (const d of c.droppedItems) {
        scene.remove(d.mesh)
      }
      c.droppedItems.length = 0
      // terrain has unique geometry -> dispose
      c.terrain.geometry.dispose()
    }

    const sharedGeos = new Set<THREE.BufferGeometry>([trunkGeo, trunkGeoLarge, leafGeo, leafGeoSphere, pineGeo, stoneGeo, bushGeo, grassBladeGeo, cactusStemGeo, cactusArmGeo, cactusRidgeGeo, sapDropGeo, sapTipGeo, sapPuddleGeo, caveFloorGeo, caveMouthGeo, caveCrystalGeo, bedGhostGeo, wallGeo, floorGeo, dropGeo, logDropBodyGeo, logDropCapGeo, logWallGeo, logFloorGeo, stoneWallGeo, trapBaseGeo, spikeGeo, standPlatformGeo, standLegGeo, rungGeo, furnaceGeo, furnaceMouthGeo, furnaceChimneyGeo])

    function updateChunks(px: number, pz: number) {
      const pcx = Math.floor(px / CHUNK_SIZE)
      const pcz = Math.floor(pz / CHUNK_SIZE)
      const needed = new Set<string>()
      for (let dx = -VIEW_CHUNKS; dx <= VIEW_CHUNKS; dx++) {
        for (let dz = -VIEW_CHUNKS; dz <= VIEW_CHUNKS; dz++) {
          const key = chunkKey(pcx + dx, pcz + dz)
          needed.add(key)
          if (!chunks.has(key)) {
            const generated = generateChunk(pcx + dx, pcz + dz)
            applyBrokenResourcesToChunk(generated)
            chunks.set(key, generated)
          }
        }
      }
      for (const [k, c] of chunks) {
        if (!needed.has(k)) { disposeChunk(c); chunks.delete(k) }
      }
    }

    // --- Player state ---
    const playerPos = new THREE.Vector3(0, 0, 0)
    playerPos.y = heightAt(0, 0) + PLAYER_HEIGHT + 0.2
    const playerVel = new THREE.Vector3(0, 0, 0)
    const input = { f: false, b: false, l: false, r: false, jump: false, sprint: false, attack: false }
    // First-person camera yaw (mouse-controlled) + slight downward pitch
    // so the player can see the ground right in front of them.
    let yaw = 0, pitch = -0.08
    // Character's facing direction (separate from camera)
    let playerYaw = 0
    // Click-to-move state
    const mouseNdc = new THREE.Vector2(0, 0)
    const mouseGroundPoint = new THREE.Vector3()
    let hasMouseGround = false
    let walkTarget: THREE.Vector3 | null = null
    let onGround = false
    let attackTimer = 0

    // Falling-tree animation state: each entry holds the tipping tree mesh
    // and the start/end quaternions to slerp between.  After the tree has
    // finished crashing down, its logs are spawned on the ground for the
    // player to walk over and pick up.
    const fallingTrees: {
      mesh: THREE.Object3D
      startQuat: THREE.Quaternion
      endQuat: THREE.Quaternion
      progress: number
      duration: number
      px: number
      pz: number
      axisX: number  // horizontal direction the trunk is falling in
      axisZ: number
      landed: boolean
      linger: number // seconds the fallen trunk lingers on the ground before breaking
      broken: boolean
    }[] = []
    const fallingCacti: {
      mesh: THREE.Object3D
      startQuat: THREE.Quaternion
      endQuat: THREE.Quaternion
      progress: number
      duration: number
      px: number
      pz: number
      landed: boolean
      linger: number
    }[] = []

    // --- Third-person player character (more organic shapes) ---
    const playerMesh = new THREE.Group()
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xcf9875, roughness: 0.72, metalness: 0 })
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0x6a5a3c, roughness: 0.85, metalness: 0 })
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2e3524, roughness: 0.9, metalness: 0 })
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.85, metalness: 0 })
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.9, metalness: 0 })
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x2b1c0f, roughness: 0.8, metalness: 0 })

    // Torso — capsule-like (cylinder + spheres) for organic shape
    const torso = new THREE.Group()
    const torsoBody = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.24, 0.7, 16), shirtMat)
    torsoBody.position.y = 0
    torsoBody.castShadow = true
    torso.add(torsoBody)
    const chestCap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), shirtMat)
    chestCap.position.y = 0.35
    chestCap.castShadow = true
    torso.add(chestCap)
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.08, 16), beltMat)
    belt.position.y = -0.35
    belt.castShadow = true
    torso.add(belt)
    torso.position.y = 1.1
    playerMesh.add(torso)

    // Neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.12, 12), skinMat)
    neck.position.y = 1.52
    neck.castShadow = true
    playerMesh.add(neck)

    // Head — sphere instead of box, with slight vertical squish
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 16), skinMat)
    head.scale.set(1, 1.08, 0.95)
    head.position.y = 1.72
    head.castShadow = true
    playerMesh.add(head)
    // Hair — half sphere cap
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2), hairMat)
    hair.position.y = 1.75
    hair.scale.set(1, 1, 0.98)
    hair.castShadow = true
    playerMesh.add(hair)
    // Eyes (small dark spheres, purely cosmetic)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.2, metalness: 0.2 })
    const eyeGeo = new THREE.SphereGeometry(0.022, 8, 6)
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat)
    eyeL.position.set(0.06, 1.74, 0.16)
    playerMesh.add(eyeL)
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat)
    eyeR.position.set(-0.06, 1.74, 0.16)
    playerMesh.add(eyeR)

    // Shoulder joints
    const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), shirtMat)
    shoulderL.position.set(0.33, 1.42, 0)
    shoulderL.castShadow = true
    playerMesh.add(shoulderL)
    const shoulderR = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), shirtMat)
    shoulderR.position.set(-0.33, 1.42, 0)
    shoulderR.castShadow = true
    playerMesh.add(shoulderR)

    // Arms — cylinder with rounded ends, pivot at shoulder
    function buildArm(isLeft: boolean) {
      const arm = new THREE.Group()
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.085, 0.38, 12), shirtMat)
      upper.position.y = -0.19
      upper.castShadow = true
      arm.add(upper)
      // Elbow
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), shirtMat)
      elbow.position.y = -0.38
      elbow.castShadow = true
      arm.add(elbow)
      // Forearm
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.08, 0.34, 12), skinMat)
      fore.position.y = -0.55
      fore.castShadow = true
      arm.add(fore)
      // Hand
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), skinMat)
      hand.scale.set(1, 1.1, 0.85)
      hand.position.y = -0.76
      hand.castShadow = true
      arm.add(hand)
      arm.position.set(isLeft ? 0.33 : -0.33, 1.42, 0)
      return { arm, hand }
    }
    const { arm: armL } = buildArm(true)
    playerMesh.add(armL)
    const { arm: armR, hand: handR } = buildArm(false)
    playerMesh.add(armR)

    // Legs — cylinder with knee joint + boot
    function buildLeg(isLeft: boolean) {
      const leg = new THREE.Group()
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.1, 0.42, 12), pantsMat)
      thigh.position.y = -0.21
      thigh.castShadow = true
      leg.add(thigh)
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), pantsMat)
      knee.position.y = -0.42
      knee.castShadow = true
      leg.add(knee)
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.4, 12), pantsMat)
      shin.position.y = -0.62
      shin.castShadow = true
      leg.add(shin)
      // Boot (rounded)
      const CapGeo: any = (THREE as any).CapsuleGeometry
      const bootGeo = CapGeo ? new CapGeo(0.11, 0.1, 6, 10) : new THREE.CylinderGeometry(0.11, 0.11, 0.16, 12)
      const boot = new THREE.Mesh(bootGeo, bootMat)
      boot.position.set(0, -0.86, 0.05)
      boot.rotation.x = Math.PI / 2
      boot.scale.set(1, 1.3, 1)
      boot.castShadow = true
      leg.add(boot)
      leg.position.set(isLeft ? 0.14 : -0.14, 0.74, 0)
      return leg
    }
    const legL = buildLeg(true)
    const legR = buildLeg(false)
    playerMesh.add(legL)
    playerMesh.add(legR)

    // Weapon attached to right hand (inside armR group)
    // Weapon is a group with a wooden handle + an interchangeable head.
    // Origin of the group = grip point (where the hand wraps the handle).
    // Positioned in CAMERA space so it hovers in the view like a classic
    // first-person weapon.
    const weaponGroup = new THREE.Group()
    weaponGroup.position.set(0.42, -0.45, -0.82)
    weaponGroup.rotation.set(0.25, -0.3, -0.15)
    weaponGroup.visible = false
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x5a3b1f, roughness: 0.85, metalness: 0 })
    // Handle: upper ~third sits above the grip (so hand wraps near the top),
    // the bulk extends downward/behind the hand.
    const handleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.78, 10), handleMat)
    handleMesh.position.y = -0.22 // grip 0.17 below the top of the handle
    handleMesh.castShadow = true
    weaponGroup.add(handleMesh)
    // Hand grip wrap — a small leather band at the grip point for visual contact.
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x3a2617, roughness: 0.95, metalness: 0 })
    const gripWrap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.11, 10), gripMat)
    gripWrap.position.y = 0
    gripWrap.castShadow = true
    weaponGroup.add(gripWrap)
    // Weapon head — sits at the top of the handle
    const weaponMat = new THREE.MeshStandardMaterial({ color: 0x8a8a90, roughness: 0.5, metalness: 0.3 })
    const weaponHead = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.12), weaponMat)
    weaponHead.position.set(0, 0.18, 0)
    weaponHead.castShadow = true
    weaponGroup.add(weaponHead)
    // Pickaxe spike (pointed end) — visible only for pickaxe
    const pickSpike = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.22, 8), weaponMat)
    pickSpike.position.set(0.22, 0.18, 0)
    pickSpike.rotation.z = -Math.PI / 2
    pickSpike.castShadow = true
    pickSpike.visible = false
    weaponGroup.add(pickSpike)
    // Back of pickaxe head — flat nub
    const pickBack = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.1), weaponMat)
    pickBack.position.set(-0.18, 0.18, 0)
    pickBack.castShadow = true
    pickBack.visible = false
    weaponGroup.add(pickBack)

    // --- Held-item meshes (shown when holding a non-weapon item like log/rock/furnace) ---
    // Held log: a chunk of wood held horizontally across the hand
    const heldLogGroup = new THREE.Group()
    const heldLogBody = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.65, 12), logDropBarkMat)
    heldLogBody.rotation.z = Math.PI / 2
    heldLogBody.position.y = 0.05
    heldLogBody.castShadow = true
    heldLogGroup.add(heldLogBody)
    const hlCap1 = new THREE.Mesh(logDropCapGeo, logDropCoreMat)
    hlCap1.rotation.y = Math.PI / 2
    hlCap1.position.set(0.33, 0.05, 0)
    hlCap1.scale.setScalar(0.42)
    heldLogGroup.add(hlCap1)
    const hlCap2 = new THREE.Mesh(logDropCapGeo, logDropCoreMat)
    hlCap2.rotation.y = -Math.PI / 2
    hlCap2.position.set(-0.33, 0.05, 0)
    hlCap2.scale.setScalar(0.42)
    heldLogGroup.add(hlCap2)
    heldLogGroup.visible = false
    weaponGroup.add(heldLogGroup)

    // Held rock (shared for stone, raw_iron, iron_ingot; color differs per item)
    const heldRockMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.95, metalness: 0.1 })
    const heldRockMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), heldRockMat)
    heldRockMesh.position.set(0, 0.04, 0)
    heldRockMesh.castShadow = true
    heldRockMesh.visible = false
    weaponGroup.add(heldRockMesh)

    // Held cactus sap — amber sticky droplet/blob (not a generic tool mesh).
    const heldSapGroup = new THREE.Group()
    const heldSapBlob = new THREE.Mesh(sapDropGeo, sapMat)
    heldSapBlob.scale.set(0.55, 0.7, 0.55)
    heldSapBlob.position.y = 0.06
    heldSapBlob.castShadow = true
    heldSapGroup.add(heldSapBlob)
    const heldSapTip = new THREE.Mesh(sapTipGeo, sapMat)
    heldSapTip.position.y = 0.25
    heldSapTip.castShadow = true
    heldSapGroup.add(heldSapTip)
    heldSapGroup.visible = false
    weaponGroup.add(heldSapGroup)

    // Held wood planks — flat wide planks, for 'wood' item
    const heldWoodMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 })
    const heldWoodMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.18), heldWoodMat)
    heldWoodMesh.position.set(0, 0.05, 0)
    heldWoodMesh.castShadow = true
    heldWoodMesh.visible = false
    weaponGroup.add(heldWoodMesh)

    // Held furnace — small preview block (for when the furnace placeable is equipped)
    const heldFurnaceMesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.22), furnaceMat.clone())
    heldFurnaceMesh.position.set(0, 0.1, 0)
    heldFurnaceMesh.castShadow = true
    heldFurnaceMesh.visible = false
    weaponGroup.add(heldFurnaceMesh)

    // Held wall (generic)
    const heldWallMat = new THREE.MeshStandardMaterial({ color: 0x707a82, roughness: 0.9 })
    const heldWallMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.1), heldWallMat)
    heldWallMesh.position.set(0, 0.08, 0)
    heldWallMesh.castShadow = true
    heldWallMesh.visible = false
    weaponGroup.add(heldWallMesh)

    // --- Improved per-tool weapon detail meshes (sword blade, axe blade, pommel etc.) ---
    // All start invisible; the swap logic toggles which ones are shown per tool.

    // Sword: long blade with pointy tip, crossguard, pommel
    const swordBladeGeo = new THREE.BoxGeometry(0.05, 0.7, 0.12)
    const swordBlade = new THREE.Mesh(swordBladeGeo, weaponMat)
    swordBlade.position.set(0, 0.48, 0)
    swordBlade.castShadow = true
    swordBlade.visible = false
    weaponGroup.add(swordBlade)
    const swordTipGeo = new THREE.ConeGeometry(0.062, 0.16, 4)
    const swordTip = new THREE.Mesh(swordTipGeo, weaponMat)
    swordTip.position.set(0, 0.88, 0)
    swordTip.rotation.y = Math.PI / 4
    swordTip.castShadow = true
    swordTip.visible = false
    weaponGroup.add(swordTip)
    const swordGuardGeo = new THREE.BoxGeometry(0.28, 0.04, 0.08)
    const swordGuardMat = new THREE.MeshStandardMaterial({ color: 0x453522, roughness: 0.85, metalness: 0.3 })
    const swordGuard = new THREE.Mesh(swordGuardGeo, swordGuardMat)
    swordGuard.position.set(0, 0.16, 0)
    swordGuard.castShadow = true
    swordGuard.visible = false
    weaponGroup.add(swordGuard)
    const swordPommel = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), swordGuardMat)
    swordPommel.position.set(0, -0.48, 0)
    swordPommel.castShadow = true
    swordPommel.visible = false
    weaponGroup.add(swordPommel)

    // Axe: curved wedge blade on one side with a small poll on the other
    const axeBladeShape = new THREE.Shape()
    axeBladeShape.moveTo(0, -0.18)
    axeBladeShape.lineTo(0, 0.18)
    axeBladeShape.lineTo(0.22, 0.26)
    axeBladeShape.lineTo(0.35, 0)
    axeBladeShape.lineTo(0.22, -0.26)
    axeBladeShape.lineTo(0, -0.18)
    const axeBladeGeo = new THREE.ExtrudeGeometry(axeBladeShape, { depth: 0.06, bevelEnabled: false })
    axeBladeGeo.center()
    const axeBlade = new THREE.Mesh(axeBladeGeo, weaponMat)
    axeBlade.position.set(0.18, 0.2, 0)
    axeBlade.castShadow = true
    axeBlade.visible = false
    weaponGroup.add(axeBlade)
    const axePoll = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.12), weaponMat)
    axePoll.position.set(-0.12, 0.2, 0)
    axePoll.castShadow = true
    axePoll.visible = false
    weaponGroup.add(axePoll)

    // Pickaxe: curved two-pointed head (thicker spike on each side)
    const pickHeadBarGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8)
    const pickHeadBar = new THREE.Mesh(pickHeadBarGeo, weaponMat)
    pickHeadBar.rotation.z = Math.PI / 2
    pickHeadBar.position.set(0, 0.2, 0)
    pickHeadBar.castShadow = true
    pickHeadBar.visible = false
    weaponGroup.add(pickHeadBar)
    const pickTip2 = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.2, 8), weaponMat)
    pickTip2.position.set(-0.28, 0.2, 0)
    pickTip2.rotation.z = Math.PI / 2
    pickTip2.castShadow = true
    pickTip2.visible = false
    weaponGroup.add(pickTip2)

    // --- Cosmetic held-item meshes ---
    // Shirt: a 3D shirt shape held up in front of the player — torso panel
    // with short sleeves and a collar so it's obviously a shirt and not a rag.
    const heldShirtMat = new THREE.MeshStandardMaterial({ color: 0x8a6243, roughness: 1, side: THREE.DoubleSide })
    const heldShirtGroup = new THREE.Group()
    heldShirtGroup.position.set(0, 0.02, 0.0)
    heldShirtGroup.rotation.x = -0.25
    // Torso panel (the main body of the shirt)
    const heldShirtTorso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.08), heldShirtMat)
    heldShirtTorso.castShadow = true
    heldShirtGroup.add(heldShirtTorso)
    // Short left sleeve
    const heldShirtSleeveL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.1), heldShirtMat)
    heldShirtSleeveL.position.set(0.21, 0.12, 0)
    heldShirtSleeveL.rotation.z = 0.35
    heldShirtSleeveL.castShadow = true
    heldShirtGroup.add(heldShirtSleeveL)
    // Short right sleeve
    const heldShirtSleeveR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.1), heldShirtMat)
    heldShirtSleeveR.position.set(-0.21, 0.12, 0)
    heldShirtSleeveR.rotation.z = -0.35
    heldShirtSleeveR.castShadow = true
    heldShirtGroup.add(heldShirtSleeveR)
    // V-neck collar strip (slightly darker than shirt body)
    const heldShirtCollarMat = new THREE.MeshStandardMaterial({ color: 0x523923, roughness: 1 })
    const heldShirtCollar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.09), heldShirtCollarMat)
    heldShirtCollar.position.set(0, 0.19, 0)
    heldShirtGroup.add(heldShirtCollar)
    // Bottom hem — a darker ribbon to suggest a finished edge
    const heldShirtHem = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.085), heldShirtCollarMat)
    heldShirtHem.position.set(0, -0.2, 0)
    heldShirtGroup.add(heldShirtHem)
    heldShirtGroup.visible = false
    weaponGroup.add(heldShirtGroup)
    // Keep the old name alive for compatibility with existing visibility toggles.
    const heldShirtMesh = heldShirtGroup

    // Pants: a 3D pants shape with a waistband + two tapered legs.
    const heldPantsMat = new THREE.MeshStandardMaterial({ color: 0x4a3f36, roughness: 1, side: THREE.DoubleSide })
    const heldPantsGroup = new THREE.Group()
    heldPantsGroup.position.set(0, -0.04, 0.0)
    heldPantsGroup.rotation.x = -0.2
    // Waistband — slightly darker cloth ribbon at the top
    const heldPantsWaistMat = new THREE.MeshStandardMaterial({ color: 0x2e261f, roughness: 1 })
    const heldPantsWaist = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.09), heldPantsWaistMat)
    heldPantsWaist.position.set(0, 0.2, 0)
    heldPantsWaist.castShadow = true
    heldPantsGroup.add(heldPantsWaist)
    // Left trouser leg
    const heldPantsLegL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.38, 0.1), heldPantsMat)
    heldPantsLegL.position.set(0.075, -0.03, 0)
    heldPantsLegL.castShadow = true
    heldPantsGroup.add(heldPantsLegL)
    // Right trouser leg
    const heldPantsLegR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.38, 0.1), heldPantsMat)
    heldPantsLegR.position.set(-0.075, -0.03, 0)
    heldPantsLegR.castShadow = true
    heldPantsGroup.add(heldPantsLegR)
    heldPantsGroup.visible = false
    weaponGroup.add(heldPantsGroup)
    const heldPantsMesh = heldPantsGroup

    // Torn hat: a simple cap — low cone on top of a round brim
    const heldHatGroup = new THREE.Group()
    const hatCrown = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.18, 10), new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.95 }))
    hatCrown.position.y = 0.12
    heldHatGroup.add(hatCrown)
    const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.95 }))
    hatBrim.position.y = 0.04
    heldHatGroup.add(hatBrim)
    heldHatGroup.position.set(0, 0.05, 0)
    heldHatGroup.visible = false
    weaponGroup.add(heldHatGroup)

    // Torn cloak: large draping cloth
    const heldCloakMat = new THREE.MeshStandardMaterial({ color: 0x4b4a55, roughness: 1, side: THREE.DoubleSide })
    const heldCloakMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.55), heldCloakMat)
    heldCloakMesh.position.set(0, 0.05, 0.03)
    heldCloakMesh.rotation.x = -0.2
    heldCloakMesh.visible = false
    weaponGroup.add(heldCloakMesh)

    // Holy water: small glass vial — glowing blue liquid + cork stopper
    const heldHolyWaterGroup = new THREE.Group()
    const hwGlassMat = new THREE.MeshStandardMaterial({ color: 0x7ecbff, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.75, emissive: 0x2d8cff, emissiveIntensity: 0.3 })
    const hwGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.2, 12), hwGlassMat)
    hwGlass.position.y = 0.12
    hwGlass.castShadow = true
    heldHolyWaterGroup.add(hwGlass)
    const hwCork = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10), new THREE.MeshStandardMaterial({ color: 0x6b4d28, roughness: 1 }))
    hwCork.position.y = 0.24
    heldHolyWaterGroup.add(hwCork)
    heldHolyWaterGroup.visible = false
    weaponGroup.add(heldHolyWaterGroup)

    // First-person: weapon is a child of the camera so it moves with the view.
    // Alias for legacy references in animation code
    const weaponMesh = weaponGroup

    // Player mesh isn't rendered in first person (you're inside it looking out).
    // We keep the object graph and its sub-meshes intact though, because the
    // rest of the game logic (legs/arms/head refs) still touches them.
    scene.add(playerMesh)
    playerMesh.visible = false

    // Camera attached to scene + weapon attached to camera (first person rig).
    scene.add(camera)
    camera.add(weaponGroup)

    // --- First-person arm + fist (visible when unarmed) ---
    // The group is parented to the camera. Its origin is at the player's
    // RIGHT SHOULDER, tucked just off-screen behind the viewport edge. From
    // there the upper-arm, elbow, forearm, wrist and hand extend forward and
    // down into view — this is what makes the hand look anatomically
    // connected to the body instead of floating in space. Rotating the whole
    // group at rotation.x pivots the entire arm from the shoulder, which is
    // exactly what happens when a real person throws a punch.
    const fistGroup = new THREE.Group()
    fistGroup.position.set(0.48, -0.18, 0.28)
    fistGroup.rotation.set(-0.5, -0.15, -0.12)
    fistGroup.visible = false

    // Materials
    const handSkinMat = new THREE.MeshStandardMaterial({ color: 0xd5a57f, roughness: 0.72, metalness: 0.02 })
    const handSkinDarkMat = new THREE.MeshStandardMaterial({ color: 0xb1845f, roughness: 0.8, metalness: 0 })
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x3a2518, roughness: 0.96, metalness: 0 })
    const sleeveDarkMat = new THREE.MeshStandardMaterial({ color: 0x241609, roughness: 1, metalness: 0 })
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0f, roughness: 0.95, metalness: 0.03 })
    const fingernailMat = new THREE.MeshStandardMaterial({ color: 0xe8c79f, roughness: 0.5, metalness: 0.05 })

    // SHOULDER CAP — big rounded pad that reads as the upper-arm/shoulder
    // connection. It sits right at the pivot so the arm looks anchored to a
    // body even though the body itself is off-screen.
    const shoulderCap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), sleeveMat)
    shoulderCap.castShadow = true
    fistGroup.add(shoulderCap)

    // UPPER ARM — tapered cylinder (bicep → elbow), aligned along local -Z
    const upperArmGeom = new THREE.CylinderGeometry(0.125, 0.105, 0.42, 16)
    const upperArm = new THREE.Mesh(upperArmGeom, sleeveMat)
    upperArm.rotation.x = Math.PI / 2 // lay cylinder along Z axis
    upperArm.position.set(0, 0, -0.21)
    upperArm.castShadow = true
    fistGroup.add(upperArm)

    // Subtle shirt-sleeve seam at the shoulder (dark ring)
    const shoulderSeam = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.018, 8, 20), sleeveDarkMat)
    shoulderSeam.position.set(0, 0, -0.01)
    fistGroup.add(shoulderSeam)

    // ELBOW GROUP — everything from the elbow forward lives here so the
    // forearm can flex independently of the shoulder during punches, and the
    // joint is visible at the bend.
    const elbowGroup = new THREE.Group()
    elbowGroup.position.set(0, 0, -0.42)
    // Rest pose: slight bend so the arm reads as a "ready" stance, not stiff
    elbowGroup.rotation.x = -0.35
    fistGroup.add(elbowGroup)

    // Elbow joint — sleeve cuff + skin patch peeking through (rolled sleeve look)
    const elbowCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.08, 16), sleeveDarkMat)
    elbowCuff.rotation.x = Math.PI / 2
    elbowCuff.position.set(0, 0, 0)
    elbowGroup.add(elbowCuff)
    const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 10), handSkinDarkMat)
    elbowJoint.position.set(0, 0, 0.01)
    elbowGroup.add(elbowJoint)

    // FOREARM — bare skin from elbow to wrist, slightly tapered
    const forearmGeom = new THREE.CylinderGeometry(0.098, 0.078, 0.36, 16)
    const forearm = new THREE.Mesh(forearmGeom, handSkinMat)
    forearm.rotation.x = Math.PI / 2
    forearm.position.set(0, 0, -0.18)
    forearm.castShadow = true
    elbowGroup.add(forearm)

    // Faint forearm musculature (a slightly darker stripe on the underside)
    const forearmMuscle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.24), handSkinDarkMat)
    forearmMuscle.position.set(0, -0.075, -0.19)
    elbowGroup.add(forearmMuscle)

    // WRIST — leather wrap band (survivor aesthetic, also hides seam)
    const wristBand = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.065, 16), leatherMat)
    wristBand.rotation.x = Math.PI / 2
    wristBand.position.set(0, 0, -0.38)
    elbowGroup.add(wristBand)
    // Tiny buckle on the wrist band
    const wristBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.022, 0.015), new THREE.MeshStandardMaterial({ color: 0x8a6b3d, roughness: 0.5, metalness: 0.4 }))
    wristBuckle.position.set(0, 0.08, -0.38)
    elbowGroup.add(wristBuckle)

    // HAND GROUP — closed fist with real finger segments
    const handGroup = new THREE.Group()
    handGroup.position.set(0, 0, -0.44)
    elbowGroup.add(handGroup)

    // Palm / back-of-hand box (slightly rounded-looking via chamfered proportions)
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.155, 0.14), handSkinMat)
    palm.position.set(0, 0, -0.06)
    palm.castShadow = true
    handGroup.add(palm)

    // Back-of-hand tendon relief (subtle lines running along the top)
    for (let t = 0; t < 3; t++) {
      const tendon = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.005, 0.095),
        handSkinDarkMat
      )
      tendon.position.set(-0.04 + t * 0.04, 0.08, -0.06)
      handGroup.add(tendon)
    }

    // 4 CURLED FINGERS — each has a knuckle bump on top of the hand, a
    // middle "curled down" segment on the front, and a tip that tucks
    // under toward the palm. Together they form the visible front of a
    // clenched fist.
    const fingerWidth = 0.036
    const fingerSpread = 0.036
    const fingerBaseX = -0.055
    for (let i = 0; i < 4; i++) {
      const fx = fingerBaseX + i * fingerSpread
      // Knuckle bump (visible on back-of-hand side)
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), handSkinMat)
      knuckle.position.set(fx, 0.065, -0.1)
      knuckle.castShadow = true
      handGroup.add(knuckle)
      // Proximal phalanx — short box curling down over the front of the fist
      const proximal = new THREE.Mesh(
        new THREE.BoxGeometry(fingerWidth, 0.06, 0.07),
        handSkinMat
      )
      proximal.position.set(fx, 0.025, -0.145)
      proximal.rotation.x = -0.35
      proximal.castShadow = true
      handGroup.add(proximal)
      // Middle phalanx — curled further under
      const middle = new THREE.Mesh(
        new THREE.BoxGeometry(fingerWidth, 0.055, 0.06),
        handSkinMat
      )
      middle.position.set(fx, -0.03, -0.17)
      middle.rotation.x = -1.0
      handGroup.add(middle)
      // Distal tip tucked into the palm (barely visible, adds depth)
      const tip = new THREE.Mesh(
        new THREE.BoxGeometry(fingerWidth * 0.92, 0.05, 0.045),
        handSkinMat
      )
      tip.position.set(fx, -0.06, -0.13)
      tip.rotation.x = -1.7
      handGroup.add(tip)
      // Tiny nail on the tip (just a lighter cap)
      const nail = new THREE.Mesh(
        new THREE.BoxGeometry(fingerWidth * 0.7, 0.015, 0.012),
        fingernailMat
      )
      nail.position.set(fx, -0.08, -0.115)
      nail.rotation.x = -1.7
      handGroup.add(nail)
    }

    // THUMB — two segments wrapping across the front of the fist from the
    // right side (anatomically correct for a right hand).
    const thumbProx = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.055, 0.075),
      handSkinMat
    )
    thumbProx.position.set(0.09, 0.0, -0.08)
    thumbProx.rotation.z = 0.55
    thumbProx.rotation.y = -0.2
    thumbProx.castShadow = true
    handGroup.add(thumbProx)
    const thumbDist = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.05, 0.065),
      handSkinMat
    )
    thumbDist.position.set(0.075, 0.005, -0.15)
    thumbDist.rotation.z = 0.4
    thumbDist.rotation.x = -0.35
    handGroup.add(thumbDist)
    // Thumbnail
    const thumbNail = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.012, 0.012),
      fingernailMat
    )
    thumbNail.position.set(0.06, 0.025, -0.178)
    thumbNail.rotation.z = 0.4
    handGroup.add(thumbNail)

    camera.add(fistGroup)

    // Building ghost
    let buildGhost: THREE.Mesh | null = null

    // ---------------------------------------------------------------------
    // Multiplayer world synchronization.
    // The React/network layer polls /api/servers/[id]/world and calls the
    // window hooks below.  The server elects one active client as the temporary
    // simulation authority; only that client advances enemy spawn timers and
    // uploads enemy snapshots.  All clients still publish discrete world events
    // (tree/stone breaks, item drops/pickups, structures) so the environment is
    // reconciled quickly for everyone on the same server.
    // ---------------------------------------------------------------------
    type WorldEvent = { id: string; type: string; payload: any }
    type EnemySnapshot = { id: string; kind: 'zombie' | 'vampire' | 'goblin' | 'orc'; x: number; y: number; z: number; hp: number; state?: string; fleeing?: boolean }
    const worldClientId = (() => {
      try {
        let id = window.localStorage.getItem('nightfall:worldClientId')
        if (!id) {
          id = `wc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
          window.localStorage.setItem('nightfall:worldClientId', id)
        }
        return id
      } catch {
        return `wc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      }
    })()
    let isWorldAuthority = false
    let lastWorldRevision = 0
    const pendingWorldEvents: WorldEvent[] = []
    const appliedWorldEvents = new Set<string>()
    const brokenResources = new Set<string>()
    const removedDropIds = new Set<string>()
    let pvpDeathDropped = false

    function makeNetId(prefix: string) {
      return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    }

    function resourceKey(kind: 'tree' | 'stone' | 'cactus', x: number, z: number) {
      return `${kind}:${x.toFixed(2)}:${z.toFixed(2)}`
    }

    function queueWorldEvent(type: string, payload: any) {
      const evt = { id: makeNetId('evt'), type, payload }
      // Local actions have already been applied immediately; marking the event
      // avoids double-applying it when the server echoes it back.
      appliedWorldEvents.add(evt.id)
      pendingWorldEvents.push(evt)
    }

    function removeResourceMesh(kind: 'tree' | 'stone' | 'cactus', x: number, z: number, animated = false) {
      const key = resourceKey(kind, x, z)
      brokenResources.add(key)
      for (const c of chunks.values()) {
        if (kind === 'tree') {
          const idx = c.trees.findIndex(t => resourceKey('tree', t.px, t.pz) === key)
          if (idx >= 0) {
            const t = c.trees[idx]
            t.collider = false
            c.trees.splice(idx, 1)
            if (animated) {
              const startQuat = t.mesh.quaternion.clone()
              const endQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2).multiply(startQuat)
              fallingTrees.push({ mesh: t.mesh, startQuat, endQuat, progress: 0, duration: 1.1, px: t.px, pz: t.pz, axisX: 0, axisZ: 1, landed: false, linger: 1.3, broken: false })
            } else if (t.mesh.parent) t.mesh.parent.remove(t.mesh)
          }
        } else if (kind === 'stone') {
          const idx = c.stones.findIndex(st => resourceKey('stone', st.px, st.pz) === key)
          if (idx >= 0) {
            const st = c.stones[idx]
            if (st.mesh.parent) st.mesh.parent.remove(st.mesh)
            c.stones.splice(idx, 1)
          }
        } else {
          const idx = c.cacti.findIndex(ca => resourceKey('cactus', ca.px, ca.pz) === key)
          if (idx >= 0) {
            const ca = c.cacti[idx]
            ca.collider = false
            c.cacti.splice(idx, 1)
            if (animated) {
              const dx = ca.px - playerPos.x
              const dz = ca.pz - playerPos.z
              const len = Math.hypot(dx, dz) || 1
              const axis = new THREE.Vector3(dz / len, 0, -dx / len).normalize()
              const startQuat = ca.mesh.quaternion.clone()
              const endQuat = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2).multiply(startQuat)
              fallingCacti.push({ mesh: ca.mesh, startQuat, endQuat, progress: 0, duration: 0.9, px: ca.px, pz: ca.pz, landed: false, linger: 1.35 })
            } else if (ca.mesh.parent) ca.mesh.parent.remove(ca.mesh)
          }
        }
      }
    }

    function applyBrokenResourcesToChunk(c: ChunkData) {
      for (let i = c.trees.length - 1; i >= 0; i--) {
        const tree = c.trees[i]
        if (tree && brokenResources.has(resourceKey('tree', tree.px, tree.pz))) {
          if (tree.mesh.parent) tree.mesh.parent.remove(tree.mesh)
          c.trees.splice(i, 1)
        }
      }
      for (let i = c.stones.length - 1; i >= 0; i--) {
        const stone = c.stones[i]
        if (stone && brokenResources.has(resourceKey('stone', stone.px, stone.pz))) {
          if (stone.mesh.parent) stone.mesh.parent.remove(stone.mesh)
          c.stones.splice(i, 1)
        }
      }
      for (let i = c.cacti.length - 1; i >= 0; i--) {
        const cactus = c.cacti[i]
        if (cactus && brokenResources.has(resourceKey('cactus', cactus.px, cactus.pz))) {
          if (cactus.mesh.parent) cactus.mesh.parent.remove(cactus.mesh)
          c.cacti.splice(i, 1)
        }
      }
    }

    // Zombies
    const zombies: Zombie[] = []
    function createZombie(x: number, y: number, z: number, id = makeNetId('z')): Zombie {
      const g = new THREE.Group()
      // More realistic, shaded materials with slight roughness variation
      const shirtMat = new THREE.MeshStandardMaterial({ color: 0x3f5c3a, roughness: 0.95, metalness: 0 })
      const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2c2418, roughness: 0.95, metalness: 0 })
      const skinMat = new THREE.MeshStandardMaterial({ color: 0x6f8e62, roughness: 0.85, metalness: 0 })
      const bloodMat = new THREE.MeshStandardMaterial({ color: 0x5c0e0e, roughness: 0.6, metalness: 0 })

      // Torso: shoulder-pivot at the top so whole body can lurch
      const torsoGroup = new THREE.Group()
      torsoGroup.position.y = 0.9
      g.add(torsoGroup)
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.4), shirtMat)
      body.castShadow = true
      torsoGroup.add(body)
      // Ragged tear across the chest (small darker strip)
      const tear = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.41), bloodMat)
      tear.position.set(0.05, 0.1, 0)
      torsoGroup.add(tear)
      // Small blood splatter on shirt
      const bs = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), bloodMat)
      bs.position.set(-0.18, -0.2, 0.21)
      bs.scale.set(1.3, 0.7, 0.05)
      torsoGroup.add(bs)

      // Head — cube w/ skin; separate so it can tilt independently
      const headGroup = new THREE.Group()
      headGroup.position.y = 1.7
      g.add(headGroup)
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skinMat)
      head.castShadow = true
      headGroup.add(head)
      // Sunken eye sockets (dark) + glowing red pupils
      const socketMat = new THREE.MeshStandardMaterial({ color: 0x1c1e16, roughness: 1 })
      const sockL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.04), socketMat)
      sockL.position.set(0.12, 0.04, 0.26)
      headGroup.add(sockL)
      const sockR = sockL.clone(); sockR.position.x = -0.12; headGroup.add(sockR)
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3020 })
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat)
      eye.position.set(0.12, 0.05, 0.28)
      headGroup.add(eye)
      const eye2 = eye.clone(); eye2.position.x = -0.12; headGroup.add(eye2)
      // Gnashed teeth / mouth gash
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.02), new THREE.MeshStandardMaterial({ color: 0x1a0b0b, roughness: 1 }))
      mouth.position.set(0, -0.12, 0.26)
      headGroup.add(mouth)
      // Tuft of matted hair
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a130b, roughness: 1 }))
      hair.position.y = 0.22
      hair.scale.set(1.02, 0.6, 1.02)
      headGroup.add(hair)

      // Arm groups — pivot at shoulder so rotation.x swings arm forward/back
      const armLGroup = new THREE.Group()
      armLGroup.position.set(0.48, 1.45, 0)
      g.add(armLGroup)
      const armLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.85, 0.2), skinMat)
      armLMesh.position.y = -0.42
      armLMesh.castShadow = true
      armLGroup.add(armLMesh)
      // Zombies hold arms forward Frankenstein-style by default
      armLGroup.rotation.x = -0.55

      const armRGroup = new THREE.Group()
      armRGroup.position.set(-0.48, 1.45, 0)
      g.add(armRGroup)
      const armRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.85, 0.2), skinMat)
      armRMesh.position.y = -0.42
      armRMesh.castShadow = true
      armRGroup.add(armRMesh)
      armRGroup.rotation.x = -0.55

      // Leg groups — pivot at hip
      const legLGroup = new THREE.Group()
      legLGroup.position.set(0.18, 0.85, 0)
      g.add(legLGroup)
      const legLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.85, 0.25), pantsMat)
      legLMesh.position.y = -0.43
      legLMesh.castShadow = true
      legLGroup.add(legLMesh)

      const legRGroup = new THREE.Group()
      legRGroup.position.set(-0.18, 0.85, 0)
      g.add(legRGroup)
      const legRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.85, 0.25), pantsMat)
      legRMesh.position.y = -0.43
      legRMesh.castShadow = true
      legRGroup.add(legRMesh)

      g.position.set(x, y, z)
      scene.add(g)
      return {
        id,
        mesh: g,
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(),
        hp: ZOMBIE_HEALTH,
        attackTimer: 0,
        hurtTimer: 0,
        armL: armLGroup,
        armR: armRGroup,
        legL: legLGroup,
        legR: legRGroup,
        body: torsoGroup,
        head: headGroup,
        walkPhase: Math.random() * Math.PI * 2,
      }
    }

    function removeZombie(z: Zombie) {
      scene.remove(z.mesh)
      z.mesh.traverse((obj: any) => { if (obj.geometry && !sharedGeos.has(obj.geometry)) obj.geometry.dispose?.(); if (obj.material && obj.material.dispose) obj.material.dispose() })
    }

    // --- Goblins (opportunistic thieves) ---
    const goblins: Goblin[] = []
    function createGoblin(x: number, y: number, z: number, id = makeNetId('g')): Goblin {
      const g = new THREE.Group()
      // Short green body, proportioned like a child. Now uses Standard materials
      // so it picks up scene lighting properly.
      const skinMat = new THREE.MeshStandardMaterial({ color: 0x5a7a34, roughness: 0.9, metalness: 0 })
      const vestMat = new THREE.MeshStandardMaterial({ color: 0x4a2a1a, roughness: 0.95, metalness: 0 })
      const pantMat = new THREE.MeshStandardMaterial({ color: 0x2e1d10, roughness: 0.95, metalness: 0 })

      // Body (torso group so we can bob it while running)
      const bodyGroup = new THREE.Group()
      bodyGroup.position.y = 0.55
      g.add(bodyGroup)
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.3), vestMat)
      body.castShadow = true
      bodyGroup.add(body)
      // Belt strap
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.32), new THREE.MeshStandardMaterial({ color: 0x1a0f07, roughness: 1 }))
      belt.position.y = -0.24
      bodyGroup.add(belt)

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.42), skinMat)
      head.position.y = 1.05
      head.castShadow = true
      g.add(head)
      // Pointy ears
      const earL = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 6), skinMat)
      earL.position.set(0.22, 1.15, 0)
      earL.rotation.z = -Math.PI / 2.2
      g.add(earL)
      const earR = earL.clone()
      earR.position.x = -0.22
      earR.rotation.z = Math.PI / 2.2
      g.add(earR)
      // Glowing yellow eyes
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffd040 }))
      eye.position.set(0.1, 1.08, 0.22)
      g.add(eye)
      const eye2 = eye.clone()
      eye2.position.x = -0.1
      g.add(eye2)
      // Fangs
      const fangMat = new THREE.MeshBasicMaterial({ color: 0xfffaec })
      const fangL = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 5), fangMat)
      fangL.position.set(0.05, 0.92, 0.22)
      fangL.rotation.x = Math.PI
      g.add(fangL)
      const fangR = fangL.clone(); fangR.position.x = -0.05; g.add(fangR)

      // Arms — shoulder pivot groups for swinging
      const armLGroup = new THREE.Group()
      armLGroup.position.set(0.3, 0.9, 0)
      g.add(armLGroup)
      const armLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.15), skinMat)
      armLMesh.position.y = -0.25
      armLMesh.castShadow = true
      armLGroup.add(armLMesh)
      const armRGroup = new THREE.Group()
      armRGroup.position.set(-0.3, 0.9, 0)
      g.add(armRGroup)
      const armRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.15), skinMat)
      armRMesh.position.y = -0.25
      armRMesh.castShadow = true
      armRGroup.add(armRMesh)

      // Legs — hip pivot groups
      const legLGroup = new THREE.Group()
      legLGroup.position.set(0.12, 0.45, 0)
      g.add(legLGroup)
      const legLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.45, 0.18), pantMat)
      legLMesh.position.y = -0.23
      legLMesh.castShadow = true
      legLGroup.add(legLMesh)
      const legRGroup = new THREE.Group()
      legRGroup.position.set(-0.12, 0.45, 0)
      g.add(legRGroup)
      const legRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.45, 0.18), pantMat)
      legRMesh.position.y = -0.23
      legRMesh.castShadow = true
      legRGroup.add(legRMesh)

      // A permanent little backpack that visually bulges as stolen loot is added.
      const backpackGroup = new THREE.Group()
      backpackGroup.position.set(0, 0.72, -0.24)
      const backpackMat = new THREE.MeshStandardMaterial({ color: 0x6b451f, roughness: 0.95, metalness: 0 })
      const backpackBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.16), backpackMat)
      backpackBody.castShadow = true
      backpackGroup.add(backpackBody)
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.175), new THREE.MeshStandardMaterial({ color: 0x3b2410, roughness: 1 }))
      flap.position.y = 0.17
      backpackGroup.add(flap)
      const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.43, 0.03), new THREE.MeshStandardMaterial({ color: 0x201007, roughness: 1 }))
      strapL.position.set(0.12, 0, 0.095)
      backpackGroup.add(strapL)
      const strapR = strapL.clone(); strapR.position.x = -0.12; backpackGroup.add(strapR)
      g.add(backpackGroup)

      g.position.set(x, y, z)
      scene.add(g)
      return {
        id,
        mesh: g,
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(),
        hp: GOBLIN_HEALTH,
        hurtTimer: 0,
        phase: 'approach',
        fleeDir: new THREE.Vector2(),
        grabTimer: 0,
        stolen: null,
        backpack: { items: [], mesh: backpackGroup },
        armL: armLGroup,
        armR: armRGroup,
        legL: legLGroup,
        legR: legRGroup,
        body: bodyGroup,
        walkPhase: Math.random() * Math.PI * 2,
      }
    }

    function removeGoblin(g: Goblin) {
      scene.remove(g.mesh)
      g.mesh.traverse((obj: any) => { if (obj.geometry && !sharedGeos.has(obj.geometry)) obj.geometry.dispose?.(); if (obj.material && obj.material.dispose) obj.material.dispose() })
    }

    function addToGoblinBackpack(g: Goblin, id: ItemId, count: number) {
      const existing = g.backpack.items.find(item => item.id === id)
      if (existing) existing.count += count
      else g.backpack.items.push({ id, count })
      const total = g.backpack.items.reduce((sum, item) => sum + item.count, 0)
      const bulge = Math.min(0.32, total * 0.045)
      g.backpack.mesh.scale.set(1 + bulge, 1 + bulge * 0.65, 1 + bulge)
    }

    function dropGoblinBackpack(g: Goblin) {
      if (g.backpack.items.length === 0) return 0
      let offset = 0
      for (const item of g.backpack.items) {
        dropItemToWorld(item.id, item.count, g.pos.x + offset, g.pos.y + 0.55, g.pos.z - offset)
        offset += 0.25
      }
      return g.backpack.items.reduce((sum, item) => sum + item.count, 0)
    }

    function findGoblinHit(ray: THREE.Raycaster) {
      let best: { goblin: Goblin; distance: number } | null = null
      const rayOrigin = ray.ray.origin
      const rayDir = ray.ray.direction
      for (const gb of goblins) {
        const meshHits = ray.intersectObject(gb.mesh, true)
        if (meshHits.length && meshHits[0].distance < REACH) {
          if (!best || meshHits[0].distance < best.distance) best = { goblin: gb, distance: meshHits[0].distance }
          continue
        }

        // Fallback capsule-style hit test for the tiny, fast goblin. The old
        // pure mesh raycast was unforgiving because the goblin is below the
        // player's eye-line; this generous capsule makes center-crosshair hits
        // register reliably without letting players hit through long distances.
        const capsuleCenter = new THREE.Vector3(gb.pos.x, gb.pos.y + 0.72, gb.pos.z)
        const toCenter = new THREE.Vector3().subVectors(capsuleCenter, rayOrigin)
        const along = toCenter.dot(rayDir)
        if (along < 0 || along > REACH + 0.4) continue
        const closest = new THREE.Vector3().copy(rayOrigin).addScaledVector(rayDir, along)
        const miss = closest.distanceTo(capsuleCenter)
        const horizontalDist = Math.hypot(gb.pos.x - playerPos.x, gb.pos.z - playerPos.z)
        if (miss <= 0.78 && horizontalDist <= REACH + 0.9) {
          if (!best || along < best.distance) best = { goblin: gb, distance: along }
        }
      }
      return best
    }

    // --- Vampires (boss-class night enemies) ---
    const vampires: Vampire[] = []
    function createVampire(x: number, y: number, z: number, id = makeNetId('v')): Vampire {
      const g = new THREE.Group()
      // Tall gaunt vampire with dark cape.
      const skinMat = new THREE.MeshStandardMaterial({ color: 0xe8dccd, roughness: 0.6, metalness: 0 })
      const coatMat = new THREE.MeshStandardMaterial({ color: 0x15050a, roughness: 0.8, metalness: 0.1 })
      const capeMat = new THREE.MeshStandardMaterial({ color: 0x2a0612, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide })
      const hairMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9, metalness: 0 })
      const eyeGlowMat = new THREE.MeshBasicMaterial({ color: 0xff1830 })
      // Torso (long, dark)
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 1.3, 14), coatMat)
      torso.position.y = 1.2
      torso.castShadow = true
      g.add(torso)
      // Shoulders
      const shoulderGeo = new THREE.SphereGeometry(0.16, 10, 8)
      const shL = new THREE.Mesh(shoulderGeo, coatMat); shL.position.set(0.35, 1.75, 0); g.add(shL)
      const shR = new THREE.Mesh(shoulderGeo, coatMat); shR.position.set(-0.35, 1.75, 0); g.add(shR)
      // Arms — shoulder pivot groups so they can swing while gliding
      const armGeo = new THREE.CylinderGeometry(0.1, 0.09, 0.85, 10)
      const armLGroup = new THREE.Group()
      armLGroup.position.set(0.4, 1.75, 0)
      g.add(armLGroup)
      const armLMesh = new THREE.Mesh(armGeo, coatMat)
      armLMesh.position.y = -0.42
      armLMesh.castShadow = true
      armLGroup.add(armLMesh)
      // Pale hand at end of arm
      const handGeo = new THREE.SphereGeometry(0.1, 10, 8)
      const hL = new THREE.Mesh(handGeo, skinMat)
      hL.position.y = -0.88
      armLGroup.add(hL)
      armLGroup.rotation.x = -0.3
      const armRGroup = new THREE.Group()
      armRGroup.position.set(-0.4, 1.75, 0)
      g.add(armRGroup)
      const armRMesh = new THREE.Mesh(armGeo, coatMat)
      armRMesh.position.y = -0.42
      armRMesh.castShadow = true
      armRGroup.add(armRMesh)
      const hR = new THREE.Mesh(handGeo, skinMat)
      hR.position.y = -0.88
      armRGroup.add(hR)
      armRGroup.rotation.x = -0.3
      // Legs — hip pivot groups
      const legGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.95, 10)
      const legLGroup = new THREE.Group()
      legLGroup.position.set(0.15, 0.95, 0)
      g.add(legLGroup)
      const legLMesh = new THREE.Mesh(legGeo, coatMat)
      legLMesh.position.y = -0.48
      legLGroup.add(legLMesh)
      const legRGroup = new THREE.Group()
      legRGroup.position.set(-0.15, 0.95, 0)
      g.add(legRGroup)
      const legRMesh = new THREE.Mesh(legGeo, coatMat)
      legRMesh.position.y = -0.48
      legRGroup.add(legRMesh)
      // Head (pale gaunt, slightly elongated)
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), skinMat)
      head.scale.set(0.9, 1.15, 0.95)
      head.position.y = 2.1
      head.castShadow = true
      g.add(head)
      // Slicked-back hair
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), hairMat)
      hair.position.y = 2.14
      hair.scale.set(1, 1, 1.1)
      g.add(hair)
      // Glowing red eyes
      const eyeGeo = new THREE.SphereGeometry(0.035, 8, 6)
      const eyeL = new THREE.Mesh(eyeGeo, eyeGlowMat); eyeL.position.set(0.07, 2.12, 0.2); g.add(eyeL)
      const eyeR = new THREE.Mesh(eyeGeo, eyeGlowMat); eyeR.position.set(-0.07, 2.12, 0.2); g.add(eyeR)
      // Fang visible as tiny white cone
      const fangMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
      const fangGeo = new THREE.ConeGeometry(0.018, 0.06, 6)
      const fangL = new THREE.Mesh(fangGeo, fangMat); fangL.position.set(0.04, 1.99, 0.2); fangL.rotation.x = Math.PI; g.add(fangL)
      const fangR = new THREE.Mesh(fangGeo, fangMat); fangR.position.set(-0.04, 1.99, 0.2); fangR.rotation.x = Math.PI; g.add(fangR)
      // Dramatic cape: curved plane behind the shoulders
      const capeGeo = new THREE.PlaneGeometry(1.2, 1.6, 6, 8)
      const capePos = capeGeo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < capePos.count; i++) {
        const y = capePos.getY(i)
        const x = capePos.getX(i)
        // curve it around the back
        capePos.setZ(i, -Math.cos((x / 0.6) * 1.2) * 0.25 - (y > 0 ? 0 : 0.05))
      }
      capeGeo.computeVertexNormals()
      const cape = new THREE.Mesh(capeGeo, capeMat)
      cape.position.set(0, 1.4, -0.25)
      cape.castShadow = true
      g.add(cape)
      // Subtle point-light so vampire casts a red glow as it approaches
      const aura = new THREE.PointLight(0x7a0019, 1.2, 6, 2)
      aura.position.set(0, 1.6, 0)
      g.add(aura)
      g.position.set(x, y, z)
      scene.add(g)
      return {
        id,
        mesh: g,
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(),
        hp: VAMPIRE_HEALTH,
        attackTimer: 0,
        hurtTimer: 0,
        fleeing: false,
        fleeTimer: 0,
        cape,
        armL: armLGroup,
        armR: armRGroup,
        legL: legLGroup,
        legR: legRGroup,
        walkPhase: Math.random() * Math.PI * 2,
      }
    }

    function removeVampire(v: Vampire) {
      scene.remove(v.mesh)
      if (v.bat) scene.remove(v.bat)
      v.mesh.traverse((obj: any) => {
        if (obj.geometry && !sharedGeos.has(obj.geometry)) obj.geometry.dispose?.()
        if (obj.material && obj.material.dispose) obj.material.dispose()
      })
      if (v.bat) {
        v.bat.traverse((obj: any) => {
          if (obj.geometry) obj.geometry.dispose?.()
          if (obj.material && obj.material.dispose) obj.material.dispose()
        })
      }
    }

    function spawnVampire(id = makeNetId('v'), announce = true, sx?: number, sz?: number) {
      if (!isNightTimeValue(timeOfDayAcc)) return
      if (vampires.some(v => v.id === id) || vampires.length >= MAX_VAMPIRES) return
      // Spawn on the surface only — never in cave entrances.
      const spawn = findSurfaceSpawnPoint(55, 20, sx, sz)
      if (!spawn) return
      const { x, z } = spawn
      const y = heightAt(x, z)
      const v = createVampire(x, y, z, id)
      vampires.push(v)
      if (announce) queueWorldEvent('enemy_spawn', { id, kind: 'vampire', x, y, z })
      useGame.getState().showToast('🦇 A vampire stalks you...')
    }

    // --- Huge Green Orc Boss ---
    const orcs: OrcBoss[] = []

    function createOrc(x: number, y: number, z: number, id = makeNetId('o')): OrcBoss {
      const g = new THREE.Group()
      const skinMat = new THREE.MeshStandardMaterial({ color: 0x2f8f34, roughness: 0.82, metalness: 0 })
      const darkSkinMat = new THREE.MeshStandardMaterial({ color: 0x1f6126, roughness: 0.95, metalness: 0 })
      const leatherMat = new THREE.MeshStandardMaterial({ color: 0x4b2e17, roughness: 0.9, metalness: 0 })
      const toothMat = new THREE.MeshStandardMaterial({ color: 0xf4edcf, roughness: 0.5, metalness: 0 })
      const weakMat = new THREE.MeshBasicMaterial({ color: 0xff3b1f })
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x6a401c, roughness: 0.85, metalness: 0 })
      const spikeMat = new THREE.MeshStandardMaterial({ color: 0x38220f, roughness: 0.8, metalness: 0 })

      const bodyGroup = new THREE.Group()
      bodyGroup.position.y = 1.75
      g.add(bodyGroup)
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.05, 2.1, 14), skinMat)
      torso.castShadow = true
      bodyGroup.add(torso)
      const belly = new THREE.Mesh(new THREE.SphereGeometry(0.78, 16, 10), darkSkinMat)
      belly.position.set(0, -0.25, 0.18)
      belly.scale.set(1.05, 0.8, 0.42)
      belly.castShadow = true
      bodyGroup.add(belly)
      const belt = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.18, 1.15), leatherMat)
      belt.position.y = -0.95
      bodyGroup.add(belt)

      const headGroup = new THREE.Group()
      headGroup.position.y = 3.05
      g.add(headGroup)
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.95, 1.05), skinMat)
      head.castShadow = true
      headGroup.add(head)
      const brow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.12), darkSkinMat)
      brow.position.set(0, 0.16, 0.57)
      headGroup.add(brow)
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff066 })
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), eyeMat)
      eyeL.position.set(0.28, 0.06, 0.58)
      headGroup.add(eyeL)
      const eyeR = eyeL.clone(); eyeR.position.x = -0.28; headGroup.add(eyeR)
      const jawGroup = new THREE.Group()
      jawGroup.position.set(0, -0.22, 0.56)
      headGroup.add(jawGroup)
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.12), darkSkinMat)
      jawGroup.add(jaw)
      const tuskL = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 8), toothMat)
      tuskL.position.set(0.24, -0.12, 0.06)
      tuskL.rotation.x = Math.PI
      jawGroup.add(tuskL)
      const tuskR = tuskL.clone(); tuskR.position.x = -0.24; jawGroup.add(tuskR)

      const armLGroup = new THREE.Group(); armLGroup.position.set(0.92, 2.55, 0); g.add(armLGroup)
      const armRGroup = new THREE.Group(); armRGroup.position.set(-0.92, 2.55, 0); g.add(armRGroup)
      const armGeo = new THREE.CylinderGeometry(0.22, 0.28, 1.65, 10)
      const armL = new THREE.Mesh(armGeo, skinMat); armL.position.y = -0.78; armL.castShadow = true; armLGroup.add(armL)
      const armR = new THREE.Mesh(armGeo, skinMat); armR.position.y = -0.78; armR.castShadow = true; armRGroup.add(armR)
      const clubGroup = new THREE.Group()
      clubGroup.position.set(0, -1.25, 0.1)
      armRGroup.add(clubGroup)
      const clubHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.45, 9), woodMat)
      clubHandle.rotation.x = 0.22
      clubGroup.add(clubHandle)
      const clubHead = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 0.95, 9), woodMat)
      clubHead.position.y = -0.82
      clubHead.castShadow = true
      clubGroup.add(clubHead)
      for (let i = 0; i < 6; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 6), spikeMat)
        const a = (i / 6) * Math.PI * 2
        spike.position.set(Math.cos(a) * 0.28, -0.82 + (i % 3 - 1) * 0.18, Math.sin(a) * 0.28)
        spike.lookAt(new THREE.Vector3(Math.cos(a), spike.position.y, Math.sin(a)))
        clubGroup.add(spike)
      }

      const legLGroup = new THREE.Group(); legLGroup.position.set(0.43, 0.95, 0); g.add(legLGroup)
      const legRGroup = new THREE.Group(); legRGroup.position.set(-0.43, 0.95, 0); g.add(legRGroup)
      const legGeo = new THREE.CylinderGeometry(0.26, 0.34, 1.65, 10)
      const legL = new THREE.Mesh(legGeo, darkSkinMat); legL.position.y = -0.8; legL.castShadow = true; legLGroup.add(legL)
      const legR = new THREE.Mesh(legGeo, darkSkinMat); legR.position.y = -0.8; legR.castShadow = true; legRGroup.add(legR)

      const weakSpots: OrcWeakSpot[] = []
      const makeWeakSpot = (name: string, parent: THREE.Object3D, px: number, py: number, pz: number, scale = 1) => {
        const spot = new THREE.Mesh(new THREE.SphereGeometry(0.13 * scale, 12, 8), weakMat)
        spot.position.set(px, py, pz)
        spot.userData.orcWeakSpot = name
        parent.add(spot)
        weakSpots.push({ mesh: spot, name, active: true })
      }
      makeWeakSpot('head', headGroup, 0, 0.12, 0.63, 1.1)
      makeWeakSpot('heart', bodyGroup, 0.26, 0.28, 0.78, 1.15)
      makeWeakSpot('left knee', legLGroup, 0, -0.55, 0.28, 0.9)
      makeWeakSpot('right knee', legRGroup, 0, -0.55, 0.28, 0.9)

      const aura = new THREE.PointLight(0x39ff45, 1.4, 8, 2)
      aura.position.set(0, 2.4, 0)
      g.add(aura)
      g.position.set(x, y, z)
      scene.add(g)
      return {
        id,
        mesh: g,
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(),
        hp: ORC_HEALTH,
        state: 'roaring',
        stateTimer: 2.2,
        attackTimer: 1.2,
        grabCooldown: 8,
        hurtTimer: 0,
        walkPhase: Math.random() * Math.PI * 2,
        weakSpots,
        body: bodyGroup,
        head: headGroup,
        jaw: jawGroup,
        armL: armLGroup,
        armR: armRGroup,
        legL: legLGroup,
        legR: legRGroup,
        club: clubGroup,
      }
    }

    function removeOrc(o: OrcBoss) {
      scene.remove(o.mesh)
      o.mesh.traverse((obj: any) => { if (obj.geometry && !sharedGeos.has(obj.geometry)) obj.geometry.dispose?.(); if (obj.material && obj.material.dispose) obj.material.dispose() })
    }

    function caveSpecNear(x: number, z: number, margin = 0) {
      const ccx = Math.floor(x / CHUNK_SIZE)
      const ccz = Math.floor(z / CHUNK_SIZE)
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const spec = caveSpecForChunk(ccx + ox, ccz + oz)
          if (!spec) continue
          if (Math.hypot(x - spec.x, z - spec.z) <= spec.radius + margin) return spec
        }
      }
      return null
    }

    function findSurfaceSpawnPoint(minDist: number, extraDist: number, sx?: number, sz?: number) {
      if (typeof sx === 'number' && typeof sz === 'number') {
        if (caveSpecNear(sx, sz, 1.5)) return null
        return { x: sx, z: sz }
      }
      for (let attempt = 0; attempt < 12; attempt++) {
        const angle = Math.random() * Math.PI * 2
        const dist = minDist + Math.random() * extraDist
        const x = playerPos.x + Math.cos(angle) * dist
        const z = playerPos.z + Math.sin(angle) * dist
        if (caveSpecNear(x, z, 1.5)) continue
        return { x, z }
      }
      return null
    }

    function findLoadedCaveForOrc() {
      const candidates: { x: number; y: number; z: number; radius: number; yaw: number; d2: number }[] = []
      for (const c of chunks.values()) {
        for (const cave of c.caves) {
          const dx = cave.x - playerPos.x
          const dz = cave.z - playerPos.z
          const d2 = dx * dx + dz * dz
          if (d2 < 16 * 16 || d2 > 135 * 135) continue
          candidates.push({ ...cave, d2 })
        }
      }
      if (!candidates.length) return null
      candidates.sort((a, b) => a.d2 - b.d2)
      return candidates[Math.min(candidates.length - 1, Math.floor(Math.random() * Math.min(3, candidates.length)))]
    }

    function spawnOrc(id = makeNetId('o'), announce = true, sx?: number, sz?: number) {
      if (!isNightTimeValue(timeOfDayAcc)) return false
      if (orcs.some(o => o.id === id) || orcs.length >= MAX_ORCS) return false
      const cave = typeof sx === 'number' && typeof sz === 'number' ? caveSpecNear(sx, sz, 1.2) : findLoadedCaveForOrc()
      if (!cave) return false
      const inwardX = Math.sin(cave.yaw) * cave.radius * 0.25
      const inwardZ = Math.cos(cave.yaw) * cave.radius * 0.25
      const x = sx ?? (cave.x + inwardX)
      const z = sz ?? (cave.z + inwardZ)
      if (!caveSpecNear(x, z, 1.2)) return false
      const y = heightAt(x, z)
      orcs.push(createOrc(x, y, z, id))
      if (announce) queueWorldEvent('enemy_spawn', { id, kind: 'orc', x, y, z })
      useGame.getState().showToast('👹 A huge green orc boss roars from a cave!')
      return true
    }

    function knockDownOrc(o: OrcBoss, reason = 'weak spot') {
      if (o.state === 'down' || o.state === 'dying') return
      o.state = 'down'
      o.stateTimer = 5.2
      o.vel.set(0, 0, 0)
      o.mesh.rotation.z = 1.22
      o.mesh.position.y = o.pos.y + 0.35
      useGame.getState().showToast(`💥 Orc ${reason} hit! It crashes down — strike now!`)
    }

    function damageOrc(o: OrcBoss, amount: number, weak = false) {
      if (o.state === 'dying') return
      const finalDamage = o.state === 'down' ? amount * 1.55 : weak ? amount * 1.25 : amount
      o.hp -= finalDamage
      o.hurtTimer = 0.22
      if (weak) knockDownOrc(o)
      if (o.hp <= 0) {
        o.state = 'dying'
        o.stateTimer = 2.1
        o.vel.set(0, 0, 0)
        useGame.getState().showToast('👑 The huge orc boss is falling!')
      }
    }

    // Build a small bat that replaces the vampire when dawn breaks.
    function makeBat(position: THREE.Vector3): THREE.Group {
      const bat = new THREE.Group()
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a0a12, roughness: 0.9 })
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), bodyMat)
      body.scale.set(1, 0.9, 1.2)
      body.castShadow = true
      bat.add(body)
      const wingMat = new THREE.MeshStandardMaterial({ color: 0x2a0612, roughness: 0.85, side: THREE.DoubleSide })
      const wingGeo = new THREE.PlaneGeometry(0.45, 0.25, 2, 2)
      const wL = new THREE.Mesh(wingGeo, wingMat); wL.position.set(0.3, 0, 0); bat.add(wL)
      const wR = new THREE.Mesh(wingGeo, wingMat); wR.position.set(-0.3, 0, 0); bat.add(wR)
      bat.position.copy(position)
      ;(bat as any).wL = wL
      ;(bat as any).wR = wR
      scene.add(bat)
      return bat
    }

    // ---- Realistic wall helpers ----
    // Each wall type is built as a Group with visible detail meshes plus
    // a damage overlay (2 planes, one per face) and a health bar sprite.
    // Shared: pre-rendered progressive crack textures (Undamaged/Light/Medium/Heavy).
    function makeCrackTexture(level: number): THREE.Texture {
      // Produces progressive "tear mark" damage overlays — groups of
      // parallel slashes / gashes (like something clawed/tore through
      // the wall). Higher level = more groups, longer tears, and
      // torn-open gaps with jagged splinter edges.
      const size = 256
      const cvs = document.createElement('canvas')
      cvs.width = cvs.height = size
      const ctx = cvs.getContext('2d')!
      ctx.clearRect(0, 0, size, size)
      if (level > 0) {
        // Deterministic-ish but varied per level using level-based seed feel.
        const rng = (() => {
          let s = Math.floor(level * 997 + 17)
          return () => {
            s = (s * 9301 + 49297) % 233280
            return s / 233280
          }
        })()
        // Number of tear groups scales with damage
        const tearGroups = Math.max(1, Math.round(1 + level * 3.5))
        // Draw a single tear group = 3-4 nearly-parallel slashes
        const drawTearGroup = (cx: number, cy: number, angle: number, reach: number, strokeCount: number) => {
          const dirX = Math.cos(angle), dirY = Math.sin(angle)
          const perpX = -dirY, perpY = dirX
          for (let s = 0; s < strokeCount; s++) {
            // Offset each parallel slash slightly from the group center
            const off = (s - (strokeCount - 1) / 2) * (6 + rng() * 4)
            const x0 = cx - dirX * reach / 2 + perpX * off + (rng() - 0.5) * 4
            const y0 = cy - dirY * reach / 2 + perpY * off + (rng() - 0.5) * 4
            const x1 = cx + dirX * reach / 2 + perpX * off + (rng() - 0.5) * 4
            const y1 = cy + dirY * reach / 2 + perpY * off + (rng() - 0.5) * 4
            // Outer soft halo — hint of torn material around the slash
            ctx.strokeStyle = `rgba(20,14,10,${0.25 + level * 0.25})`
            ctx.lineWidth = 5 + level * 5
            ctx.lineCap = 'round'
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
            // Core dark gash
            ctx.strokeStyle = `rgba(0,0,0,${0.8 + level * 0.2})`
            ctx.lineWidth = 2 + level * 2.5
            ctx.lineCap = 'round'
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
            // Thin inner highlight (lighter, shows depth in the gash)
            ctx.strokeStyle = `rgba(90,70,55,${0.35 + level * 0.25})`
            ctx.lineWidth = 0.9
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
            // Jagged splinter edges poking out at each end (torn wood feel)
            for (let sp = 0; sp < 3 + Math.floor(level * 3); sp++) {
              const t = sp / 5
              const px = x0 + (x1 - x0) * t
              const py = y0 + (y1 - y0) * t
              const jx = perpX * (rng() - 0.5) * (6 + level * 10)
              const jy = perpY * (rng() - 0.5) * (6 + level * 10)
              ctx.strokeStyle = `rgba(5,3,2,${0.5 + level * 0.3})`
              ctx.lineWidth = 0.8 + rng() * 0.8
              ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + jx, py + jy); ctx.stroke()
            }
          }
        }
        for (let g = 0; g < tearGroups; g++) {
          const cx = 30 + rng() * (size - 60)
          const cy = 30 + rng() * (size - 60)
          // Mostly diagonal angles (like a claw swipe) but vary per group
          const base = (rng() < 0.5) ? -Math.PI / 4 : Math.PI / 4
          const angle = base + (rng() - 0.5) * 0.7
          const reach = size * (0.25 + level * 0.35) * (0.8 + rng() * 0.5)
          const strokes = 3 + (rng() < 0.5 ? 0 : 1)
          drawTearGroup(cx, cy, angle, reach, strokes)
        }
        // At heavier damage, punch out "hole" patches where the wall
        // is torn open — dark irregular blotches with ragged edges.
        if (level > 0.45) {
          const holes = Math.floor((level - 0.3) * 8)
          for (let i = 0; i < holes; i++) {
            const hx = 30 + rng() * (size - 60)
            const hy = 30 + rng() * (size - 60)
            const rr = 10 + rng() * 20 * level
            ctx.fillStyle = `rgba(3,2,1,${0.7 + level * 0.25})`
            ctx.beginPath()
            // Irregular polygon hole
            const pts = 10 + Math.floor(rng() * 6)
            for (let p = 0; p < pts; p++) {
              const a = (p / pts) * Math.PI * 2
              const r = rr * (0.65 + rng() * 0.7)
              const x = hx + Math.cos(a) * r
              const y = hy + Math.sin(a) * r
              if (p === 0) ctx.moveTo(x, y)
              else ctx.lineTo(x, y)
            }
            ctx.closePath(); ctx.fill()
            // Ragged splinters around the hole rim
            for (let sp = 0; sp < 8; sp++) {
              const a = rng() * Math.PI * 2
              const r1 = rr * 0.8
              const r2 = rr * (1.1 + rng() * 0.5)
              ctx.strokeStyle = `rgba(0,0,0,${0.6 + level * 0.3})`
              ctx.lineWidth = 0.8 + rng() * 0.9
              ctx.beginPath()
              ctx.moveTo(hx + Math.cos(a) * r1, hy + Math.sin(a) * r1)
              ctx.lineTo(hx + Math.cos(a) * r2, hy + Math.sin(a) * r2)
              ctx.stroke()
            }
          }
        }
      }
      const tex = new THREE.CanvasTexture(cvs)
      tex.needsUpdate = true
      return tex
    }
    const crackTextures: THREE.Texture[] = [
      makeCrackTexture(0.0),
      makeCrackTexture(0.25),
      makeCrackTexture(0.5),
      makeCrackTexture(0.85),
    ]
    // Shared vertical & horizontal damage overlay planes — keyed by wall shape
    // to avoid re-creating on every wall. We still make per-wall materials so
    // we can fade opacity independently.
    function damageLevelForRatio(ratio: number): number {
      if (ratio >= 1.0) return 0
      if (ratio >= 0.7) return 1
      if (ratio >= 0.4) return 2
      return 3
    }
    // ---- Health bar sprite ----
    function makeHealthBarCanvas() {
      const cvs = document.createElement('canvas')
      cvs.width = 160; cvs.height = 20
      return cvs
    }
    function updateHealthBarCanvas(cvs: HTMLCanvasElement, ratio: number) {
      const ctx = cvs.getContext('2d')!
      const W = cvs.width, H = cvs.height
      ctx.clearRect(0, 0, W, H)
      // Outer frame
      ctx.fillStyle = 'rgba(0,0,0,0.82)'
      ctx.fillRect(0, 0, W, H)
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = 2
      ctx.strokeRect(1, 1, W - 2, H - 2)
      const r = Math.max(0, Math.min(1, ratio))
      const fillW = Math.floor((W - 6) * r)
      // color: green → yellow → red
      const cr = Math.round(220 - 160 * r)
      const cg = Math.round(60 + 180 * r)
      const cb = 50
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`
      ctx.fillRect(3, 3, fillW, H - 6)
      // Tick marks
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = 1
      for (let i = 1; i < 4; i++) {
        const tx = 3 + Math.floor(((W - 6) * i) / 4)
        ctx.beginPath()
        ctx.moveTo(tx, 2); ctx.lineTo(tx, H - 2); ctx.stroke()
      }
    }
    function buildHealthBarSprite(topY: number): { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
      const canvas = makeHealthBarCanvas()
      updateHealthBarCanvas(canvas, 1)
      const tex = new THREE.CanvasTexture(canvas)
      tex.needsUpdate = true
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.set(1.6, 0.22, 1)
      sprite.position.y = topY + 0.35
      sprite.visible = false // only show when damaged
      sprite.renderOrder = 999
      return { sprite, canvas, tex }
    }
    // ---- Wall builders ----
    // All wall groups: width along local X (2m), thickness along local Z, height along Y.
    // Centre of group is the visual centre of the wall — callers position it
    // by storing y = groundY + halfHeight so the wall sits flush with ground.
    function buildWoodWallGroup() {
      const g = new THREE.Group()
      // wall dimensions
      const W = 2, H = 2.4, T = 0.22
      // 5 vertical planks with slight gaps + colour variation
      const plankCount = 5
      const plankW = (W - 0.02) / plankCount
      for (let i = 0; i < plankCount; i++) {
        const geo = new THREE.BoxGeometry(plankW * 0.96, H, T)
        const mat = (i % 2 === 0) ? woodWallPlankMat : woodWallPlankAltMat
        const m = new THREE.Mesh(geo, mat)
        m.castShadow = true; m.receiveShadow = true
        const px = -W / 2 + plankW / 2 + i * plankW
        m.position.set(px, 0, 0)
        g.add(m)
      }
      // 2 horizontal cross-beams (front + back)
      const beamGeo = new THREE.BoxGeometry(W, 0.2, T + 0.08)
      for (const by of [H / 2 - 0.28, -H / 2 + 0.28]) {
        const m = new THREE.Mesh(beamGeo, woodWallBeamMat)
        m.castShadow = true; m.receiveShadow = true
        m.position.set(0, by, 0)
        g.add(m)
      }
      // Nail heads — small dark dots on beam ends, 8 total (4 per face)
      const nailGeo = new THREE.SphereGeometry(0.035, 6, 5)
      for (const by of [H / 2 - 0.28, -H / 2 + 0.28]) {
        for (const bx of [-W / 2 + 0.15, W / 2 - 0.15]) {
          for (const bz of [T / 2 + 0.04, -T / 2 - 0.04]) {
            const n = new THREE.Mesh(nailGeo, nailMat)
            n.position.set(bx, by, bz)
            g.add(n)
          }
        }
      }
      ;(g as any).__wallBounds = { W, H, T }
      return g
    }
    function buildLogWallGroup() {
      // 4 horizontal stacked logs — cylinders along local X
      const g = new THREE.Group()
      const W = 2, H = 2.8, T = 0.42
      const logDiam = H / 4 - 0.01
      const logR = logDiam / 2
      const logGeo = new THREE.CylinderGeometry(logR, logR, W, 12)
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(logGeo, logWallMat)
        m.castShadow = true; m.receiveShadow = true
        // Rotate so cylinder axis lies along X
        m.rotation.z = Math.PI / 2
        m.position.set(0, -H / 2 + logR + i * logDiam, 0)
        g.add(m)
        // End-grain cap (darker) — small disks on the two log ends
        const capGeo = new THREE.CircleGeometry(logR * 0.9, 10)
        for (const sx of [-W / 2 + 0.001, W / 2 - 0.001]) {
          const cap = new THREE.Mesh(capGeo, logDropCoreMat)
          cap.position.set(sx, -H / 2 + logR + i * logDiam, 0)
          cap.rotation.y = sx < 0 ? -Math.PI / 2 : Math.PI / 2
          g.add(cap)
        }
      }
      ;(g as any).__wallBounds = { W, H, T }
      return g
    }
    function buildStoneWallGroup() {
      // Stone block wall — 4 rows of offset bricks
      const g = new THREE.Group()
      const W = 2, H = 2.6, T = 0.4
      const rows = 5
      const rowH = H / rows
      // Mortar back-plane (so gaps show darker)
      const backGeo = new THREE.BoxGeometry(W, H, T * 0.55)
      const back = new THREE.Mesh(backGeo, mortarMat)
      back.position.set(0, 0, 0)
      back.receiveShadow = true
      g.add(back)
      for (let r = 0; r < rows; r++) {
        const offset = (r % 2) * 0.5
        const blocksPerRow = (r % 2 === 0) ? 4 : 5
        const blockW = W / (r % 2 === 0 ? 4 : 4)
        for (let i = 0; i < blocksPerRow; i++) {
          let bx: number
          let bw: number
          if (r % 2 === 0) {
            // 4 full-width blocks
            bw = blockW * 0.94
            bx = -W / 2 + blockW / 2 + i * blockW
          } else {
            // 5 blocks: 2 half-blocks at ends + 3 full blocks in middle (offset bond)
            bw = (i === 0 || i === 4) ? blockW / 2 * 0.92 : blockW * 0.94
            if (i === 0) bx = -W / 2 + (blockW / 4)
            else if (i === 4) bx = W / 2 - (blockW / 4)
            else bx = -W / 2 + blockW * (i - 0.5)
          }
          const bh = rowH * 0.9
          const bt = T * 0.95
          const bgeo = new THREE.BoxGeometry(bw, bh, bt)
          // Alternate block material for visual noise
          const matIdx = (r + i) % 3
          const bmat = matIdx === 0 ? stoneBlockMat : matIdx === 1 ? stoneBlockAltMat : stoneBlockDarkMat
          const m = new THREE.Mesh(bgeo, bmat)
          m.castShadow = true; m.receiveShadow = true
          m.position.set(bx, -H / 2 + rowH / 2 + r * rowH, 0)
          // Tiny random tilt / depth offset for texture
          m.position.z = (Math.random() - 0.5) * 0.03
          m.rotation.z = (Math.random() - 0.5) * 0.015
          g.add(m)
        }
      }
      // Capstones — slightly bigger blocks on top row for a fortified look
      const capGeo = new THREE.BoxGeometry(W * 1.02, rowH * 0.35, T * 1.05)
      const cap = new THREE.Mesh(capGeo, stoneBlockDarkMat)
      cap.castShadow = true; cap.receiveShadow = true
      cap.position.set(0, H / 2 + rowH * 0.1, 0)
      g.add(cap)
      ;(g as any).__wallBounds = { W, H, T }
      return g
    }
    // Build two damage overlay planes that sit just in front of each wall face.
    // Returns the two meshes and their materials so damage can be updated.
    function attachDamageOverlays(parent: THREE.Group, W: number, H: number, T: number) {
      const mats: THREE.MeshBasicMaterial[] = []
      const meshes: THREE.Mesh[] = []
      const geo = new THREE.PlaneGeometry(W * 0.98, H * 0.98)
      // Front face
      const matF = new THREE.MeshBasicMaterial({ map: crackTextures[0], transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
      const mF = new THREE.Mesh(geo, matF)
      mF.position.set(0, 0, T / 2 + 0.012)
      parent.add(mF)
      // Back face
      const matB = new THREE.MeshBasicMaterial({ map: crackTextures[0], transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
      const mB = new THREE.Mesh(geo, matB)
      mB.position.set(0, 0, -T / 2 - 0.012)
      mB.rotation.y = Math.PI
      parent.add(mB)
      mats.push(matF, matB)
      meshes.push(mF, mB)
      return { mats, meshes }
    }
    // Apply a damage ratio (hp/maxHp) to a wall group by choosing the right
    // crack texture and fading opacity to taste.
    function applyWallDamage(sm: StructureMesh, ratio: number) {
      const meta = (sm.mesh as any).__wallDamage as { mats: THREE.MeshBasicMaterial[] } | undefined
      if (!meta) return
      const clamped = Math.max(0, Math.min(1, ratio))
      const lvl = damageLevelForRatio(clamped)
      const tex = crackTextures[lvl]
      // Opacity fades up as damage increases
      const op = lvl === 0 ? 0 : lvl === 1 ? 0.45 : lvl === 2 ? 0.7 : 0.9
      for (const m of meta.mats) {
        m.map = tex
        m.opacity = op
        m.needsUpdate = true
      }
    }
    // Update the health bar sprite for a structure based on hp/maxHp.
    function applyHealthBar(sm: StructureMesh, hp: number, maxHp: number) {
      const bar = (sm.mesh as any).__healthBar as { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } | undefined
      if (!bar) return
      if (hp >= maxHp) {
        bar.sprite.visible = false
        return
      }
      bar.sprite.visible = true
      updateHealthBarCanvas(bar.canvas, hp / maxHp)
      bar.tex.needsUpdate = true
    }

    // Structures
    const structureMeshes = new Map<string, StructureMesh>()
    // HP defaults per structure kind. Missing StructureData.hp falls back to
    // the corresponding max from this table so older saves still work.
    const STRUCT_HP: Record<string, number> = {
      wall:        20, // wood plank wall
      log_wall:    30, // thick log palisade
      stone_wall:  40, // mortared stone block wall
      floor:       15,
      log_floor:   20,
      spike_trap:   8,
      tree_stand:  40,
      furnace:     60,
      bed:         20,
    }
    function buildBedGroup(isSpawn = false) {
      const g = new THREE.Group()
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.22, 2.35), bedFrameMat)
      frame.position.y = 0.18
      frame.castShadow = true; frame.receiveShadow = true
      g.add(frame)
      const roll = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.2, 1.55), bedRollMat)
      roll.position.set(0, 0.42, 0.18)
      roll.castShadow = true; roll.receiveShadow = true
      g.add(roll)
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.16, 0.42), pillowMat)
      pillow.position.set(0, 0.52, -0.72)
      pillow.castShadow = true; pillow.receiveShadow = true
      g.add(pillow)
      for (const x of [-0.72, 0.72]) for (const z of [-0.95, 0.95]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.35, 0.18), bedFrameMat)
        leg.position.set(x, -0.03, z)
        leg.castShadow = true
        g.add(leg)
      }
      const marker = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.035, 8, 48), new THREE.MeshBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.8 }))
      marker.rotation.x = Math.PI / 2
      marker.position.y = 0.03
      marker.visible = isSpawn
      ;(g as any).__spawnMarker = marker
      g.add(marker)
      return g
    }

    function addStructureMesh(s: StructureData) {
      let obj: THREE.Object3D
      let wallMeta: { W: number; H: number; T: number } | null = null
      if (s.kind === 'wall') {
        const g = buildWoodWallGroup()
        wallMeta = (g as any).__wallBounds
        obj = g
      } else if (s.kind === 'floor') {
        const m = new THREE.Mesh(floorGeo, woodFloorMat)
        m.castShadow = true; m.receiveShadow = true
        obj = m
      } else if (s.kind === 'log_wall') {
        const g = buildLogWallGroup()
        wallMeta = (g as any).__wallBounds
        obj = g
      } else if (s.kind === 'stone_wall') {
        const g = buildStoneWallGroup()
        wallMeta = (g as any).__wallBounds
        obj = g
      } else if (s.kind === 'log_floor') {
        const m = new THREE.Mesh(logFloorGeo, logFloorMat)
        m.castShadow = true; m.receiveShadow = true
        obj = m
      } else if (s.kind === 'spike_trap') {
        const g = new THREE.Group()
        const base = new THREE.Mesh(trapBaseGeo, trapBaseMat)
        base.castShadow = true; base.receiveShadow = true
        base.position.y = 0.06
        g.add(base)
        // 3x3 spikes
        for (let ix = -1; ix <= 1; ix++) {
          for (let iz = -1; iz <= 1; iz++) {
            const sp = new THREE.Mesh(spikeGeo, spikeMat)
            sp.castShadow = true
            sp.position.set(ix * 0.5, 0.4, iz * 0.5)
            g.add(sp)
          }
        }
        obj = g
      } else if (s.kind === 'furnace') {
        // Stone furnace / forge — enables smelting when player is nearby.
        // Stored position.y = groundY + 0.9 (body center). All child offsets
        // are relative to that centre so the body sits flat on the ground.
        const g = new THREE.Group()
        const body = new THREE.Mesh(furnaceGeo, furnaceMat)
        body.castShadow = true; body.receiveShadow = true
        body.position.y = 0
        g.add(body)
        // Glowing mouth on the front, just below body centre.
        const mouth = new THREE.Mesh(furnaceMouthGeo, furnaceMouthMat)
        mouth.position.set(0, -0.2, 0.615)
        g.add(mouth)
        // Chimney sits directly on top of the body.
        const chimney = new THREE.Mesh(furnaceChimneyGeo, furnaceChimneyMat)
        chimney.castShadow = true
        chimney.position.set(0.4, 1.25, 0)
        g.add(chimney)
        // Flickering warm point-light near the mouth.
        const glow = new THREE.PointLight(0xff7320, 1.4, 5, 2)
        glow.position.set(0, -0.2, 0.7)
        g.add(glow)
        ;(g as any).__furnaceGlow = glow
        obj = g
      } else if (s.kind === 'bed') {
        obj = buildBedGroup(!!s.spawn)
      } else {
        // tree_stand — stored position.y = groundY + 3.0 (platform centre).
        // Legs reach down from the platform to the ground; rungs follow.
        const g = new THREE.Group()
        const legs: [number, number][] = [[-1.05, -1.05], [1.05, -1.05], [-1.05, 1.05], [1.05, 1.05]]
        for (const [lx, lz] of legs) {
          const leg = new THREE.Mesh(standLegGeo, standLegMat)
          leg.castShadow = true; leg.receiveShadow = true
          leg.position.set(lx, -1.5, lz)
          g.add(leg)
        }
        const plat = new THREE.Mesh(standPlatformGeo, standPlatformMat)
        plat.castShadow = true; plat.receiveShadow = true
        plat.position.y = 0
        g.add(plat)
        // Ladder rungs on the -x side: placed from just above ground up to
        // just below the platform (world-y sy+0.6 .. sy+2.8).
        for (let i = 0; i < 5; i++) {
          const r = new THREE.Mesh(rungGeo, standLegMat)
          r.position.set(-1.2, -2.4 + i * 0.55, 0)
          r.castShadow = true
          g.add(r)
        }
        obj = g
      }
      // Attach damage overlay + health bar to walls (they're the only
      // player-attackable structures for now).
      if (wallMeta && (obj instanceof THREE.Group)) {
        const dmg = attachDamageOverlays(obj, wallMeta.W, wallMeta.H, wallMeta.T)
        ;(obj as any).__wallDamage = dmg
        const bar = buildHealthBarSprite(wallMeta.H / 2)
        obj.add(bar.sprite)
        ;(obj as any).__healthBar = bar
      }
      obj.position.set(s.x, s.y, s.z)
      obj.rotation.y = s.ry
      scene.add(obj)
      const sm: StructureMesh = { id: s.id, kind: s.kind, mesh: obj }
      structureMeshes.set(s.id, sm)
      // Initialize damage visuals for restored (previously damaged) structures.
      if (s.hp != null && s.maxHp != null && s.hp < s.maxHp) {
        applyWallDamage(sm, s.hp / s.maxHp)
        applyHealthBar(sm, s.hp, s.maxHp)
      }
    }
    function removeStructureMesh(id: string) {
      const sm = structureMeshes.get(id)
      if (sm) { scene.remove(sm.mesh); structureMeshes.delete(id) }
    }

    // Initialize world
    updateChunks(playerPos.x, playerPos.z)
    useGame.getState().structures.forEach(addStructureMesh)

    // --- Input handling ---
    const onKeyDown = (e: KeyboardEvent) => {
      const mode = useGame.getState().mode
      if (e.code === 'KeyW' || e.code === 'ArrowUp') { input.f = true; walkTarget = null }
      if (e.code === 'KeyS' || e.code === 'ArrowDown') { input.b = true; walkTarget = null }
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') { input.l = true; walkTarget = null }
      if (e.code === 'KeyD' || e.code === 'ArrowRight') { input.r = true; walkTarget = null }
      // prevent page scrolling
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') e.preventDefault()
      // Space bar = JUMP (only when actually playing).
      if (e.code === 'Space') {
        if (mode === 'play') input.jump = true
        e.preventDefault()
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sprint = true
      // Attack (F key — alternate attack binding)
      if (e.code === 'KeyF') {
        if (mode === 'play') input.attack = true
      }
      // Hotbar
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.replace('Digit', '')) - 1
        if (n >= 0 && n <= 4) useGame.getState().setHotbar(n)
      }
      // Menus
      if (e.code === 'KeyI' || e.code === 'Tab') {
        // Tab toggles the inventory/character/shop panel too
        e.preventDefault()
        if (mode === 'inventory') useGame.getState().setMode('play')
        else if (mode === 'play') useGame.getState().setMode('inventory')
      }
      // Enter toggles the bottom-right keys guide overlay
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (mode === 'play') {
          useGame.getState().toggleKeysGuide()
          e.preventDefault()
        }
      }
      if (e.code === 'KeyC') {
        if (mode === 'crafting') useGame.getState().setMode('play')
        else if (mode === 'play') {
          // C key always opens the basic workbench — forge only opens via
          // right-clicking a placed furnace.
          useGame.getState().setCraftingContext('normal')
          useGame.getState().setMode('crafting')
        }
      }
      if (e.code === 'KeyB') {
        if (mode === 'build') useGame.getState().setMode('play')
        else if (mode === 'play') useGame.getState().setMode('build')
      }
      if (e.code === 'Escape') {
        if (mode === 'play') useGame.getState().setMode('paused')
        else if (mode !== 'dead') useGame.getState().setMode('play')
      }
      if (e.code === 'KeyQ') {
        dropEquippedItem()
      }
      if (e.code === 'KeyE') {
        if (mode === 'play' || mode === 'build') {
          if (!tryInteractBed()) tryPickupNearest()
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') input.f = false
      if (e.code === 'KeyS' || e.code === 'ArrowDown') input.b = false
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') input.l = false
      if (e.code === 'KeyD' || e.code === 'ArrowRight') input.r = false
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sprint = false
      if (e.code === 'Space') input.jump = false
    }

    // Compute the mouse's ground point (where the mouse cursor projects onto the terrain plane
    // near the player). Uses a horizontal plane at the player's feet for simplicity.
    const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    function updateMouseGround(): boolean {
      raycaster.setFromCamera(mouseNdc, camera)
      const feetY = playerPos.y - PLAYER_HEIGHT
      _plane.set(new THREE.Vector3(0, 1, 0), -feetY)
      const pt = new THREE.Vector3()
      if (raycaster.ray.intersectPlane(_plane, pt)) {
        mouseGroundPoint.copy(pt)
        return true
      }
      return false
    }

    // Mouse delta accumulator — consumed by the render loop to rotate yaw/pitch.
    // We can't use pointer lock (blocked by the sandboxed iframe), so we use a
    // HYBRID scheme:
    //   1) Primary:   `movementX`/`movementY` deltas give smooth FPS-style look.
    //   2) Fallback:  when the cursor is in the outer edge zone of the canvas
    //                 (±82% along either axis), edge-pan keeps turning the
    //                 camera in that direction — so you can turn a full 360°
    //                 by pushing the cursor to the screen edge.
    let mouseDx = 0
    let mouseDy = 0
    const onMouseMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      // Accumulate motion deltas only while we're actually playing/building —
      // menus / paused / dead modes should not rotate the camera.
      const m = useGame.getState().mode
      if (m === 'play' || m === 'build') {
        mouseDx += e.movementX || 0
        mouseDy += e.movementY || 0
      }
    }

    // Helper: returns true if the player is currently looking at a placed
    // furnace within ~4m. Used to open the crafting panel on right-click.
    function isFurnaceTargeted(): boolean {
      const structs = useGame.getState().structures
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
      // Flatten to the horizontal plane so aiming up/down doesn't exclude floor-level furnaces.
      fwd.y = 0
      if (fwd.lengthSq() < 1e-6) return false
      fwd.normalize()
      for (const st of structs) {
        if (st.kind !== 'furnace') continue
        const dx = st.x - playerPos.x
        const dz = st.z - playerPos.z
        const dist2 = dx * dx + dz * dz
        if (dist2 > 16) continue // >4m away
        const dist = Math.sqrt(dist2) || 1
        const nx = dx / dist
        const nz = dz / dist
        // Dot product >0.5 => player is facing within ~60° of the furnace.
        if (fwd.x * nx + fwd.z * nz > 0.5) return true
      }
      return false
    }

    const onMouseDown = (e: MouseEvent) => {
      // Ignore clicks that originate outside the game canvas (e.g., on HUD panels)
      if (e.target !== renderer.domElement) return
      // Lazy-initialize the procedural audio engine (must occur after a user gesture
      // so browsers permit the AudioContext to start).
      try { getGameAudio().init() } catch {}
      const mode = useGame.getState().mode
      if (mode !== 'play' && mode !== 'build') return

      // Lock the cursor to the canvas so the mouse can't escape off-screen
      // while playing. Pointer lock requires a user gesture, so we piggy-back
      // on the same click that starts the action.
      requestPointerLockSafe()

      // Right-click = either OPEN CRAFTING if aimed at a nearby furnace,
      // or swing the weapon toward the mouse point (default behaviour).
      if (e.button === 2) {
        e.preventDefault()
        if (mode === 'play') {
          // If the player is looking at a furnace within reach, open the
          // forge/crafting panel instead of attacking. This is how iron
          // weapons + smelting are accessed.
          if (isFurnaceTargeted()) {
            // Open the forge context — crafting panel shows ONLY smelting
            // and iron-tool recipes in this mode.
            useGame.getState().setCraftingContext('furnace')
            useGame.getState().setMode('crafting')
            return
          }
          if (updateMouseGround()) {
            const dx = mouseGroundPoint.x - playerPos.x
            const dz = mouseGroundPoint.z - playerPos.z
            if (dx * dx + dz * dz > 0.04) playerYaw = Math.atan2(dx, dz)
          }
          input.attack = true
        }
        return
      }

      if (e.button !== 0) return

      if (mode === 'build') {
        tryPlaceStructure()
        return
      }
      // Play mode: left-click = attack along the crosshair direction.
      // Click-to-move has been removed — use WASD / arrow keys to walk.
      input.attack = true
      walkTarget = null
    }

    // Block the browser's default right-click context menu over the game canvas
    const onContextMenu = (e: MouseEvent) => {
      if (e.target === renderer.domElement) e.preventDefault()
    }

    // --- Pointer Lock --------------------------------------------------------
    // Confines the mouse cursor to the canvas during active play/build. Menus,
    // pause, inventory, crafting, and death all release the lock so the user
    // can interact with HTML UI. If the browser blocks pointer lock (sandboxed
    // iframe), we silently fall back to the edge-pan rotation scheme.
    let pointerLockSupported = true
    let suppressNextLockExitPause = false
    function requestPointerLockSafe() {
      if (!pointerLockSupported) return
      if (document.pointerLockElement === renderer.domElement) return
      try {
        const el = renderer.domElement as any
        const req = el.requestPointerLock || el.mozRequestPointerLock || el.webkitRequestPointerLock
        if (req) req.call(el)
      } catch {
        pointerLockSupported = false
      }
    }
    function releasePointerLockSafe() {
      try {
        if (document.pointerLockElement === renderer.domElement) {
          suppressNextLockExitPause = true
          ;(document as any).exitPointerLock?.()
        }
      } catch {}
    }
    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === renderer.domElement
      if (!locked) {
        // We lost the lock. If the game is still in active play/build mode,
        // the user pressed ESC (browser auto-releases lock). In that case
        // switch to the paused menu so the cursor is visible for interaction.
        // If we released the lock ourselves (mode-switch), skip pausing.
        if (suppressNextLockExitPause) {
          suppressNextLockExitPause = false
          return
        }
        const m = useGame.getState().mode
        if (m === 'play' || m === 'build') {
          useGame.getState().setMode('paused')
        }
      }
    }
    const onPointerLockError = () => {
      // Browser refused the lock (sandboxed iframe, permission denied, etc.).
      // Remember this so we don't keep requesting on every click.
      pointerLockSupported = false
    }
    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('pointerlockerror', onPointerLockError)

    // Subscribe to mode changes: release lock whenever the game leaves
    // play/build so menus and panels are usable.
    let prevModeForLock = useGame.getState().mode
    const unsubscribeMode = useGame.subscribe((state) => {
      const m = state.mode
      if (m === prevModeForLock) return
      prevModeForLock = m
      if (m !== 'play' && m !== 'build') {
        releasePointerLockSafe()
      }
      // When re-entering play/build we don't re-request here because the
      // browser requires a user gesture — that happens on the next click.
    })

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('contextmenu', onContextMenu)

    const onResize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    // --- Actions ---
    function dropItemToWorld(id: ItemId, count: number, x: number, y: number, z: number, netId = makeNetId('drop'), announce = true) {
      const def = ITEMS[id]
      // Compose a recognizable drop mesh per item family so they pop visually
      // against grass/dirt. Logs get a chunky cylindrical "log" body with a
      // dark bark cap; everything else keeps the iconic floating cube.
      const group = new THREE.Group()
      if (id === 'log') {
        // Oriented like a felled log resting on its side.
        // Offset up so it rests on (not clipped into) the ground.
        const body = new THREE.Mesh(logDropBodyGeo, logDropBarkMat)
        body.rotation.z = Math.PI / 2
        body.position.y = 0.1
        body.castShadow = true
        group.add(body)
        // Bright end caps so the log-shape reads clearly from above
        const cap1 = new THREE.Mesh(logDropCapGeo, logDropCoreMat)
        cap1.rotation.y = Math.PI / 2
        cap1.position.set(0.526, 0.1, 0)
        group.add(cap1)
        const cap2 = new THREE.Mesh(logDropCapGeo, logDropCoreMat)
        cap2.rotation.y = -Math.PI / 2
        cap2.position.set(-0.526, 0.1, 0)
        group.add(cap2)
      } else if (id === 'sap') {
        const blob = new THREE.Mesh(sapDropGeo, sapMat)
        blob.scale.set(0.85, 1.1, 0.85)
        blob.position.y = 0.12
        blob.castShadow = true
        group.add(blob)
        const tip = new THREE.Mesh(sapTipGeo, sapMat)
        tip.position.y = 0.42
        tip.castShadow = true
        group.add(tip)
        const puddle = new THREE.Mesh(sapPuddleGeo, sapPuddleMat)
        puddle.rotation.x = -Math.PI / 2
        puddle.position.y = -0.09
        group.add(puddle)
        const glow = new THREE.PointLight(0xf59e0b, 0.45, 2.4, 2)
        glow.position.y = 0.25
        group.add(glow)
      } else {
        const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(def.color) })
        const cube = new THREE.Mesh(dropGeo, mat)
        cube.castShadow = true
        group.add(cube)
      }
      group.position.set(x, y, z)
      scene.add(group)
      const chunkX = Math.floor(x / CHUNK_SIZE)
      const chunkZ = Math.floor(z / CHUNK_SIZE)
      const c = chunks.get(chunkKey(chunkX, chunkZ))
      // Items linger for 30 seconds in the world before disappearing.
      if (c && !removedDropIds.has(netId)) c.droppedItems.push({ netId, mesh: group, id, count, px: x, py: y, pz: z, vy: 2, life: 30 })
      if (announce) queueWorldEvent('item_drop', { netId, itemId: id, count, x, y, z })
    }

    function dropEquippedItem() {
      const s = useGame.getState()
      const slot = s.inventory[s.hotbarIndex]
      if (!slot?.id) return
      const id = slot.id
      // front of player (uses the character's facing direction)
      const forward = new THREE.Vector3(Math.sin(playerYaw), 0, Math.cos(playerYaw))
      const dx = playerPos.x + forward.x * 1.2
      const dz = playerPos.z + forward.z * 1.2
      const dy = heightAt(dx, dz) + 0.4
      dropItemToWorld(id, 1, dx, dy, dz)
      s.removeItem(id, 1)
      if (s.inventory[s.hotbarIndex]?.id !== id) s.setHotbar(s.hotbarIndex)
    }

    function updateBedSpawnMarkers() {
      for (const st of useGame.getState().structures) {
        if (st.kind !== 'bed') continue
        const sm = structureMeshes.get(st.id)
        const marker = sm ? ((sm.mesh as any).__spawnMarker as THREE.Object3D | undefined) : undefined
        if (marker) marker.visible = !!st.spawn
      }
    }

    function setBedSpawnPoint(id: string) {
      const state = useGame.getState()
      const bed = state.structures.find(st => st.id === id && st.kind === 'bed')
      if (!bed) return false
      state.setStructures(state.structures.map(st => st.kind === 'bed' ? { ...st, spawn: st.id === id } : st))
      updateBedSpawnMarkers()
      queueWorldEvent('bed_spawn_set', { id })
      state.showToast('🛏️ Respawn point set')
      return true
    }

    function tryInteractBed() {
      let best: { id: string; d2: number } | null = null
      for (const st of useGame.getState().structures) {
        if (st.kind !== 'bed') continue
        const dx = st.x - playerPos.x
        const dz = st.z - playerPos.z
        const d2 = dx * dx + dz * dz
        if (d2 < 3.2 * 3.2 && (!best || d2 < best.d2)) best = { id: st.id, d2 }
      }
      if (!best) return false
      return setBedSpawnPoint(best.id)
    }

    function tryPickupNearest() {
      let closest: { d: number; c: ChunkData; i: number } | null = null
      for (const c of chunks.values()) {
        for (let i = 0; i < c.droppedItems.length; i++) {
          const d = c.droppedItems[i]
          const dx = d.px - playerPos.x
          const dz = d.pz - playerPos.z
          const dy = d.py - playerPos.y
          const dist = dx * dx + dz * dz + dy * dy
          if (dist < 3 * 3 && (!closest || dist < closest.d)) closest = { d: dist, c, i }
        }
      }
      if (closest) {
        const d = closest.c.droppedItems[closest.i]
        const added = useGame.getState().addItem(d.id, d.count)
        if (added) {
          removedDropIds.add(d.netId)
          queueWorldEvent('item_pickup', { netId: d.netId })
          scene.remove(d.mesh)
          closest.c.droppedItems.splice(closest.i, 1)
        } else {
          useGame.getState().showToast('Inventory full')
        }
      }
    }

    function tryPlaceStructure() {
      const s = useGame.getState()
      if (!buildGhost || !buildGhost.visible) return
      // Snap is already applied
      const kind = s.buildSelection
      const itemId: ItemId = kind as ItemId
      // Placement stock now comes from the Build menu's buildInventory first,
      // with the old regular inventory as a fallback for legacy saves that
      // still have walls stashed in the hotbar.
      if (s.countBuildItem(itemId) < 1) {
        s.showToast(`No ${ITEMS[itemId].name} to place`)
        return
      }
      const id = `st_${Date.now()}_${Math.floor(Math.random() * 1000)}`
      const maxHp = STRUCT_HP[kind] ?? 20
      const st: StructureData = {
        id,
        kind,
        x: buildGhost.position.x,
        y: buildGhost.position.y,
        z: buildGhost.position.z,
        ry: buildGhost.rotation.y,
        hp: maxHp,
        maxHp,
      }
      s.addStructure(st)
      addStructureMesh(st)
      s.consumeBuildItem(itemId, 1)
      queueWorldEvent('structure_add', { structure: st })
    }

    function spawnZombie(id = makeNetId('z'), announce = true, sx?: number, sz?: number) {
      if (!isNightTimeValue(timeOfDayAcc)) return
      if (zombies.some(z => z.id === id) || zombies.length >= MAX_ZOMBIES) return
      // Push spawn point well outside the player's awareness so the horde
      // is seen shuffling in from the darkness rather than appearing instantly.
      // Zombies are surface monsters; cave interiors are reserved for orcs.
      const spawn = findSurfaceSpawnPoint(42, 22, sx, sz)
      if (!spawn) return
      const { x, z } = spawn
      const y = heightAt(x, z)
      zombies.push(createZombie(x, y, z, id))
      if (announce) queueWorldEvent('enemy_spawn', { id, kind: 'zombie', x, y, z })
    }

    // Per-kind footprint + vertical bounds for structures. Used for both
    // stacking-aware placement and enemy collision push-back.
    // `halfW` / `halfD` are in structure-local space (pre-rotation).
    // `topOffset` is where the top of the structure is relative to the
    // stored position.y (which is the mesh centre / group origin).
    const STRUCT_DIMS = {
      wall:       { halfW: 1.0,  halfD: 0.12, topOffset: 1.2,   collide: true },
      log_wall:   { halfW: 1.0,  halfD: 0.22, topOffset: 1.4,   collide: true },
      stone_wall: { halfW: 1.0,  halfD: 0.22, topOffset: 1.3,   collide: true },
      floor:      { halfW: 1.0,  halfD: 1.0,  topOffset: 0.075, collide: false },
      log_floor:  { halfW: 1.0,  halfD: 1.0,  topOffset: 0.1,   collide: false },
      spike_trap: { halfW: 0.85, halfD: 0.85, topOffset: 0.15,  collide: false },
      // Furnace IS solid — player and enemies bump into it so it occupies
      // real space in the base. RMB on the furnace opens the forge crafting
      // panel without needing to walk through it.
      furnace:    { halfW: 0.8,  halfD: 0.6,  topOffset: 0.9,   collide: true },
      bed:        { halfW: 0.9,  halfD: 1.2,  topOffset: 0.55,  collide: true },
      tree_stand: { halfW: 1.2,  halfD: 1.2,  topOffset: 0.15,  collide: true },
    } as const

    // Push an enemy out of trees, stones, and solid structures within `r`.
    function collideEnemy(pos: THREE.Vector3, r: number) {
      const ecx = Math.floor(pos.x / CHUNK_SIZE)
      const ecz = Math.floor(pos.z / CHUNK_SIZE)
      for (let dcx = -1; dcx <= 1; dcx++) {
        for (let dcz = -1; dcz <= 1; dcz++) {
          const c = chunks.get(chunkKey(ecx + dcx, ecz + dcz))
          if (!c) continue
          // Trees: radius ~0.45 around trunk
          for (const t of c.trees) {
            if (!t.collider) continue
            const dx = pos.x - t.px, dz = pos.z - t.pz
            const minD = r + 0.45
            const d2 = dx * dx + dz * dz
            if (d2 < minD * minD && d2 > 1e-6) {
              const d = Math.sqrt(d2)
              pos.x = t.px + (dx / d) * minD
              pos.z = t.pz + (dz / d) * minD
            }
          }
          for (const ca of c.cacti) {
            if (!ca.collider) continue
            const dx = pos.x - ca.px, dz = pos.z - ca.pz
            const minD = r + 0.38
            const d2 = dx * dx + dz * dz
            if (d2 < minD * minD && d2 > 1e-6) {
              const d = Math.sqrt(d2)
              pos.x = ca.px + (dx / d) * minD
              pos.z = ca.pz + (dz / d) * minD
            }
          }
          // Stones/boulders: use the boulder's original spawn scale so a
          // partially-mined rock still blocks enemies; otherwise a nearly-
          // broken boulder's shrunken mesh would let enemies phase through.
          for (const s of c.stones) {
            const sr = 0.55 + (s.initialScale - 0.6) * 0.6
            const dx = pos.x - s.px, dz = pos.z - s.pz
            const minD = r + Math.max(0.5, sr)
            const d2 = dx * dx + dz * dz
            if (d2 < minD * minD && d2 > 1e-6) {
              const d = Math.sqrt(d2)
              pos.x = s.px + (dx / d) * minD
              pos.z = s.pz + (dz / d) * minD
            }
          }
        }
      }
      // Solid structures (walls, furnace, tree_stand legs): simple AABB push
      // in structure-local space to handle rotation (walls are thin & long).
      for (const sm of structureMeshes.values()) {
        const dims = (STRUCT_DIMS as any)[sm.kind]
        if (!dims || !dims.collide) continue
        const dx = pos.x - sm.mesh.position.x
        const dz = pos.z - sm.mesh.position.z
        const cosR = Math.cos(-sm.mesh.rotation.y)
        const sinR = Math.sin(-sm.mesh.rotation.y)
        const lx = dx * cosR - dz * sinR
        const lz = dx * sinR + dz * cosR
        const hw = dims.halfW + r
        const hd = dims.halfD + r
        if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
          // Push out the axis with smaller overlap
          const ox = hw - Math.abs(lx)
          const oz = hd - Math.abs(lz)
          let nlx = lx, nlz = lz
          if (ox < oz) nlx = Math.sign(lx) * hw
          else          nlz = Math.sign(lz) * hd
          // back to world
          const cosR2 = Math.cos(sm.mesh.rotation.y)
          const sinR2 = Math.sin(sm.mesh.rotation.y)
          pos.x = sm.mesh.position.x + (nlx * cosR2 - nlz * sinR2)
          pos.z = sm.mesh.position.z + (nlx * sinR2 + nlz * cosR2)
        }
      }
    }

    function clearZombies() {
      for (const z of zombies) removeZombie(z)
      zombies.length = 0
    }

    function clearDaytimeHostiles() {
      clearZombies()
      for (const v of vampires) removeVampire(v)
      vampires.length = 0
      for (const g of goblins) removeGoblin(g)
      goblins.length = 0
      for (const o of orcs) removeOrc(o)
      orcs.length = 0
      ;(window as any).__nightfall_nearestEnemy = null
      ;(window as any).__nightfall_boss = null
    }

    function spawnGoblin(id = makeNetId('g'), announce = true, sx?: number, sz?: number) {
      if (!isNightTimeValue(timeOfDayAcc)) return
      if (goblins.some(g => g.id === id) || goblins.length >= MAX_GOBLINS) return
      const spawn = findSurfaceSpawnPoint(38, 18, sx, sz)
      if (!spawn) return
      const { x, z } = spawn
      const y = heightAt(x, z)
      goblins.push(createGoblin(x, y, z, id))
      if (announce) queueWorldEvent('enemy_spawn', { id, kind: 'goblin', x, y, z })
      useGame.getState().showToast('🟢 A goblin eyes your loot!')
    }

    // At dawn, vampires don't just vanish — they transform into bats and fly away.
    function startVampireDawnFlight() {
      for (const v of vampires) {
        if (!v.fleeing) {
          v.fleeing = true
          v.fleeTimer = 0
          // Replace body mesh with a small bat hovering above
          scene.remove(v.mesh)
          v.bat = makeBat(new THREE.Vector3(v.pos.x, v.pos.y + 1.8, v.pos.z))
        }
      }
    }

    // Game loop
    let last = performance.now()
    let acc = 0
    let timeOfDayAcc = useGame.getState().timeOfDay
    // The day/night clock is anchored to wall-clock time instead of frame
    // deltas, so it cannot drift when FPS changes, browser tabs sleep, or a
    // multiplayer server sends an authoritative time correction.
    let timeCycleOriginMs = Date.now() - timeOfDayToCycleSeconds(timeOfDayAcc) * 1000
    let wasNight = isNightTimeValue(timeOfDayAcc)
    let zombieSpawnTimer = 3
    let vampireSpawnTimer = 30
    // Orc boss is rare, but guaranteed to appear after the world has been alive a while.
    let orcSpawnTimer = 140 + Math.random() * 90
    // Goblin first sighting happens a few minutes in; respawns are even rarer.
    let goblinSpawnTimer = 180 + Math.random() * 120
    let bob = 0

    // ---------------------------------------------------------------------
    // Multiplayer ghosts: simple humanoid avatars driven by presence data
    // posted to /api/servers/{id}/presence. The network layer only polls
    // every couple of seconds so we keep a target position for each ghost
    // and interpolate toward it every frame to hide the latency.
    // ---------------------------------------------------------------------
    type Ghost = {
      name: string
      mesh: THREE.Group
      label: THREE.Sprite
      pos: THREE.Vector3
      target: THREE.Vector3
      yaw: number
      targetYaw: number
      // used to detect stalled heartbeat -> fade the ghost out
      lastSeen: number
    }
    const ghosts = new Map<string, Ghost>()
    const ghostSkinMat = new THREE.MeshStandardMaterial({ color: 0xd6b08d, roughness: 0.7, metalness: 0 })
    const ghostShirtMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85, metalness: 0 })
    const ghostPantsMat = new THREE.MeshStandardMaterial({ color: 0x2a2a36, roughness: 0.92, metalness: 0 })
    const ghostBootMat = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.88, metalness: 0 })

    function makeGhostLabel(name: string): THREE.Sprite {
      const cvs = document.createElement('canvas')
      cvs.width = 256
      cvs.height = 72
      const ctx = cvs.getContext('2d')!
      ctx.clearRect(0, 0, 256, 72)
      ctx.font = 'bold 36px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 6
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.fillStyle = '#ffd884'
      ctx.strokeText(name, 128, 36)
      ctx.fillText(name, 128, 36)
      const tex = new THREE.CanvasTexture(cvs)
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.needsUpdate = true
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.set(1.8, 0.5, 1)
      sprite.position.y = 2.4
      sprite.renderOrder = 999
      return sprite
    }

    function createGhost(id: string, name: string, x: number, y: number, z: number, yaw: number): Ghost {
      const g = new THREE.Group()
      // Torso
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.26, 0.72, 14), ghostShirtMat)
      torso.position.y = 1.1
      torso.castShadow = true
      g.add(torso)
      // Head
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), ghostSkinMat)
      head.position.y = 1.72
      head.castShadow = true
      g.add(head)
      // Arms (simple cylinders so we don't burn polys)
      const armGeo = new THREE.CylinderGeometry(0.09, 0.08, 0.62, 10)
      const armL = new THREE.Mesh(armGeo, ghostShirtMat)
      armL.position.set(0.36, 1.15, 0)
      armL.castShadow = true
      g.add(armL)
      const armR = new THREE.Mesh(armGeo, ghostShirtMat)
      armR.position.set(-0.36, 1.15, 0)
      armR.castShadow = true
      g.add(armR)
      // Legs
      const legGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.74, 10)
      const legL = new THREE.Mesh(legGeo, ghostPantsMat)
      legL.position.set(0.14, 0.4, 0)
      legL.castShadow = true
      g.add(legL)
      const legR = new THREE.Mesh(legGeo, ghostPantsMat)
      legR.position.set(-0.14, 0.4, 0)
      legR.castShadow = true
      g.add(legR)
      // Boots — tiny flat pads to ground the mesh.
      const bootGeo = new THREE.BoxGeometry(0.3, 0.08, 0.35)
      const bootL = new THREE.Mesh(bootGeo, ghostBootMat)
      bootL.position.set(0.14, 0.04, 0.04)
      bootL.castShadow = true
      g.add(bootL)
      const bootR = new THREE.Mesh(bootGeo, ghostBootMat)
      bootR.position.set(-0.14, 0.04, 0.04)
      bootR.castShadow = true
      g.add(bootR)

      const label = makeGhostLabel(name)
      g.add(label)

      g.position.set(x, y, z)
      g.rotation.y = yaw
      scene.add(g)
      const ghost: Ghost = {
        name,
        mesh: g,
        label,
        pos: new THREE.Vector3(x, y, z),
        target: new THREE.Vector3(x, y, z),
        yaw,
        targetYaw: yaw,
        lastSeen: performance.now(),
      }
      ghosts.set(id, ghost)
      return ghost
    }

    function disposeGhost(id: string) {
      const g = ghosts.get(id)
      if (!g) return
      scene.remove(g.mesh)
      g.mesh.traverse((o: any) => {
        if (o.geometry) o.geometry.dispose?.()
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m: any) => m.dispose?.())
          else o.material.dispose?.()
        }
      })
      if ((g.label.material as any).map) (g.label.material as any).map.dispose?.()
      ;(g.label.material as any).dispose?.()
      ghosts.delete(id)
    }

    // Called by play-client every heartbeat cycle (~3s) with the latest
    // server snapshot of other players. Creates meshes for newcomers,
    // updates target positions for existing ones, and removes anyone who
    // left.
    ;(window as any).__nightfallUpdateGhosts = (players: Array<{
      id: string; name: string; posX: number; posY: number; posZ: number; yaw: number
    }>) => {
      const now = performance.now()
      const seen = new Set<string>()
      for (const p of players) {
        if (!p || !p.id) continue
        seen.add(p.id)
        let g = ghosts.get(p.id)
        if (!g) {
          g = createGhost(p.id, p.name || 'Survivor', p.posX, p.posY, p.posZ, p.yaw)
        } else {
          g.target.set(p.posX, p.posY, p.posZ)
          g.targetYaw = p.yaw
        }
        g.lastSeen = now
      }
      // Drop anyone missing from the latest update if they've been silent
      // long enough to be considered gone (handles the rare case where the
      // server's GC reaped them ahead of schedule).
      for (const id of Array.from(ghosts.keys())) {
        if (!seen.has(id)) {
          const g = ghosts.get(id)!
          if (now - g.lastSeen > 20_000) disposeGhost(id)
        }
      }
    }

    // Exposed so the presence heartbeat can read current player pose.
    ;(window as any).__nightfallGetPos = () => ({
      x: playerPos.x,
      y: playerPos.y,
      z: playerPos.z,
      yaw: playerYaw,
    })

    function enemySnapshot(): EnemySnapshot[] {
      return [
        ...zombies.map(z => ({ id: z.id, kind: 'zombie' as const, x: z.pos.x, y: z.pos.y, z: z.pos.z, hp: z.hp })),
        ...vampires.map(v => ({ id: v.id, kind: 'vampire' as const, x: v.pos.x, y: v.pos.y, z: v.pos.z, hp: v.hp, fleeing: v.fleeing })),
        ...goblins.map(g => ({ id: g.id, kind: 'goblin' as const, x: g.pos.x, y: g.pos.y, z: g.pos.z, hp: g.hp, state: g.phase })),
        ...orcs.map(o => ({ id: o.id, kind: 'orc' as const, x: o.pos.x, y: o.pos.y, z: o.pos.z, hp: o.hp, state: o.state })),
      ]
    }

    function removeDropById(netId: string) {
      removedDropIds.add(netId)
      for (const c of chunks.values()) {
        const idx = c.droppedItems.findIndex(d => d.netId === netId)
        if (idx >= 0) {
          scene.remove(c.droppedItems[idx].mesh)
          c.droppedItems.splice(idx, 1)
          return
        }
      }
    }

    function ownMemberKey() {
      const fromJoin = (window as any).__nightfallMemberKey
      if (typeof fromJoin === 'string' && fromJoin) return fromJoin
      try {
        const gid = window.localStorage.getItem('nightfall:guestId')
        if (gid) return `g:${gid}`
      } catch {}
      return null
    }

    function dropAllPlayerItems(reason: string) {
      if (pvpDeathDropped) return
      pvpDeathDropped = true
      const state = useGame.getState()
      let dropped = 0
      let ring = 0
      for (const slot of state.inventory) {
        if (!slot?.id || slot.count <= 0) continue
        const a = ring * 1.17
        const r = 0.45 + (ring % 5) * 0.16
        dropItemToWorld(slot.id, slot.count, playerPos.x + Math.cos(a) * r, heightAt(playerPos.x, playerPos.z) + 0.55, playerPos.z + Math.sin(a) * r)
        ring++
        dropped += slot.count
      }
      for (const [rawId, count] of Object.entries(state.buildInventory)) {
        const id = rawId as ItemId
        const n = Number(count || 0)
        if (!n) continue
        const a = ring * 1.17
        const r = 0.45 + (ring % 5) * 0.16
        dropItemToWorld(id, n, playerPos.x + Math.cos(a) * r, heightAt(playerPos.x, playerPos.z) + 0.55, playerPos.z + Math.sin(a) * r)
        ring++
        dropped += n
      }
      state.setInventory(Array.from({ length: 30 }, () => ({ id: null, count: 0 })))
      state.setBuildInventory({})
      state.setEquipped(null)
      state.showToast(dropped > 0 ? `💀 ${reason} You dropped ${dropped} items!` : `💀 ${reason}`)
    }

    function applyWorldEvent(evt: WorldEvent) {
      if (!evt?.id || appliedWorldEvents.has(evt.id)) return
      appliedWorldEvents.add(evt.id)
      const p = evt.payload || {}
      if (evt.type === 'enemy_spawn') {
        if (!isNightTimeValue(timeOfDayAcc)) return
        if (p.kind === 'zombie') spawnZombie(p.id, false, Number(p.x), Number(p.z))
        else if (p.kind === 'vampire') spawnVampire(p.id, false, Number(p.x), Number(p.z))
        else if (p.kind === 'goblin') spawnGoblin(p.id, false, Number(p.x), Number(p.z))
        else if (p.kind === 'orc') spawnOrc(p.id, false, Number(p.x), Number(p.z))
      } else if (evt.type === 'resource_break') {
        if (p.kind === 'tree' || p.kind === 'stone' || p.kind === 'cactus') removeResourceMesh(p.kind, Number(p.x), Number(p.z), p.kind === 'tree' || p.kind === 'cactus')
      } else if (evt.type === 'item_drop') {
        if (p.itemId && !removedDropIds.has(String(p.netId))) dropItemToWorld(p.itemId as ItemId, Number(p.count || 1), Number(p.x), Number(p.y), Number(p.z), String(p.netId), false)
      } else if (evt.type === 'item_pickup') {
        removeDropById(String(p.netId))
      } else if (evt.type === 'structure_add' && p.structure) {
        const state = useGame.getState()
        if (!state.structures.some(st => st.id === p.structure.id)) {
          state.addStructure(p.structure as StructureData)
          addStructureMesh(p.structure as StructureData)
        }
      } else if (evt.type === 'structure_remove') {
        useGame.getState().removeStructure(String(p.id))
        removeStructureMesh(String(p.id))
      } else if (evt.type === 'structure_update') {
        useGame.getState().updateStructure(String(p.id), p.patch || {})
        updateBedSpawnMarkers()
      } else if (evt.type === 'bed_spawn_set') {
        const id = String(p.id || '')
        const state = useGame.getState()
        state.setStructures(state.structures.map(st => st.kind === 'bed' ? { ...st, spawn: st.id === id } : st))
        updateBedSpawnMarkers()
      } else if (evt.type === 'pvp_hit') {
        const targetId = String(p.targetId || '')
        if (targetId && targetId === ownMemberKey()) {
          const state = useGame.getState()
          if (state.mode !== 'dead') {
            const before = state.health
            const kx = Number(p.knockX || 0)
            const kz = Number(p.knockZ || 0)
            playerPos.x += kx
            playerPos.z += kz
            playerVel.x += kx * 2.5
            playerVel.z += kz * 2.5
            state.takeDamage(Math.max(1, Number(p.damage || 1)))
            state.showToast(`⚔️ Hit by ${String(p.attackerName || 'another player')}!`)
            if (before > 0 && useGame.getState().health <= 0) {
              dropAllPlayerItems(`Slain by ${String(p.attackerName || 'another player')}.`)
              queueWorldEvent('pvp_death', { victimId: targetId, killerId: String(p.attackerId || ''), x: playerPos.x, y: heightAt(playerPos.x, playerPos.z), z: playerPos.z })
            }
          }
        }
      } else if (evt.type === 'pvp_death') {
        if (String(p.killerId || '') === ownMemberKey()) useGame.getState().showToast('🏆 You defeated a player!')
      }
    }

    function reconcileEnemySnapshots(snapshots: EnemySnapshot[]) {
      if (isWorldAuthority) return
      if (!isNightTimeValue(timeOfDayAcc)) {
        clearDaytimeHostiles()
        return
      }
      const seen = new Set<string>()
      for (const e of snapshots || []) {
        seen.add(e.id)
        const pos = new THREE.Vector3(Number(e.x), Number(e.y), Number(e.z))
        let target: Zombie | Vampire | Goblin | OrcBoss | undefined
        if (e.kind === 'zombie') target = zombies.find(z => z.id === e.id) || (spawnZombie(e.id, false, e.x, e.z), zombies.find(z => z.id === e.id))
        else if (e.kind === 'vampire') target = vampires.find(v => v.id === e.id) || (spawnVampire(e.id, false, e.x, e.z), vampires.find(v => v.id === e.id))
        else if (e.kind === 'goblin') target = goblins.find(g => g.id === e.id) || (spawnGoblin(e.id, false, e.x, e.z), goblins.find(g => g.id === e.id))
        else if (e.kind === 'orc') target = orcs.find(o => o.id === e.id) || (spawnOrc(e.id, false, e.x, e.z), orcs.find(o => o.id === e.id))
        if (target) {
          target.pos.lerp(pos, 0.65)
          target.hp = Number(e.hp ?? target.hp)
          if (e.kind === 'orc' && e.state) (target as OrcBoss).state = e.state as OrcState
          if (e.kind === 'goblin' && e.state) (target as Goblin).phase = e.state as GoblinPhase
          if (e.kind === 'vampire') (target as Vampire).fleeing = !!e.fleeing
          target.mesh.position.copy(target.pos)
        }
      }
      for (let i = zombies.length - 1; i >= 0; i--) if (!seen.has(zombies[i].id)) { removeZombie(zombies[i]); zombies.splice(i, 1) }
      for (let i = vampires.length - 1; i >= 0; i--) if (!seen.has(vampires[i].id)) { removeVampire(vampires[i]); vampires.splice(i, 1) }
      for (let i = goblins.length - 1; i >= 0; i--) if (!seen.has(goblins[i].id)) { removeGoblin(goblins[i]); goblins.splice(i, 1) }
      for (let i = orcs.length - 1; i >= 0; i--) if (!seen.has(orcs[i].id)) { removeOrc(orcs[i]); orcs.splice(i, 1) }
    }

    ;(window as any).__nightfallWorldSyncPayload = () => ({
      clientId: worldClientId,
      sinceRevision: lastWorldRevision,
      events: pendingWorldEvents.splice(0, pendingWorldEvents.length),
      snapshot: isWorldAuthority ? { entities: enemySnapshot() } : undefined,
    })
    ;(window as any).__nightfallApplyWorldSync = (data: any) => {
      if (!data) return
      if (typeof data.revision === 'number') lastWorldRevision = Math.max(lastWorldRevision, data.revision)
      isWorldAuthority = data.authorityId === worldClientId
      if (typeof data.timeOfDay === 'number') {
        timeOfDayAcc = data.timeOfDay
        timeCycleOriginMs = Date.now() - timeOfDayToCycleSeconds(timeOfDayAcc) * 1000
        useGame.getState().setTime(timeOfDayAcc)
        if (!isNightTimeValue(timeOfDayAcc)) clearDaytimeHostiles()
      }
      for (const evt of (data.events || []) as WorldEvent[]) applyWorldEvent(evt)
      if (data.snapshot?.entities) reconcileEnemySnapshots(data.snapshot.entities as EnemySnapshot[])
    }

    const raycaster = new THREE.Raycaster()

    function animate() {
      gameRef.current.raf = requestAnimationFrame(animate)
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const state = useGame.getState()
      if (state.mode !== 'dead') pvpDeathDropped = false
      const paused = state.mode === 'paused' || state.mode === 'dead'
      if (state.mode === 'dead') {
        // Death leaves no visible local body/hand in the world view until respawn.
        playerMesh.visible = false
        weaponGroup.visible = false
        fistGroup.visible = false
      }

      // Time of day progression — based on real elapsed wall-clock time, not
      // frame count. This keeps the HUD countdown, monster spawn gates, and
      // server-authoritative multiplayer time in sync with actual time passing.
      timeOfDayAcc = cycleSecondsToTimeOfDay((Date.now() - timeCycleOriginMs) / 1000)
      state.setTime(timeOfDayAcc)
      ;(window as any).__nightfall_phase = phaseInfoForTimeOfDay(timeOfDayAcc)

      // Sun/moon positions (sun arc)
      const sunAngle = timeOfDayAcc * Math.PI * 2 - Math.PI / 2 // 0.25 = east, 0.5 = noon overhead
      const sunY = Math.sin(sunAngle)
      const sunX = Math.cos(sunAngle)
      sun.position.set(sunX * 60, sunY * 60 + 10, 30).add(playerPos)
      sun.target.position.copy(playerPos)
      moonLight.position.set(-sunX * 60, -sunY * 60 + 10, 30).add(playerPos)
      moonLight.target.position.copy(playerPos)
      // intensity & color based on time
      const daylight = Math.max(0, sunY) // 0 at horizon, 1 at noon
      const isNightNow = isNightTimeValue(timeOfDayAcc)
      // Bigger, brighter daytime sun (less golden, more midday feel)
      sun.intensity = isNightNow ? 0 : Math.min(2.2, 0.4 + daylight * 2.0)
      ambient.intensity = isNightNow ? 0.035 : 0.22 + daylight * 0.75
      hemi.intensity = isNightNow ? 0.02 : 0.18 + daylight * 0.9
      // Nights are intentionally pitch-black overhead; the player torch is the main readable light.
      moonLight.intensity = isNightNow ? 0 : Math.max(0, (1 - Math.max(0, daylight + 0.05))) * 0.25

      // Place the visible moon on the firmament opposite the sun.
      // It follows the camera horizontally so the horizon stays fixed.
      const moonDir = new THREE.Vector3(-sunX, -sunY, 0.25)
      moonDir.normalize()
      const moonAnchor = new THREE.Vector3(camera.position.x, 0, camera.position.z)
      const moonPos = moonAnchor.clone().addScaledVector(moonDir, 200)
      moonMesh.position.copy(moonPos)
      moonGlow.position.copy(moonPos)
      const moonVisibility = isNightNow ? 0 : Math.max(0, Math.min(1, (0.15 - daylight) * 4))
      ;(moonMesh.material as THREE.MeshBasicMaterial).opacity = moonVisibility
      ;(moonGlow.material as THREE.MeshBasicMaterial).opacity = moonVisibility * 0.35
      moonMesh.visible = moonVisibility > 0.01
      moonGlow.visible = moonMesh.visible

      // Fog/sky colors — bright blue daytime, pure-black night.
      const dayTop = new THREE.Color(0x4d97d6)
      const dayBot = new THREE.Color(0xe8dcbe)
      const nightTop = new THREE.Color(0x000000)
      const nightBot = new THREE.Color(0x000000)
      const sunsetTop = new THREE.Color(0x3b2852)
      const sunsetBot = new THREE.Color(0xff8a52)
      // Blend: day holds pure-day longer, sunset band is narrower.
      let topCol: THREE.Color, botCol: THREE.Color, fogCol: THREE.Color
      if (isNightNow) {
        topCol = nightTop; botCol = nightBot
      } else if (daylight > 0.12) {
        topCol = dayTop; botCol = dayBot
      } else if (daylight > 0) {
        const t = daylight / 0.12
        topCol = new THREE.Color().copy(sunsetTop).lerp(dayTop, t)
        botCol = new THREE.Color().copy(sunsetBot).lerp(dayBot, t)
      } else {
        topCol = nightTop; botCol = nightBot
      }
      skyMat.uniforms.topColor.value.copy(topCol)
      skyMat.uniforms.bottomColor.value.copy(botCol)
      // Night: full-black fog so the horizon line disappears and everything
      // beyond the torch / moonlight range fades into true darkness.
      if (isNightNow) {
        fogCol = new THREE.Color(0x000000)
      } else {
        fogCol = new THREE.Color().copy(botCol).multiplyScalar(0.7)
      }
      scene.fog!.color.copy(fogCol)
      // Thicker fog at night for eerie atmosphere
      if ((scene.fog as any).density !== undefined) {
        (scene.fog as any).density = isNightNow ? 0.018 : 0.0075
      }
      ;(renderer as any).setClearColor(fogCol)

      // The requested night sky is pitch black: no star/moon texture competing with the void.
      const starOpacity = isNightNow ? 0 : Math.max(0, Math.min(0.35, (0.08 - daylight) * 2))
      starMat.opacity = starOpacity
      stars.visible = starOpacity > 0.01
      stars.position.set(camera.position.x, 0, camera.position.z)
      // Keep skydome centered on camera for infinite-horizon feel
      sky.position.set(camera.position.x, 0, camera.position.z)
      // Subtle slow rotation so the firmament feels alive
      stars.rotation.y += dt * 0.002
      // Edge ring follows camera so horizon edge is always visible far away
      edgeRing.position.set(camera.position.x, -0.8, camera.position.z)

      // Night state transitions
      if (isNightNow !== wasNight) {
        wasNight = isNightNow
        if (!isNightNow) {
          // dawn: daylight is safe — remove all active monsters.
          clearDaytimeHostiles()
          state.showToast('🌅 Dawn breaks. The horde retreats.')
        } else {
          state.showToast('🌙 Nightfall... they are coming.')
        }
      }

      // Player torch during night
      if (isNightNow) {
        playerTorch.intensity = 1.2
        playerTorch.position.set(playerPos.x, playerPos.y + 0.5, playerPos.z)
      } else {
        playerTorch.intensity = 0
      }

      if (!paused) {
        // Mouse-look: rotate camera yaw based on horizontal mouse position.
        // No pointer lock (blocked by sandboxed iframe) — instead we use a soft
        // edge-panning model: a dead zone in the center, and rotation speed
        // ramps up as the cursor approaches the horizontal edges of the canvas.
        // Only active while actually playing or building (never while a panel is open).
        // NB: mouse-right must turn the view RIGHT (i.e. yaw must INCREASE so the
        // forward vector sweeps from -Z toward +X).
        if (state.mode === 'play' || state.mode === 'build') {
          // Part 1 — FPS-style mouse deltas: rotate yaw/pitch by the mouse's
          // motion this frame.  Gives a smooth, direct, FPS-like feel while
          // the cursor is moving freely inside the screen.
          const mouseSensitivity = 0.0025
          yaw += mouseDx * mouseSensitivity
          // Mouse-up (negative movementY) should tilt camera up (positive pitch).
          pitch -= mouseDy * mouseSensitivity
          mouseDx = 0
          mouseDy = 0

          // Part 2 — Edge-pan fallback for true 360° rotation.
          // When the cursor is pushed into the outer edge zone of the canvas
          // (outside ±0.82 NDC), continuously rotate the camera in that
          // direction.  This lets the player spin past the physical screen
          // edge, which is otherwise impossible without pointer lock.
          const edgeThreshold = 0.82
          const mx = mouseNdc.x
          const my = mouseNdc.y
          if (mx > edgeThreshold || mx < -edgeThreshold) {
            const sign = mx > 0 ? 1 : -1
            const t = (Math.abs(mx) - edgeThreshold) / (1 - edgeThreshold)
            const ramp = Math.min(1, t) // 0 at edge threshold, 1 at screen edge
            const edgeTurnSpeed = 2.4   // rad/sec at full edge
            yaw += sign * ramp * edgeTurnSpeed * dt
          }
          if (my > edgeThreshold || my < -edgeThreshold) {
            const sign = my > 0 ? 1 : -1
            const t = (Math.abs(my) - edgeThreshold) / (1 - edgeThreshold)
            const ramp = Math.min(1, t)
            const edgePitchSpeed = 1.6  // rad/sec at full edge
            pitch += sign * ramp * edgePitchSpeed * dt
          }

          // Clamp pitch so the camera never flips past vertical.
          // Yaw is intentionally NOT clamped — it wraps naturally for 360°.
          if (pitch > 1.2) pitch = 1.2
          if (pitch < -1.2) pitch = -1.2
        }

        // Update mouse ground point every frame (for aim / click-to-move target)
        hasMouseGround = updateMouseGround()

        // --- Player Movement (first-person, camera-relative) ---
        // Camera's forward direction in world space (matches the (fx,fz)
        // formula used by the camera block below).  Pressing W should move
        // the player toward wherever the camera is looking.
        const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED
        const forward = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw))
        const right = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw))
        const wish = new THREE.Vector3()
        const usingKeys = input.f || input.b || input.l || input.r
        if (usingKeys) {
          if (input.f) wish.add(forward)   // W / ↑ — walk forward
          if (input.b) wish.sub(forward)   // S / ↓ — walk backward
          if (input.r) wish.add(right)     // D / → — strafe right
          if (input.l) wish.sub(right)     // A / ← — strafe left
        } else if (walkTarget) {
          const tx = walkTarget.x - playerPos.x
          const tz = walkTarget.z - playerPos.z
          const td = Math.sqrt(tx * tx + tz * tz)
          if (td < 0.35) {
            walkTarget = null
          } else {
            wish.set(tx / td, 0, tz / td)
          }
        }
        wish.y = 0
        if (wish.lengthSq() > 0) {
          wish.normalize().multiplyScalar(speed)
        }
        // In first person the character yaw always matches the camera yaw —
        // this is the "screen faces where mouse points" behaviour.  The mesh
        // is invisible anyway so this is purely for weapon-aim & drop dir.
        playerYaw = yaw

        playerVel.x = wish.x
        playerVel.z = wish.z
        playerVel.y -= GRAVITY * dt
        if (input.jump && onGround) {
          playerVel.y = JUMP_VELOCITY
          onGround = false
        }

        // Move horizontally with structure collision
        let newX = playerPos.x + playerVel.x * dt
        let newZ = playerPos.z + playerVel.z * dt
        // Player collides with walls (all 3 kinds) and furnaces. Tree stands
        // are solid for enemies but walk-on-able for the player (platforms);
        // floors & spike traps are non-solid surfaces.
        for (const sm of structureMeshes.values()) {
          if (sm.kind !== 'wall' && sm.kind !== 'log_wall' && sm.kind !== 'stone_wall' && sm.kind !== 'furnace' && sm.kind !== 'bed') continue
          const dims = (STRUCT_DIMS as any)[sm.kind]
          const dx = newX - sm.mesh.position.x
          const dz = newZ - sm.mesh.position.z
          // rotate into wall local space
          const cosR = Math.cos(-sm.mesh.rotation.y)
          const sinR = Math.sin(-sm.mesh.rotation.y)
          const lx = dx * cosR - dz * sinR
          const lz = dx * sinR + dz * cosR
          const halfW = dims.halfW + PLAYER_RADIUS
          const halfD = dims.halfD + PLAYER_RADIUS
          if (Math.abs(lx) < halfW && Math.abs(lz) < halfD) {
            // Push out on the axis with smaller overlap (handles head-on hits cleanly)
            const ox = halfW - Math.abs(lx)
            const oz = halfD - Math.abs(lz)
            const cosR2 = Math.cos(sm.mesh.rotation.y)
            const sinR2 = Math.sin(sm.mesh.rotation.y)
            if (oz <= ox) {
              // push along local z
              const pushZ = lz >= 0 ? halfD - lz : -halfD - lz
              const worldPushX = pushZ * (-sinR2) // = pushZ * sin(-r) inverted
              const worldPushZ = pushZ * cosR2
              newX += worldPushX
              newZ += worldPushZ
            } else {
              const pushX = lx >= 0 ? halfW - lx : -halfW - lx
              const worldPushX = pushX * cosR2
              const worldPushZ = pushX * sinR2
              newX += worldPushX
              newZ += worldPushZ
            }
          }
        }
        // Tree collision (simple radial)
        const pcx = Math.floor(newX / CHUNK_SIZE)
        const pcz = Math.floor(newZ / CHUNK_SIZE)
        for (let dcx = -1; dcx <= 1; dcx++) {
          for (let dcz = -1; dcz <= 1; dcz++) {
            const c = chunks.get(chunkKey(pcx + dcx, pcz + dcz))
            if (!c) continue
            for (const t of c.trees) {
              if (!t.collider) continue
              const dx = newX - t.px, dz = newZ - t.pz
              const minD = PLAYER_RADIUS + 0.45
              const d2 = dx * dx + dz * dz
              if (d2 < minD * minD) {
                const d = Math.sqrt(d2) || 0.001
                const push = (minD - d)
                newX += (dx / d) * push
                newZ += (dz / d) * push
              }
            }
            for (const ca of c.cacti) {
              if (!ca.collider) continue
              const dx = newX - ca.px, dz = newZ - ca.pz
              const minD = PLAYER_RADIUS + 0.38
              const d2 = dx * dx + dz * dz
              if (d2 < minD * minD) {
                const d = Math.sqrt(d2) || 0.001
                const push = (minD - d)
                newX += (dx / d) * push
                newZ += (dz / d) * push
              }
            }
          }
        }
        playerPos.x = newX
        playerPos.z = newZ

        // Vertical
        playerPos.y += playerVel.y * dt
        const terrainY = heightAt(playerPos.x, playerPos.z)
        const floorY = terrainY + PLAYER_HEIGHT
        // Check wooden floors
        let standingOn = floorY
        for (const sm of structureMeshes.values()) {
          if (sm.kind !== 'floor') continue
          const dx = playerPos.x - sm.mesh.position.x
          const dz = playerPos.z - sm.mesh.position.z
          if (Math.abs(dx) < 1 + PLAYER_RADIUS && Math.abs(dz) < 1 + PLAYER_RADIUS) {
            const floorTop = sm.mesh.position.y + 0.075 + PLAYER_HEIGHT
            if (playerPos.y <= floorTop + 0.1 && playerVel.y <= 0 && floorTop > standingOn) {
              standingOn = floorTop
            }
          }
        }
        if (playerPos.y <= standingOn) {
          // Fall damage
          if (playerVel.y < -14) {
            const dmg = Math.floor(Math.abs(playerVel.y + 14) * 2.5)
            if (dmg > 0) state.takeDamage(dmg)
          }
          playerPos.y = standingOn
          playerVel.y = 0
          onGround = true
        } else {
          onGround = false
        }

        // Update third-person character position & orientation
        // Feet at ground level: playerPos.y represents eye/head level (playerPos.y - PLAYER_HEIGHT ~ feet)
        const feetY = playerPos.y - PLAYER_HEIGHT
        playerMesh.position.set(playerPos.x, feetY, playerPos.z)
        // Character faces based on movement direction or mouse cursor.
        // The mesh forward is -Z, so yaw of 0 faces -Z (playerYaw is atan2(dx, dz), which aligns +Z)
        // Adding Math.PI makes the -Z front face the direction given by playerYaw.
        playerMesh.rotation.y = playerYaw + Math.PI

        // Walking animation: swing legs and arms
        const moving = wish.lengthSq() > 0 && onGround
        bob += dt * (moving ? (input.sprint ? 12 : 8) : 0)
        const swing = moving ? Math.sin(bob) * 0.7 : 0
        legL.rotation.x = swing
        legR.rotation.x = -swing
        // arm swing (unless attacking)
        if (attackTimer <= 0) {
          armL.rotation.x = -swing * 0.8
          armR.rotation.x = swing * 0.8
        }

        // --- First-person camera ---
        // The camera sits at the player's eye-level and looks in the direction
        // controlled by mouse-yaw (+ a slight downward pitch so the ground is
        // visible ahead).  Walk-bob adds a subtle vertical oscillation so the
        // view feels grounded while moving.
        const eyeY = feetY + PLAYER_HEIGHT - 0.12
        const walking = wish.lengthSq() > 0 && onGround
        const bobAmt = walking ? Math.sin(bob * 2) * 0.04 : 0
        const fx = Math.sin(yaw)
        const fz = -Math.cos(yaw)
        camera.position.set(playerPos.x, eyeY + bobAmt, playerPos.z)
        // Proper look target: horizontal = cos(pitch)*10 forward, vertical = sin(pitch)*10.
        const cosP = Math.cos(pitch)
        const sinP = Math.sin(pitch)
        camera.lookAt(
          playerPos.x + fx * cosP * 10,
          eyeY + bobAmt + sinP * 10,
          playerPos.z + fz * cosP * 10,
        )

        // Weapon view model (on character's right hand)
        const eq = state.equippedItem
        const hasWeapon = !!eq
        weaponGroup.visible = hasWeapon
        // Show the fist only when unarmed. The fist swings with its own arc
        // (parallel to the weapon's) so the player SEES a punch happen.
        fistGroup.visible = !hasWeapon
        if (hasWeapon) {
          // Hide every detail + held mesh; each branch below re-enables only
          // the meshes that belong to the currently-equipped item.
          handleMesh.visible = false
          gripWrap.visible = false
          weaponHead.visible = false
          pickSpike.visible = false
          pickBack.visible = false
          swordBlade.visible = false
          swordTip.visible = false
          swordGuard.visible = false
          swordPommel.visible = false
          axeBlade.visible = false
          axePoll.visible = false
          pickHeadBar.visible = false
          pickTip2.visible = false
          heldLogGroup.visible = false
          heldRockMesh.visible = false
          heldSapGroup.visible = false
          heldWoodMesh.visible = false
          heldFurnaceMesh.visible = false
          heldWallMesh.visible = false
          heldShirtMesh.visible = false
          heldPantsMesh.visible = false
          heldHatGroup.visible = false
          heldCloakMesh.visible = false
          heldHolyWaterGroup.visible = false

          if (eq === 'stone_pickaxe' || eq === 'iron_pickaxe') {
            // Wooden handle + grip + two-pointed pickaxe head
            handleMesh.visible = true
            gripWrap.visible = true
            handleMesh.scale.set(1, 1, 1)
            weaponMat.color.set(eq === 'iron_pickaxe' ? 0xd8dde2 : 0xa1a1aa)
            pickHeadBar.visible = true
            pickSpike.visible = true
            pickTip2.visible = true
          } else if (eq === 'stone_sword' || eq === 'iron_sword') {
            // Handle (shorter grip) + crossguard + long blade + tip + pommel
            handleMesh.visible = true
            gripWrap.visible = true
            handleMesh.scale.set(0.8, 0.55, 0.8)
            weaponMat.color.set(eq === 'iron_sword' ? 0xe8eef5 : 0xd4d4d8)
            swordBlade.visible = true
            swordTip.visible = true
            swordGuard.visible = true
            swordPommel.visible = true
          } else if (eq === 'stone_axe' || eq === 'iron_axe') {
            // Handle + grip + extruded axe blade + small poll on back
            handleMesh.visible = true
            gripWrap.visible = true
            handleMesh.scale.set(1, 1, 1)
            weaponMat.color.set(eq === 'iron_axe' ? 0xbfc7cf : 0xb45309)
            axeBlade.visible = true
            axePoll.visible = true
          } else if (eq === 'log') {
            heldLogGroup.visible = true
          } else if (eq === 'wood') {
            heldWoodMesh.visible = true
          } else if (eq === 'sap') {
            heldSapGroup.visible = true
          } else if (eq === 'stone' || eq === 'raw_iron' || eq === 'iron_ingot') {
            heldRockMesh.visible = true
            ;(heldRockMesh.material as THREE.MeshStandardMaterial).color.set(
              eq === 'raw_iron' ? 0x8a5a3a : eq === 'iron_ingot' ? 0xcbd5e1 : 0x9ca3af
            )
          } else if (eq === 'furnace') {
            heldFurnaceMesh.visible = true
          } else if (eq === 'wall' || eq === 'floor' || eq === 'log_wall' || eq === 'log_floor' || eq === 'spike_trap' || eq === 'tree_stand' || eq === 'bed') {
            heldWallMesh.visible = true
          } else if (eq === 'torn_shirt' || eq === 'shirt_common' || eq === 'shirt_rare' || eq === 'shirt_epic' || eq === 'shirt_legendary' || eq === 'shirt_godly') {
            heldShirtMesh.visible = true
            // Tint the shirt with the rarity color so the held item matches
            // the inventory UI's rarity border — a Legendary shirt looks gold,
            // a Godly shirt looks pale-gold, etc.
            const shirtColor = eq === 'shirt_godly' ? 0xfde68a
              : eq === 'shirt_legendary' ? 0xf59e0b
              : eq === 'shirt_epic' ? 0xa855f7
              : eq === 'shirt_rare' ? 0x38bdf8
              : eq === 'shirt_common' ? 0xa1a1aa
              : 0x8a6243 // torn_shirt (default brown)
            heldShirtMat.color.setHex(shirtColor)
          } else if (eq === 'torn_pants') {
            heldPantsMesh.visible = true
          } else if (eq === 'torn_hat') {
            heldHatGroup.visible = true
          } else if (eq === 'torn_cloak') {
            heldCloakMesh.visible = true
          } else if (eq === 'holy_water') {
            heldHolyWaterGroup.visible = true
          } else {
            // Fallback: generic club (plain handle + weaponHead)
            handleMesh.visible = true
            gripWrap.visible = true
            weaponHead.visible = true
            weaponMat.color.set(0x8a8a90)
            weaponHead.scale.set(0.7, 1, 1)
            handleMesh.scale.set(1, 1, 1)
          }
        }

        // Attack animation - swing weapon forward (first-person)
        if (attackTimer > 0) {
          attackTimer -= dt
          const p = 1 - attackTimer / ATTACK_COOLDOWN
          const swingA = Math.sin(p * Math.PI)
          // Weapon swings forward+down. Base rot.x = 0.25; subtract to pitch forward.
          weaponGroup.rotation.x = 0.25 - swingA * 1.0
          // Small left-kick and recovery rotation for visual interest.
          weaponGroup.rotation.z = -0.15 + swingA * 0.35
          weaponGroup.position.z = -0.82 - swingA * 0.18
          // Punch = shoulder rotates up-and-forward + elbow straightens.
          // This mirrors real boxing mechanics: the whole arm pivots at the
          // shoulder while the forearm extends, so the fist travels on a
          // clean forward arc instead of the hand floating around.
          fistGroup.rotation.x = -0.5 + swingA * 0.55
          fistGroup.rotation.z = -0.12 + swingA * 0.15
          fistGroup.position.z = 0.28 - swingA * 0.32
          fistGroup.position.x = 0.48 - swingA * 0.14
          fistGroup.position.y = -0.18 + swingA * 0.06
          // Elbow flex: bent at rest, snaps straight on impact.
          elbowGroup.rotation.x = -0.35 + swingA * 0.4
        } else {
          weaponGroup.rotation.x = 0.25
          weaponGroup.rotation.y = -0.3
          weaponGroup.rotation.z = -0.15
          weaponGroup.position.set(0.42, -0.45, -0.82)
          // Idle fist — subtle shoulder bob synced to head bob, plus a gentle
          // breathing sway so the arm looks alive. Elbow stays slightly bent.
          const breathe = Math.sin(performance.now() * 0.0018) * 0.02
          fistGroup.rotation.x = -0.5 + breathe
          fistGroup.rotation.z = -0.12
          fistGroup.position.set(0.48, -0.18 + bobAmt * 0.5, 0.28)
          elbowGroup.rotation.x = -0.35
        }

        // Extra first-person walking flair: a figure-eight hand sway and a
        // tiny roll make sprinting feel weighty even though the full body is
        // hidden in first person.  Other players still see interpolated ghost
        // avatars, while the local player gets immediate animation feedback.
        if (attackTimer <= 0 && walking) {
          const stride = Math.sin(bob)
          const step = Math.cos(bob * 2)
          if (hasWeapon) {
            weaponGroup.position.x = 0.42 + stride * 0.035
            weaponGroup.position.y = -0.45 + Math.abs(stride) * 0.035 + step * 0.012
            weaponGroup.rotation.y = -0.3 + stride * 0.045
            weaponGroup.rotation.z = -0.15 + stride * 0.08
          } else {
            fistGroup.position.x = 0.48 + stride * 0.045
            fistGroup.position.y = -0.18 + bobAmt * 0.5 + Math.abs(stride) * 0.035
            fistGroup.rotation.y = stride * 0.06
            fistGroup.rotation.z = -0.12 + stride * 0.08
          }
        }

        // Attack action
        if (input.attack && attackTimer <= 0) {
          attackTimer = ATTACK_COOLDOWN
          input.attack = false
          doAttack()
        } else {
          input.attack = false
        }

        // Build preview
        updateBuildGhost(state)

        // Zombies update
        if (isNightNow && isWorldAuthority) {
          zombieSpawnTimer -= dt
          if (zombieSpawnTimer <= 0) {
            zombieSpawnTimer = 3 + Math.random() * 4
            spawnZombie()
          }
        }
        for (let i = zombies.length - 1; i >= 0; i--) {
          const z = zombies[i]
          // simple AI: move toward player
          const dir = new THREE.Vector3().subVectors(playerPos, z.pos)
          dir.y = 0
          const dist = dir.length()
          if (dist > 0.001) dir.normalize()
          // Slow to a stop as the zombie gets inside its attack ring so it
          // never phases into the player's body.
          const MIN_STANDOFF = 1.05
          const speedScale = dist > MIN_STANDOFF ? 1 : Math.max(0, (dist - 0.8) / 0.25)
          z.vel.x = dir.x * ZOMBIE_SPEED * speedScale
          z.vel.z = dir.z * ZOMBIE_SPEED * speedScale
          z.pos.x += z.vel.x * dt
          z.pos.z += z.vel.z * dt
          // Push out of trees / stones / walls / furnaces
          collideEnemy(z.pos, 0.4)
          // Hard clamp: if we're somehow inside the standoff ring, push out.
          const nd = Math.sqrt((playerPos.x - z.pos.x) ** 2 + (playerPos.z - z.pos.z) ** 2)
          if (nd < MIN_STANDOFF && nd > 0.001) {
            const k = MIN_STANDOFF / nd
            z.pos.x = playerPos.x - (playerPos.x - z.pos.x) * k
            z.pos.z = playerPos.z - (playerPos.z - z.pos.z) * k
          }
          z.pos.y = heightAt(z.pos.x, z.pos.z)
          z.mesh.position.copy(z.pos)
          // face player
          z.mesh.rotation.y = Math.atan2(playerPos.x - z.pos.x, playerPos.z - z.pos.z)
          // --- Walking animation ---
          // Phase advances with horizontal speed; `gait` is the swing amplitude.
          const zSpd = Math.sqrt(z.vel.x * z.vel.x + z.vel.z * z.vel.z)
          if (zSpd > 0.05) {
            z.walkPhase += zSpd * dt * 2.4
          }
          // Swing amplitude scales with speed up to a cap — lurching walk.
          const zSwing = Math.min(zSpd / ZOMBIE_SPEED, 1.0)
          const zS = Math.sin(z.walkPhase) * zSwing
          // Legs step forward/back
          z.legL.rotation.x = zS * 0.75
          z.legR.rotation.x = -zS * 0.75
          // Arms stay forward (Frankenstein pose) but sway opposite legs
          z.armL.rotation.x = -0.55 - zS * 0.35
          z.armR.rotation.x = -0.55 + zS * 0.35
          // Gentle body bob and side-to-side head tilt (zombie lurch)
          z.body.position.y = 0.9 + Math.abs(zS) * 0.05
          z.body.rotation.z = zS * 0.08
          z.head.rotation.z = -zS * 0.06
          z.head.rotation.y = Math.sin(z.walkPhase * 0.5) * 0.05
          // spike trap damage (continuous while standing over trap)
          for (const st of state.structures) {
            if (st.kind !== 'spike_trap') continue
            const dx = z.pos.x - st.x
            const dzd = z.pos.z - st.z
            if (dx * dx + dzd * dzd < 0.9) {
              z.hp -= 35 * dt
              z.hurtTimer = 0.15
              break
            }
          }
          // hurt flash
          if (z.hurtTimer > 0) {
            z.hurtTimer -= dt
            z.mesh.scale.setScalar(1 + Math.sin(z.hurtTimer * 30) * 0.05)
          } else {
            z.mesh.scale.setScalar(1)
          }
          // attack
          z.attackTimer -= dt
          if (dist < ZOMBIE_ATTACK_RANGE && z.attackTimer <= 0) {
            z.attackTimer = 1.2
            state.takeDamage(ZOMBIE_DAMAGE)
          }
          // death by trap
          if (z.hp <= 0) {
            const deathX = z.pos.x, deathY = z.pos.y, deathZ = z.pos.z
            removeZombie(z)
            zombies.splice(i, 1)
            state.addXp(15)
            state.addZombieKill()
            if (Math.random() < 0.35) {
              // 40% of clothing drops are shirts (weighted by rarity),
              // remaining 60% split among the legacy cosmetic scraps.
              const isShirt = Math.random() < 0.4
              const pickId: ItemId = isShirt
                ? rollShirtRarity()
                : (['torn_pants', 'torn_hat', 'torn_cloak'] as ItemId[])[Math.floor(Math.random() * 3)]
              dropItemToWorld(pickId, 1, deathX, deathY + 0.4, deathZ)
            }
            state.showToast('🩸 Impaled! +15 XP')
            continue
          }
          // despawn if day
          if (!isNightNow || dist > 90) {
            removeZombie(z)
            zombies.splice(i, 1)
          }
        }

        // Vampire spawning (slower, rarer than zombies — boss encounters)
        if (isNightNow && isWorldAuthority) {
          vampireSpawnTimer -= dt
          if (vampireSpawnTimer <= 0) {
            vampireSpawnTimer = 45 + Math.random() * 30
            spawnVampire()
          }
        }

        // Vampire update
        for (let i = vampires.length - 1; i >= 0; i--) {
          const v = vampires[i]
          if (v.fleeing) {
            // Vampire is mid-transformation, flying away as a bat
            v.fleeTimer += dt
            if (v.bat) {
              v.bat.position.y += dt * 8
              // push away from player
              const away = new THREE.Vector3().subVectors(v.bat.position, playerPos)
              away.y = 0
              if (away.length() < 0.001) away.set(1, 0, 0)
              away.normalize()
              v.bat.position.x += away.x * dt * 12
              v.bat.position.z += away.z * dt * 12
              const flap = Math.sin(v.fleeTimer * 26) * 0.9
              ;(v.bat as any).wL.rotation.z = flap
              ;(v.bat as any).wR.rotation.z = -flap
              v.bat.rotation.y = Math.atan2(away.x, away.z)
            }
            if (v.fleeTimer > 6) {
              removeVampire(v)
              vampires.splice(i, 1)
            }
            continue
          }
          // AI: glide toward player, but stop short so they don't phase in.
          const dir = new THREE.Vector3().subVectors(playerPos, v.pos)
          dir.y = 0
          const dist = dir.length()
          if (dist > 0.001) dir.normalize()
          const VAMP_STANDOFF = 1.25
          const vSpeedScale = dist > VAMP_STANDOFF ? 1 : Math.max(0, (dist - 0.9) / 0.35)
          v.vel.x = dir.x * VAMPIRE_SPEED * vSpeedScale
          v.vel.z = dir.z * VAMPIRE_SPEED * vSpeedScale
          v.pos.x += v.vel.x * dt
          v.pos.z += v.vel.z * dt
          // Push out of trees / stones / walls / furnaces
          collideEnemy(v.pos, 0.45)
          const vnd = Math.sqrt((playerPos.x - v.pos.x) ** 2 + (playerPos.z - v.pos.z) ** 2)
          if (vnd < VAMP_STANDOFF && vnd > 0.001) {
            const k = VAMP_STANDOFF / vnd
            v.pos.x = playerPos.x - (playerPos.x - v.pos.x) * k
            v.pos.z = playerPos.z - (playerPos.z - v.pos.z) * k
          }
          v.pos.y = heightAt(v.pos.x, v.pos.z)
          v.mesh.position.copy(v.pos)
          v.mesh.rotation.y = Math.atan2(playerPos.x - v.pos.x, playerPos.z - v.pos.z)
          // spike trap damage on vampires too (reduced vs zombies)
          for (const st of state.structures) {
            if (st.kind !== 'spike_trap') continue
            const dx = v.pos.x - st.x
            const dzd = v.pos.z - st.z
            if (dx * dx + dzd * dzd < 0.9) {
              v.hp -= 20 * dt
              v.hurtTimer = 0.15
              break
            }
          }
          // --- Vampire walking / gliding animation ---
          const vSpd = Math.sqrt(v.vel.x * v.vel.x + v.vel.z * v.vel.z)
          if (vSpd > 0.05) v.walkPhase += vSpd * dt * 2.0
          const vSwing = Math.min(vSpd / VAMPIRE_SPEED, 1.0)
          const vS = Math.sin(v.walkPhase) * vSwing
          // Legs glide slightly (vampires don't really walk, they hover)
          v.legL.rotation.x = vS * 0.3
          v.legR.rotation.x = -vS * 0.3
          // Arms drift like a slow cape dance
          v.armL.rotation.x = -0.3 + vS * 0.2
          v.armR.rotation.x = -0.3 - vS * 0.2
          v.armL.rotation.z = 0.1 + Math.sin(performance.now() * 0.003) * 0.05
          v.armR.rotation.z = -0.1 - Math.sin(performance.now() * 0.003) * 0.05
          // cape flutter & subtle hover bob
          if (v.cape) v.cape.rotation.x = Math.sin(performance.now() * 0.004) * 0.18
          v.mesh.position.y += Math.sin(performance.now() * 0.003 + v.pos.x) * 0.04
          // hurt flash
          if (v.hurtTimer > 0) {
            v.hurtTimer -= dt
            v.mesh.scale.setScalar(1 + Math.sin(v.hurtTimer * 30) * 0.05)
          } else {
            v.mesh.scale.setScalar(1)
          }
          // attack
          v.attackTimer -= dt
          if (dist < VAMPIRE_ATTACK_RANGE && v.attackTimer <= 0) {
            v.attackTimer = 1.4
            state.takeDamage(VAMPIRE_DAMAGE)
          }
          // despawn if drifted far, or if player somehow escaped
          if (dist > 120) {
            removeVampire(v)
            vampires.splice(i, 1)
          }
        }

        // --- Huge Orc boss spawning & AI ---
        if (isNightNow && isWorldAuthority) orcSpawnTimer -= dt
        if (isNightNow && isWorldAuthority && orcSpawnTimer <= 0) {
          const spawned = spawnOrc()
          // If the player has not discovered/loaded a cave yet, try again soon
          // instead of forcing a surface spawn.
          orcSpawnTimer = spawned ? 360 + Math.random() * 240 : 45 + Math.random() * 45
        }
        for (let i = orcs.length - 1; i >= 0; i--) {
          const o = orcs[i]
          const toPlayer = new THREE.Vector3().subVectors(playerPos, o.pos)
          toPlayer.y = 0
          const dist = toPlayer.length()
          if (dist > 0.001) toPlayer.normalize()

          o.attackTimer -= dt
          o.grabCooldown -= dt
          o.stateTimer -= dt

          if (o.state === 'dying') {
            const p = Math.max(0, 1 - o.stateTimer / 2.1)
            o.mesh.rotation.z = p * 1.45
            o.mesh.rotation.x = -p * 0.45
            o.mesh.position.y = o.pos.y + Math.sin(p * Math.PI) * 0.55
            o.armR.rotation.x = -1.8 + p * 1.5
            o.armL.rotation.x = -0.6 + p * 1.4
            if (o.stateTimer <= 0) {
              const px = o.pos.x, py = o.pos.y, pz = o.pos.z
              removeOrc(o)
              orcs.splice(i, 1)
              state.addXp(350)
              state.addZombieKill()
              state.showToast('👑 Huge Orc defeated! +350 XP')
              dropItemToWorld('wood', 10, px, py + 0.7, pz)
              dropItemToWorld('raw_iron', 4, px + 0.5, py + 0.7, pz)
            }
            continue
          }

          if (o.state === 'down') {
            o.vel.set(0, 0, 0)
            o.mesh.rotation.z = 1.22 + Math.sin(performance.now() * 0.009) * 0.03
            o.armR.rotation.x = -0.25
            o.armL.rotation.x = 0.35
            o.legL.rotation.x = 0.4
            o.legR.rotation.x = -0.25
            o.jaw.rotation.x = 0.35
            if (o.stateTimer <= 0) {
              o.state = 'gettingUp'
              o.stateTimer = 1.4
            }
          } else if (o.state === 'gettingUp') {
            const p = 1 - Math.max(0, o.stateTimer / 1.4)
            o.mesh.rotation.z = (1 - p) * 1.22
            o.mesh.position.y = o.pos.y + (1 - p) * 0.35
            o.jaw.rotation.x = 0.1
            if (o.stateTimer <= 0) {
              o.state = 'roaring'
              o.stateTimer = 1.2
              o.mesh.rotation.set(0, o.mesh.rotation.y, 0)
            }
          } else if (o.state === 'roaring') {
            o.vel.set(0, 0, 0)
            o.mesh.rotation.y = Math.atan2(playerPos.x - o.pos.x, playerPos.z - o.pos.z)
            const roar = Math.sin(performance.now() * 0.018)
            o.body.position.y = 1.75 + Math.abs(roar) * 0.08
            o.head.rotation.x = -0.12 + roar * 0.08
            o.jaw.rotation.x = 0.55 + Math.abs(roar) * 0.18
            o.armL.rotation.x = -1.1 + roar * 0.18
            o.armR.rotation.x = -1.2 - roar * 0.18
            if (o.stateTimer <= 0) o.state = 'walking'
          } else {
            const ORC_STANDOFF = 2.15
            const speedScale = dist > ORC_STANDOFF ? 1 : Math.max(0, (dist - 1.55) / 0.6)
            o.vel.x = toPlayer.x * ORC_SPEED * speedScale
            o.vel.z = toPlayer.z * ORC_SPEED * speedScale
            o.pos.x += o.vel.x * dt
            o.pos.z += o.vel.z * dt
            collideEnemy(o.pos, 0.95)
            const od = Math.sqrt((playerPos.x - o.pos.x) ** 2 + (playerPos.z - o.pos.z) ** 2)
            if (od < ORC_STANDOFF && od > 0.001) {
              const k = ORC_STANDOFF / od
              o.pos.x = playerPos.x - (playerPos.x - o.pos.x) * k
              o.pos.z = playerPos.z - (playerPos.z - o.pos.z) * k
            }
            o.pos.y = heightAt(o.pos.x, o.pos.z)
            o.mesh.position.copy(o.pos)
            o.mesh.rotation.y = Math.atan2(playerPos.x - o.pos.x, playerPos.z - o.pos.z)

            const spd = Math.sqrt(o.vel.x * o.vel.x + o.vel.z * o.vel.z)
            if (spd > 0.05) o.walkPhase += spd * dt * 1.9
            const swing = Math.sin(o.walkPhase) * Math.min(spd / ORC_SPEED, 1)
            o.legL.rotation.x = swing * 0.55
            o.legR.rotation.x = -swing * 0.55
            o.armL.rotation.x = -swing * 0.42
            o.armR.rotation.x = -0.45 + swing * 0.38
            o.club.rotation.z = Math.sin(o.walkPhase + 0.5) * 0.12
            o.body.position.y = 1.75 + Math.abs(swing) * 0.06
            o.body.rotation.z = swing * 0.035
            o.head.rotation.y = Math.sin(o.walkPhase * 0.5) * 0.07
            o.jaw.rotation.x = 0.04

            if (dist < ORC_GRAB_RANGE && o.grabCooldown <= 0) {
              o.grabCooldown = ORC_GRAB_COOLDOWN
              o.attackTimer = 1.6
              state.takeDamage(ORC_GRAB_DAMAGE)
              const away = new THREE.Vector3().subVectors(playerPos, o.pos)
              away.y = 0
              if (away.lengthSq() < 0.001) away.set(1, 0, 0)
              away.normalize()
              playerVel.x += away.x * 13
              playerVel.z += away.z * 13
              playerVel.y = Math.max(playerVel.y, 8)
              o.state = 'roaring'
              o.stateTimer = 1.05
              state.showToast('👹 The orc grabs and throws you! -30 HP')
            } else if (dist < ORC_ATTACK_RANGE && o.attackTimer <= 0) {
              o.attackTimer = 2.0
              state.takeDamage(ORC_CLUB_DAMAGE)
              o.armR.rotation.x = -2.2
              o.club.rotation.x = -0.8
              state.showToast('🪵 Orc club smash!')
            }
          }

          // Weak spots pulse to make the knockdown mechanic readable.
          const pulse = 1 + Math.sin(performance.now() * 0.008) * 0.18
          for (const ws of o.weakSpots) ws.mesh.scale.setScalar(pulse)
          if (o.hurtTimer > 0) {
            o.hurtTimer -= dt
            o.mesh.scale.setScalar(1 + Math.sin(o.hurtTimer * 30) * 0.035)
          } else {
            o.mesh.scale.setScalar(1)
          }

          // spike trap chip damage only; boss should not be trivialized by traps.
          for (const st of state.structures) {
            if (st.kind !== 'spike_trap') continue
            const dx = o.pos.x - st.x
            const dzd = o.pos.z - st.z
            if (dx * dx + dzd * dzd < 1.15) {
              damageOrc(o, 8 * dt)
              break
            }
          }
        }

        // --- Goblin spawning & AI ---
        // Goblins appear on the surface at night, sprint in, steal one inventory
        // stack, then bolt. Kill before they escape to recover the loot.
        if (isNightNow && isWorldAuthority) goblinSpawnTimer -= dt
        if (isNightNow && isWorldAuthority && goblinSpawnTimer <= 0) {
          // Next goblin sighting: 4–8 minutes later.
          goblinSpawnTimer = 240 + Math.random() * 240
          spawnGoblin()
        }
        for (let i = goblins.length - 1; i >= 0; i--) {
          const gb = goblins[i]
          // hurt flash
          if (gb.hurtTimer > 0) {
            gb.hurtTimer -= dt
            gb.mesh.scale.setScalar(1 + Math.sin(gb.hurtTimer * 30) * 0.06)
          } else {
            gb.mesh.scale.setScalar(1)
          }

          if (gb.phase === 'approach') {
            const dir = new THREE.Vector3().subVectors(playerPos, gb.pos)
            dir.y = 0
            const dist = dir.length()
            if (dist > 0.001) dir.normalize()
            gb.vel.x = dir.x * GOBLIN_SPEED
            gb.vel.z = dir.z * GOBLIN_SPEED
            gb.pos.x += gb.vel.x * dt
            gb.pos.z += gb.vel.z * dt
            // Push out of trees / stones / walls / furnaces
            collideEnemy(gb.pos, 0.35)
            gb.pos.y = heightAt(gb.pos.x, gb.pos.z)
            gb.mesh.rotation.y = Math.atan2(playerPos.x - gb.pos.x, playerPos.z - gb.pos.z)
            gb.mesh.position.copy(gb.pos)
            // Start the grab motion once in range
            if (dist < GOBLIN_ATTACK_RANGE + 0.4) {
              gb.phase = 'grabbing'
              gb.grabTimer = 0.5
            }
          } else if (gb.phase === 'grabbing') {
            // Pause, wave arms, then try to snatch a random inventory stack.
            gb.grabTimer -= dt
            // simple arm wave: rotate mesh slightly
            gb.mesh.rotation.y += Math.sin(performance.now() * 0.02) * 0.03
            if (gb.grabTimer <= 0) {
              const stState = useGame.getState()
              // Choose a random non-empty slot (any item)
              const candidates: number[] = []
              stState.inventory.forEach((s, idx) => { if (s && s.id && s.count > 0) candidates.push(idx) })
              if (candidates.length === 0) {
                // Nothing to steal — goblin just flees empty-handed.
                stState.showToast('😤 A goblin found nothing worth stealing!')
              } else {
                const pickIdx = candidates[Math.floor(Math.random() * candidates.length)]
                const slot = stState.inventory[pickIdx]
                if (slot && slot.id) {
                  const takeCount = Math.min(slot.count, 1 + Math.floor(Math.random() * 3))
                  stState.removeItem(slot.id, takeCount)
                  gb.stolen = { id: slot.id, count: takeCount }
                  addToGoblinBackpack(gb, slot.id, takeCount)
                  stState.showToast(`🟢 A goblin packed ${takeCount}× ${ITEMS[slot.id].name} into its backpack!`)
                  // Give the goblin a visible sack
                  const sackMat = new THREE.MeshLambertMaterial({ color: 0x7a5a2a })
                  const sack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.2), sackMat)
                  sack.position.set(0.25, 0.85, 0.22)
                  sack.castShadow = true
                  gb.mesh.add(sack)
                  gb.sack = sack
                }
              }
              // Pick a flee direction pointing away from the player
              const ax = gb.pos.x - playerPos.x
              const az = gb.pos.z - playerPos.z
              const al = Math.sqrt(ax * ax + az * az) || 1
              gb.fleeDir.set(ax / al, az / al)
              gb.phase = 'fleeing'
            }
          } else {
            // fleeing: sprint directly away from player
            gb.vel.x = gb.fleeDir.x * GOBLIN_SPEED * 1.15
            gb.vel.z = gb.fleeDir.y * GOBLIN_SPEED * 1.15
            gb.pos.x += gb.vel.x * dt
            gb.pos.z += gb.vel.z * dt
            // Push out of trees / stones / walls / furnaces
            collideEnemy(gb.pos, 0.35)
            gb.pos.y = heightAt(gb.pos.x, gb.pos.z)
            gb.mesh.rotation.y = Math.atan2(gb.fleeDir.x, gb.fleeDir.y)
            gb.mesh.position.copy(gb.pos)
            // Escaped! despawn without dropping if they got away
            const dx = gb.pos.x - playerPos.x
            const dz = gb.pos.z - playerPos.z
            if (dx * dx + dz * dz > 70 * 70) {
              if (gb.stolen) {
                useGame.getState().showToast('💨 A goblin escaped with your loot!')
              }
              removeGoblin(gb)
              goblins.splice(i, 1)
              continue
            }
          }

          // --- Goblin running / arm-wave animation ---
          // During approach & fleeing goblins SPRINT, so animate with large
          // stride amplitude. When grabbing, flail arms overhead.
          if (gb.phase === 'grabbing') {
            // Frantic arm-wave while stealing
            const wave = Math.sin(performance.now() * 0.02)
            gb.armL.rotation.x = -1.6 + wave * 0.4
            gb.armR.rotation.x = -1.6 - wave * 0.4
            gb.legL.rotation.x = 0
            gb.legR.rotation.x = 0
            gb.body.position.y = 0.55
            // Reset body lean left over from sprinting so the goblin doesn't
            // stay hunched forward while standing at the chest.
            gb.body.rotation.x = 0
          } else {
            const gSpd = Math.sqrt(gb.vel.x * gb.vel.x + gb.vel.z * gb.vel.z)
            if (gSpd > 0.05) gb.walkPhase += gSpd * dt * 3.2
            const gSwing = Math.min(gSpd / GOBLIN_SPEED, 1.0)
            const gS = Math.sin(gb.walkPhase) * gSwing
            // Big sprinting strides
            gb.legL.rotation.x = gS * 1.1
            gb.legR.rotation.x = -gS * 1.1
            // Arms pump opposite legs (big swing for running)
            gb.armL.rotation.x = -gS * 0.9
            gb.armR.rotation.x = gS * 0.9
            // Body bob vertically with each step + lean forward while sprinting
            gb.body.position.y = 0.55 + Math.abs(gS) * 0.07
            gb.body.rotation.x = gSwing * 0.15
          }

          // spike trap damage
          for (const st of state.structures) {
            if (st.kind !== 'spike_trap') continue
            const dx = gb.pos.x - st.x
            const dzd = gb.pos.z - st.z
            if (dx * dx + dzd * dzd < 0.9) {
              gb.hp -= 25 * dt
              gb.hurtTimer = 0.15
              break
            }
          }
          // death: drop stolen loot + small XP
          if (gb.hp <= 0) {
            const dropped = dropGoblinBackpack(gb)
            if (dropped > 0) {
              useGame.getState().showToast(`💰 Goblin slain! Backpack dropped ${dropped} stolen item${dropped === 1 ? '' : 's'}`)
            } else {
              useGame.getState().showToast('💰 Goblin slain!')
            }
            useGame.getState().addXp(20)
            removeGoblin(gb)
            goblins.splice(i, 1)
          }
        }

        // Update procedural audio: day-birds, night-owls/crickets, vampire whispers
        {
          let nearestVamp = Infinity
          for (const v of vampires) {
            if (v.fleeing) continue
            const dx = v.pos.x - playerPos.x
            const dz = v.pos.z - playerPos.z
            const d = Math.sqrt(dx * dx + dz * dz)
            if (d < nearestVamp) nearestVamp = d
          }
          try { getGameAudio().update(isNightNow, nearestVamp) } catch {}
        }

        // Track the single closest hostile within 18 units so the HUD can
        // draw a focus health-bar. Vampires win ties with bigger threat.
        {
          let bestD = 18
          let best: { name: string; hp: number; maxHp: number; dist: number; kind: string } | null = null
          for (const z of zombies) {
            const dx = z.pos.x - playerPos.x
            const dz = z.pos.z - playerPos.z
            const d = Math.sqrt(dx * dx + dz * dz)
            if (d < bestD) { bestD = d; best = { name: 'Zombie', hp: z.hp, maxHp: ZOMBIE_HEALTH, dist: d, kind: 'zombie' } }
          }
          for (const v of vampires) {
            if (v.fleeing) continue
            const dx = v.pos.x - playerPos.x
            const dz = v.pos.z - playerPos.z
            const d = Math.sqrt(dx * dx + dz * dz)
            // Vampires always take priority within range
            if (d < 22) { bestD = d; best = { name: 'Vampire', hp: v.hp, maxHp: VAMPIRE_HEALTH, dist: d, kind: 'vampire' }; break }
          }
          for (const gb of goblins) {
            const dx = gb.pos.x - playerPos.x
            const dz = gb.pos.z - playerPos.z
            const d = Math.sqrt(dx * dx + dz * dz)
            if (d < bestD) { bestD = d; best = { name: 'Goblin', hp: gb.hp, maxHp: GOBLIN_HEALTH, dist: d, kind: 'goblin' } }
          }
          let boss: { name: string; hp: number; maxHp: number; dist: number; kind: string; state?: string; grabCooldown?: number } | null = null
          for (const o of orcs) {
            const dx = o.pos.x - playerPos.x
            const dz = o.pos.z - playerPos.z
            const d = Math.sqrt(dx * dx + dz * dz)
            if (!boss || d < boss.dist) boss = { name: 'Huge Green Orc', hp: o.hp, maxHp: ORC_HEALTH, dist: d, kind: 'orc', state: o.state, grabCooldown: Math.max(0, o.grabCooldown) }
            if (d < 40) best = { name: 'Huge Green Orc', hp: o.hp, maxHp: ORC_HEALTH, dist: d, kind: 'orc' }
          }
          ;(window as any).__nightfall_nearestEnemy = best
          ;(window as any).__nightfall_boss = boss
        }

        // Flag whether the player is standing near any furnace so the
        // crafting panel can enable smelting recipes. 4m radius.
        {
          let nearF = false
          const structsNow = useGame.getState().structures
          for (const st of structsNow) {
            if (st.kind !== 'furnace') continue
            const dx = st.x - playerPos.x
            const dz = st.z - playerPos.z
            if (dx * dx + dz * dz < 16) { nearF = true; break }
          }
          ;(window as any).__nightfall_nearFurnace = nearF
        }

        // Subtle flicker for furnace glow lights so the forge feels alive.
        {
          const tNow = performance.now() / 1000
          for (const [, sm] of structureMeshes) {
            if (sm.kind !== 'furnace' && sm.kind !== 'bed') continue
            const glow = (sm.mesh as any).__furnaceGlow as THREE.PointLight | undefined
            if (glow) {
              glow.intensity = 1.2 + 0.35 * Math.sin(tNow * 8 + sm.id.length) + 0.15 * Math.sin(tNow * 17)
            }
          }
        }

        // --- Falling-tree animation ---
        // Advance each tipping tree, then on landing shake the ground and
        // spawn 2 logs on the forest floor that the player can pick up (E
        // or just by walking over them — auto-pickup kicks in within 1.5m).
        for (let i = fallingTrees.length - 1; i >= 0; i--) {
          const ft = fallingTrees[i]
          if (!ft.landed) {
            ft.progress += dt / ft.duration
            const t = Math.min(1, ft.progress)
            // Gravity-like ease-in (t²): hesitates at the start, whips down at the end.
            const eased = t * t
            const q = ft.startQuat.clone().slerp(ft.endQuat, eased)
            ft.mesh.quaternion.copy(q)
            if (t >= 1) {
              ft.landed = true
              // Spawn logs spread along the fallen trunk so the pile looks
              // like it spilled out of the tree.  Player can scoop with E
              // or just walk over them.
              const baseY = heightAt(ft.px, ft.pz) + 0.4
              dropItemToWorld('log', 1, ft.px + ft.axisX * 0.8, baseY, ft.pz + ft.axisZ * 0.8)
              dropItemToWorld('log', 1, ft.px + ft.axisX * 2.2, baseY, ft.pz + ft.axisZ * 2.2)
              useGame.getState().showToast('🪵 +2 Logs on the ground — pick them up!')
              ft.broken = true
            }
          } else {
            // Linger: fallen trunk stays visible for a moment, then fades out
            // so the forest floor isn't permanently cluttered with old trunks.
            ft.linger -= dt
            if (ft.linger <= 0) {
              if (ft.mesh.parent) ft.mesh.parent.remove(ft.mesh)
              fallingTrees.splice(i, 1)
            } else if (ft.linger < 1) {
              // Sink slightly into the ground & fade traversal-sprite style
              // by scaling down: gives a soft "decomposing" look.
              const s = Math.max(0.05, ft.linger)
              ft.mesh.scale.setScalar(s)
            }
          }
        }

        // --- Falling-cactus animation ---
        // Cacti tip over with a snappy wobble and sticky amber sap already
        // popping free as collectible drops.
        for (let i = fallingCacti.length - 1; i >= 0; i--) {
          const fc = fallingCacti[i]
          if (!fc.landed) {
            fc.progress += dt / fc.duration
            const t = Math.min(1, fc.progress)
            const eased = t < 0.72 ? 1 - Math.pow(1 - t / 0.72, 3) * 0.18 : 1
            const q = fc.startQuat.clone().slerp(fc.endQuat, Math.min(1, t * t * (3 - 2 * t)))
            fc.mesh.quaternion.copy(q)
            fc.mesh.rotation.y += Math.sin(t * Math.PI * 8) * (1 - t) * 0.025
            fc.mesh.position.y = heightAt(fc.px, fc.pz) + Math.sin(Math.min(1, t) * Math.PI) * 0.05 * eased
            if (t >= 1) {
              fc.landed = true
              fc.mesh.position.y = heightAt(fc.px, fc.pz) + 0.03
            }
          } else {
            fc.linger -= dt
            if (fc.linger <= 0) {
              if (fc.mesh.parent) fc.mesh.parent.remove(fc.mesh)
              fallingCacti.splice(i, 1)
            } else if (fc.linger < 0.85) {
              fc.mesh.scale.setScalar(Math.max(0.05, fc.linger / 0.85))
            }
          }
        }

        // Dropped items -> gravity & auto-pickup
        for (const c of chunks.values()) {
          for (let i = c.droppedItems.length - 1; i >= 0; i--) {
            const d = c.droppedItems[i]
            d.life -= dt
            if (d.life <= 0) {
              scene.remove(d.mesh)
              c.droppedItems.splice(i, 1)
              continue
            }
            // gravity
            d.vy -= GRAVITY * 0.5 * dt
            d.py += d.vy * dt
            const gy = heightAt(d.px, d.pz) + 0.2
            if (d.py <= gy) { d.py = gy; d.vy = 0 }
            d.mesh.position.set(d.px, d.py, d.pz)
            // Logs rest still; cubes spin to catch the eye.
            if (d.id !== 'log') d.mesh.rotation.y += dt * 2
            // Despawn warning: rapid flicker in the last 5 seconds of life
            if (d.life < 5) {
              d.mesh.visible = Math.floor(d.life * 6) % 2 === 0
            } else {
              d.mesh.visible = true
            }
            // auto pickup
            const dx = d.px - playerPos.x, dz = d.pz - playerPos.z, dy = d.py - playerPos.y
            const distSq = dx * dx + dz * dz + dy * dy
            if (distSq < 1.5 * 1.5) {
              const ok = useGame.getState().addItem(d.id, d.count)
              if (ok) {
                scene.remove(d.mesh)
                c.droppedItems.splice(i, 1)
              }
            }
          }
        }

        // Damage flash decay
        if (state.damageFlash > 0) {
          useGame.setState({ damageFlash: Math.max(0, state.damageFlash - dt * 1.5) })
        }

        // Update chunks
        acc += dt
        if (acc > 0.5) { acc = 0; updateChunks(playerPos.x, playerPos.z) }
      }

      // Ghost interpolation — smoothly ease each ghost toward its latest
      // target pose so the ~3s polling interval doesn't feel choppy.
      if (ghosts.size > 0) {
        const easePos = 1 - Math.pow(0.001, dt) // ~3.3/sec
        const easeYaw = 1 - Math.pow(0.004, dt)
        for (const g of ghosts.values()) {
          g.pos.x += (g.target.x - g.pos.x) * easePos
          g.pos.y += (g.target.y - g.pos.y) * easePos
          g.pos.z += (g.target.z - g.pos.z) * easePos
          // Angle lerp through shortest arc
          let dyaw = g.targetYaw - g.yaw
          while (dyaw > Math.PI) dyaw -= Math.PI * 2
          while (dyaw < -Math.PI) dyaw += Math.PI * 2
          g.yaw += dyaw * easeYaw
          // Place the mesh: posY from the server is the player's EYE level
          // (matches playerPos.y).  Our ghost model is built feet-up so we
          // shift it down by PLAYER_HEIGHT.
          g.mesh.position.set(g.pos.x, g.pos.y - PLAYER_HEIGHT, g.pos.z)
          g.mesh.rotation.y = g.yaw
        }
      }

      renderer.render(scene, camera)
    }

    function doAttack() {
      // First-person: attacks always shoot through the center-screen crosshair,
      // i.e. along the camera's forward direction.  This matches what the
      // player sees the reticle pointing at, regardless of invisible cursor pos.
      const origin = new THREE.Vector3(playerPos.x, playerPos.y - 0.3, playerPos.z)
      const attackDir = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw))
      raycaster.set(origin, attackDir)
      raycaster.far = REACH
      // Determine damage
      const eq = useGame.getState().equippedItem
      let dmg = FIST_DAMAGE
      if (eq && ITEMS[eq]?.damage) dmg = ITEMS[eq]!.damage!

      // If the player is holding a cosmetic / placeable / resource (anything
      // that has no damage stat and isn't the holy water consumable), block
      // the attack entirely.  Bare-hand fists still work (eq is null).
      if (eq && eq !== 'holy_water' && !ITEMS[eq]?.damage) {
        useGame.getState().showToast(`✋ You can't attack with ${ITEMS[eq].name}`)
        return
      }

      // PvP: player ghosts are real targets.  Hits are sent through the shared
      // world event stream; the victim applies damage, a tiny knockback, and
      // drops all inventory/build items if the hit kills them.
      if (eq !== 'holy_water') {
        let bestGhost: { id: string; name: string; distance: number } | null = null
        for (const [id, g] of ghosts) {
          const hits = raycaster.intersectObject(g.mesh, true)
          if (hits.length && hits[0].distance < REACH) {
            if (!bestGhost || hits[0].distance < bestGhost.distance) bestGhost = { id, name: (g as any).name || 'Survivor', distance: hits[0].distance }
          }
        }
        if (bestGhost) {
          const attackerId = ownMemberKey() || worldClientId
          let attackerName = 'Survivor'
          try { attackerName = window.localStorage.getItem('nightfall:guestName') || attackerName } catch {}
          const knock = 0.42
          queueWorldEvent('pvp_hit', {
            targetId: bestGhost.id,
            attackerId,
            attackerName,
            damage: dmg,
            knockX: attackDir.x * knock,
            knockZ: attackDir.z * knock,
          })
          useGame.getState().showToast(`⚔️ Hit ${bestGhost.name} for ${dmg}`)
          return
        }
      }

      // Holy water: single-use, instant-kill a zombie or vampire within reach.
      if (eq === 'holy_water') {
        let bestTarget: { kind: 'zombie' | 'vampire'; idx: number; dist: number } | null = null
        for (let i = 0; i < zombies.length; i++) {
          const z = zombies[i]
          const hits = raycaster.intersectObject(z.mesh, true)
          if (hits.length && hits[0].distance < REACH) {
            if (!bestTarget || hits[0].distance < bestTarget.dist) bestTarget = { kind: 'zombie', idx: i, dist: hits[0].distance }
          }
        }
        for (let i = 0; i < vampires.length; i++) {
          const v = vampires[i]
          if (v.fleeing) continue
          const hits = raycaster.intersectObject(v.mesh, true)
          if (hits.length && hits[0].distance < REACH) {
            if (!bestTarget || hits[0].distance < bestTarget.dist) bestTarget = { kind: 'vampire', idx: i, dist: hits[0].distance }
          }
        }
        // Holy water is a single-use consumable — it's used up on EVERY throw,
        // even if the splash misses, so players can't farm infinite vials.
        useGame.getState().removeItem('holy_water', 1)
        if (bestTarget) {
          if (bestTarget.kind === 'zombie') {
            const z = zombies[bestTarget.idx]
            removeZombie(z)
            zombies.splice(bestTarget.idx, 1)
            useGame.getState().addXp(30)
            useGame.getState().addZombieKill()
            useGame.getState().showToast('🧪 Holy water smites the undead! +30 XP')
          } else {
            const v = vampires[bestTarget.idx]
            const px = v.pos.x, py = v.pos.y, pz = v.pos.z
            removeVampire(v)
            vampires.splice(bestTarget.idx, 1)
            useGame.getState().addXp(150)
            useGame.getState().addZombieKill()
            useGame.getState().showToast('✝️ Holy water purges the vampire! +150 XP')
            // A defeated vampire always drops another holy water vial + some stone
            dropItemToWorld('holy_water', 1, px, py + 0.5, pz)
          }
          return
        }
        // No enemy in range — holy water was already consumed above.
        useGame.getState().showToast('💧 Holy water splashed harmlessly')
        return
      }

      // Check zombies first
      const zombieHits: THREE.Intersection[] = []
      for (const z of zombies) {
        const hits = raycaster.intersectObject(z.mesh, true)
        if (hits.length && hits[0].distance < REACH) {
          zombieHits.push({ ...hits[0], object: z.mesh as any })
        }
      }
      zombieHits.sort((a, b) => a.distance - b.distance)
      if (zombieHits.length > 0) {
        const hitMesh = zombieHits[0].object
        const z = zombies.find(zz => zz.mesh === hitMesh)
        if (z) {
          z.hp -= dmg
          z.hurtTimer = 0.2
          if (z.hp <= 0) {
            const px = z.pos.x, py = z.pos.y, pz = z.pos.z
            const idx = zombies.indexOf(z)
            if (idx >= 0) { removeZombie(z); zombies.splice(idx, 1) }
            useGame.getState().addXp(25)
            useGame.getState().addZombieKill()
            useGame.getState().showToast('+25 XP')
            // ~22% chance to drop a random piece of tattered clothing.
            // 40% of those drops are shirts rolled on the rarity table.
            if (Math.random() < 0.22) {
              const isShirt = Math.random() < 0.4
              const pick: ItemId = isShirt
                ? rollShirtRarity()
                : (['torn_pants', 'torn_hat', 'torn_cloak'] as ItemId[])[Math.floor(Math.random() * 3)]
              dropItemToWorld(pick, 1, px, py + 0.6, pz)
              useGame.getState().showToast(`👕 Dropped ${ITEMS[pick].name}`)
            }
          }
          return
        }
      }

      // Check vampires (boss enemies)
      const vampHits: THREE.Intersection[] = []
      for (const v of vampires) {
        if (v.fleeing) continue
        const hits = raycaster.intersectObject(v.mesh, true)
        if (hits.length && hits[0].distance < REACH) {
          vampHits.push({ ...hits[0], object: v.mesh as any })
        }
      }
      vampHits.sort((a, b) => a.distance - b.distance)
      if (vampHits.length > 0) {
        const hitMesh = vampHits[0].object
        const v = vampires.find(vv => vv.mesh === hitMesh)
        if (v) {
          v.hp -= dmg
          v.hurtTimer = 0.2
          if (v.hp <= 0) {
            const px = v.pos.x, py = v.pos.y, pz = v.pos.z
            const idx = vampires.indexOf(v)
            if (idx >= 0) { removeVampire(v); vampires.splice(idx, 1) }
            useGame.getState().addXp(120)
            useGame.getState().addZombieKill()
            // The slain vampire's lifeblood leaves behind a blessed vial of Holy Water.
            useGame.getState().showToast('🦇 Vampire slain! +120 XP · 🧪 Holy Water dropped')
            dropItemToWorld('holy_water', 1, px, py + 0.5, pz)
            // Slain vampires sometimes leave behind tattered clothing from
            // their victims. Vampires are boss-tier so shirts are slightly
            // more likely to drop here.
            if (Math.random() < 0.5) {
              const isShirt = Math.random() < 0.6
              const pick: ItemId = isShirt ? rollShirtRarity() : 'torn_cloak'
              dropItemToWorld(pick, 1, px + 0.5, py + 0.4, pz)
            }
          }
          return
        }
      }

      // Check huge orc boss, including weak spots that knock it down.
      const orcHits: { orc: OrcBoss; hit: THREE.Intersection; weak: boolean }[] = []
      for (const o of orcs) {
        const hits = raycaster.intersectObject(o.mesh, true)
        if (hits.length && hits[0].distance < REACH + 1.2) {
          const weak = !!(hits[0].object as any).userData?.orcWeakSpot
          orcHits.push({ orc: o, hit: hits[0], weak })
        } else {
          // Big-body fallback so the boss never feels unhittable when close.
          const center = new THREE.Vector3(o.pos.x, o.pos.y + 1.8, o.pos.z)
          const toCenter = new THREE.Vector3().subVectors(center, raycaster.ray.origin)
          const along = toCenter.dot(raycaster.ray.direction)
          if (along > 0 && along < REACH + 1.2) {
            const closest = new THREE.Vector3().copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, along)
            if (closest.distanceTo(center) < 1.15) {
              orcHits.push({ orc: o, hit: { distance: along, object: o.mesh } as unknown as THREE.Intersection, weak: false })
            }
          }
        }
      }
      orcHits.sort((a, b) => a.hit.distance - b.hit.distance)
      if (orcHits.length > 0) {
        const target = orcHits[0]
        damageOrc(target.orc, dmg, target.weak)
        return
      }

      // Check goblins — quick little thieves, low HP. Uses a forgiving capsule
      // fallback so hits on the small sprinting model register consistently.
      const gobHit = findGoblinHit(raycaster)
      if (gobHit) {
        const gb = gobHit.goblin
        if (gb) {
          gb.hp -= dmg
          gb.hurtTimer = 0.2
          if (gb.hp <= 0) {
            const dropped = dropGoblinBackpack(gb)
            if (dropped > 0) {
              useGame.getState().showToast(`💰 Goblin slain! Backpack dropped ${dropped} stolen item${dropped === 1 ? '' : 's'}`)
            } else {
              useGame.getState().showToast('💰 Goblin slain!')
            }
            useGame.getState().addXp(20)
            const idx = goblins.indexOf(gb)
            if (idx >= 0) { removeGoblin(gb); goblins.splice(idx, 1) }
          }
          return
        }
      }

      // Check structures (walls) — players can break walls by attacking them.
      // Wood walls take ~20 hits, log walls ~30, stone walls ~40. Specialized
      // tools (axe on wood, pickaxe on stone) deal bonus damage per swing.
      {
        const structTargets: THREE.Object3D[] = []
        const structRefs: { mesh: THREE.Object3D; sm: StructureMesh }[] = []
        for (const sm of structureMeshes.values()) {
          if (sm.kind !== 'wall' && sm.kind !== 'log_wall' && sm.kind !== 'stone_wall') continue
          const ddx = sm.mesh.position.x - playerPos.x
          const ddz = sm.mesh.position.z - playerPos.z
          // Broad-phase cull — only raycast walls near the player.
          if (ddx * ddx + ddz * ddz > (REACH + 3) * (REACH + 3)) continue
          structTargets.push(sm.mesh)
          structRefs.push({ mesh: sm.mesh, sm })
        }
        if (structTargets.length) {
          const shits = raycaster.intersectObjects(structTargets, true)
          if (shits.length && shits[0].distance < REACH) {
            let root: THREE.Object3D | null = shits[0].object
            while (root && !structRefs.find(r => r.mesh === root)) root = root.parent
            if (root) {
              const entry = structRefs.find(r => r.mesh === root)!
              const sm = entry.sm
              const kind = sm.kind
              const isAxe = eq === 'stone_axe' || eq === 'iron_axe'
              const isPick = eq === 'stone_pickaxe' || eq === 'iron_pickaxe'
              // Damage: 1 base per hit. Axes hit wood walls harder, pickaxes
              // shred stone walls. Iron tools edge out stone by 1 more.
              let structDmg = 1
              if (kind === 'wall' || kind === 'log_wall') {
                if (eq === 'iron_axe') structDmg = 3
                else if (eq === 'stone_axe') structDmg = 2
              } else if (kind === 'stone_wall') {
                if (eq === 'iron_pickaxe') structDmg = 3
                else if (eq === 'stone_pickaxe') structDmg = 2
              }
              const structs = useGame.getState().structures
              const st = structs.find(ss => ss.id === sm.id)
              if (st) {
                const maxHp = st.maxHp ?? STRUCT_HP[kind] ?? 20
                const newHp = Math.max(0, (st.hp ?? maxHp) - structDmg)
                // Tiny hit-shake — briefly scale down the mesh on each hit
                sm.mesh.scale.setScalar(0.97)
                setTimeout(() => { if (sm.mesh) sm.mesh.scale.setScalar(1) }, 80)
                if (newHp <= 0) {
                  // Drop a small refund of raw materials when broken.
                  const px = sm.mesh.position.x, pz = sm.mesh.position.z
                  const gy = heightAt(px, pz) + 0.5
                  if (kind === 'wall') {
                    dropItemToWorld('wood', 1, px, gy, pz)
                  } else if (kind === 'log_wall') {
                    dropItemToWorld('wood', 2, px, gy, pz)
                  } else if (kind === 'stone_wall') {
                    dropItemToWorld('stone', 2, px, gy, pz)
                  }
                  useGame.getState().removeStructure(sm.id)
                  removeStructureMesh(sm.id)
                  queueWorldEvent('structure_remove', { id: sm.id })
                  useGame.getState().showToast(`💥 ${kind === 'stone_wall' ? 'Stone wall' : kind === 'log_wall' ? 'Log wall' : 'Wooden wall'} broken!`)
                } else {
                  useGame.getState().updateStructure(sm.id, { hp: newHp, maxHp })
                  queueWorldEvent('structure_update', { id: sm.id, patch: { hp: newHp, maxHp } })
                  applyWallDamage(sm, newHp / maxHp)
                  applyHealthBar(sm, newHp, maxHp)
                }
                return
              }
            }
          }
        }
      }

      // Check trees/stones
      const targets: THREE.Object3D[] = []
      const pcx = Math.floor(playerPos.x / CHUNK_SIZE)
      const pcz = Math.floor(playerPos.z / CHUNK_SIZE)
      const chunkObjs: { chunk: ChunkData; obj: THREE.Object3D; kind: 'tree' | 'stone' | 'cactus'; ref: any }[] = []
      for (let dcx = -1; dcx <= 1; dcx++) {
        for (let dcz = -1; dcz <= 1; dcz++) {
          const c = chunks.get(chunkKey(pcx + dcx, pcz + dcz))
          if (!c) continue
          for (const t of c.trees) { if (t.collider) { targets.push(t.mesh); chunkObjs.push({ chunk: c, obj: t.mesh, kind: 'tree', ref: t }) } }
          for (const ca of c.cacti) { if (ca.collider) { targets.push(ca.mesh); chunkObjs.push({ chunk: c, obj: ca.mesh, kind: 'cactus', ref: ca }) } }
          for (const s of c.stones) { targets.push(s.mesh); chunkObjs.push({ chunk: c, obj: s.mesh, kind: 'stone', ref: s }) }
        }
      }
      const hits = raycaster.intersectObjects(targets, true)
      if (hits.length && hits[0].distance < REACH) {
        // find which tree/stone
        let root: THREE.Object3D | null = hits[0].object
        while (root && !chunkObjs.find(co => co.obj === root)) root = root.parent
        if (!root) return
        const entry = chunkObjs.find(co => co.obj === root)!
        if (entry.kind === 'tree') {
          // Clothes/placeables can't chop anything.  Bare fists *can* tear bark
          // off slowly so a fresh survivor isn't permanently stuck, but a real
          // tool makes all the difference.
          const isCosmetic = !!eq && !ITEMS[eq]?.damage
          if (isCosmetic) {
            useGame.getState().showToast('🪓 Worn cosmetics can\'t chop trees')
            return
          }
          // Tool balance vs. 12 HP trees so the numbers match what players
          // expect from the tool tier table:
          //   axe     → 6  (2 hits)
          //   pickaxe → 4  (3 hits)
          //   sword   → 3  (4 hits)
          //   fist    → 1  (12 hits — fallback only)
          const chopDamage = !eq ? 1
            : eq === 'iron_axe' || eq === 'stone_axe' ? 6
            : eq === 'iron_pickaxe' || eq === 'stone_pickaxe' ? 4
            : eq === 'iron_sword' || eq === 'stone_sword' ? 3
            : 1
          entry.ref.hp -= chopDamage
          // feedback: shake
          entry.ref.mesh.rotation.z = 0.05
          setTimeout(() => { if (entry.ref.mesh) entry.ref.mesh.rotation.z = 0 }, 100)
          if (entry.ref.hp <= 0) {
            // Felled tree — kick off the falling animation. The tree tips
            // over in the direction *away* from the player so the camera
            // has a clear view of the dramatic crash.  Its logs spawn on
            // the ground once the trunk has landed (see main render loop).
            // Disable its collider & remove from chunk.trees so it no longer
            // participates in further chops / collisions.
            entry.ref.collider = false
            const idx = entry.chunk.trees.indexOf(entry.ref)
            if (idx >= 0) entry.chunk.trees.splice(idx, 1)

            // Fall direction: away from the player in the horizontal plane.
            let fx = entry.ref.px - playerPos.x
            let fz = entry.ref.pz - playerPos.z
            const flen = Math.sqrt(fx * fx + fz * fz)
            if (flen < 1e-3) {
              // Degenerate case: use camera forward so the tree still falls somewhere sensible
              fx = Math.sin(yaw); fz = -Math.cos(yaw)
            } else {
              fx /= flen; fz /= flen
            }

            // Build quaternion that tips the tree 90° around the horizontal
            // axis perpendicular to the fall direction, preserving its
            // existing random yaw / lean.
            const startQuat = entry.ref.mesh.quaternion.clone()
            const fallAxis = new THREE.Vector3(-fz, 0, fx).normalize()
            const fallQuat = new THREE.Quaternion().setFromAxisAngle(fallAxis, Math.PI / 2)
            // World rotation = fallQuat * startQuat — apply original yaw first, then world-space tip.
            const endQuat = fallQuat.clone().multiply(startQuat)

            fallingTrees.push({
              mesh: entry.ref.mesh,
              startQuat,
              endQuat,
              progress: 0,
              duration: 1.1,
              px: entry.ref.px,
              pz: entry.ref.pz,
              axisX: fx,
              axisZ: fz,
              landed: false,
              linger: 2.2,
              broken: false,
            })
            brokenResources.add(resourceKey('tree', entry.ref.px, entry.ref.pz))
            queueWorldEvent('resource_break', { kind: 'tree', x: entry.ref.px, z: entry.ref.pz })

            useGame.getState().showToast('🌳 Timberrr!')
          }
        } else if (entry.kind === 'cactus') {
          const isCosmetic = !!eq && !ITEMS[eq]?.damage
          if (isCosmetic) {
            useGame.getState().showToast('🌵 Use hands or a tool to break cactus')
            return
          }
          const cactusDamage = !eq ? 1
            : eq === 'iron_axe' || eq === 'stone_axe' || eq === 'iron_sword' || eq === 'stone_sword' ? 4
            : eq === 'iron_pickaxe' || eq === 'stone_pickaxe' ? 2
            : 1
          entry.ref.hp -= cactusDamage
          entry.ref.mesh.rotation.z = 0.07
          setTimeout(() => { if (entry.ref.mesh) entry.ref.mesh.rotation.z = 0 }, 100)
          if (entry.ref.hp <= 0) {
            entry.ref.collider = false
            const count = 1 + Math.floor(Math.random() * 3)
            dropItemToWorld('sap', count, entry.ref.px, heightAt(entry.ref.px, entry.ref.pz) + 0.5, entry.ref.pz)
            queueWorldEvent('resource_break', { kind: 'cactus', x: entry.ref.px, z: entry.ref.pz })
            removeResourceMesh('cactus', entry.ref.px, entry.ref.pz, true)
            useGame.getState().showToast(`🌵 Cactus falls! +${count} Sap`)
          }
        } else if (entry.kind === 'stone') {
          const isIron = entry.ref.oreKind === 'iron'
          const isPickaxe = eq === 'stone_pickaxe' || eq === 'iron_pickaxe'
          // Stone (boulders AND iron ore) can ONLY be broken with a pickaxe.
          // Players need to craft a stone pickaxe from sticks + small ground
          // rocks before they can start harvesting boulders.
          if (!isPickaxe) {
            useGame.getState().showToast(isIron ? '⛏️ Iron ore requires a pickaxe' : '⛏️ You need a pickaxe to mine stone')
            return
          }
          // Mining damage is a flat 1 per swing so every boulder breaks in
          // exactly 3 hits (boulderHp = 3). Iron and stone pickaxes are
          // equivalent for mining — the iron pickaxe's advantage is its
          // higher combat damage against enemies.
          const mineDamage = 1
          entry.ref.hp -= mineDamage
          // Visual feedback: shake + shrink slightly per chip
          const mesh = entry.ref.mesh as THREE.Mesh
          mesh.rotation.z = 0.08
          setTimeout(() => { if (mesh) mesh.rotation.z = 0 }, 100)
          // Shrink the boulder up to ~30% of its original scale as it breaks,
          // anchored off the scale it was spawned at. Keeps the visual chip
          // feedback consistent regardless of boulder size.
          const brokenFrac = 1 - Math.max(0, entry.ref.hp / entry.ref.maxHp)
          mesh.scale.setScalar(Math.max(0.25, entry.ref.initialScale * (1 - brokenFrac * 0.3)))
          if (entry.ref.hp <= 0) {
            if (isIron) {
              // Iron ore yields a healthy stack of raw iron + a couple stone chips.
              const ironCount = 3 + Math.floor(Math.random() * 2) // 3-4
              const stoneBonus = 1 + Math.floor(Math.random() * 2) // 1-2
              dropItemToWorld('raw_iron', ironCount, entry.ref.px, heightAt(entry.ref.px, entry.ref.pz) + 0.5, entry.ref.pz)
              dropItemToWorld('stone', stoneBonus, entry.ref.px + 0.4, heightAt(entry.ref.px + 0.4, entry.ref.pz) + 0.5, entry.ref.pz)
              useGame.getState().showToast(`⛏️ Iron ore broken! +${ironCount} Raw Iron · +${stoneBonus} Stone`)
            } else {
              // Regular boulder yields 3-5 stone.
              const count = 3 + Math.floor(Math.random() * 3)
              dropItemToWorld('stone', count, entry.ref.px, heightAt(entry.ref.px, entry.ref.pz) + 0.5, entry.ref.pz)
              useGame.getState().showToast(`🪨 Boulder broken! +${count} Stone`)
            }
            // Stone meshes are parented to the chunk group — detach from real parent.
            brokenResources.add(resourceKey('stone', entry.ref.px, entry.ref.pz))
            queueWorldEvent('resource_break', { kind: 'stone', x: entry.ref.px, z: entry.ref.pz })
            if (entry.ref.mesh.parent) entry.ref.mesh.parent.remove(entry.ref.mesh)
            const idx = entry.chunk.stones.indexOf(entry.ref)
            if (idx >= 0) entry.chunk.stones.splice(idx, 1)
          }
        }
      }
    }

    function updateBuildGhost(state: ReturnType<typeof useGame.getState>) {
      if (state.mode !== 'build') {
        if (buildGhost) { scene.remove(buildGhost); buildGhost.geometry.dispose(); buildGhost = null }
        return
      }
      const kind = state.buildSelection
      let geo: THREE.BufferGeometry
      if (kind === 'wall') geo = wallGeo
      else if (kind === 'floor') geo = floorGeo
      else if (kind === 'log_wall') geo = logWallGeo
      else if (kind === 'stone_wall') geo = stoneWallGeo
      else if (kind === 'log_floor') geo = logFloorGeo
      else if (kind === 'spike_trap') geo = trapBaseGeo
      else if (kind === 'furnace') geo = furnaceGeo
      else if (kind === 'bed') geo = bedGhostGeo
      else geo = standPlatformGeo
      if (!buildGhost || (buildGhost.geometry !== geo)) {
        if (buildGhost) scene.remove(buildGhost)
        buildGhost = new THREE.Mesh(geo, ghostMat)
        scene.add(buildGhost)
      }
      // Compute placement position in front of the player (uses the character's facing direction),
      // then apply **corner-aligned** snapping so fort/house corners line up.
      //
      // Grid cells are 2m squares with corners at (2k, 2m). To let walls meet
      // cleanly at corners, different structure types snap to different offsets:
      //
      //   • Horizontal walls (running along X): centre at (2k+1, 2m)
      //     → endpoints land on grid corners (2k, 2m) & (2k+2, 2m)
      //   • Vertical walls (running along Z):   centre at (2k,   2m+1)
      //     → endpoints land on grid corners (2k, 2m) & (2k,   2m+2)
      //   • Floors fill a cell:                 centre at (2k+1, 2m+1)
      //   • Furnace/trap/stand use simple 2m centre snap.
      const forward = new THREE.Vector3(Math.sin(playerYaw), 0, Math.cos(playerYaw))
      const placeX = playerPos.x + forward.x * 2.5
      const placeZ = playerPos.z + forward.z * 2.5
      const isWall = kind === 'wall' || kind === 'log_wall' || kind === 'stone_wall'
      const isFloor = kind === 'floor' || kind === 'log_floor'
      const horizontal = Math.abs(forward.x) > Math.abs(forward.z) // wall runs along Z-axis (rotated 90°)
      let sx: number, sz: number
      if (isWall) {
        if (horizontal) {
          // Wall rotated PI/2 → wall runs along local X after rotation = along Z in world.
          // Centre.x lands on even corner, centre.z lands on mid-edge.
          sx = Math.round(placeX / 2) * 2
          sz = Math.round((placeZ - 1) / 2) * 2 + 1
        } else {
          // Wall flat (rotation 0) → wall runs along X in world.
          sx = Math.round((placeX - 1) / 2) * 2 + 1
          sz = Math.round(placeZ / 2) * 2
        }
      } else if (isFloor) {
        sx = Math.round((placeX - 1) / 2) * 2 + 1
        sz = Math.round((placeZ - 1) / 2) * 2 + 1
      } else {
        sx = Math.round(placeX / 2) * 2
        sz = Math.round(placeZ / 2) * 2
      }
      let sy = heightAt(sx, sz)
      // Stacking: if another structure already occupies this XZ cell, raise
      // the placement up to its top (instead of embedding in it or floating
      // above the ground). Uses a loose XZ-overlap test against footprints.
      for (const ex of state.structures) {
        const exDims = (STRUCT_DIMS as any)[ex.kind]
        if (!exDims) continue
        // Existing structure's world-space X/Z extent, ignoring rotation (conservative — works for walls too)
        const exHW = Math.max(exDims.halfW, exDims.halfD)
        const exHD = Math.max(exDims.halfW, exDims.halfD)
        const dx = sx - ex.x
        const dz = sz - ex.z
        if (Math.abs(dx) < exHW + 0.5 && Math.abs(dz) < exHD + 0.5) {
          const exTop = ex.y + exDims.topOffset
          if (exTop > sy) sy = exTop
        }
      }
      if (isWall) {
        const yOff = kind === 'log_wall' ? 1.4 : kind === 'stone_wall' ? 1.3 : 1.2
        buildGhost.position.set(sx, sy + yOff, sz)
        buildGhost.rotation.y = horizontal ? Math.PI / 2 : 0
      } else if (isFloor) {
        const yOff = kind === 'log_floor' ? 0.1 : 0.08
        buildGhost.position.set(sx, sy + yOff, sz)
        buildGhost.rotation.y = 0
      } else if (kind === 'spike_trap') {
        buildGhost.position.set(sx, sy + 0.06, sz)
        buildGhost.rotation.y = 0
      } else if (kind === 'furnace') {
        buildGhost.position.set(sx, sy + 0.9, sz)
        buildGhost.rotation.y = Math.abs(forward.x) > Math.abs(forward.z) ? Math.PI / 2 : 0
      } else if (kind === 'bed') {
        buildGhost.position.set(sx, sy + 0.28, sz)
        buildGhost.rotation.y = Math.abs(forward.x) > Math.abs(forward.z) ? Math.PI / 2 : 0
      } else {
        // tree_stand platform ghost at full height
        buildGhost.position.set(sx, sy + 3.0, sz)
        buildGhost.rotation.y = 0
      }
      const itemId: ItemId = kind as ItemId
      // Count from build inventory (primary) + regular inventory (fallback).
      const has = state.countBuildItem(itemId) > 0
      buildGhost.material = has ? ghostMat : ghostBadMat
      buildGhost.visible = true
    }

    // Start
    gameRef.current = {}
    animate()

    // Subscribe to structure adds/removes from external state (persistence load)
    const unsub = useGame.subscribe((s, prev) => {
      if (s.structures !== prev.structures) {
        // reconcile
        const seen = new Set<string>()
        for (const st of s.structures) {
          seen.add(st.id)
          if (!structureMeshes.has(st.id)) addStructureMesh(st)
        }
        for (const id of Array.from(structureMeshes.keys())) {
          if (!seen.has(id)) removeStructureMesh(id)
        }
        updateBedSpawnMarkers()
      }
    })

    // Save snapshot to position
    const save = () => {
      const s = useGame.getState()
      useGame.setState({}) // no-op, but triggers
      return {
        health: s.health, level: s.level, xp: s.xp,
        posX: playerPos.x, posY: playerPos.y, posZ: playerPos.z,
        timeOfDay: s.timeOfDay, equippedItem: s.equippedItem,
        inventory: s.inventory, structures: s.structures,
        deaths: s.deaths, zombiesKilled: s.zombiesKilled,
      }
    }
    ;(window as any).__nightfallSave = save
    ;(window as any).__nightfallRequestLock = () => requestPointerLockSafe()
    ;(window as any).__nightfallRespawn = () => {
      const state = useGame.getState()
      const bed = state.structures.find(st => st.kind === 'bed' && st.spawn)
      const x = bed ? bed.x + Math.sin(bed.ry) * 1.7 : 0
      const z = bed ? bed.z + Math.cos(bed.ry) * 1.7 : 0
      playerPos.set(x, heightAt(x, z) + PLAYER_HEIGHT + 0.2, z)
      playerVel.set(0, 0, 0)
      walkTarget = null
      attackTimer = 0
      updateChunks(playerPos.x, playerPos.z)
      pvpDeathDropped = false
      return !!bed
    }
    ;(window as any).__nightfallTeleport = (x: number, z: number) => {
      playerPos.x = x
      playerPos.z = z
      playerPos.y = heightAt(x, z) + PLAYER_HEIGHT
      playerVel.set(0, 0, 0)
    }

    // Cleanup
    return () => {
      cancelAnimationFrame(gameRef.current?.raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('pointerlockerror', onPointerLockError)
      unsubscribeMode()
      releasePointerLockSafe()
      unsub()
      try { delete (window as any).__nightfallRespawn } catch {}
      try { getGameAudio().stop() } catch {}
      // dispose
      for (const c of chunks.values()) disposeChunk(c)
      chunks.clear()
      for (const z of zombies) removeZombie(z)
      zombies.length = 0
      for (const v of vampires) removeVampire(v)
      vampires.length = 0
      for (const o of orcs) removeOrc(o)
      orcs.length = 0
      for (const gb of goblins) removeGoblin(gb)
      goblins.length = 0
      try {
        delete (window as any).__nightfall_nearestEnemy
        delete (window as any).__nightfall_boss
        delete (window as any).__nightfall_phase
        delete (window as any).__nightfall_nearFurnace
        delete (window as any).__nightfallRequestLock
        delete (window as any).__nightfallUpdateGhosts
        delete (window as any).__nightfallGetPos
        delete (window as any).__nightfallWorldSyncPayload
        delete (window as any).__nightfallApplyWorldSync
      } catch {}
      for (const id of Array.from(ghosts.keys())) disposeGhost(id)
      for (const sm of structureMeshes.values()) scene.remove(sm.mesh)
      structureMeshes.clear()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={mountRef} className="absolute inset-0" />
}