"use client";

import React, { useEffect, useRef } from "react";
import { useSocket } from "@/hooks/use-socket";
import { cn } from "@/lib/utils";
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  FlipHorizontal,
} from "lucide-react";

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function CallOverlay() {
  const {
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
  } = useSocket();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, callState]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, callState]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.muted = !speakerOn;
    if (remoteAudioRef.current) remoteAudioRef.current.muted = !speakerOn;
  }, [speakerOn]);

  if (callState === "idle" || !peerInfo) return null;

  const isVideo = callType === "video";
  const isRinging =
    callState === "calling" ||
    callState === "ringing" ||
    callState === "connecting";
  const isConnected = callState === "connected";
  const showRemoteVideo = isVideo && isConnected;
  const showLocalPiP = isVideo && videoEnabled && callState !== "ringing";

  const statusLabel = (() => {
    if (callState === "calling") return "Calling…";
    if (callState === "ringing") return "Incoming call";
    if (callState === "connecting") return "Connecting…";
    if (callState === "connected") return formatDuration(elapsed);
    return "";
  })();

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
    >
      {/* Background overlay */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/30 via-black to-black transition-opacity duration-500",
          showRemoteVideo ? "opacity-0" : "opacity-100"
        )}
      />

      {/* Audio element for crystal clear sound playback */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Main Remote Video */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className={cn(
          "absolute inset-0 h-full w-full bg-black object-cover transition-opacity duration-500",
          showRemoteVideo ? "opacity-100" : "opacity-0"
        )}
      />

      {/* Local Video PiP */}
      <video
        ref={localVideoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          "absolute right-4 top-20 z-10 h-40 w-28 rounded-2xl border-2 border-white/30 bg-black object-cover shadow-2xl transition-opacity duration-300",
          showLocalPiP ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      {/* Top Header */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-2 rounded-full bg-black/30 px-3 py-1 backdrop-blur">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isConnected
                ? "bg-emerald-400"
                : "bg-amber-400 animate-pulse"
            )}
          />
          <span className="text-xs font-medium text-white/90">
            {statusLabel}
          </span>
        </div>
        {isVideo && (
          <div className="rounded-full bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-wide text-white/70 backdrop-blur">
            {facingMode === "user" ? "Front" : "Back"}
          </div>
        )}
      </div>

      {/* Center Avatar & Info */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        {(isRinging || !isVideo) && (
          <div className="relative grid place-items-center">
            {isRinging && (
              <>
                <span className="absolute h-40 w-40 animate-ping rounded-full bg-primary/40" />
                <span
                  className="absolute h-40 w-40 animate-ping rounded-full bg-primary/20"
                  style={{ animationDelay: "0.5s" }}
                />
              </>
            )}
            <div className="relative">
              {peerInfo.photoUrl ? (
                <img
                  src={peerInfo.photoUrl}
                  alt={peerInfo.name}
                  className="h-32 w-32 rounded-full object-cover ring-4 ring-white/20"
                />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded-full bg-zinc-800 text-3xl font-bold ring-4 ring-white/20">
                  {peerInfo.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="text-2xl font-bold drop-shadow-md">
            {peerInfo.name}
          </div>
          <div className="text-sm text-white/70">
            {callState === "calling" &&
              (isVideo ? "Video calling…" : "Calling…")}
            {callState === "ringing" &&
              (isVideo ? "Incoming video call" : "Incoming audio call")}
            {callState === "connecting" && "Connecting…"}
            {callState === "connected" && formatDuration(elapsed)}
          </div>
          <div className="text-[11px] text-white/50">Private call · crystal-clear audio</div>
        </div>
      </div>

      {/* Call Actions */}
      <div className="relative z-10 flex flex-col items-center gap-4 px-6 pb-8 pt-6">
        {callState === "ringing" ? (
          <div className="flex items-center gap-12">
            <button
              onClick={rejectCall}
              className="grid h-16 w-16 place-items-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/30 transition hover:bg-red-500 active:scale-95"
              aria-label="Decline"
            >
              <PhoneOff size={28} />
            </button>
            <button
              onClick={acceptCall}
              className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 active:scale-95"
              aria-label="Accept"
            >
              {isVideo ? <Video size={28} /> : <Phone size={28} />}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={toggleMic}
              className={cn(
                "grid h-14 w-14 place-items-center rounded-full bg-white/15 backdrop-blur transition hover:bg-white/25 active:scale-95",
                !micEnabled && "bg-red-600/90 hover:bg-red-500"
              )}
            >
              {micEnabled ? <Mic size={22} /> : <MicOff size={22} />}
            </button>
            {isVideo && (
              <button
                onClick={toggleVideo}
                className={cn(
                  "grid h-14 w-14 place-items-center rounded-full bg-white/15 backdrop-blur transition hover:bg-white/25 active:scale-95",
                  !videoEnabled && "bg-red-600/90 hover:bg-red-500"
                )}
              >
                {videoEnabled ? <Video size={22} /> : <VideoOff size={22} />}
              </button>
            )}
            {isVideo && (
              <button
                onClick={switchCamera}
                className="grid h-14 w-14 place-items-center rounded-full bg-white/15 backdrop-blur transition hover:bg-white/25 active:scale-95"
              >
                <FlipHorizontal size={22} />
              </button>
            )}
            <button
              onClick={toggleSpeaker}
              className={cn(
                "grid h-14 w-14 place-items-center rounded-full bg-white/15 backdrop-blur transition hover:bg-white/25 active:scale-95",
                !speakerOn && "bg-white/5"
              )}
            >
              {speakerOn ? <Volume2 size={22} /> : <VolumeX size={22} />}
            </button>
            <button
              onClick={endCall}
              className="grid h-14 w-14 place-items-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/30 transition hover:bg-red-500 active:scale-95"
            >
              <PhoneOff size={24} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
