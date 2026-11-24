"use client"

import { useState, useEffect } from "react"
import { Avatar } from "./Avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Search, Users, MessageSquare, UserPlus, Settings, Bell, Moon, Sun, LogOut, Pin,
} from "lucide-react"
import { useTheme } from "next-themes"
import { signOut } from "next-auth/react"
import { timeAgo } from "@/lib/api"
import type { ConversationData } from "./ChatView"
import { toast } from "sonner"

interface SidebarProps {
  currentUser: { id: string; name: string; username: string; email: string; avatarUrl?: string | null; status: string; bio?: string | null }
  conversations: ConversationData[]
  selectedId: string | null
  onSelect: (id: string) => void
  onOpenProfile: () => void
  onOpenNewChat: () => void
  onConversationChanged: () => void
  unreadNotifications: number
  onOpenNotifications: () => void
}

type FriendData = {
  id: string
  username: string
  name: string
  avatarUrl?: string | null
  status: string
  lastSeenAt?: string
}

type FriendRequestData = {
  id: string
  createdAt: string
  from?: FriendData
  to?: FriendData
}

export function Sidebar({
  currentUser,
  conversations,
  selectedId,
  onSelect,
  onOpenProfile,
  onOpenNewChat,
  onConversationChanged,
  unreadNotifications,
  onOpenNotifications,
}: SidebarProps) {
  const [tab, setTab] = useState<"chats" | "friends" | "requests">("chats")
  const [query, setQuery] = useState("")
  const [friends, setFriends] = useState<FriendData[]>([])
  const [sentRequests, setSentRequests] = useState<FriendRequestData[]>([])
  const [receivedRequests, setReceivedRequests] = useState<FriendRequestData[]>([])
  const [searchResults, setSearchResults] = useState<FriendData[]>([])
  const [searching, setSearching] = useState(false)
  const { theme, setTheme } = useTheme()

  async function loadFriends() {
    try {
      const r = await fetch("/api/friends")
      const body = await r.json()
      setFriends(body.friends || [])
      setSentRequests(body.sent || [])
      setReceivedRequests(body.received || [])
    } catch {}
  }

  useEffect(() => {
    loadFriends()
  }, [])

  // Refresh friend lists whenever we switch to the friends/requests tab
  useEffect(() => {
    if (tab !== "chats") loadFriends()
  }, [tab])

  async function handleSearchUsers(q: string) {
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

  async function handleSendRequest(toId: string) {
    try {
      const r = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", targetId: toId }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error)
      toast.success("Friend request sent")
      loadFriends()
    } catch (e: any) {
      toast.error(e.message || "Failed")
    }
  }

  // fetch() resolves for 4xx/5xx too, so every handler below checks r.ok before
  // reporting success. Previously a 404 (the endpoint did not exist) still showed
  // "Friend request accepted".
  async function postAction(url: string, body: Record<string, unknown> | undefined, success: string, opts?: { onDone?: () => void }) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!r.ok) {
        const payload = await r.json().catch(() => null)
        throw new Error(payload?.error || `Request failed (${r.status})`)
      }
      toast.success(success)
      await loadFriends()
      opts?.onDone?.()
    } catch (e: any) {
      toast.error(e?.message || "Failed")
    }
  }

  function handleAccept(id: string) {
    return postAction(`/api/friends/request/${id}/accept`, undefined, "Friend request accepted", {
      onDone: onConversationChanged,
    })
  }
  function handleReject(id: string) {
    return postAction(`/api/friends/request/${id}/reject`, undefined, "Request rejected")
  }
  function handleCancel(id: string) {
    return postAction(`/api/friends/request/${id}/cancel`, undefined, "Request cancelled")
  }

  const filteredConversations = query.trim()
    ? conversations.filter((c) => c.title?.toLowerCase().includes(query.toLowerCase()))
    : conversations

  return (
    <div className="flex flex-col h-full bg-background border-r border-border">
      {/* Top: user header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border">
        <button onClick={onOpenProfile} className="flex items-center gap-2 flex-1 min-w-0 text-left hover:bg-muted rounded-md p-1 -m-1">
          <Avatar name={currentUser.name} src={currentUser.avatarUrl} size={36} online />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{currentUser.name}</div>
            <div className="text-xs text-muted-foreground truncate">@{currentUser.username}</div>
          </div>
        </button>
        <Button variant="ghost" size="icon" className="rounded-full relative" onClick={onOpenNotifications}>
          <Bell className="w-5 h-5" />
          {unreadNotifications > 0 && (
            <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Toggle theme"
        >
          {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={tab === "chats" ? "Search conversations…" : "Search people…"}
            value={query}
            onChange={(e) => (tab === "chats" ? setQuery(e.target.value) : handleSearchUsers(e.target.value))}
            className="pl-8 bg-muted border-transparent focus-visible:bg-background"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="px-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="chats" className="text-xs">
              <MessageSquare className="w-3.5 h-3.5 mr-1" /> Chats
            </TabsTrigger>
            <TabsTrigger value="friends" className="text-xs">
              <Users className="w-3.5 h-3.5 mr-1" /> Friends
            </TabsTrigger>
            <TabsTrigger value="requests" className="text-xs relative">
              <UserPlus className="w-3.5 h-3.5 mr-1" /> Requests
              {receivedRequests.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center">
                  {receivedRequests.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto mt-2">
        {tab === "chats" && (
          <div>
            {filteredConversations.length === 0 ? (
              <EmptyState
                icon="💬"
                title={query ? "No conversations match" : "No conversations yet"}
                subtitle={query ? "" : "Start a new chat from the button below"}
              />
            ) : (
              filteredConversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  data-testid="sidebar-conversation"
                  className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted transition text-left ${
                    selectedId === c.id ? "bg-muted" : ""
                  }`}
                >
                  <Avatar
                    name={c.title}
                    src={c.avatarUrl}
                    size={44}
                    online={c.type === "direct" ? (c.otherUser ? undefined : undefined) : undefined}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      {c.pinned && <Pin className="w-3 h-3 text-muted-foreground shrink-0" />}
                      <span className="font-medium text-sm truncate">{c.title}</span>
                      {c.lastMessage && (
                        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                          {timeAgo(c.lastMessage.createdAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-xs text-muted-foreground truncate flex-1">
                        {c.lastMessage
                          ? (c.lastMessage.senderId === currentUser.id ? "You: " : "") + (c.lastMessage.content || "[attachment]")
                          : "Tap to start chatting"}
                      </span>
                      {c.unreadCount > 0 && (
                        <span className="bg-emerald-500 text-white text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {tab === "friends" && (
          <div>
            {/* Search results (people not yet friends) */}
            {searchResults.length > 0 && (
              <div className="mb-2">
                <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  People
                </div>
                {searchResults.map((u) => (
                  <div key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted">
                    <Avatar name={u.name} src={u.avatarUrl} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{u.name}</div>
                      <div className="text-xs text-muted-foreground truncate">@{u.username}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => handleSendRequest(u.id)}>
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Your friends ({friends.length})
            </div>
            {friends.length === 0 ? (
              <EmptyState
                icon="👥"
                title="No friends yet"
                subtitle="Search for people above to add them"
              />
            ) : (
              friends.map((f) => (
                <div key={f.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted">
                  <Avatar name={f.name} src={f.avatarUrl} size={36} online />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{f.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {f.lastSeenAt ? `last seen ${timeAgo(f.lastSeenAt)} ago` : `@${f.username}`}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => onOpenNewChat()}>
                    <MessageSquare className="w-4 h-4" />
                  </Button>
                </div>
              ))
            )}

            {sentRequests.length > 0 && (
              <>
                <div className="px-3 py-1 mt-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Sent requests
                </div>
                {sentRequests.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted">
                    <Avatar name={r.to?.name || "?"} src={r.to?.avatarUrl} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{r.to?.name}</div>
                      <div className="text-xs text-muted-foreground">Pending</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => handleCancel(r.id)}>Cancel</Button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {tab === "requests" && (
          <div>
            <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Incoming ({receivedRequests.length})
            </div>
            {receivedRequests.length === 0 ? (
              <EmptyState icon="📭" title="No pending requests" />
            ) : (
              receivedRequests.map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted">
                  <Avatar name={r.from?.name || "?"} src={r.from?.avatarUrl} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{r.from?.name}</div>
                    <div className="text-xs text-muted-foreground truncate">@{r.from?.username}</div>
                  </div>
                  <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white" onClick={() => handleAccept(r.id)}>
                    Accept
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleReject(r.id)}>Decline</Button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Bottom: new chat + signout */}
      <div className="border-t border-border p-2 flex items-center gap-1">
        <Button
          data-testid="new-chat"
          className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white"
          onClick={onOpenNewChat}
        >
          <MessageSquare className="w-4 h-4 mr-2" /> New chat
        </Button>
        <Button variant="ghost" size="icon" onClick={onOpenProfile} title="Settings">
          <Settings className="w-5 h-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={async () => {
            // Revoke the DB-backed registry session before clearing NextAuth's
            // browser cookie so open realtime sockets become unauthorized too.
            await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
            await signOut({ callbackUrl: "/" })
          }}
          title="Sign out"
        >
          <LogOut className="w-5 h-5" />
        </Button>
      </div>
    </div>
  )
}

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-sm font-medium">{title}</div>
      {subtitle && <div className="text-xs mt-0.5">{subtitle}</div>}
    </div>
  )
}
