'use client'

import { create } from 'zustand'
import type { CosmeticSlot, EquippedCosmetic, InventorySlot, ItemId, StructureData } from './types'
import { ITEMS, isBuildable, xpForNextLevel } from './items'

export type GameMode = 'play' | 'inventory' | 'crafting' | 'build' | 'paused' | 'dead'
// Which recipe set to show in the crafting panel. Opening via the C key
// is a 'normal' context (wood/stone/basic gear). Right-clicking a placed
// furnace is the 'furnace' context (smelting + iron tools).
export type CraftingContext = 'normal' | 'furnace'

// Equipped cosmetics now carry durability per-slot so shirts can wear out.
// Legacy torn_* cosmetics still have no defense/maxDurability so equipping
// them is effectively free and they never break.
export type CosmeticState = Partial<Record<CosmeticSlot, EquippedCosmetic>>

export interface GameState {
  health: number
  maxHealth: number
  level: number
  xp: number
  timeOfDay: number // 0..1, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset, 0 = midnight
  isNight: boolean
  inventory: InventorySlot[] // length 30
  // Separate storage for placeable/buildable items (walls, floors, traps,
  // furnaces, etc.). When the player CRAFTS a buildable it lands here
  // instead of the main inventory so the hotbar stays clean for weapons &
  // consumables. The Build menu reads counts from this map and the
  // placement logic consumes from it first.
  buildInventory: Partial<Record<ItemId, number>>
  hotbarIndex: number // 0..4 uses first 5 slots
  equippedItem: ItemId | null
  mode: GameMode
  damageFlash: number // 0..1
  lastHitAt: number
  zombiesKilled: number
  deaths: number
  structures: StructureData[]
  buildSelection: 'wall' | 'floor' | 'log_wall' | 'stone_wall' | 'log_floor' | 'spike_trap' | 'tree_stand' | 'furnace' | 'bed'
  toast: { text: string; at: number } | null
  // Current crafting panel context — controls which recipes are visible.
  craftingContext: CraftingContext
  // Equipped cosmetics (hat/shirt/pants/cloak). Cosmetic only, no stats.
  cosmetics: CosmeticState
  // Cosmetic currency. Starts at 0 and is reserved for future shop purchases.
  credits: number
  // Bottom-right keys guide toggle
  keysGuideVisible: boolean
  // actions
  setHealth: (h: number) => void
  takeDamage: (n: number) => void
  heal: (n: number) => void
  addXp: (n: number) => void
  setTime: (t: number) => void
  setMode: (m: GameMode) => void
  setCraftingContext: (c: CraftingContext) => void
  addItem: (id: ItemId, count?: number) => boolean // true if fully added
  removeItem: (id: ItemId, count: number) => boolean
  // Craft-output helper: routes to buildInventory for placeables, else
  // delegates to addItem. Used by the crafting panel.
  addCraftedItem: (id: ItemId, count?: number) => boolean
  // Build-panel inventory management.
  addBuildItem: (id: ItemId, count?: number) => void
  // Consume from buildInventory first; fall back to regular inventory.
  // Returns true on success.
  consumeBuildItem: (id: ItemId, count: number) => boolean
  // Count placeable stock from buildInventory + regular inventory combined.
  countBuildItem: (id: ItemId) => number
  setBuildInventory: (bi: Partial<Record<ItemId, number>>) => void
  setSlot: (i: number, slot: InventorySlot) => void
  swapSlots: (a: number, b: number) => void
  setHotbar: (i: number) => void
  setEquipped: (id: ItemId | null) => void
  addStructure: (s: StructureData) => void
  removeStructure: (id: string) => void
  setStructures: (s: StructureData[]) => void
  setBuildSelection: (k: 'wall' | 'floor' | 'log_wall' | 'stone_wall' | 'log_floor' | 'spike_trap' | 'tree_stand' | 'furnace' | 'bed') => void
  updateStructure: (id: string, patch: Partial<StructureData>) => void
  setInventory: (inv: InventorySlot[]) => void
  equipCosmetic: (slot: CosmeticSlot, id: ItemId | null) => void
  toggleKeysGuide: () => void
  setKeysGuideVisible: (v: boolean) => void
  setLevel: (lvl: number, xp: number) => void
  countItem: (id: ItemId) => number
  setDead: () => void
  respawn: () => void
  addZombieKill: () => void
  showToast: (t: string) => void
  reset: () => void
}

function emptyInv(): InventorySlot[] {
  return Array.from({ length: 30 }, () => ({ id: null, count: 0 }))
}

// Starting inventory: the player begins with empty hands — they must
// craft their first tool from fists + natural materials they can punch.
function starterInv(): InventorySlot[] {
  return emptyInv()
}

export const useGame = create<GameState>((set, get) => ({
  health: 100,
  maxHealth: 100,
  level: 1,
  xp: 0,
  timeOfDay: 0.25,
  isNight: false,
  inventory: starterInv(),
  buildInventory: {},
  hotbarIndex: 0,
  equippedItem: null,
  mode: 'play',
  damageFlash: 0,
  lastHitAt: 0,
  zombiesKilled: 0,
  deaths: 0,
  structures: [],
  buildSelection: 'wall',
  toast: null,
  craftingContext: 'normal',
  cosmetics: {},
  credits: 0,
  keysGuideVisible: true,

  setHealth: (h) => set({ health: Math.max(0, Math.min(100, h)) }),
  takeDamage: (n) => {
    const s = get()
    if (s.mode === 'dead') return
    // 1. Apply shirt defense BEFORE subtracting health. Legacy torn_shirt and
    //    any other cosmetic without `defense` has no effect (def falls back
    //    to 0). We clamp to at least 1 damage so a max-tier shirt can't make
    //    the player unhittable.
    let damage = n
    const shirt = s.cosmetics.shirt
    if (shirt) {
      const def = ITEMS[shirt.id]
      if (def?.defense && def.defense > 0) {
        damage = Math.max(1, Math.round(n * (1 - def.defense)))
      }
      // 2. Tick durability on any cosmetic that has a maxDurability. Break
      //    the shirt and auto-unequip when it hits 0.
      if (def?.maxDurability) {
        const newDur = shirt.durability - 1
        if (newDur <= 0) {
          const next = { ...s.cosmetics }
          delete next.shirt
          set({ cosmetics: next })
          get().showToast(`🛡️ Your ${def.name} broke!`)
        } else {
          set({ cosmetics: { ...s.cosmetics, shirt: { ...shirt, durability: newDur } } })
        }
      }
    }
    const newHealth = Math.max(0, s.health - damage)
    set({ health: newHealth, damageFlash: 1, lastHitAt: performance.now() })
    if (newHealth <= 0) {
      set({ mode: 'dead', deaths: s.deaths + 1 })
    }
  },
  heal: (n) => set((s) => ({ health: Math.min(s.maxHealth, s.health + n) })),
  addXp: (n) => {
    let { xp, level } = get()
    xp += n
    while (xp >= xpForNextLevel(level)) {
      xp -= xpForNextLevel(level)
      level += 1
      get().showToast(`⬆ Level Up! You are now level ${level}`)
    }
    set({ xp, level })
  },
  setTime: (t) => set({ timeOfDay: t, isNight: t < 0.2 || t > 0.8 }),
  setMode: (m) => set({ mode: m }),
  setCraftingContext: (c) => set({ craftingContext: c }),
  addItem: (id, count = 1) => {
    const inv = [...get().inventory]
    const def = ITEMS[id]
    let remaining = count
    // First, try to stack on existing
    for (let i = 0; i < inv.length && remaining > 0; i++) {
      const s = inv[i]
      if (s?.id === id && s.count < def.stack) {
        const add = Math.min(def.stack - s.count, remaining)
        inv[i] = { id, count: s.count + add }
        remaining -= add
      }
    }
    // Then, fill empty slots
    for (let i = 0; i < inv.length && remaining > 0; i++) {
      const s = inv[i]
      if (!s?.id) {
        const add = Math.min(def.stack, remaining)
        inv[i] = { id, count: add }
        remaining -= add
      }
    }
    const hotIdx = get().hotbarIndex
    set({ inventory: inv, equippedItem: inv[hotIdx]?.id ?? null })
    return remaining === 0
  },
  removeItem: (id, count) => {
    const inv = [...get().inventory]
    const total = inv.reduce((acc, s) => (s?.id === id ? acc + s.count : acc), 0)
    if (total < count) return false
    let rem = count
    for (let i = 0; i < inv.length && rem > 0; i++) {
      const s = inv[i]
      if (s?.id === id) {
        const take = Math.min(s.count, rem)
        const left = s.count - take
        inv[i] = left > 0 ? { id, count: left } : { id: null, count: 0 }
        rem -= take
      }
    }
    const hotIdx = get().hotbarIndex
    set({ inventory: inv, equippedItem: inv[hotIdx]?.id ?? null })
    return true
  },
  addCraftedItem: (id, count = 1) => {
    // Placeables go straight to the build inventory (keeps the hotbar clean)
    if (isBuildable(id)) {
      get().addBuildItem(id, count)
      return true
    }
    return get().addItem(id, count)
  },
  addBuildItem: (id, count = 1) => set((s) => {
    const bi = { ...s.buildInventory }
    bi[id] = (bi[id] ?? 0) + count
    return { buildInventory: bi }
  }),
  consumeBuildItem: (id, count) => {
    const s = get()
    const haveBuild = s.buildInventory[id] ?? 0
    const haveInv = s.inventory.reduce((acc, sl) => (sl?.id === id ? acc + sl.count : acc), 0)
    if (haveBuild + haveInv < count) return false
    let rem = count
    // Consume from buildInventory first.
    if (haveBuild > 0 && rem > 0) {
      const take = Math.min(haveBuild, rem)
      const bi = { ...s.buildInventory }
      const left = haveBuild - take
      if (left > 0) bi[id] = left
      else delete bi[id]
      set({ buildInventory: bi })
      rem -= take
    }
    // Fallback: consume the remainder from regular inventory.
    if (rem > 0) {
      get().removeItem(id, rem)
    }
    return true
  },
  countBuildItem: (id) => {
    const s = get()
    const b = s.buildInventory[id] ?? 0
    const inv = s.inventory.reduce((acc, sl) => (sl?.id === id ? acc + sl.count : acc), 0)
    return b + inv
  },
  setBuildInventory: (bi) => set({ buildInventory: { ...bi } }),
  setSlot: (i, slot) => {
    const inv = [...get().inventory]
    inv[i] = slot
    const hotIdx = get().hotbarIndex
    set({ inventory: inv, equippedItem: inv[hotIdx]?.id ?? null })
  },
  swapSlots: (a, b) => {
    const inv = [...get().inventory]
    const tmp = inv[a]
    inv[a] = inv[b]
    inv[b] = tmp
    const hotIdx = get().hotbarIndex
    set({ inventory: inv, equippedItem: inv[hotIdx]?.id ?? null })
  },
  setHotbar: (i) => {
    const idx = Math.max(0, Math.min(4, i))
    const slot = get().inventory[idx]
    set({ hotbarIndex: idx, equippedItem: slot?.id ?? null })
  },
  setEquipped: (id) => set({ equippedItem: id }),
  addStructure: (s) => set((st) => ({ structures: [...st.structures, s] })),
  removeStructure: (id) => set((st) => ({ structures: st.structures.filter(s => s.id !== id) })),
  setStructures: (s) => set({ structures: s }),
  setBuildSelection: (k) => set({ buildSelection: k }),
  updateStructure: (id, patch) => set((st) => ({
    structures: st.structures.map(s => s.id === id ? { ...s, ...patch } : s),
  })),
  equipCosmetic: (slot, id) => set((s) => {
    const next = { ...s.cosmetics }
    if (id === null) {
      delete next[slot]
    } else {
      // Build an EquippedCosmetic with durability initialised to the item's
      // maxDurability (or 0 for legacy cosmetics without one). Only shirts
      // actually have defense+durability today, but the data shape is
      // consistent across all slots so we can extend it later.
      const def = ITEMS[id]
      const maxDurability = def?.maxDurability ?? 0
      next[slot] = { id, durability: maxDurability, maxDurability }
    }
    return { cosmetics: next }
  }),
  toggleKeysGuide: () => set((s) => ({ keysGuideVisible: !s.keysGuideVisible })),
  setKeysGuideVisible: (v) => set({ keysGuideVisible: v }),
  setInventory: (inv) => set((s) => ({
    inventory: inv,
    // Keep equippedItem in sync with the currently-selected hotbar slot
    equippedItem: inv[s.hotbarIndex]?.id ?? null,
  })),
  setLevel: (lvl, xp) => set({ level: lvl, xp }),
  countItem: (id) => get().inventory.reduce((acc, s) => (s?.id === id ? acc + s.count : acc), 0),
  setDead: () => set((s) => ({ mode: 'dead', health: 0, deaths: s.deaths + 1 })),
  respawn: () => set({ mode: 'play', health: 100, damageFlash: 0 }),
  addZombieKill: () => set((s) => ({ zombiesKilled: s.zombiesKilled + 1 })),
  showToast: (t) => set({ toast: { text: t, at: performance.now() } }),
  reset: () => set({
    health: 100, level: 1, xp: 0, timeOfDay: 0.25,
    inventory: starterInv(), buildInventory: {}, hotbarIndex: 0, equippedItem: null, mode: 'play',
    damageFlash: 0, zombiesKilled: 0, deaths: 0, structures: [], buildSelection: 'wall',
    toast: null, craftingContext: 'normal', cosmetics: {}, credits: 0, keysGuideVisible: true,
  }),
}))