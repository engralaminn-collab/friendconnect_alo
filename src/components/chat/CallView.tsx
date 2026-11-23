"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Avatar } from "./Avatar"
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Volume2, VolumeX,
} from "lucide-react"
import type { CallType } from "@/lib/webrtc"
import { WebRTCManager } from "@/lib/webrtc"
import { JaraAvatar } from "@/components/jara/JaraAvatar"

const BG_MAP: Record<string, string> = {
  'gradient-emerald':'from-emerald-400 via-teal-500 to-cyan-600','gradient-blue':'from-blue-500 via-indigo-500 to-violet-600','gradient-purple':'from-violet-500 via-purple-600 to-fuchsia-600','futuristic':'from-slate-900 via-indigo-900 to-violet-900','alo-office':'from-slate-100 via-sky-100 to-emerald-100','outdoor':'from-sky-400 via-emerald-300 to-lime-200','studio':'from-zinc-200 via-slate-100 to-white','nature':'from-green-600 via-emerald-700 to-teal-800','city':'from-slate-700 via-zinc-800 to-slate-900','space':'from-black via-indigo-950 to-violet-950','ocean':'from-sky-600 via-blue-700 to-indigo-800','sunset':'from-orange-400 via-pink-500 to-violet-600','forest':'from-green-800 via-emerald-900 to-teal-900','minimal':'from-zinc-100 via-white to-zinc-50',
}
function bgClassFor(bg?: string) { return BG_MAP[bg || ''] || BG_MAP['gradient-emerald'] }
function safeColors(c: any) { try { return c ? (typeof c === 'string' ? JSON.parse(c) : c) : null } catch { return null } }
function clothingLabel(c: any) { try { const obj = typeof c === 'string' && c.startsWith('{') ? JSON.parse(c) : null; return obj?.label || obj?.type || (c ? 'custom' : 'default') } catch { return 'default' } }

export interface ActiveCall {
  callId: string
  callType: CallType
  // The other party
  peer: { id: string; name: string; avatarUrl?: string | null }
  role: "caller" | "callee"
}

export function CallView({
  call,
  socket,
  remoteOffer,
  currentUser,
  onEnd,
}: {
  call: ActiveCall
  socket: any
  remoteOffer?: RTCSessionDescriptionInit | null
  currentUser: { id: string; name: string }
  onEnd: () => void
}) {
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const mgrRef = useRef<WebRTCManager | null>(null)
  const [muted, setMuted] = useState(false)
  const [videoOn, setVideoOn] = useState(call.callType === "video")
  const [seconds, setSeconds] = useState(0)
  const [status, setStatus] = useState<string>("Connecting…")
  const [error, setError] = useState<string | null>(null)
  const [presentation, setPresentation] = useState<any>(null)
  const isJaraPeer = call.peer.id === 'jara-ai-system-001' || /jara/i.test(call.peer.name || '')

  function releasePresentation(outcome: 'completed' | 'cancelled' | 'failed') {
    fetch('/api/jara/presentation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'release', sessionId: call.callId, outcome }) }).catch(() => {})
  }

  // Setup WebRTC on mount
  useEffect(() => {
    let cancelled = false
    async function setup() {
      try {
        const mgr = new WebRTCManager({
          socket,
          targetUserId: call.peer.id,
          callType: call.callType,
          role: call.role,
          onRemoteTrack: (stream) => {
            if (cancelled) return
            if (remoteAudioRef.current) {
              remoteAudioRef.current.srcObject = stream
              remoteAudioRef.current.play().catch(() => {})
            }
            if (remoteVideoRef.current && call.callType === "video") {
              remoteVideoRef.current.srcObject = stream
              remoteVideoRef.current.play().catch(() => {})
            }
          },
          onStateChange: (state) => {
            if (cancelled) return
            const map: Record<string, string> = {
              "new": "Connecting…",
              "connecting": "Connecting…",
              "connected": "Connected",
              "disconnected": "Reconnecting…",
              "failed": "Connection failed",
              "closed": "Call ended",
            }
            setStatus(map[state] || state)
            if (state === "failed") setError("Connection failed — check your network or TURN server")
          },
          onIceCandidate: (candidate, targetUserId) => {
            socket.emit("call:ice-candidate", {
              toUserId: targetUserId,
              callId: call.callId,
              candidate,
            })
          },
        })
        mgrRef.current = mgr

        const localStream = await mgr.start()
        if (cancelled) return
        if (localVideoRef.current && call.callType === "video") {
          localVideoRef.current.srcObject = localStream
          localVideoRef.current.play().catch(() => {})
        }

        if (call.role === "caller") {
          // Caller: create offer and send
          const offer = await mgr.createOffer()
          if (cancelled) return
          socket.emit("call:offer", {
            toUserId: call.peer.id,
            callId: call.callId,
            callType: call.callType,
            offer,
          })
          setStatus("Ringing…")
        } else if (remoteOffer) {
          // Callee: accept the offer and send answer
          const answer = await mgr.acceptOffer(remoteOffer)
          if (cancelled) return
          socket.emit("call:answer", {
            toUserId: call.peer.id,
            callId: call.callId,
            answer,
          })
          setStatus("Connected")
        }

        // Listen for remote ICE candidates, answer (if caller), and end
        const onIce = (data: { callId: string; fromUserId: string; candidate: RTCIceCandidateInit }) => {
          if (data.callId !== call.callId) return
          mgr.addIceCandidate(data.candidate)
        }
        const onAnswer = (data: { callId: string; fromUserId: string; answer: RTCSessionDescriptionInit }) => {
          if (data.callId !== call.callId) return
          mgr.receiveAnswer(data.answer)
          setStatus("Connected")
        }
        const onEnded = (data: { callId: string; fromUserId: string }) => {
          if (data.callId !== call.callId) return
          releasePresentation('completed')
          cleanup()
          onEnd()
        }
        socket.on("call:ice-candidate", onIce)
        socket.on("call:accepted", onAnswer)
        socket.on("call:ended", onEnded)
        socket.on("call:rejected", onEnded)

        function cleanup() {
          socket.off("call:ice-candidate", onIce)
          socket.off("call:accepted", onAnswer)
          socket.off("call:ended", onEnded)
          socket.off("call:rejected", onEnded)
        }
        // Store cleanup on the mgr so end() can call it
        ;(mgr as any)._cleanup = cleanup
      } catch (e: any) {
        if (cancelled) return
        setError(e?.message || "Failed to start call")
        if (e?.name === "NotAllowedError") {
          setError("Microphone/camera permission denied. Allow access in your browser.")
        }
      }
    }
    setup()
    return () => {
      cancelled = true
      const mgr = mgrRef.current
      if ((mgr as any)?._cleanup) (mgr as any)._cleanup()
      if (mgr) mgr.end()
    }
  }, [call.callId, call.peer.id, call.role, call.callType, socket, remoteOffer, onEnd])

  // Resolve per-session Jara presentation (server-authorized, per-call isolation)
  useEffect(() => {
    let cancelled = false
    async function loadPresentation() {
      try {
        const sessionType = call.callType === 'video' ? 'video_call' : 'audio_call'
        const r = await fetch(`/api/jara/presentation?sessionId=${encodeURIComponent(call.callId)}&sessionType=${sessionType}`)
        const d = await r.json().catch(() => null)
        if (!cancelled && r.ok && d?.presentation) setPresentation(d.presentation)
      } catch {}
    }
    loadPresentation()
    return () => { cancelled = true }
  }, [call.callId, call.callType])

  // Call timer
  useEffect(() => {
    if (status !== "Connected") return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [status])

  function handleEnd() {
    socket.emit("call:end", { toUserId: call.peer.id, callId: call.callId })
    releasePresentation('completed')
    const mgr = mgrRef.current
    if ((mgr as any)?._cleanup) (mgr as any)._cleanup()
    if (mgr) mgr.end()
    onEnd()
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    mgrRef.current?.toggleMute(next)
  }
  function toggleVideo() {
    const next = !videoOn
    setVideoOn(next)
    mgrRef.current?.toggleVideo(next)
  }

  const isVideo = call.callType === "video" && videoOn

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 text-white flex flex-col">
      {/* Remote video (full-screen) */}
      {isVideo && !isJaraPeer && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {isVideo && isJaraPeer && (
        <div className={`absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br ${bgClassFor(presentation?.appearance?.background)}`}>
          <div className="absolute inset-0 bg-black/10" />
          <JaraAvatar
            face={presentation?.appearance?.face || 'friendly'}
            background={presentation?.appearance?.background || 'gradient-emerald'}
            theme={presentation?.appearance?.theme || 'light'}
            clothing={presentation?.appearance?.clothing || null}
            mood={status === 'Connected' ? 'speaking' : 'listening'}
            size={220}
            colors={safeColors(presentation?.appearance?.colors)}
          />
          <div className="mt-4 text-white text-lg font-semibold relative">{presentation?.identity?.displayName || call.peer.name}</div>
          <div className="text-white/80 text-xs relative">AI digital human • {presentation?.temporary ? 'Temporary' : 'Default'} profile • {clothingLabel(presentation?.appearance?.clothing)}</div>
          <div className="text-amber-300/90 text-[11px] relative mt-1">Browser fallback renderer — real GPU avatar video track not configured</div>
        </div>
      )}

      {/* Remote audio (always, even in audio-only) */}
      <audio ref={remoteAudioRef} autoPlay />

      {/* Local video (picture-in-picture) */}
      {isVideo && (
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-24 right-4 w-32 h-48 sm:w-48 sm:h-32 object-cover rounded-xl border-2 border-white/20 mirror"
          style={{ transform: "scaleX(-1)" }}
        />
      )}

      {/* Audio-only: large avatar */}
      {!isVideo && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 relative overflow-hidden">
          {isJaraPeer && presentation?.appearance?.background && (
            <div className={`absolute inset-0 bg-gradient-to-br ${bgClassFor(presentation.appearance.background)} opacity-30`} />
          )}
          {isJaraPeer ? (
            <JaraAvatar
              face={presentation?.appearance?.face || 'friendly'}
              background={presentation?.appearance?.background || 'gradient-emerald'}
              theme={presentation?.appearance?.theme || 'light'}
              clothing={presentation?.appearance?.clothing || null}
              mood={status === 'Connected' ? 'speaking' : 'listening'}
              size={180}
              colors={safeColors(presentation?.appearance?.colors)}
            />
          ) : (
            <Avatar name={call.peer.name} src={call.peer.avatarUrl} size={160} />
          )}
          <div className="text-2xl font-semibold relative">{call.peer.name}</div>
          <div className="text-emerald-400 relative">{status}</div>
          {presentation && (
            <div className="text-xs text-zinc-300/90 relative px-3 py-1 rounded-full bg-black/30">
              {presentation.temporary ? 'Temporary' : 'Default'} profile • {presentation.appearance?.background} • {clothingLabel(presentation.appearance?.clothing)}
            </div>
          )}
          {isJaraPeer && (
            <div className="text-[11px] text-amber-300/90 relative">Renderer: browser fallback (canvas preview) — no GPU avatar video track</div>
          )}
          {status === "Connected" && (
            <div className="text-zinc-400 relative">
              {Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, "0")}
            </div>
          )}
        </div>
      )}

      {/* Video call overlay info */}
      {isVideo && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-black/40 backdrop-blur px-4 py-2 rounded-full text-sm flex items-center gap-2">
          <span className="font-medium">{call.peer.name}</span>
          <span className="text-zinc-300">·</span>
          <span className={status === "Connected" ? "text-emerald-400" : "text-zinc-300"}>
            {status === "Connected" ? `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}` : status}
          </span>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-rose-500 px-4 py-2 rounded-md text-sm mt-16">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-3 bg-black/40 backdrop-blur px-4 py-3 rounded-full">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full w-12 h-12 p-0 text-white hover:bg-white/10"
          onClick={toggleMute}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </Button>
        {call.callType === "video" && (
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full w-12 h-12 p-0 text-white hover:bg-white/10"
            onClick={toggleVideo}
            title={videoOn ? "Turn off camera" : "Turn on camera"}
          >
            {videoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </Button>
        )}
        <Button
          variant="destructive"
          size="icon"
          className="rounded-full w-12 h-12 p-0"
          onClick={handleEnd}
          title="End call"
        >
          <PhoneOff className="w-5 h-5" />
        </Button>
      </div>
    </div>
  )
}
