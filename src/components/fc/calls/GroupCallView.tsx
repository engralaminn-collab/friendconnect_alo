"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Avatar } from "@/components/chat/Avatar"
import { Mic, MicOff, Video, VideoOff, PhoneOff, Users } from "lucide-react"
import {
  LiveKitRoom,
  VideoConference,
  ParticipantTile,
  TrackMutedIndicator,
  useTracks,
} from "@livekit/components-react"
import { RoomEvent, Track } from "livekit-client"
import "@livekit/components-styles"

interface GroupCallData {
  token: string
  url: string
  roomName: string
  identity: string
}

export function GroupCallView({
  conversationId,
  conversationTitle,
  onEnd,
}: {
  conversationId: string
  conversationTitle: string
  onEnd: () => void
}) {
  const [callData, setCallData] = useState<GroupCallData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function joinCall() {
      try {
        const res = await fetch("/api/calls/group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, action: "join" }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to join call")
        if (!cancelled) {
          setCallData(data)
          setLoading(false)
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message)
          setLoading(false)
        }
      }
    }
    joinCall()
    return () => { cancelled = true }
  }, [conversationId])

  async function handleEnd() {
    if (callData) {
      try {
        await fetch("/api/calls/group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, action: "end" }),
        })
      } catch {}
    }
    onEnd()
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-pulse text-lg">Joining group call…</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-center max-w-md p-6">
          <div className="text-rose-500 text-lg mb-2">⚠️ {error}</div>
          <div className="text-sm text-zinc-400 mb-4">
            LiveKit needs to be configured on the server. Set these env vars:
            <pre className="text-xs mt-2 text-left bg-zinc-900 p-3 rounded">
LIVEKIT_URL=wss://your-livekit-server
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
            </pre>
          </div>
          <Button onClick={onEnd} variant="destructive">Close</Button>
        </div>
      </div>
    )
  }

  if (!callData) return null

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950">
      <LiveKitRoom
        token={callData.token}
        serverUrl={callData.url}
        onDisconnected={handleEnd}
        className="h-full"
      >
        {/* Video conference grid — handles participant tiles, active speaker, screen share */}
        <VideoConference className="h-full" />

        {/* Top bar */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/40 backdrop-blur px-4 py-2 rounded-full text-white text-sm flex items-center gap-2 z-10">
          <Users className="w-4 h-4" />
          <span className="font-medium">{conversationTitle}</span>
        </div>

        {/* End call button */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
          <Button
            variant="destructive"
            size="icon"
            className="rounded-full w-14 h-14"
            onClick={handleEnd}
            title="Leave call"
          >
            <PhoneOff className="w-6 h-6" />
          </Button>
        </div>
      </LiveKitRoom>
    </div>
  )
}
