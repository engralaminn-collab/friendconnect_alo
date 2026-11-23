"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { JaraAvatarPreview } from "./JaraAvatar"
import { toast } from "sonner"
import { Loader2, Check, X, Clock, History, Shield, Sparkles, RotateCcw, Eye, AlertTriangle, CheckCircle, XCircle, Activity } from "lucide-react"

export function JaraConfigCenter({ onClose }: { onClose?: () => void }) {
  const [live, setLive] = useState<any>(null)
  const [proposals, setProposals] = useState<any[]>([])
  const [history, setHistory] = useState<{ logs: any[]; configs: any[] }>({ logs: [], configs: [] })
  const [loading, setLoading] = useState(true)
  const [selectedProposal, setSelectedProposal] = useState<any>(null)
  const [health, setHealth] = useState<any>(null)

  async function refresh() {
    setLoading(true)
    try {
      const [liveR, propR, histR, healthR] = await Promise.all([
        fetch("/api/jara/config"),
        fetch("/api/jara/proposals?limit=20"),
        fetch("/api/jara/history?limit=50"),
        fetch("/api/jara/health"),
      ])
      const liveD = await liveR.json()
      const propD = await propR.json()
      const histD = await histR.json()
      const healthD = await healthR.json()
      setLive(liveD.config)
      setProposals(propD.proposals || [])
      setHistory({ logs: histD.logs || [], configs: histD.configs || [] })
      setHealth(healthD)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const h = () => refresh()
    window.addEventListener("jara:proposal-created", h)
    return () => window.removeEventListener("jara:proposal-created", h)
  }, [])

  async function approve(p: any) {
    try {
      const r = await fetch(`/api/jara/proposals/${p.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configHash: p.configHash, version: p.version }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Approve failed")
      toast.success(`Approved v${p.version} — now live!`)
      await refresh()
      setSelectedProposal(null)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function reject(p: any) {
    try {
      const r = await fetch(`/api/jara/proposals/${p.id}/reject`, { method: "POST" })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Reject failed")
      toast.success("Proposal rejected")
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function rollback(targetVersion: number) {
    if (!confirm(`Create a rollback proposal to v${targetVersion}? It will still require approval.`)) return
    try {
      const r = await fetch("/api/jara/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetVersion }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Rollback failed")
      toast.success(`Rollback proposal to v${targetVersion} created`)
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function toggleEmergency() {
    const next = live?.isEnabled === false
    const reason = prompt(next ? "Reason for re-enabling Jara AI?" : "Reason for emergency disabling Jara AI?", next ? "Recovered" : "Emergency disable")
    if (reason == null) return
    try {
      const r = await fetch("/api/jara/emergency", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next, reason }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Failed")
      toast.success(next ? "Jara AI enabled" : "Jara AI emergency disabled")
      await refresh()
    } catch (e: any) { toast.error(e.message) }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>
  }

  const pending = proposals.filter(p => p.effectiveStatus === "pending" && !p.isExpired)
  const expired = proposals.filter(p => p.isExpired || p.effectiveStatus === "expired")
  const recentApplied = proposals.filter(p => p.status === "applied").slice(0, 5)

  let pendingProposedConfig: any = null
  try { pendingProposedConfig = selectedProposal?.configJson ? JSON.parse(selectedProposal.configJson) : null } catch {}

  return (
    <div className="flex flex-col h-full max-h-[85vh] bg-background rounded-xl overflow-hidden">
      <div className="shrink-0 px-6 py-4 border-b bg-gradient-to-r from-violet-600 via-indigo-600 to-emerald-500 text-white flex items-center justify-between">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Shield className="w-5 h-5" /> Jara Configuration Center</h2>
          <p className="text-xs text-white/80">Super Admin — govern Jara's identity, voice & AI model</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-white text-violet-700 font-bold">v{live?.version || 1} LIVE</Badge>
          {onClose && <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={onClose}>Close</Button>}
        </div>
      </div>

      <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 mt-4 shrink-0 grid w-auto grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="proposals">Proposals {pending.length > 0 && <Badge className="ml-1 bg-amber-500 text-white px-1 py-0 text-[10px]">{pending.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <div className="flex-1 min-h-0 overflow-auto">
          <TabsContent value="overview" className="p-4 space-y-4">
            {/* Current live */}
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><Eye className="w-4 h-4" /> Current Identity</CardTitle>
                  <CardDescription className="text-xs">Live configuration — what users see now</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-center">
                    <JaraAvatarPreview config={live} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Info label="Face" value={live?.face} />
                    <Info label="Avatar" value={live?.avatar} />
                    <Info label="Background" value={live?.background} />
                    <Info label="Theme" value={live?.theme} />
                    <Info label="Voice" value={`${live?.voiceLanguage} / ${live?.voiceModel}`} />
                    <Info label="Personality" value={live?.personality} />
                    <Info label="AI Model" value={`${live?.llmProvider}/${live?.llmModel}`} />
                    <Info label="STT / TTS" value={`${live?.sttModel} / ${live?.ttsModel}`} />
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" /> AI Health</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <div className="flex items-center justify-between"> <span>Provider</span> <Badge variant="outline">{health?.ai?.provider || "—"}</Badge> </div>
                    <div className="flex items-center justify-between"> <span>Configured</span> {health?.ai?.configured ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-amber-500" />} </div>
                    <div className="flex items-center justify-between"> <span>Jara user</span> {health?.jara?.exists ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-red-500" />} </div>
                    <div className="flex items-center justify-between"> <span>Pending proposals</span> <Badge>{health?.jara?.pendingProposals ?? pending.length}</Badge> </div>
                    <Separator />
                    <p className="text-[11px] text-muted-foreground">
                      Bangla voice uses Web Speech API (free, self-hosted). For higher quality, configure Ollama + Whisper.cpp + Piper TTS on your server.
                    </p>
                  </CardContent>
                </Card>

                <Card className={live?.isEnabled === false ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-emerald-200"}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4" /> Emergency Control</CardTitle>
                    <CardDescription className="text-xs">Super Admin kill switch for Jara AI</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span>Status</span>
                      <Badge className={live?.isEnabled === false ? "bg-red-600 text-white" : "bg-emerald-600 text-white"}>{live?.isEnabled === false ? "DISABLED" : "ENABLED"}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Emergency disable blocks Jara chat, voice, group, and automated actions server-side until re-enabled.</p>
                    <Button size="sm" variant={live?.isEnabled === false ? "default" : "destructive"} className="w-full" onClick={toggleEmergency}>
                      {live?.isEnabled === false ? "Re-enable Jara AI" : "Emergency Disable Jara AI"}
                    </Button>
                  </CardContent>
                </Card>

                <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                  <CardContent className="pt-4 text-xs space-y-2">
                    <div className="font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4" /> How to customize Jara via chat</div>
                    <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                      <li>Open Jara chat and say: <em>"Jara, change your background to a beautiful futuristic environment"</em></li>
                      <li>Jara will prepare a proposal and show a preview — live config stays unchanged.</li>
                      <li>Review the preview here, then <b>Approve</b> the exact proposal to apply it.</li>
                      <li>All changes are audited — normal users cannot approve, replay is blocked, expiry is enforced.</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Pending quick list */}
            {pending.length > 0 && (
              <Card className="border-amber-300">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-amber-800 dark:text-amber-100">Pending approval ({pending.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {pending.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 text-xs">
                      <div>
                        <div className="font-medium">v{p.version} — {p.changeSummary}</div>
                        <div className="text-[11px] text-muted-foreground">ID {p.id.slice(0,8)}… • {new Date(p.expiresAt).toLocaleString()} • {p.configHash.slice(0,10)}…</div>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" className="h-7 bg-emerald-600 text-white" onClick={() => approve(p)}><Check className="w-3 h-3 mr-1" /> Approve</Button>
                        <Button size="sm" variant="outline" className="h-7" onClick={() => reject(p)}><X className="w-3 h-3 mr-1" /> Reject</Button>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelectedProposal(p)}><Eye className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="proposals" className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">All proposals</h3>
              <Button variant="outline" size="sm" onClick={refresh}>Refresh</Button>
            </div>
            <ScrollArea className="h-[400px] pr-2">
              <div className="space-y-2">
                {proposals.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No proposals yet — chat with Jara as Super Admin to create one.</p>}
                {proposals.map((p: any) => {
                  const isExpired = p.isExpired || p.effectiveStatus === "expired"
                  return (
                    <Card key={p.id} className={`${p.status === "pending" && !isExpired ? "border-amber-300" : ""} ${p.status === "applied" ? "border-emerald-300" : ""}`}>
                      <CardContent className="p-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant={p.status === "pending" ? (isExpired ? "secondary" : "default") : p.status === "applied" ? "outline" : "secondary"} className="text-[10px]">
                              v{p.version} {p.status}{isExpired ? " (expired)" : ""}
                            </Badge>
                            <span className="text-xs font-medium truncate">{p.changeSummary}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-1">ID {p.id} • by {p.createdBy.slice(0,8)}… • {new Date(p.createdAt).toLocaleString()}</div>
                          <div className="text-[11px] text-muted-foreground">Hash {p.configHash.slice(0,16)}… • Expires {new Date(p.expiresAt).toLocaleString()}</div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelectedProposal(p)}><Eye className="w-3 h-3" /></Button>
                          {p.status === "pending" && !isExpired && (
                            <>
                              <Button size="sm" className="h-7 bg-emerald-600 text-white" onClick={() => approve(p)}><Check className="w-3 h-3" /></Button>
                              <Button size="sm" variant="outline" className="h-7" onClick={() => reject(p)}><X className="w-3 h-3" /></Button>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="preview" className="p-4 space-y-4">
            {!selectedProposal && pending.length === 0 && (
              <div className="text-center py-12 text-sm text-muted-foreground">
                <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No proposal selected</p>
                <p className="text-xs">Create a proposal via Jara chat, then click the eye icon to preview it here.</p>
              </div>
            )}
            {!selectedProposal && pending.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Select a proposal to preview:</p>
                <div className="flex gap-2 flex-wrap">
                  {pending.map((p: any) => (
                    <Button key={p.id} variant={selectedProposal?.id === p.id ? "default" : "outline"} size="sm" onClick={() => setSelectedProposal(p)}>v{p.version} — {p.changeSummary.slice(0, 40)}</Button>
                  ))}
                </div>
              </div>
            )}
            {selectedProposal && pendingProposedConfig && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm">Preview: v{selectedProposal.version} {selectedProposal.status === "pending" ? "(not live)" : `— ${selectedProposal.status}`}</h3>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedProposal(null)}>Clear</Button>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground">CURRENT (live v{live?.version})</div>
                    <div className="flex justify-center p-4 rounded-xl border bg-muted/20">
                      <JaraAvatarPreview config={live} mood="idle" />
                    </div>
                    <div className="text-xs space-y-1">
                      <Info label="Face" value={live?.face} />
                      <Info label="Background" value={live?.background} />
                      <Info label="Theme" value={live?.theme} />
                      <Info label="Voice" value={live?.voiceLanguage} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-emerald-700">PROPOSED (v{selectedProposal.version}) — PREVIEW ONLY</div>
                    <div className="flex justify-center p-4 rounded-xl border-2 border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <JaraAvatarPreview config={pendingProposedConfig} mood="idle" />
                    </div>
                    <div className="text-xs space-y-1">
                      <Info label="Face" value={pendingProposedConfig?.face} highlight={pendingProposedConfig?.face !== live?.face} />
                      <Info label="Background" value={pendingProposedConfig?.background} highlight={pendingProposedConfig?.background !== live?.background} />
                      <Info label="Theme" value={pendingProposedConfig?.theme} highlight={pendingProposedConfig?.theme !== live?.theme} />
                      <Info label="Voice" value={pendingProposedConfig?.voiceLanguage} highlight={pendingProposedConfig?.voiceLanguage !== live?.voiceLanguage} />
                      <Info label="Personality" value={pendingProposedConfig?.personality} highlight={pendingProposedConfig?.personality !== live?.personality} />
                      <Info label="Model" value={pendingProposedConfig?.llmModel} highlight={pendingProposedConfig?.llmModel !== live?.llmModel} />
                    </div>
                  </div>
                </div>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Change summary</CardTitle></CardHeader>
                  <CardContent className="text-xs space-y-1">
                    <div>Proposal ID: <code className="bg-muted px-1 rounded">{selectedProposal.id}</code></div>
                    <div>Hash: <code className="bg-muted px-1 rounded">{selectedProposal.configHash}</code></div>
                    <div>Status: <Badge>{selectedProposal.status}</Badge> {selectedProposal.isExpired ? <Badge variant="destructive">Expired</Badge> : <Badge variant="outline">Expires {new Date(selectedProposal.expiresAt).toLocaleString()}</Badge>}</div>
                    <div>Summary: {selectedProposal.changeSummary}</div>
                    <div className="pt-2">
                      <div className="font-medium">Exact changes:</div>
                      <ul className="list-disc pl-4">
                        {buildDiff(live, pendingProposedConfig).map((d: string, i: number) => <li key={i}>{d}</li>)}
                      </ul>
                    </div>
                  </CardContent>
                </Card>

                {selectedProposal.status === "pending" && !selectedProposal.isExpired && (
                  <div className="flex gap-2">
                    <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => approve(selectedProposal)}><Check className="w-4 h-4 mr-1" /> Approve & Apply (v{selectedProposal.version})</Button>
                    <Button variant="outline" onClick={() => reject(selectedProposal)}><X className="w-4 h-4 mr-1" /> Reject</Button>
                  </div>
                )}
                {selectedProposal.isExpired && <p className="text-xs text-amber-600">This proposal has expired — create a new one.</p>}
                {selectedProposal.status === "applied" && <p className="text-xs text-emerald-600">This proposal was already applied — it is live.</p>}
              </div>
            )}
          </TabsContent>

          <TabsContent value="versions" className="p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2"><History className="w-4 h-4" /> Configuration versions</h3>
            <div className="space-y-2">
              {history.configs.map((c: any) => (
                <Card key={c.id} className={c.isLive ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20" : ""}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant={c.isLive ? "default" : "outline"}>v{c.version}{c.isLive ? " LIVE" : ""}</Badge>
                        <span className="text-xs">{c.face} • {c.background} • {c.theme} • {c.voiceLanguage} • {c.llmModel}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{new Date(c.createdAt).toLocaleString()} {c.createdBy ? `by ${c.createdBy.slice(0,8)}…` : ""}</div>
                    </div>
                    <div className="flex gap-1">
                      {!c.isLive && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => rollback(c.version)}><RotateCcw className="w-3 h-3 mr-1" /> Rollback</Button>}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {history.configs.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No versions yet</p>}
            </div>
          </TabsContent>

          <TabsContent value="audit" className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">Audit log</h3>
            <ScrollArea className="h-[400px]">
              <div className="space-y-1">
                {history.logs.map((l: any) => (
                  <div key={l.id} className="flex items-start gap-2 p-2 rounded border text-xs">
                    <Badge variant="outline" className="text-[10px] shrink-0">{l.action}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{l.detail || `${l.action} v${l.version ?? ""} by ${l.actorId?.slice(0,8) ?? "system"}`}</div>
                      <div className="text-[11px] text-muted-foreground">{new Date(l.createdAt).toLocaleString()} • {l.actorRole || ""} {l.ip ? `• ${l.ip}` : ""}</div>
                    </div>
                  </div>
                ))}
                {history.logs.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No audit entries</p>}
              </div>
            </ScrollArea>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

function Info({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between p-1.5 rounded ${highlight ? "bg-amber-100 dark:bg-amber-900/20 border border-amber-200" : "bg-muted/30"}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium truncate ml-2 ${highlight ? "text-amber-800 dark:text-amber-100" : ""}`}>{value || "—"}</span>
    </div>
  )
}

function buildDiff(a: any, b: any): string[] {
  if (!a || !b) return []
  const keys = ["face", "avatar", "background", "theme", "voiceModel", "voiceLanguage", "personality", "llmModel", "llmProvider", "speakingSpeed", "pitch", "responseLength"] as const
  const out: string[] = []
  for (const k of keys) {
    const av = String(a[k] ?? "")
    const bv = String(b[k] ?? "")
    if (av !== bv) out.push(`${k}: ${av || "(empty)"} → ${bv || "(empty)"}`)
  }
  return out.length ? out : ["No field changes detected (maybe colors or metadata)"]
}
