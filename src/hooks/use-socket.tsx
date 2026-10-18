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
import { toast } from 'sonner'

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

/** How long the caller rings before giving up, and how long ICE may take. */
const RING_TIMEOUT_MS = 45_000
const CONNECT_TIMEOUT_MS = 30_000

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}

/**
 * Browsers only expose camera/microphone on secure origins (https:// or localhost).
 * Opening the app on a plain http://<ip-address> silently removes
 * navigator.mediaDevices, which used to make every call fail with no message.
 */
function mediaUnavailableReason(): string | null {
  if (typeof window === 'undefined') return null
  if (!window.isSecureContext) {
    return 'Calls need a secure (https://) connection. Your browser blocks the camera and microphone on plain http:// addresses — open FriendConnect through its https:// domain.'
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This browser does not support calls. Please use an up-to-date Chrome, Safari, Edge or Firefox.'
  }
  if (typeof RTCPeerConnection === 'undefined') {
    return 'This browser does not support WebRTC calls.'
  }
  return null
}

function describeMediaError(e: unknown, type: CallType): string {
  const name = (e as { name?: string })?.name || ''
  const what = type === 'video' ? 'camera or microphone' : 'microphone'
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return `Permission to use your ${what} was denied. Allow it in your browser's site settings and try again.`
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `No ${what} was found on this device.`
    case 'NotReadableError':
    case 'TrackStartError':
      return `Your ${what} is in use by another app. Close it and try again.`
    case 'OverconstrainedError':
      return `Your ${what} does not support the requested settings.`
    default:
      return mediaUnavailableReason() || `Could not start the call: ${(e as Error)?.message || 'unknown error'}`
  }
}

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
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

  const [callState, setCallStateRaw] = useState<CallState>('idle')
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
  const callTypeRef = useRef<CallType>('audio')
  const isCallerRef = useRef(false)
  const iceBufRef = useRef<RTCIceCandidateInit[]>([])
  const connectedAtRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restartingRef = useRef(false)
  const peerInfoRef = useRef<PeerInfo | null>(null)

  useEffect(() => {
    peerInfoRef.current = peerInfo
  }, [peerInfo])

  // Keep the ref in sync *synchronously*: socket handlers read it immediately,
  // and a useEffect-based sync left a window where duplicate events slipped through.
  const setCallState = useCallback((st: CallState) => {
    callStateRef.current = st
    setCallStateRaw(st)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const cleanupCall = useCallback(() => {
    clearTimer()
    const pc = pcRef.current
    pcRef.current = null
    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      pc.oniceconnectionstatechange = null
      try {
        pc.close()
      } catch {
        /* ignore */
      }
    }
    stopStream(localRef.current)
    localRef.current = null
    remoteRef.current = null
    pendingOfferRef.current = null
    iceBufRef.current = []
    peerIdRef.current = null
    isCallerRef.current = false
    restartingRef.current = false
    setLocalStream(null)
    setRemoteStream(null)
    setCallState('idle')
    setPeerInfo(null)
    setElapsed(0)
    setFacingMode('user')
    connectedAtRef.current = 0
  }, [clearTimer, setCallState])

  /** End the call locally with a message, and tell the peer so they don't hang. */
  const failCall = useCallback(
    (message: string, notifyPeer = true) => {
      const target = peerIdRef.current
      if (notifyPeer && target && socketRef.current) {
        socketRef.current.emit(RT.CALL_FAILED, { targetUserId: target, reason: message })
      }
      if (callStateRef.current !== 'idle') toast.error(message, { duration: 8000 })
      cleanupCall()
    },
    [cleanupCall]
  )

  const getIce = useCallback(async (): Promise<RTCIceServer[]> => {
    try {
      const data = await api<IcePayload>('/api/webrtc/config')
      return data.iceServers?.length ? data.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }]
    } catch {
      return [{ urls: 'stun:stun.l.google.com:19302' }]
    }
  }, [])

  /** Apply ICE candidates that arrived before the remote description was set. */
  const flushIce = useCallback(async (pc: RTCPeerConnection) => {
    const buf = iceBufRef.current
    iceBufRef.current = []
    for (const c of buf) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c))
      } catch {
        /* stale / mismatched candidate — ignore */
      }
    }
  }, [])

  const sendIceRestartOffer = useCallback(async () => {
    const pc = pcRef.current
    const target = peerIdRef.current
    if (!pc || !target || !socketRef.current || restartingRef.current) return
    if (pc.signalingState !== 'stable') return
    restartingRef.current = true
    try {
      const offer = await pc.createOffer({ iceRestart: true })
      await pc.setLocalDescription(offer)
      socketRef.current.emit(RT.CALL_OFFER, { targetUserId: target, type: callTypeRef.current, sdp: offer, restart: true })
    } catch (e) {
      console.warn('[call] ICE restart failed', e)
    } finally {
      restartingRef.current = false
    }
  }, [])

  const ensurePc = useCallback(
    (iceServers: RTCIceServer[]) => {
      if (pcRef.current) return pcRef.current
      const pc = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: 4,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      })
      pc.onicecandidate = (ev) => {
        if (ev.candidate && peerIdRef.current && socketRef.current) {
          socketRef.current.emit(RT.CALL_ICE, { targetUserId: peerIdRef.current, candidate: ev.candidate.toJSON() })
        }
      }
      pc.ontrack = (ev) => {
        // Build our own stream so audio + video tracks always end up together,
        // even if the browser delivers them without an associated MediaStream.
        let stream = remoteRef.current
        if (!stream) {
          stream = ev.streams[0] ? new MediaStream(ev.streams[0].getTracks()) : new MediaStream()
        }
        if (!stream.getTracks().includes(ev.track)) stream.addTrack(ev.track)
        remoteRef.current = stream
        // New object so React re-renders and the <audio>/<video> elements re-bind.
        setRemoteStream(new MediaStream(stream.getTracks()))
      }
      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc) return
        const st = pc.connectionState
        if (st === 'connected') {
          clearTimer()
          if (callStateRef.current !== 'connected') {
            setCallState('connected')
            if (!connectedAtRef.current) connectedAtRef.current = Date.now()
            socketRef.current?.emit(RT.CALL_CONNECTED, { targetUserId: peerIdRef.current })
          }
        } else if (st === 'disconnected' || st === 'failed') {
          // Network hiccup / switch (WiFi <-> mobile data). Only the caller re-offers,
          // so both sides never send competing offers at the same time.
          if (isCallerRef.current) {
            setTimeout(() => {
              const cur = pcRef.current
              if (cur === pc && (cur.connectionState === 'disconnected' || cur.connectionState === 'failed')) {
                void sendIceRestartOffer()
              }
            }, st === 'failed' ? 0 : 2000)
          }
          // Give up if it does not recover.
          clearTimer()
          timerRef.current = setTimeout(() => {
            if (pcRef.current === pc && pc.connectionState !== 'connected') {
              failCall('The call was lost — the network connection dropped.')
            }
          }, CONNECT_TIMEOUT_MS)
        }
      }
      pcRef.current = pc
      return pc
    },
    [clearTimer, failCall, sendIceRestartOffer, setCallState]
  )

  /**
   * Get mic (+ camera). If the camera is missing or busy on a video call, fall back
   * to an audio-only call instead of failing completely.
   */
  const attachLocal = useCallback(async (type: CallType, facing: 'user' | 'environment' = 'user') => {
    const reason = mediaUnavailableReason()
    if (reason) throw Object.assign(new Error(reason), { name: 'InsecureContext' })
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: type === 'video' ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      })
    } catch (e) {
      const name = (e as { name?: string })?.name
      if (type === 'video' && (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError')) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false })
        toast.warning('Camera unavailable — continuing with audio only.')
      } else {
        throw e
      }
    }
    stopStream(localRef.current)
    localRef.current = stream
    setLocalStream(stream)
    setMicEnabled(true)
    setVideoEnabled(stream.getVideoTracks().length > 0)
    return stream
  }, [])

  const startCall = useCallback(
    async (targetUserId: string, type: CallType, peer?: PeerInfo) => {
      if (callStateRef.current !== 'idle') {
        toast.info('You are already in a call.')
        return
      }
      const reason = mediaUnavailableReason()
      if (reason) {
        toast.error(reason, { duration: 10000 })
        return
      }
      const s = socketRef.current
      if (!s || !s.connected) {
        toast.error('Not connected to the realtime server. Check your internet connection and try again.')
        return
      }
      peerIdRef.current = targetUserId
      isCallerRef.current = true
      callTypeRef.current = type
      setCallType(type)
      setPeerInfo(peer || { id: targetUserId, name: 'Friend', photoUrl: null })
      setCallState('calling')
      let invited = false
      try {
        const [ice, stream] = await Promise.all([getIce(), attachLocal(type)])
        if (peerIdRef.current !== targetUserId) {
          // Cancelled while the permission prompt was open.
          stopStream(stream)
          return
        }
        const pc = ensurePc(ice)
        stream.getTracks().forEach((t) => pc.addTrack(t, stream))
        s.emit(RT.CALL_INVITE, { targetUserId, type })
        invited = true
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        s.emit(RT.CALL_OFFER, { targetUserId, type, sdp: offer })
        clearTimer()
        timerRef.current = setTimeout(() => {
          if (callStateRef.current === 'calling' && peerIdRef.current === targetUserId) {
            s.emit(RT.CALL_CANCELLED, { targetUserId, reason: 'timeout' })
            toast.info('No answer.')
            cleanupCall()
          }
        }, RING_TIMEOUT_MS)
      } catch (e) {
        console.error('[call] startCall failed', e)
        if (invited) s.emit(RT.CALL_CANCELLED, { targetUserId })
        toast.error(describeMediaError(e, type), { duration: 10000 })
        cleanupCall()
      }
    },
    [attachLocal, cleanupCall, clearTimer, ensurePc, getIce, setCallState]
  )

  const acceptCall = useCallback(async () => {
    const target = peerIdRef.current
    const s = socketRef.current
    if (!target || !s || callStateRef.current !== 'ringing') return
    clearTimer()
    setCallState('connecting')
    const type = callTypeRef.current
    try {
      const [ice, stream] = await Promise.all([getIce(), attachLocal(type)])
      if (peerIdRef.current !== target) {
        stopStream(stream)
        return
      }
      const pc = ensurePc(ice)
      stream.getTracks().forEach((t) => pc.addTrack(t, stream))
      s.emit(RT.CALL_ACCEPTED, { targetUserId: target })
      const offer = pendingOfferRef.current
      if (offer) {
        pendingOfferRef.current = null
        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        await flushIce(pc)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        s.emit(RT.CALL_ANSWER, { targetUserId: target, sdp: answer })
      }
      // (If the offer has not arrived yet, the CALL_OFFER handler answers it.)
      timerRef.current = setTimeout(() => {
        if (callStateRef.current === 'connecting' && peerIdRef.current === target) {
          failCall(
            'Could not connect the call. One of you may be behind a strict network (mobile data / office WiFi) — a TURN relay server is needed.'
          )
        }
      }, CONNECT_TIMEOUT_MS)
    } catch (e) {
      console.error('[call] acceptCall failed', e)
      failCall(describeMediaError(e, type))
    }
  }, [attachLocal, clearTimer, ensurePc, failCall, flushIce, getIce, setCallState])

  const rejectCall = useCallback(() => {
    const target = peerIdRef.current
    if (target && socketRef.current) {
      socketRef.current.emit(RT.CALL_REJECTED, { targetUserId: target })
    }
    cleanupCall()
  }, [cleanupCall])

  const endCall = useCallback(() => {
    const target = peerIdRef.current
    if (target && socketRef.current) {
      if (callStateRef.current === 'calling') {
        socketRef.current.emit(RT.CALL_CANCELLED, { targetUserId: target })
      } else {
        socketRef.current.emit(RT.CALL_ENDED, { targetUserId: target })
      }
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
    if (callTypeRef.current !== 'video') return
    const current = localRef.current
    if (!current) return
    const next = facingMode === 'user' ? 'environment' : 'user'
    try {
      // Only re-acquire the *camera*. The old code re-requested audio as well and
      // stopped the previous stream, which killed the mic track being sent —
      // the other person stopped hearing you after flipping the camera.
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: next }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      }).catch(() =>
        navigator.mediaDevices.getUserMedia({ video: { facingMode: next }, audio: false })
      )
      const newTrack = camStream.getVideoTracks()[0]
      if (!newTrack) return
      newTrack.enabled = videoEnabled
      const sender = pcRef.current?.getSenders().find((sd) => sd.track?.kind === 'video')
      if (sender) await sender.replaceTrack(newTrack)
      current.getVideoTracks().forEach((t) => {
        t.stop()
        current.removeTrack(t)
      })
      current.addTrack(newTrack)
      setLocalStream(new MediaStream(current.getTracks()))
      setFacingMode(next)
    } catch {
      toast.info('This device has only one camera.')
    }
  }, [facingMode, videoEnabled])

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
        reconnectionAttempts: Infinity,
        reconnectionDelayMax: 10000,
        auth: { token },
      })
      socketRef.current = s
      setSocket(s)

      s.on('connect', () => {
        if (token) s!.emit(RT.AUTH, token)
        else s!.emit(RT.AUTH, user.id)
      })
      s.on('disconnect', () => setConnected(false))
      s.on(RT.AUTH_OK, () => setConnected(true))
      s.on('connect_error', (err) => console.warn('[socket] connect_error', err?.message))

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

      /** Is this event about the call we are currently in? */
      const fromPeer = (p: { from?: string; senderId?: string } | undefined) => {
        const from = p?.from || p?.senderId
        return !!from && from === peerIdRef.current
      }

      s.on(RT.CALL_INCOMING, (payload: { callerId: string; type?: CallType; name?: string; photoUrl?: string | null }) => {
        if (!payload?.callerId) return
        if (callStateRef.current !== 'idle') {
          if (payload.callerId !== peerIdRef.current) s!.emit(RT.CALL_BUSY, { targetUserId: payload.callerId })
          return
        }
        const type: CallType = payload.type === 'video' ? 'video' : 'audio'
        peerIdRef.current = payload.callerId
        isCallerRef.current = false
        callTypeRef.current = type
        iceBufRef.current = []
        setCallType(type)
        setPeerInfo({ id: payload.callerId, name: payload.name || 'Incoming call', photoUrl: payload.photoUrl || null })
        setCallState('ringing')
        clearTimer()
        timerRef.current = setTimeout(() => {
          if (callStateRef.current === 'ringing' && peerIdRef.current === payload.callerId) {
            toast.info(`Missed call from ${payload.name || 'a friend'}`)
            cleanupCall()
          }
        }, RING_TIMEOUT_MS + 5000)
      })

      s.on(RT.CALL_OFFER, async (payload: { sdp?: RTCSessionDescriptionInit; offer?: RTCSessionDescriptionInit; senderId?: string; from?: string; type?: CallType }) => {
        const desc = payload?.sdp || payload?.offer
        if (!desc) return
        // Ignore offers from anyone other than the person we're talking to
        // (previously a second caller could hijack an ongoing call).
        if (!fromPeer(payload)) return
        const pc = pcRef.current
        if (!pc) {
          // Still ringing — keep it until the user taps Accept.
          pendingOfferRef.current = desc
          return
        }
        try {
          // Late initial offer (accepted before it arrived) or an ICE-restart re-offer.
          await pc.setRemoteDescription(new RTCSessionDescription(desc))
          await flushIce(pc)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          s!.emit(RT.CALL_ANSWER, { targetUserId: peerIdRef.current, sdp: answer })
        } catch (e) {
          console.error('[call] handling offer failed', e)
        }
      })

      s.on(RT.CALL_ANSWER, async (payload: { sdp?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; senderId?: string; from?: string }) => {
        const desc = payload?.sdp || payload?.answer
        const pc = pcRef.current
        if (!pc || !desc || !fromPeer(payload)) return
        if (pc.signalingState !== 'have-local-offer') return // duplicate answer
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(desc))
          // Candidates that arrived before the answer were buffered and, before
          // this fix, never applied — a common reason calls stuck on "Connecting…".
          await flushIce(pc)
          if (callStateRef.current === 'calling') {
            setCallState('connecting')
            clearTimer()
            timerRef.current = setTimeout(() => {
              if (callStateRef.current === 'connecting') {
                failCall(
                  'Could not connect the call. One of you may be behind a strict network (mobile data / office WiFi) — a TURN relay server is needed.'
                )
              }
            }, CONNECT_TIMEOUT_MS)
          }
        } catch (e) {
          console.error('[call] applying answer failed', e)
        }
      })

      const onIce = async (payload: { candidate?: RTCIceCandidateInit; senderId?: string; from?: string }) => {
        if (!payload?.candidate || !fromPeer(payload)) return
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
      // The server relays every candidate under both names; listen to one only.
      s.on(RT.CALL_ICE, onIce)

      s.on(RT.CALL_ACCEPTED, (p: { from?: string; senderId?: string }) => {
        if (!fromPeer(p) || callStateRef.current !== 'calling') return
        setCallState('connecting')
      })

      const endWith = (message: string | null) => (p: { from?: string; senderId?: string; reason?: string }) => {
        if (!fromPeer(p) || callStateRef.current === 'idle') return
        const name = peerInfoRef.current?.name || 'Your friend'
        const text = message?.replace('{name}', name)
        if (text) toast.info(text)
        cleanupCall()
      }
      s.on(RT.CALL_ENDED_EVENT, endWith(null))
      s.on(RT.CALL_REJECTED, endWith('{name} declined the call.'))
      s.on(RT.CALL_BUSY, endWith('{name} is on another call.'))
      s.on(RT.CALL_FAILED, endWith('The call could not be connected on {name}\'s side.'))
      s.on(RT.CALL_TIMEOUT, endWith('No answer.'))
      // call:unavailable comes from the server, not the peer.
      s.on(RT.CALL_UNAVAILABLE, (p: { targetUserId?: string }) => {
        if (!p?.targetUserId || p.targetUserId !== peerIdRef.current) return
        toast.info(`${peerInfoRef.current?.name || 'Your friend'} is offline right now.`)
        cleanupCall()
      })
    })()

    return () => {
      cancelled = true
      s?.disconnect()
      socketRef.current = null
    }
  }, [user?.id, cleanupCall, clearTimer, failCall, flushIce, setCallState])

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
