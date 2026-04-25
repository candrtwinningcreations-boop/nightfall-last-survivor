'use client'

import Image from 'next/image'
import { useState } from 'react'
import type { ItemId } from '@/lib/game/types'
import { ITEMS } from '@/lib/game/items'

/**
 * Renders an inventory item icon. Prefers the painted /items/<id>.png asset when present,
 * falls back to the emoji character if the image fails to load or isn't set.
 * Consistent sizing via the `size` prop in pixels. Uses `sizeClass` for fine-tuning when
 * inside a flex-centered cell where dimensions come from the parent.
 */
export function ItemIcon({
  id,
  size = 40,
  className = '',
  emojiSize = 'text-2xl',
}: {
  id: ItemId | null | undefined
  size?: number
  className?: string
  emojiSize?: string
}) {
  const def = id ? ITEMS[id] : null
  const [failed, setFailed] = useState(false)

  if (!def) return null

  // Use the painted icon if present and not broken
  if (def.image && !failed) {
    return (
      <div
        className={`relative flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <Image
          src={def.image}
          alt={def.name}
          width={size}
          height={size}
          draggable={false}
          className="object-contain select-none pointer-events-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.45)]"
          onError={() => setFailed(true)}
          sizes={`${size}px`}
          priority={false}
        />
      </div>
    )
  }

  return <span className={`${emojiSize} leading-none`}>{def.icon}</span>
}
