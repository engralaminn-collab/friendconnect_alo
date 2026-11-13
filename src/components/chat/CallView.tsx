"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Avatar } from "./Avatar"
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Volume2, VolumeX,
} from "lucide-react"
import type { CallType } from "@/lib/webrtc"
import { WebRTCManager } from "@/lib/webrtc"

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

  // Call timer
  useEffect(() => {
    if (status !== "Connected") return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [status])

  function handleEnd() {
    socket.emit("call:end", { toUserId: call.peer.id, callId: call.callId })
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
      {isVideo && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
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
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Avatar name={call.peer.name} src={call.peer.avatarUrl} size={160} />
          <div className="text-2xl font-semibold">{call.peer.name}</div>
          <div className="text-emerald-400">{status}</div>
          {status === "Connected" && (
            <div className="text-zinc-400">
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
