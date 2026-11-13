"use client"

import { useState, useEffect } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Bell, CheckCheck } from "lucide-react"
import { timeAgo } from "@/lib/api"

interface NotificationData {
  id: string
  type: string
  title: string
  body?: string | null
  link?: string | null
  read: boolean
  createdAt: string
}

export function NotificationsPanel({
  open,
  onOpenChange,
  onMarkAllRead,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onMarkAllRead: () => void
}) {
  const [items, setItems] = useState<NotificationData[]>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function load() {
      try {
        const r = await fetch("/api/notifications")
        const body = await r.json()
        if (cancelled) return
        setItems(body.notifications || [])
      } catch {}
    }
    load()
    return () => { cancelled = true }
  }, [open])

  async function handleMarkAll() {
    try {
      await fetch("/api/notifications", { method: "PATCH" })
      setItems((prev) => prev.map((n) => ({ ...n, read: true })))
      onMarkAllRead()
    } catch {}
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bell className="w-4 h-4" /> Notifications</DialogTitle>
          <DialogDescription>Recent activity across your account.</DialogDescription>
        </DialogHeader>
        {items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <Bell className="w-6 h-6 mx-auto mb-2 opacity-50" />
            No notifications yet.
          </div>
        ) : (
          <>
            <div className="flex justify-end mb-2">
              <Button variant="ghost" size="sm" onClick={handleMarkAll}>
                <CheckCheck className="w-4 h-4 mr-1" /> Mark all read
              </Button>
            </div>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {items.map((n) => (
                <div
                  key={n.id}
                  className={`p-2 rounded-md text-sm ${n.read ? "" : "bg-emerald-500/5"}`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.read ? "bg-transparent" : "bg-emerald-500"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{n.title}</div>
                      {n.body && <div className="text-xs text-muted-foreground truncate">{n.body}</div>}
                      <div className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(n.createdAt)} ago</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
