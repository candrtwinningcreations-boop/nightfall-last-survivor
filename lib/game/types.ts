export type ItemId =
  | 'wood'
  | 'log'
  | 'stone'
  | 'sap'
  | 'stone_pickaxe'
  | 'stone_sword'
  | 'stone_axe'
  | 'wall'
  | 'floor'
  | 'holy_water'
  // Buildables — sturdier log & stone structures & traps
  | 'log_wall'
  | 'stone_wall'
  | 'log_floor'
  | 'spike_trap'
  | 'tree_stand'
  | 'bed'
  // Iron-tier progression
  | 'raw_iron'
  | 'iron_ingot'
  | 'iron_pickaxe'
  | 'iron_sword'
  | 'iron_axe'
  | 'furnace'
  // Tattered clothing loot — found on zombies / corpses. Cosmetic only for now.
  | 'torn_shirt'
  | 'torn_pants'
  | 'torn_hat'
  | 'torn_cloak'
  // --- Rarity-tiered shirts looted from enemies. Wearable armor that
  // reduces incoming damage and has a durability bar that depletes on hit.
  | 'shirt_common'
  | 'shirt_rare'
  | 'shirt_epic'
  | 'shirt_legendary'
  | 'shirt_godly'

export type CosmeticSlot = 'hat' | 'shirt' | 'pants' | 'cloak'
export type Rarity = 'Common' | 'Rare' | 'Epic' | 'Legendary' | 'Godly'

export interface ItemDef {
  id: ItemId
  name: string
  icon: string // emoji fallback
  image?: string // optional /items/<id>.png for richer inventory art
  stack: number
  damage?: number
  placeable?: 'wall' | 'floor' | 'trap' | 'stand' | 'furnace' | 'bed'
  cosmeticSlot?: CosmeticSlot
  description: string
  color: string // accent color for slot
  tool?: 'pickaxe' | 'axe' | 'sword'
  tier?: 1 | 2 // 1 = stone, 2 = iron
  // Damage reduction applied while this item is equipped (0..1, e.g. 0.25 = -25%)
  defense?: number
  // Rarity tier (for shirts and other looted gear)
  rarity?: Rarity
  // Max durability. Missing = indestructible / not an armor piece.
  maxDurability?: number
}

// An equipped cosmetic tracks its remaining durability so we can persist &
// display per-item wear independently of the inventory stacks.
export interface EquippedCosmetic {
  id: ItemId
  durability: number
  maxDurability: number
}

export interface InventorySlot {
  id: ItemId | null
  count: number
}

export interface Recipe {
  id: ItemId
  name: string
  inputs: { id: ItemId; count: number }[]
  output: { id: ItemId; count: number }
  requiresFurnace?: boolean
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export type StructureKind =
  | 'wall'
  | 'floor'
  | 'log_wall'
  | 'stone_wall'
  | 'log_floor'
  | 'spike_trap'
  | 'tree_stand'
  | 'furnace'
  | 'bed'

export interface StructureData {
  id: string
  kind: StructureKind
  x: number
  y: number
  z: number
  ry: number // rotation Y
  // Durability — populated when placed. Missing fields default to the max
  // HP for the given kind (used for forward/backward compat with old saves).
  hp?: number
  maxHp?: number
  // Beds can be marked as the active respawn point.
  spawn?: boolean
}

export interface SaveData {
  health: number
  level: number
  xp: number
  posX: number
  posY: number
  posZ: number
  timeOfDay: number
  equippedItem: string | null
  inventoryJson: string
  structuresJson: string
  deaths: number
  zombiesKilled: number
}

// Shop listings — locked for now, will be purchasable when the credits
// economy launches. Exposed here so the store & shop UI stay in sync.
export interface ShopListing {
  id: string
  title: string
  type: 'outfit' | 'character' | 'hat' | 'shirt' | 'pants' | 'armor' | 'bundle'
  tagline: string
  creditsPrice: number
  preview: string // emoji for now
  rarity: 'Common' | 'Rare' | 'Epic' | 'Legendary'
}
