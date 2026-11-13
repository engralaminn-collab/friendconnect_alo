"use client"

// WebRTC peer connection manager for 1:1 audio/video calls.
// Signaling is relayed through the Socket.IO chat-service using the user's
// personal room (`user:<id>`).

export type CallType = "audio" | "video"
export type CallRole = "caller" | "callee"

export interface CallParticipant {
  id: string
  name: string
  avatarUrl?: string | null
}

interface IceServers {
  iceServers: RTCIceServer[]
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  // TURN server from env (configured in docker-compose as coturn)
  ...(process.env.NEXT_PUBLIC_TURN_URL
    ? [{
        urls: parseTurnUrl(process.env.NEXT_PUBLIC_TURN_URL),
        username: process.env.NEXT_PUBLIC_TURN_USER,
        credential: process.env.NEXT_PUBLIC_TURN_PASSWORD,
      } as RTCIceServer]
    : []),
]

function parseTurnUrl(raw: string): string {
  if (raw.startsWith("turn://")) return raw.replace("turn://", "turn:")
  if (raw.startsWith("turns://")) return raw.replace("turns://", "turns:")
  if (!raw.startsWith("turn:") && !raw.startsWith("turns:")) return `turn:${raw}`
  return raw
}

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private socket: any
  private targetUserId: string
  private callType: CallType
  private role: CallRole
  private onRemoteTrack: (stream: MediaStream) => void
  private onStateChange: (state: RTCPeerConnectionState) => void
  private onIceCandidate: (candidate: RTCIceCandidateInit, targetUserId: string) => void

  constructor(opts: {
    socket: any
    targetUserId: string
    callType: CallType
    role: CallRole
    onRemoteTrack: (stream: MediaStream) => void
    onStateChange: (state: RTCPeerConnectionState) => void
    onIceCandidate: (candidate: RTCIceCandidateInit, targetUserId: string) => void
  }) {
    this.socket = opts.socket
    this.targetUserId = opts.targetUserId
    this.callType = opts.callType
    this.role = opts.role
    this.onRemoteTrack = opts.onRemoteTrack
    this.onStateChange = opts.onStateChange
    this.onIceCandidate = opts.onIceCandidate
  }

  async start(): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: true,
      video: this.callType === "video" ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    }
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints)

    const config: IceServers = { iceServers: DEFAULT_ICE_SERVERS }
    this.pc = new RTCPeerConnection(config)

    for (const track of this.localStream.getTracks()) {
      this.pc.addTrack(track, this.localStream)
    }

    this.remoteStream = new MediaStream()
    this.pc.ontrack = (e) => {
      if (e.streams && e.streams[0]) {
        this.remoteStream = e.streams[0]
      } else {
        this.remoteStream?.addTrack(e.track)
      }
      this.onRemoteTrack(this.remoteStream!)
    }

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.onIceCandidate(e.candidate.toJSON(), this.targetUserId)
      }
    }

    this.pc.onconnectionstatechange = () => {
      if (this.pc) this.onStateChange(this.pc.connectionState)
    }

    return this.localStream
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error("PC not initialized")
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: this.callType === "video",
    })
    await this.pc.setLocalDescription(offer)
    return offer
  }

  async acceptOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error("PC not initialized")
    await this.pc.setRemoteDescription(offer)
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    return answer
  }

  async receiveAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) throw new Error("PC not initialized")
    await this.pc.setRemoteDescription(answer)
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) throw new Error("PC not initialized")
    try {
      await this.pc.addIceCandidate(candidate)
    } catch (e) {
      // Silently ignore late candidates after close
    }
  }

  toggleMute(muted: boolean) {
    if (!this.localStream) return
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted
    }
  }

  toggleVideo(enabled: boolean) {
    if (!this.localStream) return
    for (const track of this.localStream.getVideoTracks()) {
      track.enabled = enabled
    }
  }

  end() {
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop()
      this.localStream = null
    }
    if (this.pc) {
      this.pc.close()
      this.pc = null
    }
    this.remoteStream = null
  }

  getLocalStream() { return this.localStream }
  getRemoteStream() { return this.remoteStream }
}
