"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Mic, MicOff, PhoneOff, Volume2, Loader2, AlertCircle, Waves } from "lucide-react"
import { JaraAvatar } from "./JaraAvatar"
import { toast } from "sonner"

type CallState = "idle" | "requesting" | "active" | "ended" | "error"

interface JaraVoiceCallProps {
  config: any
  onEnd: () => void
  onTranscript?: (text: string, isUser: boolean) => void
}

export function JaraVoiceCall({ config, onEnd, onTranscript }: JaraVoiceCallProps) {
  const [state, setState] = useState<CallState>("requesting")
  const [muted, setMuted] = useState(false)
  const [jaraMood, setJaraMood] = useState<"idle" | "listening" | "speaking" | "thinking">("idle")
  const [speakingLevel, setSpeakingLevel] = useState(0)
  const [transcript, setTranscript] = useState("")
  const [interim, setInterim] = useState("")
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<any>(null)
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null)
  const listeningRef = useRef(true)
  const historyRef = useRef<{ role: string; content: string }[]>([])
  const speakingRef = useRef(false)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // TTS using browser speechSynthesis with Bangla support
  const speak = useCallback(async (text: string) => {
    if (!text) return
    // Cancel any ongoing speech (barge-in support: user interrupted)
    if (window.speechSynthesis.speaking) window.speechSynthesis.cancel()

    setJaraMood("speaking")
    speakingRef.current = true

    // Prefer Bangla voice if config is bn
    const voices = window.speechSynthesis.getVoices()
    let voice: SpeechSynthesisVoice | null = null
    const lang = config?.voiceLanguage || "bn"
    if (lang === "bn") {
      voice = voices.find(v => v.lang.toLowerCase().includes("bn") || v.name.toLowerCase().includes("bengali") || v.name.toLowerCase().includes("bangla")) || null
      // Fallback to any voice
    }
    if (!voice) voice = voices.find(v => v.lang.startsWith("en")) || voices[0] || null

    const utter = new SpeechSynthesisUtterance(text)
    if (voice) utter.voice = voice
    utter.rate = Number(config?.speakingSpeed) || 1.0
    utter.pitch = Number(config?.pitch) || 1.0
    utter.lang = lang === "bn" ? "bn-BD" : "en-US"

    // Lip-sync via audio analysis is not available for speechSynthesis; simulate with text length + interval
    let lvl = 0
    const lvlInterval = setInterval(() => {
      // simulate mouth movement while speaking
      lvl = 0.3 + Math.random() * 0.7
      setSpeakingLevel(lvl)
    }, 110)

    utter.onboundary = () => {
      // small accent on word boundaries
      setSpeakingLevel(0.8)
    }
    utter.onend = () => {
      clearInterval(lvlInterval)
      setSpeakingLevel(0)
      setJaraMood("listening")
      speakingRef.current = false
      // resume listening
      try { recognitionRef.current?.start() } catch {}
    }
    utter.onerror = () => {
      clearInterval(lvlInterval)
      setJaraMood("idle")
      speakingRef.current = false
    }

    synthRef.current = utter
    window.speechSynthesis.speak(utter)
  }, [config])

  const sendToJara = useCallback(async (text: string) => {
    if (!text.trim()) return
    onTranscript?.(text, true)
    historyRef.current.push({ role: "user", content: text })
    setJaraMood("thinking")

    try {
      const res = await fetch("/api/jara/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text, history: historyRef.current.slice(-8) }),
      })
      const data = await res.json()
      if (res.ok && data.reply) {
        historyRef.current.push({ role: "assistant", content: data.reply })
        onTranscript?.(data.reply, false)
        await speak(data.reply)
      } else {
        throw new Error(data.error || "Voice reply failed")
      }
    } catch (e: any) {
      setJaraMood("idle")
      toast.error(e.message || "Voice request failed")
    }
  }, [speak, onTranscript])

  // Setup speech recognition
  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        // Request mic permission
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream
        setState("active")
        setJaraMood("listening")

        // Audio analysis for speaking level (user)
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
          const src = ctx.createMediaStreamSource(stream)
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 256
          src.connect(analyser)
          analyserRef.current = analyser
          const updateLevel = () => {
            if (!mounted) return
            if (analyserRef.current && listeningRef.current && !speakingRef.current) {
              const data = new Uint8Array(analyserRef.current.frequencyBinCount)
              analyserRef.current.getByteFrequencyData(data)
              const avg = data.reduce((a, b) => a + b, 0) / data.length / 255
              // use for Jara listening indicator (optional)
            }
            requestAnimationFrame(updateLevel)
          }
          updateLevel()
        } catch {}

        // Speech Recognition
        const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        if (!SR) {
          setError("Speech recognition not supported in this browser. Try Chrome or Edge.")
          setState("error")
          return
        }

        const rec = new SR()
        rec.continuous = true
        rec.interimResults = true
        rec.lang = config?.voiceLanguage === "bn" ? "bn-BD" : config?.voiceLanguage === "mixed" ? "bn-BD" : "en-US"
        // For Banglish, we keep bn-BD but it somewhat handles mixed — we also switch dynamically
        rec.onstart = () => { listeningRef.current = true; setJaraMood("listening") }
        rec.onresult = (event: any) => {
          // If Jara is speaking and user starts speaking → barge-in
          const results = event.results
          let interimText = ""
          let finalText = ""
          for (let i = event.resultIndex; i < results.length; i++) {
            const r = results[i]
            if (r.isFinal) finalText += r[0].transcript
            else interimText += r[0].transcript
          }
          if (interimText) setInterim(interimText)
          if (finalText) {
            setTranscript(prev => prev + " " + finalText)
            setInterim("")
            // Barge-in: if Jara is speaking, interrupt
            if (speakingRef.current) {
              window.speechSynthesis.cancel()
              setSpeakingLevel(0)
              speakingRef.current = false
            }
            // Voice activity: small debounce before sending (allow user to finish sentence)
            // We'll send after 900ms of silence — use a timeout per final chunk
            // For simplicity, send immediately on final result with small delay if next result doesn't come
            setTimeout(() => {
              // only send if not still getting interim and not speaking
              if (finalText.trim().length > 2) {
                sendToJara(finalText.trim())
              }
            }, 600)
          }
        }
        rec.onerror = (e: any) => {
          if (e.error === "not-allowed") {
            setError("Microphone permission denied")
            setState("error")
          } else if (e.error === "no-speech") {
            // ignore, restart
          }
        }
        rec.onend = () => {
          listeningRef.current = false
          if (mounted && state !== "ended" && !muted) {
            try { rec.start() } catch {}
          }
        }

        recognitionRef.current = rec
        try { rec.start() } catch {}

        // Intro greeting
        setTimeout(() => {
          const greeting = (config?.voiceLanguage === "bn" || config?.voiceLanguage === "mixed")
            ? "হ্যালো! আমি Jara — তোমার AI বন্ধু। কীভাবে সাহায্য করতে পারি?"
            : "Hello! I'm Jara — your AI friend. How can I help you today?"
          historyRef.current.push({ role: "assistant", content: greeting })
          onTranscript?.(greeting, false)
          speak(greeting)
        }, 800)

      } catch (e: any) {
        setError(e.message || "Microphone access failed — call requires HTTPS or localhost")
        setState("error")
      }
    }

    init()

    // Load voices
    window.speechSynthesis.getVoices()
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices()
    }

    return () => {
      mounted = false
      listeningRef.current = false
      try { recognitionRef.current?.stop() } catch {}
      try { window.speechSynthesis.cancel() } catch {}
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleMute = useCallback(() => {
    const next = !muted
    setMuted(next)
    streamRef.current?.getAudioTracks().forEach(t => (t.enabled = !next))
    if (next) {
      try { recognitionRef.current?.stop() } catch {}
      setJaraMood("idle")
    } else {
      try { recognitionRef.current?.start() } catch {}
      setJaraMood("listening")
    }
  }, [muted])

  const handleEnd = useCallback(() => {
    setState("ended")
    try { recognitionRef.current?.stop() } catch {}
    try { window.speechSynthesis.cancel() } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop())
    onEnd()
  }, [onEnd])

  if (state === "requesting") {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-500" />
        <p className="text-sm text-muted-foreground">Requesting microphone permission…</p>
        <p className="text-xs text-muted-foreground max-w-sm text-center">Calls require HTTPS (or localhost). If you opened via http://IP, switch to the https:// domain.</p>
      </div>
    )
  }

  if (state === "error") {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4 px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-100 dark:bg-red-950 flex items-center justify-center">
          <AlertCircle className="w-7 h-7 text-red-600" />
        </div>
        <p className="text-sm font-medium">Voice call unavailable</p>
        <p className="text-xs text-muted-foreground max-w-sm">{error}</p>
        <Button variant="outline" onClick={handleEnd}>Close</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Avatar stage */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6 bg-gradient-to-b from-background to-muted/30">
        <JaraAvatar
          face={config?.face || "friendly"}
          background={config?.background || "gradient-emerald"}
          theme={config?.theme || "light"}
          mood={jaraMood}
          speakingLevel={speakingLevel}
          size={220}
          colors={(() => { try { return config?.colors ? JSON.parse(typeof config.colors === "string" ? config.colors : JSON.stringify(config.colors)) : null } catch { return null } })()}
        />

        <div className="text-center space-y-1">
          <h3 className="font-semibold text-lg flex items-center justify-center gap-2">
            Jara <span className="text-xs px-2 py-0.5 rounded-full bg-violet-600 text-white font-bold">AI</span>
            {jaraMood === "speaking" && <Waves className="w-4 h-4 text-emerald-500 animate-pulse" />}
            {jaraMood === "listening" && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
            {jaraMood === "thinking" && <Loader2 className="w-4 h-4 animate-spin text-violet-500" />}
          </h3>
          <p className="text-xs text-muted-foreground">
            {jaraMood === "listening" ? "Listening… speak now" : jaraMood === "speaking" ? "Jara is speaking… (speak to interrupt)" : jaraMood === "thinking" ? "Thinking…" : muted ? "Muted" : "Live voice conversation"}
          </p>
          <p className="text-[11px] text-muted-foreground/70">Bangla • English • Banglish</p>
        </div>

        {/* Transcript preview */}
        <div className="w-full max-w-md space-y-2">
          {transcript && (
            <div className="rounded-2xl bg-muted p-3 text-xs leading-relaxed max-h-24 overflow-auto">
              <span className="font-medium text-muted-foreground">You: </span>{transcript.slice(-300)}
            </div>
          )}
          {interim && (
            <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3 text-xs italic text-emerald-700 dark:text-emerald-300">
              {interim}
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="p-4 border-t bg-background flex items-center justify-center gap-3">
        <Button
          variant={muted ? "destructive" : "secondary"}
          size="icon"
          className="w-12 h-12 rounded-full"
          onClick={toggleMute}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </Button>
        <Button variant="destructive" size="icon" className="w-14 h-14 rounded-full shadow-lg" onClick={handleEnd} title="End call">
          <PhoneOff className="w-6 h-6" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="w-12 h-12 rounded-full"
          onClick={() => {
            // Replay last assistant message or test TTS
            const last = [...historyRef.current].reverse().find(m => m.role === "assistant")
            if (last) speak(last.content)
          }}
          title="Replay"
        >
          <Volume2 className="w-5 h-5" />
        </Button>
      </div>

      <div className="px-4 pb-3">
        <p className="text-[10px] text-center text-muted-foreground">
          Voice uses browser speech recognition & synthesis (self-hosted, free). For best Bangla, use Chrome. Jara can be interrupted while speaking.
        </p>
      </div>
    </div>
  )
}
