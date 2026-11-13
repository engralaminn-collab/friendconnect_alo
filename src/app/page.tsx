"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useSession } from "next-auth/react"
import { AuthScreen } from "@/components/chat/AuthScreen"
import { Sidebar } from "@/components/chat/Sidebar"
import { ChatView, type ConversationData } from "@/components/chat/ChatView"
import { NewChatModal } from "@/components/chat/NewChatModal"
import { ProfileModal } from "@/components/chat/ProfileModal"
import { NotificationsPanel } from "@/components/chat/NotificationsPanel"
import { getSocket, getExistingSocket, disconnectSocket } from "@/lib/socket"
import { MessageCircle, Loader2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { IncomingCallModal, type IncomingCallData } from "@/components/chat/IncomingCallModal"
import { CallView, type ActiveCall } from "@/components/chat/CallView"
import { nanoid } from "nanoid"

export default function Home() {
  const { data: session, status } = useSession()
  const [bootstrapped, setBootstrapped] = useState(false)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [conversations, setConversations] = useState<ConversationData[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [friends, setFriends] = useState<any[]>([])
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [socketReady, setSocketReady] = useState(false)
  const [socket, setSocket] = useState<any>(null)
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null)
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null)
  const [showNewChat, setShowNewChat] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const heartbeatRef = useRef<any>(null)
  const selectedRef = useRef<string | null>(null)
  const activeCallRef = useRef<ActiveCall | null>(null)
  const conversationsRef = useRef<ConversationData[]>([])
  const friendsRef = useRef<any[]>([])

  useEffect(() => { selectedRef.current = selectedId }, [selectedId])
  useEffect(() => { activeCallRef.current = activeCall }, [activeCall])
  useEffect(() => { conversationsRef.current = conversations }, [conversations])
  useEffect(() => { friendsRef.current = friends }, [friends])

  function findPeerName(userId: string): { name: string; avatarUrl?: string | null } | null {
    for (const c of conversationsRef.current) {
      if (c.otherUser?.id === userId) return { name: c.otherUser.name, avatarUrl: c.otherUser.avatarUrl }
      const m = c.members?.find((mm) => mm.userId === userId)
      if (m) return { name: m.user.name, avatarUrl: m.user.avatarUrl }
    }
    for (const f of friendsRef.current) {
      if (f.id === userId) return { name: f.name, avatarUrl: f.avatarUrl }
    }
    return null
  }

  function handleStartCall(peerUserId: string, peerName: string, peerAvatarUrl: string | null | undefined, callType: "audio" | "video") {
    if (!socket?.connected) { toast.error("Realtime not connected"); return }
    if (activeCall) { toast.error("Already in a call"); return }
    setActiveCall({ callId: nanoid(), callType, peer: { id: peerUserId, name: peerName, avatarUrl: peerAvatarUrl || null }, role: "caller" })
  }
  function handleAcceptCall() {
    if (!incomingCall || !socket?.connected) return
    setActiveCall({ callId: incomingCall.callId, callType: incomingCall.callType, peer: { id: incomingCall.fromUserId, name: incomingCall.fromName, avatarUrl: incomingCall.fromAvatarUrl }, role: "callee" })
    setIncomingCall(null)
  }
  function handleRejectCall() {
    if (!incomingCall) return
    if (socket?.connected) socket.emit("call:reject", { toUserId: incomingCall.fromUserId, callId: incomingCall.callId })
    setIncomingCall(null)
  }
  function handleEndCall() { setActiveCall(null) }

  // Bootstrap: fetch current user, conversations, friends
  const bootstrap = useCallback(async () => {
    try {
      const [meR, convsR, friendsR, notifR] = await Promise.all([
        fetch("/api/me"),
        fetch("/api/conversations"),
        fetch("/api/friends"),
        fetch("/api/notifications?unread=1"),
      ])
      if (!meR.ok) throw new Error("not authed")
      const meBody = await meR.json()
      const convsBody = await convsR.json()
      const friendsBody = await friendsR.json()
      const notifBody = await notifR.json()
      setCurrentUser(meBody.user)
      setConversations(convsBody.conversations || [])
      setFriends(friendsBody.friends || [])
      setUnreadNotifications(notifBody.unreadCount || 0)
      setBootstrapped(true)
    } catch (e) {
      setBootstrapped(false)
    }
  }, [])

  useEffect(() => {
    if (status === "authenticated") {
      bootstrap()
    } else if (status === "unauthenticated") {
      setBootstrapped(false)
      setCurrentUser(null)
    }
  }, [status, bootstrap])

  // Refresh conversations + notifications periodically
  const refreshConversations = useCallback(async () => {
    try {
      const [convsR, notifR] = await Promise.all([
        fetch("/api/conversations"),
        fetch("/api/notifications?unread=1"),
      ])
      if (convsR.ok) {
        const body = await convsR.json()
        setConversations(body.conversations || [])
      }
      if (notifR.ok) {
        const body = await notifR.json()
        setUnreadNotifications(body.unreadCount || 0)
      }
    } catch {}
  }, [])

  // Connect socket after bootstrap
  useEffect(() => {
    if (!bootstrapped || !currentUser) return
    let cancelled = false
    async function connectSocket() {
      try {
        const r = await fetch("/api/auth/ws-token")
        if (!r.ok) return
        const body = await r.json()
        if (cancelled) return
        const s = getSocket(body.token)
        setSocket(s)
        s.removeAllListeners()
        s.on("connect", () => {
          setSocketReady(true)
          // join current conversation if any
          if (selectedRef.current) {
            s.emit("conversation:join", selectedRef.current)
          }
        })
        s.on("disconnect", () => setSocketReady(false))
        s.on("connect_error", (err: any) => {
          console.warn("[socket] connect_error", err.message)
        })
        s.on("call:incoming", (data: any) => {
          if (activeCallRef.current) { s.emit("call:reject", { toUserId: data.fromUserId, callId: data.callId }); return }
          const peer = findPeerName(data.fromUserId)
          setIncomingCall({ callId: data.callId, callType: data.callType, fromUserId: data.fromUserId, fromName: peer?.name || "Unknown", fromAvatarUrl: peer?.avatarUrl || null, offer: data.offer })
        })
        s.on("call:cancelled", (data: any) => { setIncomingCall((prev) => (prev?.callId === data.callId ? null : prev)) })
        s.on("call:rejected", (data: any) => { if (activeCallRef.current?.callId === data.callId) { setActiveCall(null); toast.info("Call rejected") } })
        s.on("call:ended", (data: any) => { if (activeCallRef.current?.callId === data.callId) { setActiveCall(null); toast.info("Call ended") } })
        // Listen for new messages globally to refresh sidebar + notification badge
        s.on("message:new", (data: any) => {
          // refresh conversation list (last message preview, unread counts)
          refreshConversations()
        })
        s.on("message:updated", () => refreshConversations())
        s.on("message:deleted", () => refreshConversations())
        s.on("message:reaction", () => refreshConversations())
        if (!s.connected) s.connect()
        else setSocketReady(true)
      } catch (e) {
        console.error("[socket] setup failed", e)
      }
    }
    connectSocket()

    // heartbeat every 30s
    heartbeatRef.current = setInterval(() => {
      const s = getExistingSocket()
      if (s?.connected) s.emit("presence:heartbeat")
    }, 30_000)

    // periodic conversation refresh
    const refreshTimer = setInterval(refreshConversations, 30_000)

    return () => {
      cancelled = true
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
      clearInterval(refreshTimer)
    }
  }, [bootstrapped, currentUser, refreshConversations])

  // Update sidebar when conversation is selected: mark as read
  useEffect(() => {
    if (!selectedId) return
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, unreadCount: 0 } : c))
    )
  }, [selectedId])

  const selectedConversation = conversations.find((c) => c.id === selectedId) || null

  async function handleBlock(userId: string) {
    if (!confirm("Block this user? They won't be able to message you.")) return
    try {
      const r = await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toId: userId }),
      })
      if (!r.ok) throw new Error("Failed")
      toast.success("User blocked")
      refreshConversations()
    } catch (e: any) {
      toast.error(e.message || "Failed")
    }
  }

  async function handleReport(userId: string) {
    const reason = prompt("Report reason (spam, abuse, etc.)")
    if (!reason) return
    try {
      const r = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toId: userId, reason }),
      })
      if (!r.ok) throw new Error("Failed")
      toast.success("Report submitted")
    } catch (e: any) {
      toast.error(e.message || "Failed")
    }
  }

  function handleConversationCreated(convId: string) {
    setSelectedId(convId)
    refreshConversations()
    setShowNewChat(false)
  }

  // Loading states
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
      </div>
    )
  }

  if (status === "unauthenticated" || !bootstrapped || !currentUser) {
    return <AuthScreen onAuthed={() => bootstrap()} />
  }

  // Layout: sidebar + main chat
  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      {/* Sidebar - hidden on mobile when a chat is open */}
      <div className={`${selectedId ? "hidden md:flex" : "flex"} w-full md:w-[340px] lg:w-[380px] shrink-0`}>
        <Sidebar
          currentUser={currentUser}
          conversations={conversations}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id)
            if (socket?.connected) socket.emit("conversation:join", id)
          }}
          onOpenProfile={() => setShowProfile(true)}
          onOpenNewChat={() => setShowNewChat(true)}
          onConversationChanged={refreshConversations}
          unreadNotifications={unreadNotifications}
          onOpenNotifications={() => setShowNotifications(true)}
        />
      </div>

      {/* Main chat */}
      <div className={`${selectedId ? "flex" : "hidden md:flex"} flex-1 min-w-0`}>
        {selectedConversation ? (
          <ChatView
            key={selectedConversation.id}
            conversation={selectedConversation}
            currentUserId={currentUser.id}
            socket={socket}
            starredIds={starredIds}
            onBack={() => setSelectedId(null)}
            onBlock={handleBlock}
            onReport={handleReport}
            onConversationChanged={refreshConversations}
            onStartCall={handleStartCall}
          />
        ) : (
          <WelcomeScreen onNewChat={() => setShowNewChat(true)} />
        )}
      </div>

      {/* Connection indicator */}
      {socket && (
        <div className="fixed bottom-2 right-2 z-50">
          <div className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-background border border-border shadow-sm ${socketReady ? "text-emerald-600" : "text-muted-foreground"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${socketReady ? "bg-emerald-500" : "bg-zinc-400"}`} />
            {socketReady ? "Live" : "Connecting…"}
          </div>
        </div>
      )}

      <NewChatModal
        open={showNewChat}
        onOpenChange={setShowNewChat}
        friends={friends}
        onConversationCreated={handleConversationCreated}
      />
      <ProfileModal
        open={showProfile}
        onOpenChange={setShowProfile}
        user={currentUser}
        onSaved={(u) => setCurrentUser(u)}
      />
      <NotificationsPanel
        open={showNotifications}
        onOpenChange={setShowNotifications}
        onMarkAllRead={() => setUnreadNotifications(0)}
      />
      <IncomingCallModal incomingCall={incomingCall} onAccept={handleAcceptCall} onReject={handleRejectCall} />
      {activeCall && currentUser && (
        <CallView call={activeCall} socket={socket} remoteOffer={incomingCall?.offer} currentUser={currentUser} onEnd={handleEndCall} />
      )}
    </div>
  )
}

function WelcomeScreen({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-muted/30">
      <div className="w-20 h-20 rounded-3xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-4">
        <MessageCircle className="w-10 h-10 text-white" />
      </div>
      <h2 className="text-2xl font-semibold mb-2">Welcome to FriendConnect</h2>
      <p className="text-muted-foreground max-w-md mb-6">
        Select a conversation to start chatting, or begin a new one. Messages are sent in real time.
      </p>
      <Button onClick={onNewChat} className="bg-emerald-500 hover:bg-emerald-600 text-white">
        <MessageSquare className="w-4 h-4 mr-2" /> Start a new chat
      </Button>
    </div>
  )
}
