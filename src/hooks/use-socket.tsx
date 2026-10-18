'use client'

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  createContext,
  useContext,
  ReactNode,
} from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuth } from '@/hooks/use-auth'
import { RT } from '@/lib/constants'
import { api } from '@/lib/api'

export type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected'
export type CallType = 'audio' | 'video'

export interface PeerInfo {
  id: string
  name: string
  photoUrl: string | null
}

interface IcePayload {
  iceServers: RTCIceServer[]
}

interface SocketCtx {
  socket: Socket | null
  connected: boolean
  isOnline: (userId: string) => boolean
  onlineUsers: string[]
  online: Set<string>
  callState: CallState
  callType: CallType
  peerInfo: PeerInfo | null
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  micEnabled: boolean
  videoEnabled: boolean
  speakerOn: boolean
  facingMode: 'user' | 'environment'
  elapsed: number
  acceptCall: () => void
  rejectCall: () => void
  endCall: () => void
  toggleMic: () => void
  toggleVideo: () => void
  toggleSpeaker: () => void
  switchCamera: () => void
  startCall: (targetUserId: string, type: CallType, peer?: PeerInfo) => void
}

const Ctx = createContext<SocketCtx | null>(null)

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}

export function SocketProvider({
  children,
  userId: _userId,
}: {
  children: ReactNode
  userId?: string
}) {
  const { user } = useAuth()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState<string[]>([])
  const socketRef = useRef<Socket | null>(null)

  const [callState, setCallState] = useState<CallState>('idle')
  const [callType, setCallType] = useState<CallType>('audio')
  const [peerInfo, setPeerInfo] = useState<PeerInfo | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [micEnabled, setMicEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [speakerOn, setSpeakerOn] = useState(true)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [elapsed, setElapsed] = useState(0)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localRef = useRef<MediaStream | null>(null)
  const remoteRef = useRef<MediaStream | null>(null)
  const peerIdRef = useRef<string | null>(null)
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null)
  const callStateRef = useRef<CallState>('idle')
  const iceBufRef = useRef<RTCIceCandidateInit[]>([])
  const connectedAtRef = useRef<number>(0)

  useEffect(() => {
    callStateRef.current = callState
  }, [callState])

  const cleanupCall = useCallback(() => {
    pcRef.current?.close()
    pcRef.current = null
    stopStream(localRef.current)
    localRef.current = null
    remoteRef.current = null
    pendingOfferRef.current = null
    iceBufRef.current = []
    peerIdRef.current = null
    setLocalStream(null)
    setRemoteStream(null)
    setCallState('idle')
    setPeerInfo(null)
    setElapsed(0)
    connectedAtRef.current = 0
  }, [])

  const getIce = useCallback(async (): Promise<RTCIceServer[]> => {
    try {
      const data = await api<IcePayload>('/api/webrtc/config')
      return data.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }]
    } catch {
      return [{ urls: 'stun:stun.l.google.com:19302' }]
    }
  }, [])

  const ensurePc = useCallback(async (iceServers: RTCIceServer[]) => {
    if (pcRef.current) return pcRef.current
    const pc = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    })
    pc.onicecandidate = (ev) => {
      if (ev.candidate && peerIdRef.current && socketRef.current) {
        socketRef.current.emit(RT.CALL_ICE, { targetUserId: peerIdRef.current, candidate: ev.candidate })
      }
    }
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track])
      remoteRef.current = stream
      setRemoteStream(stream)
    }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected') {
        setCallState('connected')
        connectedAtRef.current = Date.now()
        socketRef.current?.emit(RT.CALL_CONNECTED, { targetUserId: peerIdRef.current })
      } else if (st === 'disconnected') {
        setTimeout(() => {
          if (pcRef.current?.connectionState === 'disconnected' || pcRef.current?.connectionState === 'failed') {
            try {
              pc.restartIce()
            } catch {
              socketRef.current?.emit(RT.CALL_FAILED, { targetUserId: peerIdRef.current })
            }
          }
        }, 2000)
      } else if (st === 'failed') {
        try {
          pc.restartIce()
        } catch {
          socketRef.current?.emit(RT.CALL_FAILED, { targetUserId: peerIdRef.current })
        }
      }
    }
    pcRef.current = pc
    return pc
  }, [])

  const attachLocal = useCallback(async (type: CallType, facing: 'user' | 'environment' = 'user') => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: type === 'video' ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    })
    stopStream(localRef.current)
    localRef.current = stream
    setLocalStream(stream)
    setMicEnabled(true)
    setVideoEnabled(type === 'video')
    return stream
  }, [])

  const startCall = useCallback(
    async (targetUserId: string, type: CallType, peer?: PeerInfo) => {
      if (!socketRef.current || callStateRef.current !== 'idle') return
      peerIdRef.current = targetUserId
      setCallType(type)
      setPeerInfo(peer || { id: targetUserId, name: 'Friend', photoUrl: null })
      setCallState('calling')
      try {
        const ice = await getIce()
        const stream = await attachLocal(type)
        const pc = await ensurePc(ice)
        stream.getTracks().forEach((t) => pc.addTrack(t, stream))
        socketRef.current.emit(RT.CALL_INVITE, { targetUserId, type })
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socketRef.current.emit(RT.CALL_OFFER, { targetUserId, type, sdp: offer })
      } catch (e) {
        console.error('startCall failed', e)
        cleanupCall()
      }
    },
    [attachLocal, cleanupCall, ensurePc, getIce]
  )

  const acceptCall = useCallback(async () => {
    const target = peerIdRef.current
    const s = socketRef.current
    if (!target || !s) return
    setCallState('connecting')
    try {
      const ice = await getIce()
      const stream = await attachLocal(callType)
      const pc = await ensurePc(ice)
      stream.getTracks().forEach((t) => pc.addTrack(t, stream))
      s.emit(RT.CALL_ACCEPTED, { targetUserId: target })
      s.emit(RT.CALL_RINGING, { targetUserId: target })
      const offer = pendingOfferRef.current
      if (offer) {
        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        for (const c of iceBufRef.current) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(c))
          } catch {
            /* ignore */
          }
        }
        iceBufRef.current = []
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        s.emit(RT.CALL_ANSWER, { targetUserId: target, sdp: answer })
        pendingOfferRef.current = null
      }
    } catch (e) {
      console.error('acceptCall failed', e)
      cleanupCall()
    }
  }, [attachLocal, callType, cleanupCall, ensurePc, getIce])

  const rejectCall = useCallback(() => {
    const target = peerIdRef.current
    if (target && socketRef.current) {
      socketRef.current.emit(RT.CALL_REJECTED, { targetUserId: target })
      socketRef.current.emit(RT.CALL_REJECT, { targetUserId: target })
    }
    cleanupCall()
  }, [cleanupCall])

  const endCall = useCallback(() => {
    const target = peerIdRef.current
    if (target && socketRef.current) {
      socketRef.current.emit(RT.CALL_ENDED, { targetUserId: target })
      socketRef.current.emit(RT.CALL_END, { targetUserId: target })
    }
    cleanupCall()
  }, [cleanupCall])

  const toggleMic = useCallback(() => {
    const next = !micEnabled
    localRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = next
    })
    setMicEnabled(next)
  }, [micEnabled])

  const toggleVideo = useCallback(() => {
    const next = !videoEnabled
    localRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = next
    })
    setVideoEnabled(next)
  }, [videoEnabled])

  const toggleSpeaker = useCallback(() => {
    setSpeakerOn((v) => !v)
  }, [])

  const switchCamera = useCallback(async () => {
    if (callType !== 'video') return
    const next = facingMode === 'user' ? 'environment' : 'user'
    setFacingMode(next)
    try {
      const stream = await attachLocal('video', next)
      const pc = pcRef.current
      const videoTrack = stream.getVideoTracks()[0]
      const sender = pc?.getSenders().find((s) => s.track?.kind === 'video')
      if (sender && videoTrack) await sender.replaceTrack(videoTrack)
    } catch {
      /* device may not support flip */
    }
  }, [attachLocal, callType, facingMode])

  useEffect(() => {
    if (callState !== 'connected') return
    const t = setInterval(() => {
      if (connectedAtRef.current) {
        setElapsed(Math.floor((Date.now() - connectedAtRef.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(t)
  }, [callState])

  useEffect(() => {
    const onStart = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { targetUserId: string; type: CallType; peer?: PeerInfo }
      if (detail?.targetUserId) void startCall(detail.targetUserId, detail.type || 'audio', detail.peer)
    }
    window.addEventListener('fc:start-call', onStart as EventListener)
    return () => window.removeEventListener('fc:start-call', onStart as EventListener)
  }, [startCall])

  useEffect(() => {
    if (!user?.id) {
      socketRef.current?.disconnect()
      socketRef.current = null
      setSocket(null)
      setConnected(false)
      setOnlineUsers([])
      cleanupCall()
      return
    }

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin
    let cancelled = false
    let s: Socket | null = null

    ;(async () => {
      let token: string | undefined
      try {
        const data = await api<{ token: string }>('/api/auth/token')
        token = data.token
      } catch {
        token = undefined
      }
      if (cancelled) return
      s = io(socketUrl, {
        path: '/socket.io/',
        transports: ['polling', 'websocket'],
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: 20,
        auth: { token },
      })
      socketRef.current = s
      setSocket(s)

      s.on('connect', () => {
        setConnected(true)
        if (token) s!.emit(RT.AUTH, token)
        else s!.emit(RT.AUTH, user.id)
      })
      s.on('disconnect', () => setConnected(false))
      s.on(RT.AUTH_OK, () => setConnected(true))

      const applyOnline = (users: string[]) => {
        if (Array.isArray(users)) setOnlineUsers(users)
      }
      s.on('online:update', applyOnline)
      s.on('onlineUsers', applyOnline)
      s.on(RT.PRESENCE, (p: { userId: string; online: boolean }) => {
        if (!p?.userId) return
        setOnlineUsers((prev) => {
          const set = new Set(prev)
          if (p.online) set.add(p.userId)
          else set.delete(p.userId)
          return Array.from(set)
        })
      })

      s.on(RT.CALL_INCOMING, async (payload: { callerId: string; type?: CallType; sdp?: RTCSessionDescriptionInit; name?: string; photoUrl?: string | null }) => {
        if (!payload?.callerId) return
        if (callStateRef.current !== 'idle') {
          s!.emit(RT.CALL_BUSY, { targetUserId: payload.callerId })
          return
        }
        peerIdRef.current = payload.callerId
        setCallType(payload.type === 'video' ? 'video' : 'audio')
        setPeerInfo({ id: payload.callerId, name: payload.name || 'Incoming call', photoUrl: payload.photoUrl || null })
        if (payload.sdp) pendingOfferRef.current = payload.sdp
        setCallState('ringing')
      })

      s.on(RT.CALL_SDP, async (payload: { kind?: string; sdp?: RTCSessionDescriptionInit; from?: string }) => {
        const pc = pcRef.current
        if (!pc || !payload?.sdp) return
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
          setCallState('connecting')
        } catch (e) {
          console.error(e)
        }
      })

      s.on(RT.CALL_ANSWER, async (payload: { sdp?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; senderId?: string }) => {
        const desc = payload?.sdp || payload?.answer
        const pc = pcRef.current
        if (!pc || !desc) return
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(desc))
          setCallState('connecting')
        } catch (e) {
          console.error(e)
        }
      })

      s.on(RT.CALL_OFFER, async (payload: { sdp?: RTCSessionDescriptionInit; offer?: RTCSessionDescriptionInit; senderId?: string; type?: CallType }) => {
        const desc = payload?.sdp || payload?.offer
        if (!desc) return
        pendingOfferRef.current = desc
        if (payload.senderId) peerIdRef.current = payload.senderId
        if (callStateRef.current === 'idle') {
          setCallType(payload.type === 'video' ? 'video' : 'audio')
          setCallState('ringing')
        } else if (pcRef.current && callStateRef.current === 'connecting') {
          try {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(desc))
            const answer = await pcRef.current.createAnswer()
            await pcRef.current.setLocalDescription(answer)
            s!.emit(RT.CALL_ANSWER, { targetUserId: peerIdRef.current, sdp: answer })
          } catch (e) {
            console.error(e)
          }
        }
      })

      const onIce = async (payload: { candidate?: RTCIceCandidateInit; senderId?: string }) => {
        if (!payload?.candidate) return
        const pc = pcRef.current
        if (!pc || !pc.remoteDescription) {
          iceBufRef.current.push(payload.candidate)
          return
        }
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
        } catch {
          /* ignore */
        }
      }
      s.on(RT.CALL_ICE, onIce)
      s.on(RT.CALL_ICE_CANDIDATE, onIce)

      const onEnded = () => cleanupCall()
      s.on(RT.CALL_ENDED_EVENT, onEnded)
      s.on('call:ended', onEnded)
      s.on(RT.CALL_REJECTED, onEnded)
      s.on(RT.CALL_UNAVAILABLE, onEnded)
      s.on(RT.CALL_TIMEOUT, onEnded)
      s.on(RT.CALL_BUSY, onEnded)

      s.on('call:accepted', async () => {
        setCallState('connecting')
      })
    })()

    return () => {
      cancelled = true
      s?.disconnect()
      socketRef.current = null
    }
  }, [user?.id, cleanupCall])

  const isOnline = useCallback((targetId: string) => onlineUsers.includes(targetId), [onlineUsers])

  const value: SocketCtx = {
    socket,
    connected,
    isOnline,
    onlineUsers,
    online: new Set(onlineUsers),
    callState,
    callType,
    peerInfo,
    localStream,
    remoteStream,
    micEnabled,
    videoEnabled,
    speakerOn,
    facingMode,
    elapsed,
    acceptCall,
    rejectCall,
    endCall,
    toggleMic,
    toggleVideo,
    toggleSpeaker,
    switchCamera,
    startCall,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSocket(): SocketCtx {
  const ctx = useContext(Ctx)
  if (!ctx) {
    return {
      socket: null,
      connected: false,
      isOnline: () => false,
      onlineUsers: [],
      online: new Set(),
      callState: 'idle',
      callType: 'audio',
      peerInfo: null,
      localStream: null,
      remoteStream: null,
      micEnabled: true,
      videoEnabled: true,
      speakerOn: true,
      facingMode: 'user',
      elapsed: 0,
      acceptCall: () => {},
      rejectCall: () => {},
      endCall: () => {},
      toggleMic: () => {},
      toggleVideo: () => {},
      toggleSpeaker: () => {},
      switchCamera: () => {},
      startCall: () => {},
    }
  }
  return ctx
}
