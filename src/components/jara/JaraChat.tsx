"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send, Sparkles, Phone, Video, Settings, Bot, Loader2, Eye } from "lucide-react"
import { JaraAvatar } from "./JaraAvatar"
import { JaraVoiceCall } from "./JaraVoiceCall"
import { toast } from "sonner"

type ChatMsg = { role: "user" | "assistant"; content: string; meta?: any }

interface JaraChatProps {
  config: any
  currentUser: any
  pendingProposal?: any | null
  onProposalApprove?: (proposal: any) => void
  onProposalReject?: (proposal: any) => void
  onOpenConfig?: () => void
}

export function JaraChat({ config, currentUser, pendingProposal, onProposalApprove, onProposalReject, onOpenConfig }: JaraChatProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "assistant", content: "Hello! I'm Jara — your AI assistant on FriendConnect. 🤖 I can chat in Bangla, English, or Banglish — whichever you prefer! How can I help you today?" },
  ])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [historyMessages, setHistoryMessages] = useState<ChatMsg[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load conversation history with Jara from DB
  useEffect(() => {
    async function loadHistory() {
      try {
        const r = await fetch("/api/messages?userId=jara-ai-system-001")
        const data = await r.json()
        if (r.ok && data.messages?.length) {
          const mapped: ChatMsg[] = data.messages.slice(-40).map((m: any) => ({
            role: m.senderId === "jara-ai-system-001" ? "assistant" : "user",
            content: m.content,
            meta: m.metadata ? JSON.parse(m.metadata) : null,
          }))
          setMessages(prev => [prev[0], ...mapped])
          setHistoryMessages(mapped)
        }
      } catch {}
    }
    loadHistory()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  async function send() {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput("")
    const userMsg: ChatMsg = { role: "user", content: text }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch("/api/jara/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...historyMessages, { role: "user", content: text }].map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        const assistantMsg: ChatMsg = { role: "assistant", content: data.response, meta: data.proposal ? { proposal: data.proposal } : null }
        setMessages(prev => [...prev, assistantMsg])
        setHistoryMessages(prev => [...prev, userMsg, assistantMsg])

        // If proposal was created, notify parent to show preview
        if (data.kind === "proposal" && data.proposal) {
          toast.success("New proposal created — review and approve to apply")
          // Optionally trigger config center refresh via event
          window.dispatchEvent(new CustomEvent("jara:proposal-created", { detail: data.proposal }))
        }
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${data.error || "Request failed"}` }])
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${e.message}` }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const isSuperAdmin = currentUser?.role === "admin" || currentUser?.role === "superadmin"

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header with avatar */}
      <div className="shrink-0 px-4 py-3 border-b bg-gradient-to-r from-emerald-50 via-teal-50 to-cyan-50 dark:from-emerald-950/20 dark:via-teal-950/20 dark:to-cyan-950/20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
            J
          </div>
          <div>
            <div className="font-semibold text-sm flex items-center gap-2">
              Jara <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-600 text-white font-bold">AI</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <div className="text-xs text-muted-foreground">AI Assistant • Online • {config?.face || "friendly"} • v{config?.version || 1}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setVoiceOpen(v => !v)} title="Voice call with Jara">
            <Phone className="w-4 h-4" />
          </Button>
          {isSuperAdmin && (
            <Button variant="ghost" size="icon" className="rounded-full" onClick={onOpenConfig} title="Jara Configuration Center">
              <Settings className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Preview banner if pending proposal exists */}
      {pendingProposal && (
        <div className="shrink-0 mx-3 mt-3 p-3 rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 flex items-start gap-3">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
            <Eye className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-amber-900 dark:text-amber-100">Proposal pending: v{pendingProposal.version}</div>
            <div className="text-xs text-amber-800/80 dark:text-amber-200/70 truncate">{pendingProposal.changeSummary}</div>
            <div className="text-[10px] text-amber-700/60">Expires {new Date(pendingProposal.expiresAt).toLocaleString()} • Hash {pendingProposal.configHash.slice(0, 12)}…</div>
          </div>
          {isSuperAdmin && (
            <div className="flex gap-1 shrink-0">
              <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white text-xs" onClick={() => onProposalApprove?.(pendingProposal)}>Approve</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onProposalReject?.(pendingProposal)}>Reject</Button>
            </div>
          )}
        </div>
      )}

      {/* Avatar strip */}
      <div className="shrink-0 flex justify-center py-3 border-b bg-muted/20">
        <JaraAvatar
          face={config?.face || "friendly"}
          background={config?.background || "gradient-emerald"}
          theme={config?.theme || "light"}
          mood={loading ? "thinking" : "idle"}
          size={96}
          colors={(() => { try { return config?.colors ? JSON.parse(typeof config.colors === "string" ? config.colors : JSON.stringify(config.colors)) : null } catch { return null } })()}
        />
      </div>

      {/* Voice call overlay */}
      {voiceOpen && (
        <div className="absolute inset-0 z-20 bg-background flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b">
            <h3 className="font-medium text-sm flex items-center gap-2"><Phone className="w-4 h-4" /> Voice Call with Jara</h3>
            <Button variant="ghost" size="sm" onClick={() => setVoiceOpen(false)}>Close</Button>
          </div>
          <div className="flex-1 overflow-hidden">
            <JaraVoiceCall
              config={config}
              onEnd={() => setVoiceOpen(false)}
              onTranscript={(text, isUser) => {
                const role = isUser ? "user" : "assistant"
                setMessages(prev => [...prev, { role, content: text }])
                if (!isUser) setHistoryMessages(prev => [...prev, { role, content: text }])
              }}
            />
          </div>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef as any}>
        <div className="p-4 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${m.role === "user" ? "bg-emerald-600 text-white rounded-br-md" : "bg-muted rounded-bl-md"}`}>
                {m.content}
                {m.meta?.proposal && (
                  <div className="mt-2 p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30 border border-amber-200 text-xs text-amber-900 dark:text-amber-100">
                    <div className="font-semibold">Preview: v{m.meta.proposal.version}</div>
                    <div className="opacity-80">{m.meta.proposal.changeSummary}</div>
                    <div className="text-[10px] opacity-60">ID {m.meta.proposal.id.slice(0, 8)}… • Hash {m.meta.proposal.configHash.slice(0, 8)}…</div>
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl px-3 py-2 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> <span className="text-xs text-muted-foreground">Jara is thinking…</span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Composer */}
      <div className="shrink-0 p-3 border-t bg-background flex items-center gap-2">
        <Input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={isSuperAdmin ? "Chat with Jara… (try: 'Jara, change your background to futuristic')" : "Message Jara…"}
          disabled={loading}
          className="rounded-full"
        />
        <Button onClick={send} disabled={loading || !input.trim()} size="icon" className="rounded-full bg-emerald-600 hover:bg-emerald-700">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>

      <div className="px-3 pb-2">
        <p className="text-[10px] text-center text-muted-foreground flex items-center justify-center gap-1">
          <Bot className="w-3 h-3" /> Jara is AI — responses are generated. {isSuperAdmin ? "Super Admin can configure Jara via chat (requires approval)." : ""}
        </p>
      </div>
    </div>
  )
}
