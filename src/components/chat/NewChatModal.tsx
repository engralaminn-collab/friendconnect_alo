"use client"

import { useState, useEffect } from "react"
import { Avatar } from "./Avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Search, Users, MessageSquare, Loader2 } from "lucide-react"
import { toast } from "sonner"

interface FriendData {
  id: string
  username: string
  name: string
  avatarUrl?: string | null
  status: string
  lastSeenAt?: string
}

export function NewChatModal({
  open,
  onOpenChange,
  friends,
  onConversationCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  friends: FriendData[]
  onConversationCreated: (conversationId: string) => void
}) {
  const [tab, setTab] = useState<"direct" | "group">("direct")
  const [query, setQuery] = useState("")
  const [searchResults, setSearchResults] = useState<FriendData[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<FriendData[]>([])
  const [groupTitle, setGroupTitle] = useState("")
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setSearchResults([])
      setSelected([])
      setGroupTitle("")
      setTab("direct")
    }
  }, [open])

  async function handleSearch(q: string) {
    setQuery(q)
    if (q.trim().length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    try {
      const r = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`)
      const body = await r.json()
      setSearchResults(body.users || [])
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  function toggleSelect(u: FriendData) {
    setSelected((prev) => {
      if (prev.some((p) => p.id === u.id)) return prev.filter((p) => p.id !== u.id)
      return [...prev, u]
    })
  }

  async function handleCreateDirect(otherId: string) {
    setCreating(true)
    try {
      const r = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "direct", memberIds: [otherId] }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error || "Failed")
      onConversationCreated(body.conversation.id)
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e.message || "Failed")
    } finally {
      setCreating(false)
    }
  }

  async function handleCreateGroup() {
    if (selected.length === 0) {
      toast.error("Select at least one member")
      return
    }
    if (!groupTitle.trim()) {
      toast.error("Enter a group name")
      return
    }
    setCreating(true)
    try {
      const r = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "group",
          title: groupTitle.trim(),
          memberIds: selected.map((s) => s.id),
        }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error || "Failed")
      toast.success("Group created")
      onConversationCreated(body.conversation.id)
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e.message || "Failed")
    } finally {
      setCreating(false)
    }
  }

  const filteredFriends = query.trim()
    ? friends.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()) || f.username.toLowerCase().includes(query.toLowerCase()))
    : friends

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Start a new conversation</DialogTitle>
          <DialogDescription>Pick a friend for a direct chat, or create a group.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="direct"><MessageSquare className="w-3.5 h-3.5 mr-1" /> Direct</TabsTrigger>
            <TabsTrigger value="group"><Users className="w-3.5 h-3.5 mr-1" /> Group</TabsTrigger>
          </TabsList>

          <TabsContent value="direct" className="mt-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search friends or people…"
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1">
              {searching && <div className="text-sm text-muted-foreground text-center py-2">Searching…</div>}
              {/* Friends first */}
              {!query && filteredFriends.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-6">
                  You don't have any friends yet. Use the Friends tab to add some.
                </div>
              )}
              {filteredFriends.map((f) => (
                <button
                  key={f.id}
                  onClick={() => handleCreateDirect(f.id)}
                  className="w-full flex items-center gap-2 px-2 py-2 hover:bg-muted rounded-md text-left"
                >
                  <Avatar name={f.name} src={f.avatarUrl} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{f.name}</div>
                    <div className="text-xs text-muted-foreground truncate">@{f.username}</div>
                  </div>
                </button>
              ))}
              {query && searchResults.length > 0 && (
                <>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2 pt-2">
                    All people
                  </div>
                  {searchResults.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => handleCreateDirect(u.id)}
                      className="w-full flex items-center gap-2 px-2 py-2 hover:bg-muted rounded-md text-left"
                    >
                      <Avatar name={u.name} src={u.avatarUrl} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{u.name}</div>
                        <div className="text-xs text-muted-foreground truncate">@{u.username}</div>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="group" className="mt-3 space-y-2">
            <div className="space-y-1">
              <Label htmlFor="groupTitle">Group name</Label>
              <Input
                id="groupTitle"
                placeholder="My group"
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
              />
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Add members (friends)…"
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1 p-1 bg-muted rounded-md">
                {selected.map((s) => (
                  <span key={s.id} className="flex items-center gap-1 bg-background rounded-full px-2 py-0.5 text-xs">
                    {s.name}
                    <button onClick={() => toggleSelect(s)} className="text-muted-foreground hover:text-rose-500">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="max-h-60 overflow-y-auto space-y-1">
              {filteredFriends.map((f) => {
                const isSel = selected.some((s) => s.id === f.id)
                return (
                  <button
                    key={f.id}
                    onClick={() => toggleSelect(f)}
                    className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left ${
                      isSel ? "bg-emerald-500/10" : "hover:bg-muted"
                    }`}
                  >
                    <Avatar name={f.name} src={f.avatarUrl} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{f.name}</div>
                      <div className="text-xs text-muted-foreground truncate">@{f.username}</div>
                    </div>
                    {isSel && <div className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs">✓</div>}
                  </button>
                )
              })}
            </div>
            <Button
              onClick={handleCreateGroup}
              disabled={creating || selected.length === 0 || !groupTitle.trim()}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create group ({selected.length})
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
