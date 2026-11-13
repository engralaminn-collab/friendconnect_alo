"use client"

import { Avatar as UiAvatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { avatarColor, initials } from "@/lib/api"

export function Avatar({
  name,
  src,
  size = 36,
  online,
}: {
  name: string
  src?: string | null
  size?: number
  online?: boolean
}) {
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <UiAvatar style={{ width: size, height: size }} className={`${avatarColor(name || "?")} border border-border`}>
        {src ? <AvatarImage src={src} alt={name} /> : null}
        <AvatarFallback className="text-white font-medium" style={{ fontSize: size * 0.4 }}>
          {initials(name)}
        </AvatarFallback>
      </UiAvatar>
      {typeof online === "boolean" && (
        <span
          className={`absolute bottom-0 right-0 block rounded-full border-2 border-background ${
            online ? "bg-emerald-500" : "bg-zinc-400"
          }`}
          style={{ width: Math.max(8, size * 0.28), height: Math.max(8, size * 0.28) }}
        />
      )}
    </div>
  )
}
