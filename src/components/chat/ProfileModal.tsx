"use client"

import { useState, useEffect } from "react"
import { Avatar } from "./Avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Loader2, Save, Star, UserX, Flag } from "lucide-react"
import { toast } from "sonner"

interface CurrentUser {
  id: string
  name: string
  username: string
  email: string
  avatarUrl?: string | null
  bio?: string | null
  status: string
}

export function ProfileModal({
  open,
  onOpenChange,
  user,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  user: CurrentUser
  onSaved: (u: CurrentUser) => void
}) {
  const [name, setName] = useState(user.name)
  const [bio, setBio] = useState(user.bio || "")
  const [status, setStatus] = useState(user.status || "")
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || "")
  const [saving, setSaving] = useState(false)
  const [starred, setStarred] = useState<any[]>([])

  useEffect(() => {
    if (open) {
      setName(user.name)
      setBio(user.bio || "")
      setStatus(user.status || "")
      setAvatarUrl(user.avatarUrl || "")
      loadStarred()
    }
  }, [open, user])

  async function loadStarred() {
    try {
      const r = await fetch("/api/messages/star")
      const body = await r.json()
      setStarred(body.starred || [])
    } catch {
      setStarred([])
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const r = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          bio: bio.trim(),
          status: status.trim(),
          avatarUrl: avatarUrl.trim() || null,
        }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error || "Failed")
      toast.success("Profile saved")
      onSaved(body.user)
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e.message || "Failed")
    } finally {
      setSaving(false)
    }
  }

  async function handleUploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append("file", file)
    try {
      const r = await fetch("/api/upload", { method: "POST", body: fd })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error || "Upload failed")
      setAvatarUrl(body.attachment.url)
    } catch (e: any) {
      toast.error(e.message || "Upload failed")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Your profile</DialogTitle>
          <DialogDescription>Update how others see you.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Avatar */}
          <div className="flex items-center gap-3">
            <Avatar name={name || "?"} src={avatarUrl || null} size={64} />
            <div>
              <label className="cursor-pointer">
                <span className="inline-flex items-center justify-center bg-background border border-border hover:bg-muted rounded-md px-3 py-1.5 text-sm">
                  Change avatar
                </span>
                <input type="file" accept="image/*" className="hidden" onChange={handleUploadAvatar} />
              </label>
              {avatarUrl && (
                <button
                  className="ml-2 text-xs text-rose-600 hover:underline"
                  onClick={() => setAvatarUrl("")}
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="name">Display name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="username">Username</Label>
            <Input id="username" value={user.username} disabled className="bg-muted" />
            <p className="text-xs text-muted-foreground">Username cannot be changed.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={user.email} disabled className="bg-muted" />
          </div>

          <div className="space-y-1">
            <Label htmlFor="status">Status</Label>
            <Input id="status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Available" maxLength={120} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell people about yourself" maxLength={200} rows={3} />
          </div>

          <Button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save changes
          </Button>

          {/* Starred messages */}
          {starred.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2 flex items-center gap-1">
                <Star className="w-4 h-4 text-amber-500" /> Starred messages ({starred.length})
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {starred.map((s) => (
                  <div key={s.id} className="text-xs p-2 bg-muted rounded-md">
                    <div className="text-muted-foreground">
                      {s.message.sender.name} · {s.message.conversation.title || "Direct"}
                    </div>
                    <div className="truncate">{s.message.content}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 border-t text-xs text-muted-foreground">
            <p className="flex items-center gap-1"><UserX className="w-3 h-3" /> Manage blocked users from conversation menus.</p>
            <p className="flex items-center gap-1 mt-1"><Flag className="w-3 h-3" /> Report abuse from any conversation.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
