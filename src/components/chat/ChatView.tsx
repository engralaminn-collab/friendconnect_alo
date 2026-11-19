"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Avatar } from "./Avatar"
import { MessageItem, type MessageData } from "./MessageItem"
import { Composer } from "./Composer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Search, Phone, Video, MoreVertical, ArrowLeft, Star, UserX, Flag, BellOff,
} from "lucide-react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { formatTime, timeAgo } from "@/lib/api"
import { toast } from "sonner"

export interface ConversationData {
  id: string
  type: "direct" | "group"
  title: string
  avatarUrl?: string | null
  description?: string | null
  ownerId?: string | null
  otherUser?: {
    id: string
    username: string
    name: string
    avatarUrl?: string | null
    status: string
    lastSeenAt: string
  } | null
  members: { userId: string; role: string; user: { id: string; username: string; name: string; avatarUrl?: string | null; status: string; lastSeenAt: string } }[]
  lastMessage: { id: string; content: string; createdAt: string; senderId: string; attachments?: any[] } | null
  unreadCount: number
  pinned: boolean
  muted: boolean
  lastReadAt?: string | null
}

export function ChatView({
  conversation,
  currentUserId,
  socket,
  starredIds,
  onBack,
  onBlock,
  onReport,
  onConversationChanged,
  onStartCall,
}: {
  conversation: ConversationData
  currentUserId: string
  socket: any
  starredIds: Set<string>
  onBack: () => void
  onBlock: (userId: string) => void
  onReport: (userId: string) => void
  onConversationChanged: () => void
  onStartCall: (peerUserId: string, peerName: string, peerAvatarUrl: string | null | undefined, callType: "audio" | "video") => void
}) {
  const [messages, setMessages] = useState<MessageData[]>([])
  const [loading, setLoading] = useState(true)
  const [replyingTo, setReplyingTo] = useState<MessageData | null>(null)
  const [editing, setEditing] = useState<MessageData | null>(null)
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set())
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<MessageData[]>([])
  const [presence, setPresence] = useState<{ online: boolean; lastSeenAt?: string }>({ online: false })
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const isGroup = conversation.type === "group"
  const title = conversation.title
  const otherUser = conversation.otherUser
  const subtitle = isGroup
    ? `${conversation.members.length} members`
    : presence.online
      ? "online"
      : presence.lastSeenAt
        ? `last seen ${timeAgo(presence.lastSeenAt)} ago`
        : "offline"

  // Load messages
  const loadMessages = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/conversations/${conversation.id}/messages?limit=50`)
      const body = await r.json()
      setMessages(body.messages || [])
    } finally {
      setLoading(false)
    }
  }, [conversation.id])

  useEffect(() => {
    loadMessages()
    setReplyingTo(null)
    setEditing(null)
    // mark as read on open
    fetch(`/api/conversations/${conversation.id}/messages`, { method: "PATCH" })
    if (socket?.connected) {
      socket.emit("message:read", { conversationId: conversation.id })
    }
  }, [conversation.id, loadMessages, socket])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current
      // only auto-scroll if user is near the bottom
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
      if (nearBottom) {
        el.scrollTop = el.scrollHeight
      }
    }
  }, [messages])

  // Initial scroll to bottom after load
  useEffect(() => {
    if (!loading && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [loading])

  // Presence: poll every 15s for the other user (direct chats)
  useEffect(() => {
    if (isGroup || !otherUser) return
    let cancelled = false
    async function fetchPresence() {
      try {
        const r = await fetch(`/api/presence?ids=${otherUser!.id}`)
        const body = await r.json()
        if (cancelled) return
        const p = body.presence?.[otherUser!.id]
        if (p) setPresence({ online: p.online, lastSeenAt: p.lastSeenAt })
      } catch {}
    }
    fetchPresence()
    const t = setInterval(fetchPresence, 15000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [isGroup, otherUser])

  // Socket events
  useEffect(() => {
    if (!socket) return
    const onNewMessage = (data: { conversationId: string; message: MessageData }) => {
      if (data.conversationId !== conversation.id) return
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.message.id)) return prev
        return [...prev, data.message]
      })
      // auto-mark as read if this conversation is open
      socket.emit("message:read", { conversationId: conversation.id })
    }
    const onUpdated = (data: { conversationId: string; message: MessageData }) => {
      if (data.conversationId !== conversation.id) return
      setMessages((prev) => prev.map((m) => (m.id === data.message.id ? data.message : m)))
    }
    const onDeleted = (data: { conversationId: string; messageId: string; deletedForAll: boolean }) => {
      if (data.conversationId !== conversation.id) return
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, deletedForAll: true, content: "" } : m))
      )
    }
    const onReaction = (data: { conversationId: string; messageId: string; userId: string; emoji: string; action: "added" | "removed" }) => {
      if (data.conversationId !== conversation.id) return
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== data.messageId) return m
          let reactions = m.reactions || []
          if (data.action === "added") {
            // remove existing by same user with same emoji if present
            reactions = reactions.filter((r) => !(r.userId === data.userId && r.emoji === data.emoji))
            reactions = [
              ...reactions,
              { id: `${data.messageId}-${data.userId}-${data.emoji}`, emoji: data.emoji, userId: data.userId, user: { id: data.userId, username: "" } },
            ]
          } else {
            reactions = reactions.filter((r) => !(r.userId === data.userId && r.emoji === data.emoji))
          }
          return { ...m, reactions }
        })
      )
    }
    const onTyping = (data: { conversationId: string; userId: string; isTyping: boolean }) => {
      if (data.conversationId !== conversation.id) return
      if (data.userId === currentUserId) return
      setTypingUsers((prev) => {
        const next = new Set(prev)
        if (data.isTyping) next.add(data.userId)
        else next.delete(data.userId)
        return next
      })
    }
    const onRead = (data: { conversationId: string; userId: string }) => {
      if (data.conversationId !== conversation.id) return
      if (data.userId === currentUserId) return
      // mark all messages sent by me before now as read by this user
      setMessages((prev) =>
        prev.map((m) => {
          if (m.senderId !== currentUserId) return m
          if (m.reads?.some((r) => r.userId === data.userId)) return m
          return { ...m, reads: [...(m.reads || []), { userId: data.userId, readAt: new Date().toISOString() }] }
        })
      )
    }
    socket.on("message:new", onNewMessage)
    socket.on("message:updated", onUpdated)
    socket.on("message:deleted", onDeleted)
    socket.on("message:reaction", onReaction)
    socket.on("typing:update", onTyping)
    socket.on("message:read", onRead)
    return () => {
      socket.off("message:new", onNewMessage)
      socket.off("message:updated", onUpdated)
      socket.off("message:deleted", onDeleted)
      socket.off("message:reaction", onReaction)
      socket.off("typing:update", onTyping)
      socket.off("message:read", onRead)
    }
  }, [socket, conversation.id, currentUserId])

  const handleSend = async (content: string, attachmentIds: string[], replyToId?: string | null) => {
    if (editing) {
      // Edit via REST
      try {
        const r = await fetch(`/api/messages/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        })
        if (!r.ok) throw new Error("Edit failed")
        const body = await r.json()
        setMessages((prev) => prev.map((m) => (m.id === editing.id ? body.message : m)))
      } catch (e: any) {
        toast.error(e.message || "Edit failed")
      }
      return
    }
    // Send via socket for realtime broadcast, with REST fallback
    if (socket?.connected) {
      socket.emit("message:send", {
        conversationId: conversation.id,
        content,
        replyToId: replyToId || null,
        attachmentIds,
      }, (res: any) => {
        if (res?.error) {
          toast.error(res.error)
        } else if (res?.ok) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === res.message.id)) return prev
            return [...prev, res.message]
          })
          onConversationChanged()
        }
      })
    } else {
      // REST fallback
      try {
        const r = await fetch(`/api/conversations/${conversation.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, replyToId: replyToId || null, attachmentIds }),
        })
        if (!r.ok) throw new Error("Send failed")
      } catch (e: any) {
        toast.error(e.message || "Send failed")
      }
    }
    onConversationChanged()
  }

  const handleTyping = (isTyping: boolean) => {
    if (!socket?.connected) return
    if (isTyping) socket.emit("typing:start", conversation.id)
    else socket.emit("typing:stop", conversation.id)
  }

  const handleReact = async (m: MessageData, emoji: string) => {
    // optimistic via socket
    if (socket?.connected) {
      socket.emit("message:react", { messageId: m.id, emoji }, (res: any) => {
        if (res?.error) toast.error(res.error)
      })
    } else {
      try {
        await fetch(`/api/messages/${m.id}/react`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji }),
        })
      } catch {}
    }
  }

  const handleStar = async (m: MessageData) => {
    try {
      await fetch(`/api/messages/${m.id}/star`, { method: "POST" })
      toast.success(starredIds.has(m.id) ? "Removed from starred" : "Added to starred")
    } catch {
      toast.error("Failed")
    }
  }

  const handleDelete = async (m: MessageData, scope: "self" | "all") => {
    if (!confirm(scope === "all" ? "Delete this message for everyone?" : "Delete for you?")) return
    if (socket?.connected) {
      socket.emit("message:delete", { messageId: m.id, scope }, (res: any) => {
        if (res?.error) toast.error(res.error)
      })
    } else {
      try {
        await fetch(`/api/messages/${m.id}?scope=${scope}`, { method: "DELETE" })
      } catch {}
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    try {
      const r = await fetch(`/api/conversations/${conversation.id}/messages/search?q=${encodeURIComponent(searchQuery)}`)
      const body = await r.json()
      setSearchResults(body.messages || [])
    } catch {}
  }

  const typingLabel = (() => {
    if (typingUsers.size === 0) return null
    if (typingUsers.size === 1) {
      const id = typingUsers.values().next().value
      const m = conversation.members.find((mm) => mm.userId === id)
      return m ? `${m.user.name} is typing…` : "someone is typing…"
    }
    return `${typingUsers.size} people are typing…`
  })()

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
        <Button variant="ghost" size="icon" className="md:hidden rounded-full" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Avatar
          name={title}
          src={conversation.avatarUrl}
          size={40}
          online={!isGroup ? presence.online : undefined}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{title}</div>
          <div className="text-xs text-muted-foreground truncate">
            {typingLabel ? <span className="text-emerald-600 dark:text-emerald-400">{typingLabel}</span> : subtitle}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setSearchOpen((v) => !v)}>
          <Search className="w-5 h-5" />
        </Button>
        {otherUser && (
          <>
            <Button variant="ghost" size="icon" className="rounded-full" onClick={() => onStartCall(otherUser.id, otherUser.name, otherUser.avatarUrl, "audio")} title="Voice call">
              <Phone className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" className="rounded-full" onClick={() => onStartCall(otherUser.id, otherUser.name, otherUser.avatarUrl, "video")} title="Video call">
              <Video className="w-5 h-5" />
            </Button>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <MoreVertical className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setSearchOpen(true)}>
              <Search className="w-4 h-4 mr-2" /> Search messages
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { window.open("/api/messages/starred", "_blank") }}>
              <Star className="w-4 h-4 mr-2" /> Starred messages
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toast.info("Toggle mute in conversation settings")}>
              <BellOff className="w-4 h-4 mr-2" /> Mute notifications
            </DropdownMenuItem>
            {!isGroup && otherUser && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-amber-600" onClick={() => onBlock(otherUser.id)}>
                  <UserX className="w-4 h-4 mr-2" /> Block user
                </DropdownMenuItem>
                <DropdownMenuItem className="text-rose-600" onClick={() => onReport(otherUser.id)}>
                  <Flag className="w-4 h-4 mr-2" /> Report user
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="px-3 py-2 border-b border-border bg-muted/50">
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder="Search messages…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button onClick={handleSearch} size="sm">Search</Button>
            <Button variant="ghost" size="sm" onClick={() => { setSearchOpen(false); setSearchResults([]); setSearchQuery("") }}>
              Close
            </Button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
              {searchResults.map((m) => (
                <button
                  key={m.id}
                  className="w-full text-left p-2 hover:bg-background rounded text-sm"
                  onClick={() => {
                    const el = document.getElementById(`msg-${m.id}`)
                    if (el) {
                      el.scrollIntoView({ behavior: "smooth", block: "center" })
                      el.classList.add("ring-2", "ring-emerald-500")
                      setTimeout(() => el.classList.remove("ring-2", "ring-emerald-500"), 1500)
                    }
                    setSearchOpen(false)
                  }}
                >
                  <div className="text-xs text-muted-foreground">{m.sender.name} · {formatTime(m.createdAt)}</div>
                  <div className="truncate">{m.content}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Loading messages…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-6">
            <div className="text-3xl">👋</div>
            <div className="text-sm">No messages yet. Say hello!</div>
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1]
            const showSender = !prev || prev.senderId !== m.senderId || (new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000)
            const showDateSeparator = !prev || !sameDay(prev.createdAt, m.createdAt)
            return (
              <div key={m.id}>
                {showDateSeparator && (
                  <div className="flex justify-center my-3">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {dayLabel(m.createdAt)}
                    </span>
                  </div>
                )}
                <div id={`msg-${m.id}`} className="rounded-lg transition-all">
                  <MessageItem
                    message={m}
                    currentUserId={currentUserId}
                    isGroup={isGroup}
                    showSender={showSender}
                    onReply={setReplyingTo}
                    onEdit={setEditing}
                    onDelete={handleDelete}
                    onReact={handleReact}
                    onStar={handleStar}
                    starred={starredIds.has(m.id)}
                  />
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <Composer
        onSend={handleSend}
        onTyping={handleTyping}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
      />
    </div>
  )
}

function sameDay(a: string | Date, b: string | Date): boolean {
  const da = typeof a === "string" ? new Date(a) : a
  const db = typeof b === "string" ? new Date(b) : b
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}

function dayLabel(d: string | Date): string {
  const da = typeof d === "string" ? new Date(d) : d
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(da, today)) return "Today"
  if (sameDay(da, yesterday)) return "Yesterday"
  return da.toLocaleDateString()
}
