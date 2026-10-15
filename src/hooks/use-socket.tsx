"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { io, Socket } from "socket.io-client";

export type CallType = "audio" | "video";
export type CallState =
  | "idle"
  | "calling"
  | "ringing"
  | "connecting"
  | "connected"
  | "ended";

export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  message: string;
  type: "text" | "image" | "video" | "audio" | "file";
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  timestamp: string;
}

export interface PeerInfo {
  id: string;
  name: string;
  photoUrl: string | null;
}

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  onlineUsers: string[];
  messages: ChatMessage[];
  callState: CallState;
  callType: CallType;
  peerInfo: PeerInfo | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micEnabled: boolean;
  videoEnabled: boolean;
  speakerOn: boolean;
  facingMode: "user" | "environment";
  elapsed: number;
  sendMessage: (msg: Omit<ChatMessage, "id" | "timestamp">) => void;
  sendTyping: (receiverId: string, isTyping: boolean) => void;
  startCall: (receiverId: string, type: CallType) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMic: () => void;
  toggleVideo: () => void;
  toggleSpeaker: () => void;
  switchCamera: () => Promise<void>;
}

const SocketContext = createContext<SocketContextType | null>(null);

// Audio Synthesizer - SSR Safe
class ToneGenerator {
  private ctx: any = null;
  private interval: any = null;

  startRinging() {
    this.stop();
    if (typeof window === "undefined") return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      const playBeep = () => {
        if (!this.ctx) return;
        try {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(440, this.ctx.currentTime);
          gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.2);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start();
          osc.stop(this.ctx.currentTime + 1.2);
        } catch {}
      };

      playBeep();
      this.interval = setInterval(playBeep, 3000);
    } catch {}
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {}
      this.ctx = null;
    }
  }
}

const toneGen = new ToneGenerator();

export function SocketProvider({
  userId,
  children,
}: {
  userId?: string;
  children: React.ReactNode;
}) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [callState, setCallState] = useState<CallState>("idle");
  const [callType, setCallType] = useState<CallType>("audio");
  const [peerInfo, setPeerInfo] = useState<PeerInfo | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [elapsed, setElapsed] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerIntervalRef = useRef<any>(null);
  const remoteDescSetRef = useRef(false);
  const iceCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);
  const callIdRef = useRef<string | null>(null);
  const targetUserRef = useRef<string | null>(null);

  const getIceServers = async (): Promise<RTCIceServer[]> => {
    try {
      const res = await fetch("/api/webrtc/config");
      if (res.ok) {
        const data = await res.json();
        if (data?.iceServers && data.iceServers.length > 0) {
          return data.iceServers;
        }
      }
    } catch {}
    return [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ];
  };

  const cleanupCall = useCallback(() => {
    toneGen.stop();
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    setCallState("idle");
    setPeerInfo(null);
    setElapsed(0);
    setMicEnabled(true);
    setVideoEnabled(true);
    setSpeakerOn(true);
    setFacingMode("user");
    remoteDescSetRef.current = false;
    iceCandidatesQueue.current = [];
    callIdRef.current = null;
    targetUserRef.current = null;
  }, []);

  const createPeerConnection = useCallback(async (targetUserId: string) => {
    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;
    remoteDescSetRef.current = false;

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit("call:ice-candidate", {
          targetUserId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      } else if (event.track) {
        setRemoteStream((prev) => {
          const stream = prev || new MediaStream();
          if (!stream.getTracks().some((t) => t.id === event.track.id)) {
            stream.addTrack(event.track);
          }
          return new MediaStream(stream.getTracks());
        });
      }
    };

    return pc;
  }, []);

  useEffect(() => {
    if (!userId) return;

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3114";
    const s = io(socketUrl, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });

    socketRef.current = s;
    setSocket(s);

    s.on("connect", () => {
      setIsConnected(true);
      s.emit("auth", userId);
    });

    s.on("disconnect", () => {
      setIsConnected(false);
    });

    s.on("online:update", (users: string[]) => {
      setOnlineUsers(users);
    });

    s.on("chat:message", (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    s.on("chat:message:ack", (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    s.on("call:incoming", async ({ callId, callerId, callType }) => {
      callIdRef.current = callId;
      targetUserRef.current = callerId;
      setCallType(callType || "audio");
      setCallState("ringing");
      toneGen.startRinging();

      try {
        const res = await fetch(`/api/users/${callerId}`);
        if (res.ok) {
          const uData = await res.json();
          setPeerInfo({
            id: callerId,
            name: uData.user.name,
            photoUrl: uData.user.photoUrl,
          });
        } else {
          setPeerInfo({ id: callerId, name: "Caller", photoUrl: null });
        }
      } catch {
        setPeerInfo({ id: callerId, name: "Caller", photoUrl: null });
      }
    });

    s.on("call:accepted", async ({ receiverId }) => {
      toneGen.stop();
      setCallState("connecting");
      if (pcRef.current && localStreamRef.current) {
        try {
          const offer = await pcRef.current.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: callType === "video",
          });
          await pcRef.current.setLocalDescription(offer);
          s.emit("call:offer", { targetUserId: receiverId, offer });
        } catch (e) {
          console.error("Failed to create offer", e);
        }
      }
    });

    s.on("call:rejected", () => {
      cleanupCall();
    });

    s.on("call:offer", async ({ senderId, offer }) => {
      if (!pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
        remoteDescSetRef.current = true;

        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        s.emit("call:answer", { targetUserId: senderId, answer });

        while (iceCandidatesQueue.current.length > 0) {
          const cand = iceCandidatesQueue.current.shift();
          if (cand) await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
        }

        toneGen.stop();
        setCallState("connected");
        startTimer();
      } catch (e) {
        console.error("Error setting offer or sending answer", e);
      }
    });

    s.on("call:answer", async ({ answer }) => {
      if (!pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        remoteDescSetRef.current = true;

        while (iceCandidatesQueue.current.length > 0) {
          const cand = iceCandidatesQueue.current.shift();
          if (cand) await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
        }

        toneGen.stop();
        setCallState("connected");
        startTimer();
      } catch (e) {
        console.error("Error setting remote answer", e);
      }
    });

    s.on("call:ice-candidate", async ({ candidate }) => {
      if (!pcRef.current || !candidate) return;
      if (remoteDescSetRef.current) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {}
      } else {
        iceCandidatesQueue.current.push(candidate);
      }
    });

    s.on("call:ended", () => {
      cleanupCall();
    });

    return () => {
      s.disconnect();
    };
  }, [userId, cleanupCall, callType]);

  const startTimer = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    setElapsed(0);
    timerIntervalRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
  };

  const startCall = useCallback(
    async (receiverId: string, type: CallType) => {
      if (!socketRef.current || !userId) return;
      setCallType(type);
      setCallState("calling");
      targetUserRef.current = receiverId;
      toneGen.startRinging();

      try {
        const uRes = await fetch(`/api/users/${receiverId}`);
        if (uRes.ok) {
          const uData = await uRes.json();
          setPeerInfo({
            id: receiverId,
            name: uData.user.name,
            photoUrl: uData.user.photoUrl,
          });
        } else {
          setPeerInfo({ id: receiverId, name: "User", photoUrl: null });
        }
      } catch {
        setPeerInfo({ id: receiverId, name: "User", photoUrl: null });
      }

      try {
        if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === "video" ? { facingMode: "user" } : false,
        });
        localStreamRef.current = stream;
        setLocalStream(stream);

        const pc = await createPeerConnection(receiverId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        socketRef.current.emit("call:initiate", {
          callerId: userId,
          receiverId,
          callType: type,
        });
      } catch (err) {
        console.error("Microphone/Camera permission error:", err);
        cleanupCall();
      }
    },
    [userId, createPeerConnection, cleanupCall]
  );

  const acceptCall = useCallback(async () => {
    if (!socketRef.current || !targetUserRef.current || !userId) return;
    toneGen.stop();
    setCallState("connecting");

    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === "video" ? { facingMode: "user" } : false,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = await createPeerConnection(targetUserRef.current);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      socketRef.current.emit("call:accept", {
        callId: callIdRef.current,
        callerId: targetUserRef.current,
        receiverId: userId,
      });
    } catch (err) {
      console.error("Failed to accept call:", err);
      cleanupCall();
    }
  }, [userId, callType, createPeerConnection, cleanupCall]);

  const rejectCall = useCallback(() => {
    if (!socketRef.current || !targetUserRef.current || !userId) return;
    socketRef.current.emit("call:reject", {
      callId: callIdRef.current,
      callerId: targetUserRef.current,
      receiverId: userId,
    });
    cleanupCall();
  }, [userId, cleanupCall]);

  const endCall = useCallback(() => {
    if (!socketRef.current || !targetUserRef.current) return;
    socketRef.current.emit("call:end", { targetUserId: targetUserRef.current });
    cleanupCall();
  }, [cleanupCall]);

  const toggleMic = useCallback(() => {
    if (localStreamRef.current) {
      const state = !micEnabled;
      localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = state));
      setMicEnabled(state);
    }
  }, [micEnabled]);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const state = !videoEnabled;
      localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = state));
      setVideoEnabled(state);
    }
  }, [videoEnabled]);

  const toggleSpeaker = useCallback(() => {
    setSpeakerOn((prev) => !prev);
  }, []);

  const switchCamera = useCallback(async () => {
    if (!localStreamRef.current || callType !== "video") return;
    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;

    const newFacing = facingMode === "user" ? "environment" : "user";
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
      const freshStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing },
      });
      const newTrack = freshStream.getVideoTracks()[0];

      if (pcRef.current) {
        const sender = pcRef.current.getSenders().find((s) => s.track?.kind === "video");
        if (sender) await sender.replaceTrack(newTrack);
      }

      videoTrack.stop();
      localStreamRef.current.removeTrack(videoTrack);
      localStreamRef.current.addTrack(newTrack);

      setFacingMode(newFacing);
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
    } catch (e) {
      console.error("Camera switch failed", e);
    }
  }, [facingMode, callType]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStartCall = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        targetUserId: string;
        type: CallType;
      };
      if (detail && detail.targetUserId) {
        void startCall(detail.targetUserId, detail.type || "audio");
      }
    };
    window.addEventListener("fc:start-call", handleStartCall);
    return () => window.removeEventListener("fc:start-call", handleStartCall);
  }, [startCall]);

  const sendMessage = useCallback((msg: Omit<ChatMessage, "id" | "timestamp">) => {
    if (!socketRef.current) return;
    socketRef.current.emit("chat:message", msg);
  }, []);

  const sendTyping = useCallback((receiverId: string, isTyping: boolean) => {
    if (!socketRef.current || !userId) return;
    socketRef.current.emit("chat:typing", { senderId: userId, receiverId, isTyping });
  }, [userId]);

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        onlineUsers,
        messages,
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
        sendMessage,
        sendTyping,
        startCall,
        acceptCall,
        rejectCall,
        endCall,
        toggleMic,
        toggleVideo,
        toggleSpeaker,
        switchCamera,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocket must be used within a SocketProvider");
  }
  return context;
}
