'use client'
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from 'react'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useApp } from '@/lib/store'
import { useAuth } from '@/hooks/use-auth'
import { useSocket } from '@/hooks/use-socket'
import { RT } from '@/lib/constants'
import { api, uploadFile, clockTime, timeAgo, lastSeenText } from '@/lib/api'
import { UserAvatar, EmptyState } from '@/components/fc/ui'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  Phone,
  Video,
  Send,
  Paperclip,
  Smile,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Download,
  Search,
  Users,
  MessageCircle,
  Loader2,
  Pin,
  Bell,
  BellOff,
  Mic,
  X,
  Trash2,
  Heart,
} from 'lucide-react'

// ---------------- types ----------------
type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document'
type MessageStatus = 'SENDING' | 'SENT' | 'DELIVERED' | 'SEEN'

interface Reaction {
  emoji: string
  userId: string
  userName: string
}

interface Conversation {
  id: string
  username: string
  name: string
  photoUrl: string | null
  unread: number
  pinned?: boolean
  muted?: boolean
  lastMessage: {
    content: string
    type: string
    senderId: string
    createdAt: string
    status: string
  } | null
}

interface GroupLite {
  id: string
  name: string
  description: string | null
  photoUrl: string | null
  role: string
  memberCount: number
  createdAt: string
}

interface Message {
  id: string
  tempId?: string
  senderId: string
  senderName?: string | null
  senderPhoto?: string | null
  receiverId?: string | null
  groupId?: string | null
  content: string
  type: MessageType
  fileUrl?: string | null
  fileName?: string | null
  fileSize?: number | null
  mimeType?: string | null
  status?: MessageStatus
  createdAt: string
  reactions?: Reaction[]
}

interface Friend {
  id: string
  username: string
  name: string
  photoUrl: string | null
  lastSeen: string | null
}

interface PeerInfo {
  name: string
  photoUrl: string | null
  username?: string
  lastSeen?: string | null
  memberCount?: number
}

const EMOJIS = [
  '😀', '😄', '😁', '😂', '🥹', '😊', '😍', '😘',
  '😎', '🤔', '😴', '😭', '😡', '🥳', '😇', '🙃',
  '👍', '👎', '🙏', '👏', '🙌', '🤝', '👋', '✌️',
  '🤞', '💪', '❤️', '🧡', '💛', '💚', '💙', '💜',
  '🔥', '✨', '🎉', '🎁', '💯', '⭐', '🌟', '☀️',
  '🌙', '🌈', '☕', '🍕', '🍔', '🍟', '🍦', '🍓',
  '🌸', '🌺', '🐶', '🐱', '🦄', '🐢', '🦋', '🐝',
  '⚽', '🏀', '🎵', '🎮', '📱', '💻', '📚', '✅',
  '❌', '❓', '❗', '🚀', '👀', '🫶', '🤗', '🫡',
]

// ---------------- helpers ----------------
function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return ''
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

function fileTypeFromMime(mime: string | null | undefined): MessageType {
  if (!mime) return 'document'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

function linkify(text: string): React.ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer" className="underline break-all">
          {part}
        </a>
      )
    }
    return <span key={i}>{part}</span>
  })
}

function toISO(d: any): string {
  if (!d) return new Date().toISOString()
  if (typeof d === 'string') return d
  if (d instanceof Date) return d.toISOString()
  try {
    return new Date(d).toISOString()
  } catch {
    return new Date().toISOString()
  }
}

function newTempId(): string {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeMessage(raw: any): Message {
  return {
    id: raw.id,
    senderId: raw.senderId,
    senderName: raw.senderName ?? raw.sender?.name ?? null,
    senderPhoto: raw.senderPhoto ?? raw.sender?.profile?.photoUrl ?? null,
    receiverId: raw.receiverId ?? null,
    groupId: raw.groupId ?? null,
    content: raw.content ?? '',
    type: (raw.type ?? 'text') as MessageType,
    fileUrl: raw.fileUrl ?? null,
    fileName: raw.fileName ?? null,
    fileSize: raw.fileSize ?? null,
    mimeType: raw.mimeType ?? null,
    status: (raw.status ?? 'SENT') as MessageStatus,
    createdAt: toISO(raw.createdAt),
    reactions: Array.isArray(raw.reactions) ? raw.reactions.map((r: any) => ({ emoji: r.emoji, userId: r.userId, userName: r.userName })) : [],
  }
}

function lastMessagePreview(c: Conversation, meId: string | undefined): string {
  if (!c.lastMessage) return 'Tap to start chatting'
  const lm = c.lastMessage
  const prefix = meId && lm.senderId === meId ? 'You: ' : ''
  if (lm.type === 'image') return `${prefix}📷 Photo`
  if (lm.type === 'video') return `${prefix}🎥 Video`
  if (lm.type === 'audio') return `${prefix}🎤 Audio`
  if (lm.type === 'document') return `${prefix}📄 Document`
  return `${prefix}${lm.content}`
}

// ---------------- main entry ----------------
export function ChatView() {
  const activeChatUserId = useApp((s) => s.activeChatUserId)
  const activeChatGroupId = useApp((s) => s.activeChatGroupId)
  const back = useCallback(() => {
    useApp.setState({ activeChatUserId: null, activeChatGroupId: null })
  }, [])

  if (activeChatUserId) {
    return <ChatRoom mode="direct" peerId={activeChatUserId} onBack={back} />
  }
  if (activeChatGroupId) {
    return <ChatRoom mode="group" peerId={activeChatGroupId} onBack={back} />
  }
  return <ConversationList />
}

// ---------------- conversation list ----------------
function ConversationList() {
  const [tab, setTab] = useState<'chats' | 'groups'>('chats')
  const [query, setQuery] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [groups, setGroups] = useState<GroupLite[]>([])
  const [loading, setLoading] = useState(true)
  const { openChat, openGroupChat } = useApp()
  const { socket, isOnline } = useSocket()
  const { user: me } = useAuth()
  const meId = me?.id

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, g] = await Promise.all([
        api<{ conversations: Conversation[] }>('/api/messages/conversations').catch(() => ({ conversations: [] as Conversation[] })),
        api<{ groups: GroupLite[] }>('/api/groups').catch(() => ({ groups: [] as GroupLite[] })),
      ])
      setConversations(c.conversations)
      setGroups(g.groups)
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // realtime: refresh lastMessage + unread when a new message arrives
  useEffect(() => {
    if (!socket || !meId) return
    const onNew = (raw: any) => {
      if (!raw || raw.groupId) return
      const peerId = raw.senderId === meId ? raw.receiverId : raw.senderId
      if (!peerId) return
      setConversations((prev) => {
        const exists = prev.find((c) => c.id === peerId)
        const lm = {
          content: raw.content || '',
          type: raw.type || 'text',
          senderId: raw.senderId,
          createdAt: toISO(raw.createdAt),
          status: raw.status || 'SENT',
        }
        const unreadInc = raw.receiverId === meId ? 1 : 0
        if (exists) {
          const updated: Conversation = {
            ...exists,
            lastMessage: lm,
            unread: exists.unread + unreadInc,
          }
          return [updated, ...prev.filter((c) => c.id !== peerId)]
        }
        // unknown peer — refetch to populate name/photo
        load()
        return prev
      })
    }
    const onStatus = ({ id, status }: { id: string; status: string }) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.lastMessage && c.lastMessage.senderId === meId && c.lastMessage.status !== status
            ? { ...c, lastMessage: { ...c.lastMessage, status } }
            : c
        )
      )
    }
    const onGroupNew = (raw: any) => {
      if (!raw?.groupId) return
      // bump group to top by re-fetching once (lightweight)
      load()
    }
    socket.on(RT.MESSAGE_NEW, onNew)
    socket.on(RT.MESSAGE_STATUS, onStatus as any)
    socket.on(RT.GROUP_MESSAGE_NEW, onGroupNew as any)
    return () => {
      socket.off(RT.MESSAGE_NEW, onNew)
      socket.off(RT.MESSAGE_STATUS, onStatus as any)
      socket.off(RT.GROUP_MESSAGE_NEW, onGroupNew as any)
    }
  }, [socket, meId, load])

  const q = query.trim().toLowerCase()
  const filteredConvs = q
    ? conversations.filter((c) => c.name.toLowerCase().includes(q) || c.username.toLowerCase().includes(q))
    : conversations
  const filteredGroups = q
    ? groups.filter((g) => g.name.toLowerCase().includes(q) || (g.description || '').toLowerCase().includes(q))
    : groups

  const totalUnread = conversations.reduce((s, c) => s + c.unread, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-bold">Chats</h1>
          {totalUnread > 0 && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
              {totalUnread} unread
            </span>
          )}
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats and groups"
            className="rounded-xl pl-9"
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'chats' | 'groups')} className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 grid grid-cols-2 rounded-xl">
          <TabsTrigger value="chats" className="text-xs">
            Chats
            {totalUnread > 0 && (
              <span className="ml-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {totalUnread > 9 ? '9+' : totalUnread}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="groups" className="text-xs">
            Groups
            {groups.length > 0 && (
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">{groups.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chats" className="fc-scroll m-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="space-y-1 p-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <ConvRowSkeleton key={i} />
              ))}
            </div>
          ) : filteredConvs.length === 0 ? (
            <EmptyState
              icon={<MessageCircle size={36} />}
              title={q ? 'No matching chats' : 'No conversations yet'}
              description={q ? 'Try a different search.' : 'Add a friend and say hello to start chatting.'}
            />
          ) : (
            <div className="space-y-0.5">
              {filteredConvs.map((c) => (
                <ConversationRow
                  key={c.id}
                  conversation={c}
                  online={isOnline(c.id)}
                  meId={meId}
                  onOpen={() => openChat(c.id)}
                  onTogglePin={async () => {
                    try {
                      await api('/api/messages/preferences', { method: 'POST', body: JSON.stringify({ peerId: c.id, pinned: !c.pinned }) })
                      setConversations((prev) => prev.map((x) => (x.id === c.id ? { ...x, pinned: !x.pinned } : x)))
                    } catch (e: any) { toast.error(e.message) }
                  }}
                  onToggleMute={async () => {
                    try {
                      await api('/api/messages/preferences', { method: 'POST', body: JSON.stringify({ peerId: c.id, muted: !c.muted }) })
                      setConversations((prev) => prev.map((x) => (x.id === c.id ? { ...x, muted: !x.muted } : x)))
                    } catch (e: any) { toast.error(e.message) }
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="groups" className="fc-scroll m-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="space-y-1 p-2">
              {[0, 1, 2, 3].map((i) => (
                <ConvRowSkeleton key={i} />
              ))}
            </div>
          ) : filteredGroups.length === 0 ? (
            <EmptyState
              icon={<Users size={36} />}
              title={q ? 'No matching groups' : 'No groups yet'}
              description={q ? 'Try a different search.' : 'Create a group from the Groups tab to chat with multiple friends.'}
            />
          ) : (
            <div className="space-y-0.5">
              {filteredGroups.map((g) => (
                <GroupRow key={g.id} group={g} onOpen={() => openGroupChat(g.id)} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ConversationRow({
  conversation,
  online,
  meId,
  onOpen,
  onTogglePin,
  onToggleMute,
}: {
  conversation: Conversation
  online: boolean
  meId?: string
  onOpen: () => void
  onTogglePin: () => void
  onToggleMute: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pinned, setPinned] = useState(!!conversation.pinned)
  const [muted, setMuted] = useState(!!conversation.muted)

  useEffect(() => {
    setPinned(!!conversation.pinned)
    setMuted(!!conversation.muted)
  }, [conversation.pinned, conversation.muted])

  const startPress = () => {
    pressTimer.current = setTimeout(() => setMenuOpen(true), 500)
  }
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
  }

  return (
    <div className="relative">
      <button
        onClick={onOpen}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-accent/50',
          pinned && 'bg-primary/5'
        )}
      >
        <UserAvatar name={conversation.name} src={conversation.photoUrl} size={48} online={online} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1 truncate text-sm font-semibold">
              <span className="truncate">{conversation.name}</span>
              {pinned && <Pin size={11} className="shrink-0 text-primary" />}
              {muted && <BellOff size={11} className="shrink-0 text-muted-foreground" />}
            </span>
            {conversation.lastMessage && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {timeAgo(conversation.lastMessage.createdAt)}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'truncate text-xs',
                conversation.unread > 0 && !muted ? 'font-medium text-foreground' : 'text-muted-foreground'
              )}
            >
              {lastMessagePreview(conversation, meId)}
            </span>
            {conversation.unread > 0 && (
              <span
                className={cn(
                  'grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[10px] font-bold',
                  muted ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'
                )}
              >
                {conversation.unread > 9 ? '9+' : conversation.unread}
              </span>
            )}
          </div>
        </div>
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-2 top-12 z-30 w-44 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-xl fc-rise">
            <button
              onClick={() => { onTogglePin(); setPinned((p) => !p); setMenuOpen(false) }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-accent"
            >
              <Pin size={14} /> {pinned ? 'Unpin chat' : 'Pin chat'}
            </button>
            <button
              onClick={() => { onToggleMute(); setMuted((m) => !m); setMenuOpen(false) }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-accent"
            >
              {muted ? <Bell size={14} /> : <BellOff size={14} />} {muted ? 'Unmute' : 'Mute notifications'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function GroupRow({ group, onOpen }: { group: GroupLite; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-accent/50"
    >
      {group.photoUrl ? (
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full ring-1 ring-border">
          <img src={group.photoUrl} alt={group.name} className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/15 text-primary ring-1 ring-border">
          <Users size={22} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold">{group.name}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(group.createdAt)}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
          {group.description ? ` · ${group.description}` : ''}
        </div>
      </div>
    </button>
  )
}

function ConvRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl p-2.5">
      <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
      </div>
    </div>
  )
}

// ---------------- chat room (direct + group) ----------------
function ChatRoom({
  mode,
  peerId,
  onBack,
}: {
  mode: 'direct' | 'group'
  peerId: string
  onBack: () => void
}) {
  const { user: me } = useAuth()
  const { socket, isOnline } = useSocket()
  const [messages, setMessages] = useState<Message[]>([])
  const [peerInfo, setPeerInfo] = useState<PeerInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [peerTyping, setPeerTyping] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordSecs, setRecordSecs] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const atBottomRef = useRef(true)
  const oldestTsRef = useRef<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const recordStreamRef = useRef<MediaStream | null>(null)
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevHeightRef = useRef(0)
  const skipAutoScrollRef = useRef(false)
  const meId = me?.id

  // ---- load history + peer info ----
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setMessages([])
    setHasMore(true)
    setPeerTyping(false)
    setPeerInfo(null)
    oldestTsRef.current = null
    atBottomRef.current = true

    const endpoint = `/api/messages?${mode === 'direct' ? 'userId' : 'groupId'}=${encodeURIComponent(peerId)}`

    Promise.all([
      api<{ messages: Message[] }>(endpoint)
        .then((d) => d.messages)
        .catch((e: any) => {
          toast.error(e?.message || 'Failed to load messages')
          return [] as Message[]
        }),
      mode === 'direct'
        ? api<{ friends: Friend[] }>('/api/friends')
            .then((d) => d.friends.find((f) => f.id === peerId) || null)
            .then((friend): PeerInfo | null => {
              if (friend) {
                return {
                  name: friend.name,
                  photoUrl: friend.photoUrl,
                  username: friend.username,
                  lastSeen: friend.lastSeen,
                }
              }
              // fallback to conversations endpoint (peer may not be a friend yet but has messages)
              return api<{ conversations: Conversation[] }>('/api/messages/conversations')
                .then((d) => {
                  const c = d.conversations.find((c) => c.id === peerId)
                  return c
                    ? { name: c.name, photoUrl: c.photoUrl, username: c.username, lastSeen: null }
                    : null
                })
                .catch(() => null)
            })
            .catch(() => null)
        : api<{ groups: GroupLite[] }>('/api/groups')
            .then((d) => {
              const g = d.groups.find((g) => g.id === peerId)
              return g
                ? { name: g.name, photoUrl: g.photoUrl, memberCount: g.memberCount }
                : null
            })
            .catch(() => null),
    ])
      .then(([msgs, info]) => {
        if (cancelled) return
        const normalized = msgs.map(normalizeMessage)
        setMessages(normalized)
        if (normalized.length > 0) oldestTsRef.current = normalized[0].createdAt
        if (normalized.length < 50) setHasMore(false)
        if (info) setPeerInfo(info)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [mode, peerId])

  // ---- jump to bottom after first load ----
  useEffect(() => {
    if (loading) return
    const id = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    })
    return () => cancelAnimationFrame(id)
  }, [loading])

  // ---- auto-scroll on new messages ----
  useEffect(() => {
    if (loading) return
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false
      return
    }
    if (loadingOlder) return
    if (!atBottomRef.current) return
    const id = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(id)
  }, [messages.length, peerTyping, loading, loadingOlder])

  // ---- socket subscriptions ----
  useEffect(() => {
    if (!socket || !meId) return

    const isRelevant = (raw: any): boolean => {
      if (!raw) return false
      if (mode === 'direct') {
        if (raw.groupId) return false
        return (
          (raw.senderId === peerId && raw.receiverId === meId) ||
          (raw.senderId === meId && raw.receiverId === peerId)
        )
      }
      return raw.groupId === peerId
    }

    const onNew = (raw: any) => {
      if (!isRelevant(raw)) return
      const msg = normalizeMessage(raw)
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        return [...prev, msg]
      })
      // mark realtime incoming 1:1 messages as seen
      if (mode === 'direct' && msg.senderId === peerId && msg.receiverId === meId) {
        socket.emit(RT.MESSAGE_SEEN, { messageId: msg.id })
      }
    }

    const onStatus = ({ id, status }: { id: string; status: string }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: status as MessageStatus } : m))
      )
    }

    const onTyping = ({ userId, isTyping }: { userId: string; isTyping: boolean }) => {
      if (mode === 'direct' && userId === peerId) setPeerTyping(isTyping)
    }

    const onReaction = ({ messageId, userId, emoji, action }: { messageId: string; userId: string; emoji: string; action: 'add' | 'remove' }) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m
          const reactions = m.reactions ? [...m.reactions] : []
          if (action === 'add') {
            if (!reactions.some((r) => r.userId === userId && r.emoji === emoji)) {
              reactions.push({ emoji, userId, userName: '' })
            }
          } else {
            const idx = reactions.findIndex((r) => r.userId === userId && r.emoji === emoji)
            if (idx >= 0) reactions.splice(idx, 1)
          }
          return { ...m, reactions }
        })
      )
    }

    socket.on(RT.MESSAGE_NEW, onNew)
    socket.on(RT.GROUP_MESSAGE_NEW, onNew)
    socket.on(RT.MESSAGE_STATUS, onStatus)
    socket.on(RT.TYPING_INDICATOR, onTyping)
    socket.on(RT.REACTION_UPDATE, onReaction)

    return () => {
      socket.off(RT.MESSAGE_NEW, onNew)
      socket.off(RT.GROUP_MESSAGE_NEW, onNew)
      socket.off(RT.MESSAGE_STATUS, onStatus)
      socket.off(RT.TYPING_INDICATOR, onTyping)
      socket.off(RT.REACTION_UPDATE, onReaction)
      if (mode === 'direct') {
        socket.emit(RT.TYPING, { receiverId: peerId, isTyping: false })
      }
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    }
  }, [socket, meId, peerId, mode])

  // ---- toggle reaction on a message ----
  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      if (!socket) return
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m
          const reactions = m.reactions ? [...m.reactions] : []
          const existing = reactions.find((r) => r.userId === meId && r.emoji === emoji)
          if (existing) {
            const idx = reactions.indexOf(existing)
            reactions.splice(idx, 1)
            socket.emit(RT.REACTION_REMOVE, { messageId, emoji })
          } else {
            reactions.push({ emoji, userId: meId, userName: me?.name || '' })
            socket.emit(RT.REACTION_ADD, { messageId, emoji })
          }
          return { ...m, reactions }
        })
      )
    },
    [socket, meId, me]
  )

  // ---- scroll handling + infinite scroll up ----
  const loadOlder = useCallback(async () => {
    if (!oldestTsRef.current) return
    setLoadingOlder(true)
    const el = scrollRef.current
    prevHeightRef.current = el?.scrollHeight || 0
    try {
      const endpoint = `/api/messages?${mode === 'direct' ? 'userId' : 'groupId'}=${encodeURIComponent(peerId)}&before=${encodeURIComponent(oldestTsRef.current)}`
      const data = await api<{ messages: Message[] }>(endpoint)
      if (data.messages.length === 0) {
        setHasMore(false)
      } else {
        const normalized = data.messages.map(normalizeMessage)
        skipAutoScrollRef.current = true
        setMessages((prev) => [...normalized, ...prev])
        oldestTsRef.current = normalized[0]?.createdAt || oldestTsRef.current
        if (normalized.length < 50) setHasMore(false)
        // restore scroll position after DOM update
        requestAnimationFrame(() => {
          if (el) {
            const newHeight = el.scrollHeight
            el.scrollTop = newHeight - prevHeightRef.current
          }
        })
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load older messages')
    } finally {
      setLoadingOlder(false)
    }
  }, [mode, peerId])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    atBottomRef.current = distFromBottom < 80
    if (el.scrollTop < 60 && hasMore && !loadingOlder && !loading && oldestTsRef.current) {
      loadOlder()
    }
  }, [hasMore, loadingOlder, loading, loadOlder])

  // ---- send text ----
  const sendMessage = useCallback(
    (partial: Pick<Message, 'content' | 'type' | 'fileUrl' | 'fileName' | 'fileSize' | 'mimeType'>) => {
      if (!socket || !meId) return
      const tempId = newTempId()
      const optimistic: Message = {
        id: tempId,
        tempId,
        senderId: meId,
        senderName: me?.name || null,
        senderPhoto: me?.profile?.photoUrl ?? null,
        receiverId: mode === 'direct' ? peerId : null,
        groupId: mode === 'group' ? peerId : null,
        content: partial.content,
        type: partial.type,
        fileUrl: partial.fileUrl ?? null,
        fileName: partial.fileName ?? null,
        fileSize: partial.fileSize ?? null,
        mimeType: partial.mimeType ?? null,
        status: 'SENDING',
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimistic])
      atBottomRef.current = true

      const payload: any = {
        tempId,
        content: partial.content,
        type: partial.type,
        fileUrl: partial.fileUrl ?? undefined,
        fileName: partial.fileName ?? undefined,
        fileSize: partial.fileSize ?? undefined,
        mimeType: partial.mimeType ?? undefined,
        ...(mode === 'direct' ? { receiverId: peerId } : { groupId: peerId }),
      }
      const event = mode === 'direct' ? RT.MESSAGE_SEND : RT.GROUP_MESSAGE_SEND
      socket.emit(event, payload, (ack: any) => {
        if (ack?.ok && ack.message) {
          const realMsg: Message = {
            ...normalizeMessage(ack.message),
            tempId,
            senderName: ack.message.senderName ?? ack.message.sender?.name ?? me?.name ?? null,
            senderPhoto: ack.message.senderPhoto ?? ack.message.sender?.profile?.photoUrl ?? me?.profile?.photoUrl ?? null,
          }
          setMessages((prev) => prev.map((m) => (m.tempId === tempId ? realMsg : m)))
        } else {
          // leave optimistic in place with SENT fallback so user can retry
          setMessages((prev) =>
            prev.map((m) => (m.tempId === tempId ? { ...m, status: 'SENT' } : m))
          )
          toast.error(ack?.error || 'Failed to send message')
        }
      })
    },
    [socket, meId, me, mode, peerId]
  )

  const sendText = useCallback(() => {
    const content = text.trim()
    if (!content) return
    sendMessage({ content, type: 'text', fileUrl: null, fileName: null, fileSize: null, mimeType: null })
    setText('')
    if (socket && mode === 'direct') {
      socket.emit(RT.TYPING, { receiverId: peerId, isTyping: false })
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    }
  }, [text, sendMessage, socket, mode, peerId])

  // ---- send file ----
  const sendFile = useCallback(
    async (file: File) => {
      setUploading(true)
      try {
        const { file: uploaded } = await uploadFile(file)
        const type = fileTypeFromMime(uploaded.mimeType)
        sendMessage({
          content: '',
          type,
          fileUrl: uploaded.url,
          fileName: uploaded.name,
          fileSize: uploaded.size,
          mimeType: uploaded.mimeType,
        })
      } catch (e: any) {
        toast.error(e?.message || 'Upload failed')
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [sendMessage]
  )

  // ---- voice note recording ----
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recordStreamRef.current = stream
      recordedChunksRef.current = []
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data)
      }
      mr.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: mr.mimeType || 'audio/webm' })
        const ext = (mr.mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm'
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type })
        await sendFile(file)
      }
      mr.start()
      mediaRecorderRef.current = mr
      setRecording(true)
      setRecordSecs(0)
      recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000)
    } catch (e: any) {
      toast.error(e?.message || 'Microphone access denied')
    }
  }, [sendFile])

  const stopRecording = useCallback((cancel: boolean = false) => {
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== 'inactive') {
      if (cancel) {
        mr.onstop = null
        mr.stop()
      } else {
        mr.stop()
      }
    }
    if (recordStreamRef.current) {
      recordStreamRef.current.getTracks().forEach((t) => t.stop())
      recordStreamRef.current = null
    }
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    setRecording(false)
    setRecordSecs(0)
  }, [])

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordStreamRef.current) recordStreamRef.current.getTracks().forEach((t) => t.stop())
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    }
  }, [])

  // ---- search reload ----
  const runSearch = useCallback(
    async (q: string) => {
      setSearchQuery(q)
      if (!q.trim()) {
        // reload normal history
        try {
          const endpoint = `/api/messages?${mode === 'direct' ? 'userId' : 'groupId'}=${encodeURIComponent(peerId)}`
          const data = await api<{ messages: Message[] }>(endpoint)
          setMessages(data.messages.map(normalizeMessage))
          if (data.messages.length > 0) oldestTsRef.current = data.messages[0].createdAt
          setHasMore(data.messages.length >= 50)
        } catch {}
        return
      }
      try {
        const endpoint = `/api/messages?${mode === 'direct' ? 'userId' : 'groupId'}=${encodeURIComponent(peerId)}&q=${encodeURIComponent(q)}`
        const data = await api<{ messages: Message[] }>(endpoint)
        setMessages(data.messages.map(normalizeMessage))
        setHasMore(false)
      } catch {}
    },
    [mode, peerId]
  )

  // ---- typing ----
  const handleTextInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    if (socket && mode === 'direct') {
      socket.emit(RT.TYPING, { receiverId: peerId, isTyping: true })
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      typingTimerRef.current = setTimeout(() => {
        socket.emit(RT.TYPING, { receiverId: peerId, isTyping: false })
      }, 1500)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendText()
    }
  }

  const startCall = (type: 'audio' | 'video') => {
    window.dispatchEvent(
      new CustomEvent('fc:start-call', { detail: { targetUserId: peerId, type } })
    )
  }

  const online = mode === 'direct' ? isOnline(peerId) : false
  const headerStatus = mode === 'direct'
    ? peerTyping
      ? 'typing…'
      : lastSeenText(online, peerInfo?.lastSeen)
    : `${peerInfo?.memberCount ?? 0} members`

  return (
    <div className="flex h-full flex-col bg-background">
      {/* header */}
      <header className="flex items-center gap-2 border-b border-border bg-background/95 px-2 py-2 backdrop-blur">
        <button
          onClick={onBack}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-foreground transition hover:bg-accent"
          aria-label="Back to conversations"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {mode === 'direct' ? (
            <UserAvatar name={peerInfo?.name || 'User'} src={peerInfo?.photoUrl} size={38} online={online} />
          ) : peerInfo?.photoUrl ? (
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full ring-1 ring-border">
              <img src={peerInfo.photoUrl} alt={peerInfo.name} className="h-full w-full object-cover" />
            </div>
          ) : (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary ring-1 ring-border">
              <Users size={18} />
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">
              {peerInfo?.name || (loading ? 'Loading…' : 'Unknown')}
            </div>
            <div
              className={cn(
                'truncate text-xs leading-tight',
                peerTyping ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              {headerStatus}
            </div>
          </div>
        </div>
        {mode === 'direct' && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => setSearchOpen((s) => !s)}
              className={cn('grid h-9 w-9 place-items-center rounded-full transition hover:bg-accent', searchOpen ? 'text-primary' : 'text-muted-foreground hover:text-primary')}
              aria-label="Search messages"
            >
              <Search size={18} />
            </button>
            <button
              onClick={() => startCall('audio')}
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-primary"
              aria-label="Start audio call"
            >
              <Phone size={18} />
            </button>
            <button
              onClick={() => startCall('video')}
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-primary"
              aria-label="Start video call"
            >
              <Video size={18} />
            </button>
          </div>
        )}
      </header>

      {/* search bar */}
      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
          <Search size={15} className="text-muted-foreground" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="Search messages in this chat…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setSearchOpen(false); runSearch('') }}
              className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-accent"
              aria-label="Close search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="fc-scroll flex-1 overflow-y-auto px-3 py-3"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="animate-spin text-muted-foreground" size={24} />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<MessageCircle size={36} />}
              title="No messages yet"
              description={
                mode === 'direct'
                  ? 'Say hello to start the conversation.'
                  : 'Be the first to post in this group.'
              }
            />
          </div>
        ) : (
          <>
            {loadingOlder && (
              <div className="mb-2 flex justify-center">
                <Loader2 className="animate-spin text-muted-foreground" size={16} />
              </div>
            )}
            {!hasMore && !loadingOlder && (
              <div className="mb-3 mt-1 text-center">
                <span className="rounded-full bg-accent/60 px-3 py-1 text-[10px] text-muted-foreground">
                  Start of conversation
                </span>
              </div>
            )}
            <div className="flex flex-col gap-1">
              {messages.map((m, idx) => {
                const mine = m.senderId === meId
                const prev = messages[idx - 1]
                const showSender =
                  mode === 'group' && !mine && (idx === 0 || prev?.senderId !== m.senderId)
                return (
                  <MessageBubble
                    key={m.id}
                    msg={m}
                    mine={mine}
                    isGroup={mode === 'group'}
                    showSender={showSender}
                    meId={meId}
                    searchQuery={searchQuery}
                    onImageClick={(url) => setImagePreview(url)}
                    onReact={toggleReaction}
                  />
                )
              })}
              {peerTyping && (
                <div className="flex items-center gap-2 pl-1">
                  {mode === 'group' && <div className="w-7 shrink-0" />}
                  <div className="fc-bubble-them fc-rise flex items-center gap-1 px-3 py-3">
                    <span
                      className="fc-typing-dot h-1.5 w-1.5 rounded-full bg-current"
                      style={{ animationDelay: '0ms' }}
                    />
                    <span
                      className="fc-typing-dot h-1.5 w-1.5 rounded-full bg-current"
                      style={{ animationDelay: '150ms' }}
                    />
                    <span
                      className="fc-typing-dot h-1.5 w-1.5 rounded-full bg-current"
                      style={{ animationDelay: '300ms' }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* input bar */}
      <div className="border-t border-border bg-background p-2 fc-safe-bottom">
        {recording ? (
          <div className="flex items-center gap-3 rounded-2xl bg-destructive/10 px-4 py-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />
            </span>
            <span className="font-mono text-sm font-medium text-destructive">
              {String(Math.floor(recordSecs / 60)).padStart(2, '0')}:{String(recordSecs % 60).padStart(2, '0')}
            </span>
            <span className="flex-1 text-sm text-muted-foreground">Recording voice note…</span>
            <button
              onClick={() => stopRecording(true)}
              className="grid h-9 w-9 place-items-center rounded-full text-destructive transition hover:bg-destructive/10"
              aria-label="Cancel recording"
            >
              <Trash2 size={18} />
            </button>
            <button
              onClick={() => stopRecording(false)}
              className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90"
              aria-label="Send voice note"
            >
              <Send size={18} />
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5">
            <EmojiPicker onPick={(emoji) => setText((t) => t + emoji)} />
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,video/*,audio/*,.pdf,.zip,.doc,.docx,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) sendFile(f)
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-primary disabled:opacity-50"
              aria-label="Attach file"
            >
              {uploading ? <Loader2 className="animate-spin" size={20} /> : <Paperclip size={20} />}
            </button>
            <Textarea
              value={text}
              onChange={handleTextInput}
              onKeyDown={handleKey}
              placeholder="Type a message…"
              rows={1}
              className="min-h-10 max-h-32 flex-1 resize-none rounded-2xl bg-accent/40 px-3 py-2.5 text-sm"
            />
            {text.trim() ? (
              <button
                onClick={sendText}
                disabled={uploading}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
                aria-label="Send message"
              >
                <Send size={18} />
              </button>
            ) : (
              <button
                onClick={startRecording}
                disabled={uploading}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary transition hover:bg-primary/25 disabled:opacity-50"
                aria-label="Record voice note"
              >
                <Mic size={20} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* image preview dialog */}
      <Dialog open={!!imagePreview} onOpenChange={(o) => !o && setImagePreview(null)}>
        <DialogContent
          className="max-w-3xl border-0 bg-black/95 p-2 sm:max-w-3xl"
          showCloseButton
        >
          <DialogTitle className="sr-only">Image preview</DialogTitle>
          {imagePreview && (
            <img
              src={imagePreview}
              alt="Image preview"
              className="mx-auto max-h-[85vh] w-auto rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------- emoji picker ----------------
function EmojiPicker({ onPick }: { onPick: (e: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-primary"
          aria-label="Pick an emoji"
        >
          <Smile size={20} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-72 p-3">
        <div className="grid grid-cols-8 gap-0.5">
          {EMOJIS.map((e, i) => (
            <button
              key={`${e}-${i}`}
              type="button"
              onClick={() => {
                onPick(e)
                setOpen(false)
              }}
              className="grid h-8 w-8 place-items-center rounded-md text-lg transition hover:bg-accent"
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ---------------- message bubble ----------------
const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🙏']

function highlight(text: string, q: string): React.ReactNode[] {
  if (!q.trim()) return linkify(text)
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  const nodes: React.ReactNode[] = []
  let i = 0
  let idx = lower.indexOf(ql, i)
  let key = 0
  while (idx !== -1) {
    if (idx > i) nodes.push(<span key={key++}>{text.slice(i, idx)}</span>)
    nodes.push(
      <mark key={key++} className="rounded bg-yellow-300 px-0.5 text-black">
        {text.slice(idx, idx + ql.length)}
      </mark>
    )
    i = idx + ql.length
    idx = lower.indexOf(ql, i)
  }
  if (i < text.length) nodes.push(<span key={key++}>{text.slice(i)}</span>)
  return nodes
}

function MessageBubble({
  msg,
  mine,
  isGroup,
  showSender,
  meId,
  searchQuery,
  onImageClick,
  onReact,
}: {
  msg: Message
  mine: boolean
  isGroup: boolean
  showSender: boolean
  meId?: string
  searchQuery?: string
  onImageClick: (url: string) => void
  onReact: (messageId: string, emoji: string) => void
}) {
  const bubbleClass = mine ? 'fc-bubble-me' : 'fc-bubble-them'
  const isMedia = msg.type === 'image' || msg.type === 'video'
  const [reactOpen, setReactOpen] = useState(false)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startPress = () => {
    pressTimer.current = setTimeout(() => setReactOpen(true), 450)
  }
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
  }

  // aggregate reactions: emoji -> { count, mine }
  const reactionAgg = React.useMemo(() => {
    const map = new Map<string, { count: number; mine: boolean }>()
    for (const r of msg.reactions || []) {
      const cur = map.get(r.emoji) || { count: 0, mine: false }
      cur.count += 1
      if (r.userId === meId) cur.mine = true
      map.set(r.emoji, cur)
    }
    return Array.from(map.entries())
  }, [msg.reactions, meId])

  const meta = (
    <div
      className={cn(
        'mt-0.5 flex items-center justify-end gap-1 text-[10px] leading-none',
        mine ? 'opacity-80' : 'opacity-70'
      )}
    >
      <span>{clockTime(msg.createdAt)}</span>
      {mine && <StatusTick status={msg.status} />}
    </div>
  )

  return (
    <div className={cn('flex w-full gap-2', mine ? 'justify-end' : 'justify-start')}>
      {!mine && isGroup && (
        <div className="mt-1 self-start">
          <UserAvatar name={msg.senderName || 'User'} src={msg.senderPhoto || undefined} size={28} />
        </div>
      )}
      <div className={cn('fc-rise flex max-w-[78%] flex-col', mine ? 'items-end' : 'items-start')}>
        {!mine && isGroup && showSender && (
          <span className="mb-0.5 px-1 text-xs font-semibold text-primary">
            {msg.senderName || 'Unknown'}
          </span>
        )}
        <div
          onPointerDown={startPress}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          onDoubleClick={() => onReact(msg.id, '❤️')}
          className={cn('relative text-sm shadow-sm', bubbleClass, isMedia ? 'p-1' : 'px-2.5 py-1.5')}
        >
          {msg.type === 'text' && (
            <>
              <p className="whitespace-pre-wrap break-words">{highlight(msg.content, searchQuery || '')}</p>
              {meta}
            </>
          )}
          {msg.type === 'image' && msg.fileUrl && (
            <>
              <button type="button" onClick={() => onImageClick(msg.fileUrl!)} className="block">
                <img
                  src={msg.fileUrl}
                  alt={msg.fileName || 'image'}
                  className="max-h-72 max-w-[260px] rounded-lg object-cover"
                />
              </button>
              <div className="px-1 pb-0.5 pt-1">{meta}</div>
            </>
          )}
          {msg.type === 'video' && msg.fileUrl && (
            <>
              <video
                src={msg.fileUrl}
                controls
                className="max-h-72 max-w-[260px] rounded-lg bg-black"
              />
              <div className="px-1 pb-0.5 pt-1">{meta}</div>
            </>
          )}
          {msg.type === 'audio' && msg.fileUrl && (
            <>
              <div className="flex items-center gap-2 py-0.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/20 text-primary">
                  <Mic size={16} />
                </span>
                <audio src={msg.fileUrl} controls className="w-48 max-w-full" />
              </div>
              {meta}
            </>
          )}
          {msg.type === 'document' && msg.fileUrl && (
            <>
              <a
                href={msg.fileUrl}
                target="_blank"
                rel="noreferrer"
                download={msg.fileName || undefined}
                className="flex items-center gap-2.5 rounded-lg bg-black/5 px-2.5 py-2 transition hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
                  <FileText size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{msg.fileName || 'Document'}</div>
                  <div className="text-[10px] opacity-70">{formatBytes(msg.fileSize)}</div>
                </div>
                <Download size={16} className="shrink-0 opacity-70" />
              </a>
              {meta}
            </>
          )}

          {/* reaction picker popover */}
          {reactOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setReactOpen(false)} />
              <div
                className={cn(
                  'absolute -top-10 z-30 flex items-center gap-0.5 rounded-full border border-border bg-popover p-1 shadow-xl fc-rise',
                  mine ? 'right-0' : 'left-0'
                )}
              >
                {QUICK_REACTIONS.map((e) => (
                  <button
                    key={e}
                    onClick={() => { onReact(msg.id, e); setReactOpen(false) }}
                    className="grid h-8 w-8 place-items-center rounded-full text-lg transition hover:scale-125 hover:bg-accent"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* reaction chips */}
        {reactionAgg.length > 0 && (
          <div className={cn('mt-0.5 flex flex-wrap gap-1', mine ? 'justify-end' : 'justify-start')}>
            {reactionAgg.map(([emoji, info]) => (
              <button
                key={emoji}
                onClick={() => onReact(msg.id, emoji)}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition',
                  info.mine
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border bg-card text-foreground hover:bg-accent'
                )}
              >
                <span className="text-sm">{emoji}</span>
                {info.count > 1 && <span className="text-[10px] font-semibold">{info.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------- status tick ----------------
function StatusTick({ status }: { status?: MessageStatus }) {
  if (!status || status === 'SENDING') {
    return <Clock size={12} className="opacity-60" />
  }
  if (status === 'SENT') {
    return <Check size={12} className="opacity-60" />
  }
  if (status === 'DELIVERED') {
    return <CheckCheck size={12} className="opacity-60" />
  }
  if (status === 'SEEN') {
    return <CheckCheck size={12} className="opacity-100" />
  }
  return null
}
