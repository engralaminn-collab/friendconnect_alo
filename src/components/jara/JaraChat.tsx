"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send, Sparkles, Phone, Video, Settings, Bot, Loader2, Eye, CalendarPlus, X, Upload } from "lucide-react"
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
  const [statusSummary, setStatusSummary] = useState<any>(null)
  const [meetingStudioOpen, setMeetingStudioOpen] = useState(false)
  const [meetingSaving, setMeetingSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [meetings, setMeetings] = useState<any[]>([])
  const [meetingForm, setMeetingForm] = useState<any>({
    title: '', purpose: '', meetingType: 'custom_video_call', platform: 'internal', scheduledAt: '', durationMinutes: 30,
    clothing: 'formal-business-suit', background: 'alo-office', avatarStyle: 'professional', presentationStyle: 'formal',
    voiceLanguage: 'bn', voiceProfile: 'default', script: '', instructions: '', referenceImageUrl: '', referenceVideoUrl: '', voiceSampleUrl: '',
  })

  async function loadMeetings() {
    try { const r = await fetch('/api/jara/meetings'); const d = await r.json(); if (r.ok) setMeetings(d.meetings || []) } catch {}
  }

  async function updateMeeting(id: string, action: string) {
    try {
      const r = await fetch(`/api/jara/meetings/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed')
      toast.success(`Meeting ${action}d`)
      loadMeetings()
    } catch (e: any) { toast.error(e.message) }
  }

  async function uploadMeetingMedia(file: File, purpose: 'reference_image'|'reference_video'|'voice_sample', field: string) {
    setUploading(purpose)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', purpose)
      fd.append('name', file.name)
      fd.append('purpose', purpose)
      const r = await fetch('/api/jara/assets/upload', { method: 'POST', body: fd })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Upload failed')
      setMeetingForm((f: any) => ({ ...f, [field]: d.file?.url || d.asset?.fileUrl || '' }))
      toast.success(`${purpose.replace('_',' ')} uploaded (scan: ${d.security?.scanStatus || 'unknown'})`)
    } catch (e: any) {
      toast.error(e.message || 'Upload failed')
    } finally { setUploading(null) }
  }

  const fetchStatus = useCallback(async () => {
    try { const r = await fetch('/api/jara/status-summary'); const d = await r.json(); if (r.ok) setStatusSummary(d) } catch {}
  }, [])
  useEffect(() => { fetchStatus() }, [fetchStatus])
  useEffect(() => { const h = () => fetchStatus(); window.addEventListener('jara:config-updated', h); window.addEventListener('jara:proposal-created', h); return () => { window.removeEventListener('jara:config-updated', h); window.removeEventListener('jara:proposal-created', h) } }, [fetchStatus])

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
          messages: [...historyMessages.slice(-39), { role: "user", content: text }].map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        const assistantMsg: ChatMsg = { role: "assistant", content: data.response, meta: data.proposal ? { proposal: data.proposal } : null }
        setMessages(prev => [...prev, assistantMsg])
        setHistoryMessages(prev => [...prev, userMsg, assistantMsg])

        if (data.kind === "proposal" && data.proposal) {
          toast.success("New proposal created — review and approve to apply")
          window.dispatchEvent(new CustomEvent("jara:proposal-created", { detail: data.proposal }))
        }
        if (data.kind === "applied" || data.kind === "applied_temporary") {
          toast.success(data.kind === "applied_temporary" ? "Temporary appearance prepared" : "Configuration applied")
          window.dispatchEvent(new CustomEvent("jara:config-updated", { detail: data }))
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

  async function saveMeeting(action: 'draft' | 'approve' | 'schedule' | 'start' = 'draft') {
    if (!meetingForm.title.trim()) { toast.error('Meeting title required'); return }
    setMeetingSaving(true)
    try {
      const payload = {
        ...meetingForm,
        durationMinutes: meetingForm.durationMinutes ? Number(meetingForm.durationMinutes) : null,
        scheduledAt: meetingForm.scheduledAt || null,
        clothing: { type: meetingForm.clothing, label: meetingForm.clothing },
      }
      const r = await fetch('/api/jara/meetings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed to create meeting profile')
      const id = d.meeting?.id
      if (action !== 'draft' && id) {
        const r2 = await fetch(`/api/jara/meetings/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, scheduledAt: meetingForm.scheduledAt || null }) })
        const d2 = await r2.json().catch(() => ({}))
        if (!r2.ok) throw new Error(d2.error || `Failed to ${action} meeting`)
      }
      toast.success(action === 'draft' ? 'Meeting draft saved' : `Meeting ${action} successful`)
      setMeetingStudioOpen(false)
      setMessages(prev => [...prev, { role: 'assistant', content: `✅ Meeting profile "${meetingForm.title}" ${action === 'draft' ? 'saved as draft' : action + 'd'} (server-confirmed). Renderer: ${d.renderer?.label || 'browser fallback'}${d.renderer?.realVideoTrack ? '' : ' — real GPU avatar video track not configured.'}` }])
    } catch (e: any) {
      toast.error(e.message || 'Meeting save failed')
    } finally { setMeetingSaving(false) }
  }

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
            <div className="text-xs text-muted-foreground">AI digital human • Not a real human • {config?.isEnabled === false ? 'Disabled by Super Admin' : 'Online'} • v{config?.version || 1}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setVoiceOpen(v => !v)} title="Voice call with Jara">
            <Phone className="w-4 h-4" />
          </Button>
          {isSuperAdmin && (
            <Button variant="ghost" size="icon" className="rounded-full" onClick={() => { setMeetingStudioOpen(true); loadMeetings() }} title="Create Custom Meeting / Video Call">
              <CalendarPlus className="w-4 h-4" />
            </Button>
          )}
          {isSuperAdmin && (
            <Button variant="ghost" size="icon" className="rounded-full" onClick={onOpenConfig} title="Jara Configuration Center">
              <Settings className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {config?.isEnabled === false && (
        <div className="shrink-0 mx-3 mt-3 p-3 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-200 text-xs">
          Jara AI is currently disabled by a Super Admin. Chat, voice, and automated actions are unavailable until re-enabled.
        </div>
      )}

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
          clothing={config?.clothing || null}
          colors={(() => { try { return config?.colors ? JSON.parse(typeof config.colors === "string" ? config.colors : JSON.stringify(config.colors)) : null } catch { return null } })()}
        />
      </div>

      {/* Compact status summary (Task 5) */}
      <div className="shrink-0 px-3 py-2 border-b bg-background/80 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span><b>Background:</b> {statusSummary?.config?.background || config?.background || '—'}</span>
          <span><b>Clothing:</b> {(() => { const c = statusSummary?.config?.clothing || config?.clothing; try { const o = typeof c === 'string' && c.startsWith('{') ? JSON.parse(c) : null; return o?.label || o?.type || (c ? 'custom' : 'default') } catch { return 'default' } })()}</span>
          <span><b>Language:</b> {statusSummary?.config?.voiceLanguage || config?.voiceLanguage || 'bn'}</span>
          <span><b>Voice:</b> {statusSummary?.config?.voiceModel || config?.voiceModel || 'default'}</span>
          <span><b>Profile:</b> {statusSummary?.temporary?.active ? `Temporary active (${statusSummary.temporary.active.sessionId?.slice(0,8) || 'session'})` : statusSummary?.temporary?.pendingNextCall ? 'Temporary pending next call' : 'Default'}</span>
          <span><b>Renderer:</b> {statusSummary?.renderer?.label || 'Browser fallback (canvas/avatar preview only)'}</span>
        </div>
      </div>

      {/* Voice call overlay */}
      {voiceOpen && (
        <div className="absolute inset-0 z-20 bg-background flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b">
            <h3 className="font-medium text-sm flex items-center gap-2"><Phone className="w-4 h-4" /> Browser voice mode with Jara</h3>
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
          <Bot className="w-3 h-3" /> Jara is AI — responses are generated. {isSuperAdmin ? "Super Admin can configure Jara via chat or Meeting Studio." : ""}
        </p>
      </div>

      {meetingStudioOpen && isSuperAdmin && (
        <div className="absolute inset-0 z-30 bg-background/95 backdrop-blur-sm flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div>
              <h3 className="font-semibold text-sm flex items-center gap-2"><CalendarPlus className="w-4 h-4" /> Create Custom Meeting / Video Call</h3>
              <p className="text-[11px] text-muted-foreground">Super Admin only • server-authorized • renderer: {statusSummary?.renderer?.label || 'browser fallback'}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setMeetingStudioOpen(false)}><X className="w-4 h-4" /></Button>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 col-span-2"><span className="text-xs">Meeting title</span><Input value={meetingForm.title} onChange={e=>setMeetingForm((f:any)=>({...f,title:e.target.value}))} /></label>
              <label className="space-y-1 col-span-2"><span className="text-xs">Purpose</span><Input value={meetingForm.purpose} onChange={e=>setMeetingForm((f:any)=>({...f,purpose:e.target.value}))} /></label>
              <label className="space-y-1"><span className="text-xs">Meeting type</span><select className="w-full h-9 rounded-md border px-2 bg-background" value={meetingForm.meetingType} onChange={e=>setMeetingForm((f:any)=>({...f,meetingType:e.target.value}))}><option value="custom_video_call">Custom video call</option><option value="internal">Internal ALO Labs</option><option value="business_presentation">Business presentation</option><option value="student_consultation">Student consultation</option><option value="interview">Interview</option><option value="online_class">Online class</option><option value="training">Training</option><option value="client_meeting">Client meeting</option></select></label>
              <label className="space-y-1"><span className="text-xs">Platform</span><select className="w-full h-9 rounded-md border px-2 bg-background" value={meetingForm.platform} onChange={e=>setMeetingForm((f:any)=>({...f,platform:e.target.value}))}><option value="internal">Internal</option><option value="zoom">Zoom (not configured)</option><option value="google_meet">Google Meet (not configured)</option><option value="microsoft_teams">Teams (not configured)</option></select></label>
              <label className="space-y-1"><span className="text-xs">Scheduled at</span><Input type="datetime-local" value={meetingForm.scheduledAt} onChange={e=>setMeetingForm((f:any)=>({...f,scheduledAt:e.target.value}))} /></label>
              <label className="space-y-1"><span className="text-xs">Duration (min)</span><Input type="number" value={meetingForm.durationMinutes} onChange={e=>setMeetingForm((f:any)=>({...f,durationMinutes:e.target.value}))} /></label>
              <label className="space-y-1"><span className="text-xs">Clothing</span><select className="w-full h-9 rounded-md border px-2 bg-background" value={meetingForm.clothing} onChange={e=>setMeetingForm((f:any)=>({...f,clothing:e.target.value}))}><option value="formal-business-suit">Formal business suit</option><option value="corporate-executive">Corporate executive</option><option value="business-casual">Business casual</option><option value="smart-casual">Smart casual</option><option value="traditional-bangladeshi">Traditional Bangladeshi</option><option value="professional-presenter">Professional presenter</option></select></label>
              <label className="space-y-1"><span className="text-xs">Background</span><select className="w-full h-9 rounded-md border px-2 bg-background" value={meetingForm.background} onChange={e=>setMeetingForm((f:any)=>({...f,background:e.target.value}))}><option value="alo-office">ALO Labs official office</option><option value="modern-corporate-office">Modern corporate office</option><option value="meeting-room">Professional meeting room</option><option value="studio">Studio</option><option value="outdoor">Outdoor</option><option value="neutral">Neutral virtual</option></select></label>
              <label className="space-y-1"><span className="text-xs">Avatar style</span><select className="w-full h-9 rounded-md border px-2 bg-background" value={meetingForm.avatarStyle} onChange={e=>setMeetingForm((f:any)=>({...f,avatarStyle:e.target.value}))}><option value="professional">Professional</option><option value="friendly">Friendly</option><option value="corporate-presenter">Corporate presenter</option><option value="educational-instructor">Educational instructor</option><option value="interview-host">Interview host</option><option value="meeting-assistant">Meeting assistant</option></select></label>
              <label className="space-y-1"><span className="text-xs">Presentation style</span><select className="w-full h-9 rounded-md border px-2 bg-background" value={meetingForm.presentationStyle} onChange={e=>setMeetingForm((f:any)=>({...f,presentationStyle:e.target.value}))}><option value="formal">Formal</option><option value="friendly">Friendly</option><option value="professional">Professional</option><option value="conversational">Conversational</option><option value="educational">Educational</option><option value="executive-briefing">Executive briefing</option></select></label>
              <label className="space-y-1"><span className="text-xs">Voice language</span><select className="w-full h-9 rounded-md border px-2 bg-background" value={meetingForm.voiceLanguage} onChange={e=>setMeetingForm((f:any)=>({...f,voiceLanguage:e.target.value}))}><option value="bn">Bangladeshi Bengali</option><option value="en">English</option><option value="mixed">Bengali-English mixed</option></select></label>
              <label className="space-y-1"><span className="text-xs">Voice profile</span><Input value={meetingForm.voiceProfile} onChange={e=>setMeetingForm((f:any)=>({...f,voiceProfile:e.target.value}))} /></label>
              <label className="space-y-1 col-span-2"><span className="text-xs">Reference image (upload JPG/PNG/WEBP or trusted URL)</span>
                <div className="flex gap-2"><Input value={meetingForm.referenceImageUrl} onChange={e=>setMeetingForm((f:any)=>({...f,referenceImageUrl:e.target.value}))} placeholder="/api/files/..." /><label className="inline-flex items-center gap-1 px-3 rounded-md border cursor-pointer text-xs whitespace-nowrap"><Upload className="w-3 h-3"/>{uploading==='reference_image'?'Uploading…':'Upload'}<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0]; if(f) uploadMeetingMedia(f,'reference_image','referenceImageUrl'); e.currentTarget.value=''}} /></label></div>
              </label>
              <label className="space-y-1 col-span-2"><span className="text-xs">Reference video (upload MP4/WEBM/MOV or trusted URL)</span>
                <div className="flex gap-2"><Input value={meetingForm.referenceVideoUrl} onChange={e=>setMeetingForm((f:any)=>({...f,referenceVideoUrl:e.target.value}))} placeholder="/api/files/..." /><label className="inline-flex items-center gap-1 px-3 rounded-md border cursor-pointer text-xs whitespace-nowrap"><Upload className="w-3 h-3"/>{uploading==='reference_video'?'Uploading…':'Upload'}<input type="file" className="hidden" accept="video/mp4,video/webm,video/quicktime" onChange={e=>{const f=e.target.files?.[0]; if(f) uploadMeetingMedia(f,'reference_video','referenceVideoUrl'); e.currentTarget.value=''}} /></label></div>
              </label>
              <label className="space-y-1 col-span-2"><span className="text-xs">Voice sample (optional, authorized only; trusted URL)</span>
                <div className="flex gap-2"><Input value={meetingForm.voiceSampleUrl} onChange={e=>setMeetingForm((f:any)=>({...f,voiceSampleUrl:e.target.value}))} placeholder="/api/files/..." /><label className="inline-flex items-center gap-1 px-3 rounded-md border cursor-pointer text-xs whitespace-nowrap"><Upload className="w-3 h-3"/>{uploading==='voice_sample'?'Uploading…':'Upload'}<input type="file" className="hidden" accept="audio/mpeg,audio/wav,audio/mp4,audio/webm,audio/ogg,audio/x-m4a" onChange={e=>{const f=e.target.files?.[0]; if(f) uploadMeetingMedia(f,'voice_sample','voiceSampleUrl'); e.currentTarget.value=''}} /></label></div>
              </label>
              <label className="space-y-1 col-span-2"><span className="text-xs">Purpose / instructions</span><textarea className="w-full min-h-[70px] rounded-md border px-2 py-1 bg-background" value={meetingForm.instructions} onChange={e=>setMeetingForm((f:any)=>({...f,instructions:e.target.value}))} /></label>
              <label className="space-y-1 col-span-2"><span className="text-xs">Presentation script</span><textarea className="w-full min-h-[70px] rounded-md border px-2 py-1 bg-background" value={meetingForm.script} onChange={e=>setMeetingForm((f:any)=>({...f,script:e.target.value}))} /></label>
            </div>
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
              Renderer status: {statusSummary?.renderer?.label || 'Browser fallback'}. Real GPU avatar video track / lip-sync is not configured in this build. External meeting platforms marked "not configured" cannot be started. Uploaded media is stored with signature/hash checks; malware scanning is <strong>not configured</strong> unless a scanner runtime is integrated.
            </div>
            <div className="border rounded-md p-2">
              <div className="text-xs font-semibold mb-2">Recent meeting profiles</div>
              <div className="space-y-2 max-h-40 overflow-auto">
                {meetings.length === 0 && <div className="text-[11px] text-muted-foreground">No meeting profiles yet.</div>}
                {meetings.slice(0,8).map((m:any)=>(
                  <div key={m.id} className="text-[11px] border rounded p-2 flex items-center justify-between gap-2">
                    <div className="min-w-0"><div className="font-medium truncate">{m.title}</div><div className="text-muted-foreground truncate">{m.status} • {m.meetingType} • {m.voiceLanguage || 'n/a'} • {m.background || 'n/a'}</div></div>
                    <div className="flex gap-1 shrink-0">
                      {m.status!=='cancelled' && m.status!=='completed' && <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={()=>updateMeeting(m.id,'cancel')}>Cancel</Button>}
                      {m.status==='draft' && <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={()=>updateMeeting(m.id,'approve')}>Approve</Button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="p-3 border-t flex flex-wrap gap-2 justify-end">
            <Button variant="outline" onClick={()=>setMeetingStudioOpen(false)}>Cancel</Button>
            <Button variant="outline" disabled={meetingSaving} onClick={()=>{ setMessages(prev=>[...prev,{role:'assistant',content:`🖼️ Static preview (not a rendered avatar): ${meetingForm.title || '(untitled)'} | ${meetingForm.meetingType} | ${meetingForm.clothing} | ${meetingForm.background} | ${meetingForm.voiceLanguage} | ${meetingForm.presentationStyle}. ${meetingForm.referenceImageUrl ? 'Image ref: '+meetingForm.referenceImageUrl : 'No image ref.'} ${meetingForm.referenceVideoUrl ? 'Video ref: '+meetingForm.referenceVideoUrl+' (reference only unless processed by real renderer).' : ''}`}]); toast.success('Static preview generated'); }}>Preview</Button>
            <Button variant="outline" disabled={meetingSaving} onClick={()=>saveMeeting('draft')}>Save Draft</Button>
            <Button variant="outline" disabled={meetingSaving} onClick={()=>saveMeeting('approve')}>Approve</Button>
            <Button variant="outline" disabled={meetingSaving} onClick={()=>saveMeeting('schedule')}>Schedule</Button>
            <Button disabled={meetingSaving} className="bg-emerald-600 hover:bg-emerald-700" onClick={()=>saveMeeting('start')}>Start (fallback)</Button>
          </div>
        </div>
      )}
    </div>
  )
}
