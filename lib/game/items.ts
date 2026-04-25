import type { ItemDef, ItemId, Rarity, Recipe, ShopListing } from './types'

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { id: 'wood', name: 'Wood Planks', icon: '🪵', image: '/items/wood.svg', stack: 64, description: 'Chopped wood planks. Crafted from raw logs.', color: '#8b5a2b' },
  log: { id: 'log', name: 'Raw Log', icon: '🪵', image: '/items/log.png', stack: 32, description: 'A whole felled log. Chop down into 4 Wood Planks at the crafting bench.', color: '#5a3720' },
  stone: { id: 'stone', name: 'Stone', icon: '🪨', image: '/items/stone.png', stack: 64, description: 'Mined from boulders with a pickaxe, or picked up off the ground.', color: '#9ca3af' },
  sap: { id: 'sap', name: 'Cactus Sap', icon: '🟠', image: '/items/sap.png', stack: 64, description: 'Sticky amber-gold desert sap harvested from cactus plants. Used for beds and survival crafting.', color: '#f59e0b' },
  glowstone: { id: 'glowstone', name: 'Glowstone', icon: '💎', image: '/items/glowstone.svg', stack: 16, description: 'A luminous crystal-gem dropped by The Worm. It hums with cold desert light.', color: '#67e8f9' },
  torch: { id: 'torch', name: 'Torch', icon: '🔥', image: '/items/torch.svg', stack: 1, damage: 5, offhand: 'torch', maxDurability: 15 * 60, description: 'A hand torch crafted from 5 planks. Equip in offhand for light or main hand to ignite targets. Lasts 15 minutes; each hit costs 2 minutes.', color: '#fb923c' },

  // Stone tools
  stone_pickaxe: { id: 'stone_pickaxe', name: 'Stone Pickaxe', icon: '⛏️', image: '/items/stone_pickaxe.png', stack: 1, damage: 15, tool: 'pickaxe', tier: 1, description: 'Mines stone and raw iron. 15 damage.', color: '#a1a1aa' },
  stone_sword: { id: 'stone_sword', name: 'Stone Sword', icon: '🗡️', image: '/items/stone_sword.png', stack: 1, damage: 20, tool: 'sword', tier: 1, description: 'A sturdy blade. 20 damage.', color: '#d4d4d8' },
  stone_axe: { id: 'stone_axe', name: 'Stone Axe', icon: '🪓', image: '/items/stone_axe.png', stack: 1, damage: 15, tool: 'axe', tier: 1, description: 'Chops trees quickly. 15 damage.', color: '#b45309' },

  // Iron-tier materials
  raw_iron: { id: 'raw_iron', name: 'Raw Iron', icon: '🪨', image: '/items/raw_iron.png', stack: 64, description: 'Raw iron ore, mined from rusty boulders. Smelt at a furnace to refine.', color: '#a8a29e' },
  iron_ingot: { id: 'iron_ingot', name: 'Iron Ingot', icon: '🧱', image: '/items/iron_ingot.png', stack: 64, description: 'Refined iron bar, forged from raw iron at a furnace. Used for strong tools.', color: '#cbd5e1' },

  // Iron tools — stronger than stone
  iron_pickaxe: { id: 'iron_pickaxe', name: 'Iron Pickaxe', icon: '⛏️', image: '/items/iron_pickaxe.png', stack: 1, damage: 25, tool: 'pickaxe', tier: 2, description: 'Forged iron pickaxe. Shreds stone and iron ore. 25 damage.', color: '#e2e8f0' },
  iron_sword: { id: 'iron_sword', name: 'Iron Sword', icon: '⚔️', image: '/items/iron_sword.png', stack: 1, damage: 32, tool: 'sword', tier: 2, description: 'Sharp iron blade. Deadly against the undead. 32 damage.', color: '#f1f5f9' },
  iron_axe: { id: 'iron_axe', name: 'Iron Axe', icon: '🪓', image: '/items/iron_axe.png', stack: 1, damage: 25, tool: 'axe', tier: 2, description: 'Iron-headed axe. Fells trees in two strikes. 25 damage.', color: '#cbd5e1' },

  // Furnace — smelting station
  furnace: { id: 'furnace', name: 'Stone Furnace', icon: '🔥', image: '/items/furnace.png', stack: 8, placeable: 'furnace', description: 'Stone furnace. Place it down to smelt raw iron into ingots.', color: '#57534e' },

  wall: { id: 'wall', name: 'Wooden Wall', icon: '🧱', image: '/items/wall.png', stack: 16, placeable: 'wall', description: 'A defensive wall.', color: '#713f12' },
  floor: { id: 'floor', name: 'Wooden Floor', icon: '⬛', image: '/items/floor.png', stack: 16, placeable: 'floor', description: 'A wooden floor tile.', color: '#78350f' },
  holy_water: { id: 'holy_water', name: 'Holy Water', icon: '🧪', stack: 8, damage: 999, description: 'Blessed vial. Instantly destroys any undead. Single use. Dropped by vampires.', color: '#bae6fd' },

  // --- Log structures — stronger fortifications made from whole tree trunks
  log_wall: { id: 'log_wall', name: 'Log Wall', icon: '🔲', stack: 16, placeable: 'wall', description: 'Thick log palisade. Far tougher than planks.', color: '#5a3720' },
  // --- Stone wall — mortared block wall, the toughest buildable barrier
  stone_wall: { id: 'stone_wall', name: 'Stone Wall', icon: '🧱', stack: 16, placeable: 'wall', description: 'Mortared stone blocks. 40 hits to break — the toughest wall you can build.', color: '#8a8a90' },
  log_floor: { id: 'log_floor', name: 'Log Floor', icon: '🟫', stack: 16, placeable: 'floor', description: 'Split-log platform, elevated above the ground.', color: '#734a2a' },
  spike_trap: { id: 'spike_trap', name: 'Spike Trap', icon: '☘️', stack: 8, placeable: 'trap', description: 'Sharpened stakes. Damages any enemy that walks onto it.', color: '#b91c1c' },
  tree_stand: { id: 'tree_stand', name: 'Tree Stand', icon: '🌲', stack: 4, placeable: 'stand', description: 'Elevated hunting platform with a ladder. Snipe enemies in safety.', color: '#365314' },
  bed: { id: 'bed', name: 'Survivor Bed', icon: '🛏️', stack: 4, placeable: 'bed', description: 'Place and interact with it to set a new respawn point.', color: '#7c2d12' },

  // --- Tattered clothing — scavenged cosmetics (legacy, no defense).
  torn_shirt: { id: 'torn_shirt', name: 'Tattered Shirt', icon: '👕', stack: 1, cosmeticSlot: 'shirt', description: 'Torn and bloodied. Scrap cloth — offers no real protection.', color: '#92400e' },
  torn_pants: { id: 'torn_pants', name: 'Ragged Pants', icon: '👖', stack: 1, cosmeticSlot: 'pants', description: 'Frayed cuffs, holes, stains. Cosmetic only.', color: '#44403c' },
  torn_hat: { id: 'torn_hat', name: 'Torn Hat', icon: '🎩', stack: 1, cosmeticSlot: 'hat', description: 'A battered hat missing its brim. Cosmetic only.', color: '#3f3f46' },
  torn_cloak: { id: 'torn_cloak', name: 'Ragged Cloak', icon: '🧥', stack: 1, cosmeticSlot: 'cloak', description: 'A worn, tattered cloak found on the road. Cosmetic only.', color: '#6b7280' },

  // --- Rarity-tiered shirts looted from fallen enemies. Each tier reduces
  // incoming damage by a fixed percentage and has a durability bar that
  // depletes when the player is hit. When durability reaches 0 the shirt
  // breaks and is removed from the equipped slot.
  shirt_common: {
    id: 'shirt_common', name: 'Common Shirt', icon: '👕', stack: 1, cosmeticSlot: 'shirt',
    description: 'Plain peasant shirt. A little better than bare skin. -5% damage.',
    color: '#a1a1aa', rarity: 'Common', defense: 0.05, maxDurability: 20,
  },
  shirt_rare: {
    id: 'shirt_rare', name: 'Rare Shirt', icon: '👕', stack: 1, cosmeticSlot: 'shirt',
    description: 'Sturdy weave, reinforced stitching. -12% damage.',
    color: '#38bdf8', rarity: 'Rare', defense: 0.12, maxDurability: 40,
  },
  shirt_epic: {
    id: 'shirt_epic', name: 'Epic Shirt', icon: '👕', stack: 1, cosmeticSlot: 'shirt',
    description: 'Arcane threading glimmers in the moonlight. -25% damage.',
    color: '#a855f7', rarity: 'Epic', defense: 0.25, maxDurability: 80,
  },
  shirt_legendary: {
    id: 'shirt_legendary', name: 'Legendary Shirt', icon: '👕', stack: 1, cosmeticSlot: 'shirt',
    description: 'A relic of a forgotten warrior. Woven with silver. -40% damage.',
    color: '#f59e0b', rarity: 'Legendary', defense: 0.40, maxDurability: 150,
  },
  shirt_godly: {
    id: 'shirt_godly', name: 'Godly Shirt', icon: '👕', stack: 1, cosmeticSlot: 'shirt',
    description: 'Said to be blessed by the dawn itself. Nearly impervious. -60% damage.',
    color: '#fde68a', rarity: 'Godly', defense: 0.60, maxDurability: 300,
  },
}

export const RECIPES: Recipe[] = [
  { id: 'wood', name: 'Chop Log into Planks', inputs: [{ id: 'log', count: 1 }], output: { id: 'wood', count: 4 } },
  { id: 'torch', name: 'Torch', inputs: [{ id: 'wood', count: 5 }], output: { id: 'torch', count: 1 } },

  // Stone tier
  { id: 'stone_pickaxe', name: 'Stone Pickaxe', inputs: [{ id: 'stone', count: 3 }, { id: 'wood', count: 1 }], output: { id: 'stone_pickaxe', count: 1 } },
  { id: 'stone_sword', name: 'Stone Sword', inputs: [{ id: 'stone', count: 2 }, { id: 'wood', count: 1 }], output: { id: 'stone_sword', count: 1 } },
  { id: 'stone_axe', name: 'Stone Axe', inputs: [{ id: 'stone', count: 2 }, { id: 'wood', count: 1 }], output: { id: 'stone_axe', count: 1 } },

  // Iron tier — smelting + crafting
  { id: 'furnace', name: 'Stone Furnace', inputs: [{ id: 'stone', count: 10 }], output: { id: 'furnace', count: 1 } },
  { id: 'iron_ingot', name: 'Smelt Iron Ingot', inputs: [{ id: 'raw_iron', count: 1 }, { id: 'log', count: 1 }], output: { id: 'iron_ingot', count: 1 }, requiresFurnace: true },
  // Iron weapons can ONLY be forged at the furnace — right-click a placed
  // furnace (or press [C] while standing next to one) to open the crafting
  // panel with these recipes enabled.
  { id: 'iron_pickaxe', name: 'Iron Pickaxe', inputs: [{ id: 'iron_ingot', count: 3 }, { id: 'wood', count: 1 }], output: { id: 'iron_pickaxe', count: 1 }, requiresFurnace: true },
  { id: 'iron_sword', name: 'Iron Sword', inputs: [{ id: 'iron_ingot', count: 2 }, { id: 'wood', count: 1 }], output: { id: 'iron_sword', count: 1 }, requiresFurnace: true },
  { id: 'iron_axe', name: 'Iron Axe', inputs: [{ id: 'iron_ingot', count: 3 }, { id: 'wood', count: 1 }], output: { id: 'iron_axe', count: 1 }, requiresFurnace: true },

  { id: 'wall', name: 'Wooden Wall', inputs: [{ id: 'wood', count: 4 }], output: { id: 'wall', count: 1 } },
  { id: 'floor', name: 'Wooden Floor', inputs: [{ id: 'wood', count: 2 }], output: { id: 'floor', count: 1 } },
  // Log — stronger and requires more wood
  { id: 'log_wall', name: 'Log Wall', inputs: [{ id: 'wood', count: 8 }], output: { id: 'log_wall', count: 1 } },
  { id: 'log_floor', name: 'Log Floor', inputs: [{ id: 'wood', count: 4 }], output: { id: 'log_floor', count: 1 } },
  // Stone — toughest wall, 40 HP. Requires a solid pile of stone.
  { id: 'stone_wall', name: 'Stone Wall', inputs: [{ id: 'stone', count: 8 }], output: { id: 'stone_wall', count: 1 } },
  { id: 'spike_trap', name: 'Spike Trap', inputs: [{ id: 'wood', count: 4 }, { id: 'stone', count: 2 }], output: { id: 'spike_trap', count: 1 } },
  { id: 'tree_stand', name: 'Tree Stand', inputs: [{ id: 'wood', count: 12 }], output: { id: 'tree_stand', count: 1 } },
  { id: 'bed', name: 'Survivor Bed', inputs: [{ id: 'wood', count: 10 }, { id: 'sap', count: 5 }], output: { id: 'bed', count: 1 } },
]

// Cosmetic shop listings — prices displayed in the upcoming credits currency.
// All items are locked for now until the credits economy launches.
export const SHOP_LISTINGS: ShopListing[] = [
  { id: 'char_warden',    title: 'The Warden',          type: 'character', tagline: 'Armored survivor with a night-vision helm.',          creditsPrice: 2800, preview: '🧑‍🚒', rarity: 'Legendary' },
  { id: 'char_ranger',    title: 'The Ranger',          type: 'character', tagline: 'Silent woodsman clad in tanned hide.',               creditsPrice: 2400, preview: '🧭',    rarity: 'Epic' },
  { id: 'outfit_wasteland', title: 'Wasteland Gear',    type: 'outfit',    tagline: 'Full desert camouflage set with scarf.',              creditsPrice: 1800, preview: '🧢',    rarity: 'Epic' },
  { id: 'outfit_priest',    title: "Inquisitor’s Robes", type: 'outfit',    tagline: 'Silver-lined robes said to repel vampires.',          creditsPrice: 2200, preview: '📏',    rarity: 'Legendary' },
  { id: 'hat_wolf',       title: 'Wolf Hood',           type: 'hat',       tagline: 'Wolf-skull headdress. Stare directly into the dark.',  creditsPrice: 650,  preview: '🐺',    rarity: 'Rare' },
  { id: 'hat_crown',      title: 'Iron Crown',          type: 'hat',       tagline: 'Bent, blackened, royal. Command the ruins.',          creditsPrice: 900,  preview: '👑',    rarity: 'Epic' },
  { id: 'shirt_crimson',  title: 'Crimson Vest',        type: 'shirt',     tagline: 'Blood-stained vest. Choose your color.',               creditsPrice: 450,  preview: '🦺',    rarity: 'Rare' },
  { id: 'pants_cargo',    title: 'Tactical Cargo',      type: 'pants',     tagline: 'Heavy-duty pants with knee guards.',                   creditsPrice: 380,  preview: '👖',    rarity: 'Common' },
  { id: 'armor_plate',    title: 'Heavy Plate Armor',   type: 'armor',     tagline: 'Steel chestplate with weathered trim.',                creditsPrice: 2600, preview: '🛡️', rarity: 'Legendary' },
  { id: 'bundle_starter', title: 'Survivor Starter Pack', type: 'bundle',  tagline: 'Hood + shirt + pants + torch. Great value.',           creditsPrice: 1200, preview: '🎁',    rarity: 'Rare' },
  { id: 'outfit_apoc',    title: 'Apocalypse Set',      type: 'outfit',    tagline: 'Scrap-metal plates over charred leather.',             creditsPrice: 2000, preview: '☢️',   rarity: 'Epic' },
  { id: 'shirt_scout',    title: 'Forest Scout Shirt',  type: 'shirt',     tagline: 'Green and loose, blends into the treeline.',           creditsPrice: 400,  preview: '🥼',    rarity: 'Common' },
]

export const FIST_DAMAGE = 5

export function xpForNextLevel(level: number) {
  return 100 * Math.pow(2, level - 1)
}

// An item is considered "buildable" if placing it creates a world structure.
// Crafted output of these items is routed to the build menu's buildInventory
// instead of the regular hotbar inventory, so the hotbar doesn't clutter up
// with stacks of 16 walls / 8 furnaces the player never intends to wield.
export function isBuildable(id: ItemId): boolean {
  return !!ITEMS[id]?.placeable
}

// --- Shirt rarity loot roll. Called whenever an enemy drops a shirt.
// Weighted percentages:
//   0.1% Godly, 1% Legendary, 5% Epic, 28.9% Rare, 65% Common.
// Returns a concrete shirt ItemId to be added to the player inventory.
export function rollShirtRarity(): ItemId {
  const r = Math.random() * 100
  if (r < 0.1) return 'shirt_godly'
  if (r < 1.1) return 'shirt_legendary'
  if (r < 6.1) return 'shirt_epic'
  if (r < 35) return 'shirt_rare'
  return 'shirt_common'
}

// Border color for inventory slots / tooltips, keyed by rarity tier.
export const RARITY_COLOR: Record<Rarity, string> = {
  Common: '#a1a1aa',
  Rare: '#38bdf8',
  Epic: '#a855f7',
  Legendary: '#f59e0b',
  Godly: '#fde68a',
}
