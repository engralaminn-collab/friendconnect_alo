'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials } from '@/lib/api'
import { cn } from '@/lib/utils'

export function UserAvatar({
  name,
  src,
  size = 40,
  online,
  className,
  filter,
}: {
  name: string
  src?: string | null
  size?: number
  online?: boolean
  className?: string
  /** Optional CSS filter (e.g. "grayscale(1)", "sepia(0.6)") applied to the AvatarImage only. */
  filter?: string | null
}) {
  // Normalize: null/undefined/''/'none' all mean "no filter".
  const activeFilter = filter && filter !== 'none' ? filter : undefined
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <Avatar style={{ width: size, height: size }} className={cn('ring-1 ring-border', className)}>
        {src ? <AvatarImage src={src} alt={name} style={activeFilter ? { filter: activeFilter } : undefined} /> : null}
        <AvatarFallback className="bg-primary/15 text-primary font-semibold" style={{ fontSize: size * 0.36 }}>
          {initials(name) || '?'}
        </AvatarFallback>
      </Avatar>
      {online !== undefined && (
        <span
          className={cn(
            'absolute -bottom-0 -right-0 rounded-full border-2 border-background',
            online ? 'fc-online-dot' : 'bg-muted-foreground'
          )}
          style={{ width: Math.max(8, size * 0.3), height: Math.max(8, size * 0.3) }}
        />
      )}
    </div>
  )
}

export function FCLogo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn(
        'relative grid place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/30',
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 6a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3 3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Z" />
        <path d="M9 18H6a3 3 0 0 1-3-3v-1" />
        <circle cx="6" cy="6" r="3" />
        <path d="m9 12-1.5 1.5" />
      </svg>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <h3 className="font-semibold text-lg">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-xs">{description}</p>}
      {action}
    </div>
  )
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn('text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1', className)}>{children}</h2>
}
