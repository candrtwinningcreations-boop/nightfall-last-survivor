'use client'

import { useGame, type CosmeticState } from '@/lib/game/store'
import { ITEMS, RARITY_COLOR, SHOP_LISTINGS, xpForNextLevel } from '@/lib/game/items'
import type { InventorySlot, ItemId, CosmeticSlot, ItemDef } from '@/lib/game/types'
import { X, Backpack, Shirt, ShoppingBag, User, Heart, Skull, Swords, Star, Lock, Coins } from 'lucide-react'
import { useState } from 'react'
import { ItemIcon } from './item-icon'

const COSMETIC_SLOTS: { slot: CosmeticSlot; label: string; accept: ItemId[]; hint: string }[] = [
  { slot: 'hat',    label: 'Head',  accept: ['torn_hat'],    hint: 'Hats & helmets' },
  { slot: 'shirt',  label: 'Chest', accept: ['torn_shirt'],  hint: 'Shirts & armor' },
  { slot: 'pants',  label: 'Legs',  accept: ['torn_pants'],  hint: 'Pants & greaves' },
  { slot: 'cloak',  label: 'Back',  accept: ['torn_cloak'],  hint: 'Cloaks & capes' },
]

// Compose a multi-line tooltip string that reveals the item rarity, damage
// reduction and max durability alongside the core name+description.
function describeItem(def: ItemDef | null, suffix = ''): string {
  if (!def) return 'Empty'
  const lines: string[] = [def.name]
  if (def.rarity) lines.push(`[${def.rarity}]`)
  if (def.description) lines.push(def.description)
  if (def.defense) lines.push(`Damage Reduction: ${Math.round(def.defense * 100)}%`)
  if (def.maxDurability) lines.push(`Max Durability: ${def.maxDurability}`)
  if (suffix) lines.push(suffix)
  return lines.join('\n')
}

export default function InventoryPanel() {
  const inventory = useGame(s => s.inventory)
  const setInventory = useGame(s => s.setInventory)
  const setMode = useGame(s => s.setMode)
  const setHotbar = useGame(s => s.setHotbar)
  const hotbarIndex = useGame(s => s.hotbarIndex)
  const health = useGame(s => s.health)
  const maxHealth = useGame(s => s.maxHealth)
  const level = useGame(s => s.level)
  const xp = useGame(s => s.xp)
  const deaths = useGame(s => s.deaths)
  const zombiesKilled = useGame(s => s.zombiesKilled)
  const credits = useGame(s => s.credits)
  const cosmetics = useGame(s => s.cosmetics)
  const equipCosmetic = useGame(s => s.equipCosmetic)
  const removeItem = useGame(s => s.removeItem)
  const addItem = useGame(s => s.addItem)
  const showToast = useGame(s => s.showToast)

  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [tab, setTab] = useState<'inventory' | 'character' | 'shop'>('inventory')

  const xpNeeded = xpForNextLevel(level)
  const xpPct = Math.min(100, (xp / xpNeeded) * 100)

  const handleDragStart = (i: number) => setDragFrom(i)
  const handleDrop = (i: number) => {
    if (dragFrom === null || dragFrom === i) { setDragFrom(null); return }
    const inv = [...inventory]
    const a = inv[dragFrom]
    const b = inv[i]
    if (a?.id && a.id === b?.id) {
      const def = ITEMS[a.id]
      const space = def.stack - (b?.count ?? 0)
      const move = Math.min(space, a.count)
      if (move > 0) {
        inv[i] = { id: a.id, count: (b?.count ?? 0) + move }
        const left = a.count - move
        inv[dragFrom] = left > 0 ? { id: a.id, count: left } : { id: null, count: 0 }
      } else {
        inv[dragFrom] = b; inv[i] = a
      }
    } else {
      inv[dragFrom] = b; inv[i] = a
    }
    setInventory(inv)
    setHotbar(hotbarIndex)
    setDragFrom(null)
  }

  // Equip a cosmetic from the inventory (removes it from inventory, stores in cosmetics)
  const tryEquipCosmetic = (id: ItemId) => {
    const def = ITEMS[id]
    if (!def.cosmeticSlot) return
    const slot = def.cosmeticSlot
    // Return whatever was already equipped (back to inventory so the player
    // doesn't lose it when swapping tiers).
    const current = cosmetics[slot]
    if (current) addItem(current.id, 1)
    if (!removeItem(id, 1)) return
    equipCosmetic(slot, id)
    showToast(`👕 Equipped ${def.name}`)
  }

  const unequipCosmetic = (slot: CosmeticSlot) => {
    const equipped = cosmetics[slot]
    if (!equipped) return
    if (addItem(equipped.id, 1)) {
      equipCosmetic(slot, null)
      showToast(`➤ Unequipped ${ITEMS[equipped.id].name}`)
    } else {
      showToast('📁 Inventory full')
    }
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-auto bg-black/70 backdrop-blur-sm">
      <div className="w-[880px] max-w-[96vw] max-h-[92vh] bg-zinc-950 border border-white/10 rounded-xl shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)] flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="font-display text-2xl font-bold flex items-center gap-2 text-white">
            <Backpack className="w-6 h-6 text-amber-400" /> Inventory
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs font-mono">
              <Coins className="w-3.5 h-3.5" /> {credits} Credits
            </div>
            <button
              onClick={() => setMode('play')}
              className="w-9 h-9 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-zinc-300"
              title="Close (Tab / I / Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 border-b border-white/10">
          {([
            { id: 'inventory' as const, label: 'Items',     icon: Backpack },
            { id: 'character' as const, label: 'Character', icon: User },
            { id: 'shop' as const,      label: 'Shop',      icon: ShoppingBag },
          ]).map(t => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-t-md text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white/10 text-white border-t border-l border-r border-white/10'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {tab === 'inventory' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2">
                <p className="text-xs text-zinc-500 mb-3 font-mono">Drag items to rearrange. First row (1-5) is your hotbar. Double-click cosmetics to equip.</p>
                <div className="grid grid-cols-6 gap-2">
                  {inventory.map((slot: InventorySlot, i: number) => {
                    const def = slot?.id ? ITEMS[slot.id] : null
                    const isHotbar = i < 5
                    const isActive = i === hotbarIndex
                    return (
                      <div
                        key={i}
                        draggable={!!def}
                        onDragStart={() => handleDragStart(i)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleDrop(i)}
                        onClick={() => { if (isHotbar) setHotbar(i) }}
                        onDoubleClick={() => { if (def?.cosmeticSlot && slot.id) tryEquipCosmetic(slot.id) }}
                        className={`relative aspect-square rounded-md flex items-center justify-center cursor-pointer select-none transition-all ${
                          isActive ? 'border-amber-400 ring-2 ring-amber-400/40' : ''
                        } ${isHotbar ? 'bg-zinc-800/70 border border-amber-500/20' : 'bg-zinc-900/60 border border-white/10'} hover:bg-zinc-800`}
                        style={def?.rarity ? { boxShadow: `0 0 0 2px ${RARITY_COLOR[def.rarity]} inset` } : undefined}
                        title={describeItem(def ?? null, def?.cosmeticSlot ? '(double-click to wear)' : '')}
                      >
                        {def && slot.id && (
                          <>
                            <ItemIcon id={slot.id} size={44} />
                            {slot.count > 1 && (
                              <span className="absolute bottom-0.5 right-1 font-mono text-[10px] text-white drop-shadow">{slot.count}</span>
                            )}
                            {def.cosmeticSlot && (
                              <span className="absolute top-0.5 right-1 text-[8px] font-bold text-pink-300">♥</span>
                            )}
                          </>
                        )}
                        {isHotbar && (
                          <span className="absolute top-0.5 left-1 text-[9px] font-mono text-amber-300/80">{i + 1}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="mt-3 text-[11px] font-mono text-zinc-500 flex items-center justify-between">
                  <span>Slots: {inventory.filter((s: InventorySlot) => s.id).length}/30</span>
                  <span>[Tab] or [I] to close</span>
                </div>
              </div>

              {/* Right-side: quick stats + worn cosmetics preview */}
              <div className="space-y-4">
                <StatsCard health={health} maxHealth={maxHealth} level={level} xp={xp} xpNeeded={xpNeeded} xpPct={xpPct} deaths={deaths} zombiesKilled={zombiesKilled} />
                <div className="rounded-lg bg-white/5 border border-white/10 p-3">
                  <h4 className="text-xs uppercase tracking-widest text-zinc-400 mb-2 flex items-center gap-1.5"><Shirt className="w-3.5 h-3.5" /> Worn</h4>
                  <div className="grid grid-cols-4 gap-2">
                    {COSMETIC_SLOTS.map(cs => {
                      const eq = cosmetics[cs.slot]
                      const def = eq ? ITEMS[eq.id] : null
                      const durPct = eq && eq.maxDurability > 0 ? (eq.durability / eq.maxDurability) * 100 : 0
                      return (
                        <button
                          key={cs.slot}
                          onClick={() => eq && unequipCosmetic(cs.slot)}
                          className="aspect-square rounded-md bg-zinc-900/70 border border-white/10 hover:bg-zinc-800 text-2xl flex items-center justify-center relative"
                          style={def?.rarity ? { boxShadow: `0 0 0 2px ${RARITY_COLOR[def.rarity]} inset` } : undefined}
                          title={describeItem(def, eq && eq.maxDurability > 0 ? `Durability: ${eq.durability}/${eq.maxDurability}\n— click to unequip` : (def ? '— click to unequip' : `${cs.label}: empty`))}
                        >
                          {eq ? <ItemIcon id={eq.id} size={36} /> : <span className="text-[9px] font-mono text-zinc-600">{cs.label}</span>}
                          {/* Durability bar along the bottom edge */}
                          {eq && eq.maxDurability > 0 && (
                            <div className="absolute bottom-0.5 left-1 right-1 h-1 bg-black/60 rounded-full overflow-hidden">
                              <div
                                className="h-full transition-all"
                                style={{
                                  width: `${durPct}%`,
                                  backgroundColor: durPct > 50 ? '#22c55e' : durPct > 20 ? '#f59e0b' : '#ef4444',
                                }}
                              />
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'character' && (
            <CharacterTab
              health={health} maxHealth={maxHealth} level={level} xp={xp} xpNeeded={xpNeeded} xpPct={xpPct}
              deaths={deaths} zombiesKilled={zombiesKilled}
              inventory={inventory} cosmetics={cosmetics}
              onUnequip={unequipCosmetic}
              onEquip={tryEquipCosmetic}
            />
          )}

          {tab === 'shop' && <ShopTab credits={credits} />}
        </div>
      </div>
    </div>
  )
}

function StatsCard({ health, maxHealth, level, xp, xpNeeded, xpPct, deaths, zombiesKilled }: {
  health: number; maxHealth: number; level: number; xp: number; xpNeeded: number; xpPct: number; deaths: number; zombiesKilled: number;
}) {
  return (
    <div className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Heart className="w-4 h-4 text-red-400" />
        <div className="flex-1">
          <div className="flex justify-between text-[11px] text-zinc-400 font-mono"><span>Health</span><span>{health}/{maxHealth}</span></div>
          <div className="h-1.5 rounded bg-white/10 overflow-hidden">
            <div className="h-full bg-red-500" style={{ width: `${(health / maxHealth) * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Star className="w-4 h-4 text-amber-400" />
        <div className="flex-1">
          <div className="flex justify-between text-[11px] text-zinc-400 font-mono"><span>Level {level}</span><span>{xp}/{xpNeeded}</span></div>
          <div className="h-1.5 rounded bg-white/10 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-400 to-amber-600" style={{ width: `${xpPct}%` }} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <Swords className="w-3.5 h-3.5 text-emerald-400" /> Kills: <span className="font-mono">{zombiesKilled}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <Skull className="w-3.5 h-3.5 text-zinc-400" /> Deaths: <span className="font-mono">{deaths}</span>
        </div>
      </div>
    </div>
  )
}

function CharacterTab({
  health, maxHealth, level, xp, xpNeeded, xpPct, deaths, zombiesKilled, inventory, cosmetics, onUnequip, onEquip,
}: {
  health: number; maxHealth: number; level: number; xp: number; xpNeeded: number; xpPct: number;
  deaths: number; zombiesKilled: number;
  inventory: InventorySlot[]; cosmetics: CosmeticState;
  onUnequip: (slot: CosmeticSlot) => void;
  onEquip: (id: ItemId) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px,1fr] gap-6">
      {/* Paper-doll */}
      <div className="relative rounded-lg bg-gradient-to-b from-zinc-800/60 to-zinc-900/80 border border-white/10 p-5 flex flex-col items-center">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">Equipped Cosmetics</div>
        <div className="relative w-28 h-48 flex flex-col items-center justify-center">
          {/* Simple paper-doll silhouette */}
          <div className="absolute inset-0 flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-zinc-700/70 mt-1" />
            <div className="w-20 h-20 rounded-md bg-zinc-700/50 mt-1" />
            <div className="w-10 h-16 rounded-md bg-zinc-700/60 mt-1" />
          </div>
          {/* Cosmetic emojis layered */}
          {cosmetics.hat && <span className="absolute -top-1 text-4xl">{ITEMS[cosmetics.hat.id].icon}</span>}
          {cosmetics.shirt && <span className="absolute top-16 text-4xl">{ITEMS[cosmetics.shirt.id].icon}</span>}
          {cosmetics.pants && <span className="absolute bottom-2 text-3xl">{ITEMS[cosmetics.pants.id].icon}</span>}
          {cosmetics.cloak && <span className="absolute right-0 top-12 text-3xl opacity-80">{ITEMS[cosmetics.cloak.id].icon}</span>}
        </div>
        <div className="mt-4 w-full grid grid-cols-2 gap-2">
          {COSMETIC_SLOTS.map(cs => {
            const eq = cosmetics[cs.slot]
            const def = eq ? ITEMS[eq.id] : null
            const durPct = eq && eq.maxDurability > 0 ? (eq.durability / eq.maxDurability) * 100 : 0
            return (
              <button
                key={cs.slot}
                onClick={() => eq && onUnequip(cs.slot)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white disabled:opacity-40 relative"
                disabled={!eq}
                style={def?.rarity ? { boxShadow: `0 0 0 2px ${RARITY_COLOR[def.rarity]} inset` } : undefined}
                title={describeItem(def, eq && eq.maxDurability > 0 ? `Durability: ${eq.durability}/${eq.maxDurability}` : '')}
              >
                {eq ? <ItemIcon id={eq.id} size={24} /> : <span className="text-lg">—</span>}
                <div className="text-left flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-400">{cs.label}</div>
                  <div className="font-mono text-[11px] truncate" style={def?.rarity ? { color: RARITY_COLOR[def.rarity] } : undefined}>
                    {def?.name ?? 'Empty'}
                  </div>
                </div>
                {eq && eq.maxDurability > 0 && (
                  <div className="absolute bottom-0 left-1 right-1 h-[3px] bg-black/60 rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${durPct}%`,
                        backgroundColor: durPct > 50 ? '#22c55e' : durPct > 20 ? '#f59e0b' : '#ef4444',
                      }}
                    />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Stats + available cosmetics to equip */}
      <div className="space-y-4">
        <StatsCard health={health} maxHealth={maxHealth} level={level} xp={xp} xpNeeded={xpNeeded} xpPct={xpPct} deaths={deaths} zombiesKilled={zombiesKilled} />
        <div className="rounded-lg bg-white/5 border border-white/10 p-4">
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2 text-white"><Shirt className="w-4 h-4 text-pink-400" /> Wearable Loot</h4>
          <p className="text-[11px] text-zinc-500 mb-3 font-mono">
            Clothing scavenged from fallen enemies. Rarer tiers absorb more damage before breaking.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {inventory.filter(s => s.id && ITEMS[s.id].cosmeticSlot).map((s, i) => {
              const def = ITEMS[s.id as ItemId]
              return (
                <button
                  key={i}
                  onClick={() => onEquip(s.id as ItemId)}
                  className="flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-900/70 hover:bg-zinc-800 border border-white/10 text-left"
                  style={def.rarity ? { boxShadow: `0 0 0 2px ${RARITY_COLOR[def.rarity]} inset` } : undefined}
                  title={describeItem(def, '(click to wear)')}
                >
                  <ItemIcon id={s.id as ItemId} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold truncate" style={def.rarity ? { color: RARITY_COLOR[def.rarity] } : { color: 'white' }}>
                      {def.name}
                    </div>
                    <div className="text-[10px] text-zinc-400 capitalize">
                      {def.cosmeticSlot}
                      {def.defense ? ` · -${Math.round(def.defense * 100)}% dmg` : ''}
                    </div>
                  </div>
                  {s.count > 1 && <span className="text-[10px] font-mono text-zinc-400">×{s.count}</span>}
                </button>
              )
            })}
            {!inventory.some(s => s.id && ITEMS[s.id].cosmeticSlot) && (
              <div className="col-span-full text-[11px] text-zinc-500 font-mono italic">
                No wearables yet — fallen enemies sometimes drop shirts (rarer the drop, the better the protection).
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ShopTab({ credits }: { credits: number }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-transparent p-4 flex items-start gap-3">
        <Lock className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            Cosmetics Shop — <span className="text-amber-300 uppercase tracking-widest text-xs">Coming Soon</span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Browse outfits, characters, hats, shirts, pants, and armor. Buy with
            <span className="text-amber-200 font-mono"> Credits</span>, a currency you’ll be able to purchase in-game once the shop goes live. Everything is preview-only for now.
          </p>
          <p className="text-[11px] text-zinc-500 mt-2 font-mono">Balance: <span className="text-amber-300">{credits} credits</span></p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {SHOP_LISTINGS.map(l => (
          <div key={l.id} className="group relative rounded-lg border border-white/10 bg-zinc-900/60 hover:bg-zinc-900 p-3 overflow-hidden">
            <div className="flex items-start gap-3">
              <div className="w-14 h-14 rounded-md bg-gradient-to-br from-white/10 to-white/0 border border-white/10 flex items-center justify-center text-3xl">
                {l.preview}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-white font-semibold text-sm truncate">{l.title}</div>
                <div className="text-[10px] uppercase tracking-widest text-zinc-500">{l.type}</div>
                <div className={`text-[10px] mt-0.5 font-mono ${
                  l.rarity === 'Legendary' ? 'text-amber-300'
                  : l.rarity === 'Epic' ? 'text-violet-300'
                  : l.rarity === 'Rare' ? 'text-sky-300'
                  : 'text-zinc-400'
                }`}>{l.rarity}</div>
              </div>
            </div>
            <p className="text-[11px] text-zinc-400 mt-2 leading-snug line-clamp-2">{l.tagline}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm font-mono text-amber-300 flex items-center gap-1"><Coins className="w-3 h-3" /> {l.creditsPrice}</span>
              <button
                disabled
                className="text-[11px] font-semibold px-2 py-1 rounded-md bg-white/5 border border-white/10 text-zinc-400 cursor-not-allowed flex items-center gap-1.5"
                title="Credits economy launches soon"
              >
                <Lock className="w-3 h-3" /> Locked
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
