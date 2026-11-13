"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Avatar } from "./Avatar"
import { Phone, PhoneOff, Video } from "lucide-react"
// no React state needed — parent controls visibility via the prop

export interface IncomingCallData {
  callId: string
  callType: "audio" | "video"
  fromUserId: string
  fromName: string
  fromAvatarUrl?: string | null
  offer: RTCSessionDescriptionInit
}

export function IncomingCallModal({
  incomingCall,
  onAccept,
  onReject,
}: {
  incomingCall: IncomingCallData | null
  onAccept: () => void
  onReject: () => void
}) {
  return (
    <Dialog open={!!incomingCall} onOpenChange={(v) => { if (!v) onReject() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">Incoming {incomingCall?.callType === "video" ? "video" : "voice"} call</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
            <Avatar
              name={incomingCall?.fromName || "?"}
              src={incomingCall?.fromAvatarUrl}
              size={96}
            />
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold">{incomingCall?.fromName}</div>
            <div className="text-sm text-muted-foreground">Incoming…</div>
          </div>
          <div className="flex gap-4">
            <Button
              variant="destructive"
              size="lg"
              className="rounded-full w-16 h-16 p-0"
              onClick={onReject}
              title="Decline"
            >
              <PhoneOff className="w-6 h-6" />
            </Button>
            <Button
              variant="default"
              size="lg"
              className="rounded-full w-16 h-16 p-0 bg-emerald-500 hover:bg-emerald-600"
              onClick={onAccept}
              title="Accept"
            >
              {incomingCall?.callType === "video"
                ? <Video className="w-6 h-6" />
                : <Phone className="w-6 h-6" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
