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
import { MessageCircle, Loader2, MessageSquare, Bot, Sparkles, Settings, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { IncomingCallModal, type IncomingCallData } from "@/components/chat/IncomingCallModal"
import { CallView, type ActiveCall } from "@/components/chat/CallView"
import { nanoid } from "nanoid"
import { JaraChat } from "@/components/jara/JaraChat"
import { JaraConfigCenter } from "@/components/jara/JaraConfigCenter"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

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
  const [showAI, setShowAI] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [jaraConfig, setJaraConfig] = useState<any>(null)
  const [jaraPending, setJaraPending] = useState<any>(null)
  const [jaraView, setJaraView] = useState(false)
  const [showJaraConfig, setShowJaraConfig] = useState(false)
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
    socket.emit("call:invite", { targetUserId: peerUserId, type: callType }, (result: any) => {
      if (!result?.ok || !result.callId) {
        toast.error(result?.error || "Call could not be started")
        return
      }
      setActiveCall({ callId: result.callId, callType, peer: { id: peerUserId, name: peerName, avatarUrl: peerAvatarUrl || null }, role: "caller" })
    })
  }
  function handleAcceptCall() {
    if (!incomingCall || !socket?.connected) return
    socket.emit("call:accepted", { toUserId: incomingCall.fromUserId, callId: incomingCall.callId })
    setActiveCall({ callId: incomingCall.callId, callType: incomingCall.callType, peer: { id: incomingCall.fromUserId, name: incomingCall.fromName, avatarUrl: incomingCall.fromAvatarUrl }, role: "callee", remoteOffer: incomingCall.offer })
    setIncomingCall(null)
  }
  function handleRejectCall() {
    if (!incomingCall) return
    if (socket?.connected) socket.emit("call:reject", { toUserId: incomingCall.fromUserId, callId: incomingCall.callId })
    setIncomingCall(null)
  }
  function handleEndCall() { setActiveCall(null) }

  const fetchJara = useCallback(async () => {
    try {
      const [cfgR, propR] = await Promise.all([
        fetch("/api/jara/config"),
        fetch("/api/jara/proposals?status=pending&limit=5"),
      ])
      if (cfgR.ok) { const d = await cfgR.json(); setJaraConfig(d.config) }
      if (propR.ok) { const d = await propR.json(); const pending = (d.proposals || []).find((p: any) => p.effectiveStatus === "pending" && !p.isExpired); setJaraPending(pending || null) }
    } catch {}
  }, [])

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
      fetchJara()
    } catch (e) {
      setBootstrapped(false)
    }
  }, [fetchJara])

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

  useEffect(() => {
    const h = () => { fetchJara(); refreshConversations() }
    window.addEventListener('jara:config-updated', h)
    window.addEventListener('jara:proposal-created', h)
    return () => { window.removeEventListener('jara:config-updated', h); window.removeEventListener('jara:proposal-created', h) }
  }, [fetchJara, refreshConversations])

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
        s.on("call:offer", (data: any) => {
          setIncomingCall((prev) => prev && prev.callId === data.callId ? { ...prev, offer: data.offer || data.sdp } : prev)
          setActiveCall((prev) => prev && prev.callId === data.callId ? { ...prev, remoteOffer: data.offer || data.sdp } : prev)
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
  // `data-testid="app-shell"` marks "authenticated shell is rendered"; the
  // end-to-end suite waits on it instead of guessing at markup.
  return (
    <div data-testid="app-shell" className="h-screen flex bg-background text-foreground overflow-hidden">
      {/* Sidebar - hidden on mobile when a chat is open */}
      <div className={`${selectedId || jaraView ? "hidden md:flex" : "flex"} w-full md:w-[340px] lg:w-[380px] shrink-0 flex-col`}>
        {/* Jara entry - always on top */}
        <div className="shrink-0 px-2 pt-2">
          <button
            onClick={() => { setJaraView(true); setSelectedId(null); fetchJara() }}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border-2 transition text-left ${jaraView ? "bg-violet-50 border-violet-300 dark:bg-violet-950/30 dark:border-violet-700" : "bg-gradient-to-r from-violet-50 to-emerald-50 dark:from-violet-950/20 dark:to-emerald-950/20 border-violet-200 dark:border-violet-800 hover:border-violet-300"}`}
          >
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-600 via-indigo-600 to-emerald-500 flex items-center justify-center text-white font-bold shadow-md shrink-0">J</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm flex items-center gap-1.5">Jara <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-600 text-white font-bold">AI</span> {jaraPending && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Proposal pending" />}</div>
              <div className="text-xs text-muted-foreground truncate">{jaraConfig ? `${jaraConfig.face} • ${jaraConfig.background} • v${jaraConfig.version}` : "AI Assistant • Online"}</div>
            </div>
            <Bot className="w-4 h-4 text-violet-600 shrink-0" />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <Sidebar
            currentUser={currentUser}
            conversations={conversations}
            selectedId={selectedId}
            onSelect={(id) => {
              setJaraView(false)
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
        {(currentUser?.role === "admin" || currentUser?.role === "superadmin") && (
          <div className="shrink-0 p-2 border-t">
            <Button variant="outline" className="w-full justify-center gap-2 text-xs" onClick={() => setShowJaraConfig(true)}>
              <Settings className="w-4 h-4" /> Jara Configuration Center {jaraPending && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
            </Button>
          </div>
        )}
      </div>

      {/* Main chat */}
      <div className={`${selectedId || jaraView ? "flex" : "hidden md:flex"} flex-1 min-w-0`}>
        {jaraView ? (
          <JaraChat
            config={jaraConfig}
            currentUser={currentUser}
            pendingProposal={jaraPending}
            onProposalApprove={async (p) => {
              try {
                const r = await fetch(`/api/jara/proposals/${p.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ configHash: p.configHash, version: p.version }) })
                const d = await r.json()
                if (!r.ok) throw new Error(d.error)
                toast.success(`Applied v${p.version}`)
                fetchJara()
              } catch (e: any) { toast.error(e.message) }
            }}
            onProposalReject={async (p) => {
              try {
                const r = await fetch(`/api/jara/proposals/${p.id}/reject`, { method: "POST" })
                const d = await r.json()
                if (!r.ok) throw new Error(d.error)
                toast.success("Rejected")
                fetchJara()
              } catch (e: any) { toast.error(e.message) }
            }}
            onOpenConfig={() => setShowJaraConfig(true)}
          />
        ) : selectedConversation ? (
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
        <CallView call={activeCall} socket={socket} remoteOffer={activeCall.remoteOffer} currentUser={currentUser} onEnd={handleEndCall} />
      )}
      <Dialog open={showJaraConfig} onOpenChange={setShowJaraConfig}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] p-0 overflow-hidden">
          <DialogTitle className="sr-only">Jara Configuration Center</DialogTitle>
          <JaraConfigCenter onClose={() => { setShowJaraConfig(false); fetchJara() }} />
        </DialogContent>
      </Dialog>
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
