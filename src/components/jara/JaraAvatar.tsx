"use client"

import { useEffect, useRef, useState } from "react"

export type JaraMood = "idle" | "listening" | "speaking" | "thinking"

interface JaraAvatarProps {
  face?: string
  background?: string
  theme?: string
  mood?: JaraMood
  speakingLevel?: number // 0..1 for lip-sync
  size?: number
  colors?: { primary: string; accent: string; background?: string } | null
  clothing?: string | null
}

const FACE_STYLES: Record<string, { emoji: string; label: string }> = {
  friendly: { emoji: "😊", label: "Friendly" },
  realistic: { emoji: "🧑", label: "Realistic" },
  illustrated: { emoji: "🎨", label: "Illustrated" },
  anime: { emoji: "✨", label: "Anime" },
  professional: { emoji: "👩‍💼", label: "Professional" },
  casual: { emoji: "😄", label: "Casual" },
  "3d": { emoji: "🤖", label: "3D Avatar" },
  "2d": { emoji: "🙂", label: "2D Avatar" },
}

const BACKGROUNDS: Record<string, string> = {
  "gradient-emerald": "from-emerald-400 via-teal-500 to-cyan-600",
  "gradient-blue": "from-blue-500 via-indigo-500 to-violet-600",
  "gradient-purple": "from-violet-500 via-purple-600 to-fuchsia-600",
  "futuristic": "from-slate-900 via-indigo-900 to-violet-900",
  "beautiful-futuristic": "from-slate-900 via-indigo-900 to-violet-900",
  "blue-futuristic": "from-blue-900 via-cyan-800 to-indigo-900",
  "dark-futuristic": "from-zinc-900 via-slate-900 to-black",
  "nature": "from-green-600 via-emerald-700 to-teal-800",
  "city": "from-slate-700 via-zinc-800 to-slate-900",
  "space": "from-black via-indigo-950 to-violet-950",
  "ocean": "from-sky-600 via-blue-700 to-indigo-800",
  "sunset": "from-orange-400 via-pink-500 to-violet-600",
  "forest": "from-green-800 via-emerald-900 to-teal-900",
  "minimal": "from-zinc-100 via-white to-zinc-50",
  "alo-office": "from-slate-100 via-sky-100 to-emerald-100",
  "outdoor": "from-sky-400 via-emerald-300 to-lime-200",
  "studio": "from-zinc-200 via-slate-100 to-white",
}

export function JaraAvatar({ face = "friendly", background = "gradient-emerald", theme = "light", mood = "idle", speakingLevel = 0, size = 160, colors, clothing = null }: JaraAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [blinkPhase, setBlinkPhase] = useState(0)
  const animRef = useRef<number>(0)
  const moodRef = useRef(mood)
  const levelRef = useRef(speakingLevel)

  useEffect(() => { moodRef.current = mood }, [mood])
  useEffect(() => { levelRef.current = speakingLevel }, [speakingLevel])

  // Blinking
  useEffect(() => {
    const blink = () => {
      setBlinkPhase(1)
      setTimeout(() => setBlinkPhase(0), 120)
      const next = 2000 + Math.random() * 3000
      setTimeout(blink, next)
    }
    const t = setTimeout(blink, 2000 + Math.random() * 2000)
    return () => clearTimeout(t)
  }, [])

  // Canvas draw loop for talking-head effect
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let frame = 0
    const draw = () => {
      frame += 1
      animRef.current = requestAnimationFrame(draw)
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      // Background blobs for depth
      const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.8)
      const primary = colors?.primary || "#10b981"
      const accent = colors?.accent || "#06b6d4"
      if (theme === "dark" || background.includes("futuristic") || background.includes("space") || background === "dark-futuristic") {
        bgGrad.addColorStop(0, accent + "30")
        bgGrad.addColorStop(0.5, primary + "18")
        bgGrad.addColorStop(1, "#00000000")
      } else {
        bgGrad.addColorStop(0, primary + "22")
        bgGrad.addColorStop(1, accent + "12")
      }
      ctx.fillStyle = bgGrad
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, w * 0.45, 0, Math.PI * 2)
      ctx.fill()

      // Head base (ellipse with subtle shadow)
      const cx = w / 2
      const cy = h / 2 + 6
      const headW = w * 0.54
      const headH = h * 0.62

      ctx.shadowColor = "rgba(0,0,0,0.15)"
      ctx.shadowBlur = 20
      ctx.shadowOffsetY = 8

      const skinGrad = ctx.createRadialGradient(cx, cy - headH * 0.15, headW * 0.2, cx, cy, headW * 0.7)
      if (face === "realistic") {
        skinGrad.addColorStop(0, "#fde68a")
        skinGrad.addColorStop(0.5, "#fbbf6a")
        skinGrad.addColorStop(1, "#d97706")
      } else if (face === "anime") {
        skinGrad.addColorStop(0, "#fef3c7")
        skinGrad.addColorStop(1, "#fcd34d")
      } else {
        skinGrad.addColorStop(0, "#fff7ed")
        skinGrad.addColorStop(1, "#fed7aa")
      }
      ctx.fillStyle = skinGrad
      ctx.beginPath()
      ctx.ellipse(cx, cy, headW / 2, headH / 2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowColor = "transparent"

      // Hair / top accent depending on face
      ctx.fillStyle = face === "professional" ? "#1e293b" : face === "anime" ? "#f472b6" : "#0f172a"
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.ellipse(cx, cy - headH * 0.28, headW * 0.52, headH * 0.22, 0, Math.PI, Math.PI * 2)
      ctx.fill()
      // hair shine
      ctx.fillStyle = "rgba(255,255,255,0.35)"
      ctx.beginPath()
      ctx.ellipse(cx - headW * 0.12, cy - headH * 0.32, headW * 0.12, headH * 0.06, -0.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1

      // Eyes
      const eyeY = cy - headH * 0.05
      const eyeGap = headW * 0.18
      const eyeW = headW * 0.14
      const eyeH = blinkPhase > 0.5 ? headW * 0.012 : headH * 0.09 * (1 - blinkPhase * 0.8)

      // Eye white
      ctx.fillStyle = "#ffffff"
      for (const dir of [-1, 1]) {
        ctx.beginPath()
        ctx.ellipse(cx + dir * eyeGap, eyeY, eyeW / 2, eyeH / 2, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = "rgba(0,0,0,0.12)"
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // Iris
      if (blinkPhase < 0.9) {
        const irisShift = Math.sin(frame * 0.03) * 1.2
        for (const dir of [-1, 1]) {
          const ix = cx + dir * eyeGap + irisShift
          const iy = eyeY
          // iris
          const irisGrad = ctx.createRadialGradient(ix, iy, 0, ix, iy, eyeW * 0.38)
          irisGrad.addColorStop(0, "#1e40af")
          irisGrad.addColorStop(0.6, "#1e3a8a")
          irisGrad.addColorStop(1, "#0f172a")
          ctx.fillStyle = irisGrad
          ctx.beginPath()
          ctx.arc(ix, iy, eyeW * 0.24, 0, Math.PI * 2)
          ctx.fill()
          // pupil
          ctx.fillStyle = "#020617"
          ctx.beginPath()
          ctx.arc(ix, iy, eyeW * 0.13, 0, Math.PI * 2)
          ctx.fill()
          // highlight
          ctx.fillStyle = "rgba(255,255,255,0.95)"
          ctx.beginPath()
          ctx.arc(ix - eyeW * 0.06, iy - eyeW * 0.06, eyeW * 0.06, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Nose subtle
      ctx.fillStyle = "rgba(0,0,0,0.08)"
      ctx.beginPath()
      ctx.ellipse(cx, cy + headH * 0.06, 3, 5, 0, 0, Math.PI * 2)
      ctx.fill()

      // Mouth (animated by speakingLevel + mood)
      const mouthY = cy + headH * 0.18
      const baseW = headW * 0.16
      const lvl = levelRef.current
      const md = moodRef.current
      let mouthOpen = 0
      if (md === "speaking") {
        // lip-sync: oscillation with level
        mouthOpen = 0.18 + lvl * 0.9 + Math.sin(frame * 0.45) * lvl * 0.18
        mouthOpen = Math.min(1, mouthOpen)
      } else if (md === "listening") {
        mouthOpen = 0.04
      } else if (md === "thinking") {
        mouthOpen = 0.02
      } else {
        mouthOpen = 0.02 + Math.sin(frame * 0.02) * 0.015
      }

      // Mouth outer
      ctx.fillStyle = md === "speaking" ? "#7c2d12" : "#9f1239"
      ctx.beginPath()
      if (mouthOpen > 0.08) {
        ctx.ellipse(cx, mouthY, baseW * (0.7 + mouthOpen * 0.5), headH * 0.04 + mouthOpen * headH * 0.08, 0, 0, Math.PI * 2)
      } else {
        // closed smile
        ctx.moveTo(cx - baseW * 0.7, mouthY)
        ctx.quadraticCurveTo(cx, mouthY + 6, cx + baseW * 0.7, mouthY)
        ctx.quadraticCurveTo(cx, mouthY + 10, cx - baseW * 0.7, mouthY)
      }
      ctx.fill()

      // Inner mouth when open
      if (mouthOpen > 0.15) {
        ctx.fillStyle = "#450a0a"
        ctx.beginPath()
        ctx.ellipse(cx, mouthY + 2, baseW * 0.45 * mouthOpen + 2, headH * 0.03 * mouthOpen + 1, 0, 0, Math.PI * 2)
        ctx.fill()
        // teeth
        if (mouthOpen > 0.3) {
          ctx.fillStyle = "rgba(255,255,255,0.95)"
          ctx.fillRect(cx - baseW * 0.25, mouthY - 1, baseW * 0.5, 2.5)
        }
      }

      // Cheek blush
      ctx.fillStyle = "rgba(244,114,182,0.22)"
      for (const dir of [-1, 1]) {
        ctx.beginPath()
        ctx.ellipse(cx + dir * headW * 0.28, cy + headH * 0.10, headW * 0.08, headH * 0.05, 0, 0, Math.PI * 2)
        ctx.fill()
      }

      // Clothing (simple visual indicator)
      const clothingStr = typeof clothing === 'string' ? clothing : ''
      let clothingType = ''
      try { clothingType = clothingStr.startsWith('{') ? JSON.parse(clothingStr).type || '' : clothingStr } catch { clothingType = clothingStr }
      if (clothingType) {
        const isFormal = /formal|business|suit|professional/.test(clothingType)
        const isCasual = /casual/.test(clothingType)
        const isTraditional = /traditional/.test(clothingType)
        ctx.fillStyle = isFormal ? '#1e293b' : isCasual ? '#0f766e' : isTraditional ? '#7c3aed' : '#334155'
        ctx.beginPath()
        ctx.moveTo(cx - headW * 0.62, h)
        ctx.quadraticCurveTo(cx - headW * 0.35, cy + headH * 0.42, cx, cy + headH * 0.38)
        ctx.quadraticCurveTo(cx + headW * 0.35, cy + headH * 0.42, cx + headW * 0.62, h)
        ctx.closePath()
        ctx.fill()
        if (isFormal) {
          ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 2
          ctx.beginPath(); ctx.moveTo(cx, cy + headH * 0.38); ctx.lineTo(cx - headW * 0.12, h); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(cx, cy + headH * 0.38); ctx.lineTo(cx + headW * 0.12, h); ctx.stroke()
          ctx.fillStyle = '#dc2626'; ctx.beginPath(); ctx.moveTo(cx, cy + headH * 0.42); ctx.lineTo(cx - 4, cy + headH * 0.52); ctx.lineTo(cx, cy + headH * 0.58); ctx.lineTo(cx + 4, cy + headH * 0.52); ctx.closePath(); ctx.fill()
        }
      }

      // Mood indicator halo
      if (md === "speaking") {
        ctx.strokeStyle = `rgba(16,185,129,${0.35 + lvl * 0.35})`
        ctx.lineWidth = 2 + lvl * 6
        ctx.beginPath()
        ctx.arc(cx, cy, headW * 0.58 + lvl * 10, -0.4, 0.4)
        ctx.stroke()
      } else if (md === "listening") {
        ctx.fillStyle = "rgba(16,185,129,0.9)"
        ctx.beginPath()
        ctx.arc(w - 18, 18, 6, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = "white"
        ctx.font = "8px sans-serif"
        ctx.fillText("●", w - 21, 21)
      } else if (md === "thinking") {
        // three dots pulse
        for (let i = 0; i < 3; i++) {
          const a = (frame * 0.08 + i * 0.9) % (Math.PI * 2)
          const alpha = 0.4 + Math.sin(a) * 0.4 + 0.4
          ctx.fillStyle = `rgba(99,102,241,${alpha})`
          ctx.beginPath()
          ctx.arc(cx + (i - 1) * 10, cy - headH * 0.42, 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Idle subtle breathing
      if (md === "idle") {
        const breathe = Math.sin(frame * 0.02) * 1.2
        // not drawing explicit body but head slightly bobs
        // handled via transform in next frame
      }
    }
    draw()
    return () => cancelAnimationFrame(animRef.current)
  }, [face, background, theme, colors, blinkPhase, clothing])

  const bgClass = BACKGROUNDS[background] || BACKGROUNDS["gradient-emerald"]
  const faceInfo = FACE_STYLES[face] || FACE_STYLES.friendly

  return (
    <div
      className={`relative rounded-[2rem] overflow-hidden flex items-center justify-center bg-gradient-to-br ${bgClass} ${theme === "dark" ? "brightness-90" : ""} shadow-xl`}
      style={{ width: size, height: size }}
    >
      {/* Decorative orbs */}
      <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute -bottom-8 -left-8 w-28 h-28 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[78%] h-[78%] rounded-full bg-white/8 blur-[1px] pointer-events-none" />

      <canvas
        ref={canvasRef}
        width={size * 2}
        height={size * 2}
        style={{ width: size, height: size }}
        className="relative z-10"
      />

      {/* Face badge */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur text-white text-[10px] font-medium flex items-center gap-1.5 border border-white/10">
        <span>{faceInfo.emoji}</span>
        <span>{faceInfo.label}</span>
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      </div>

      {/* AI badge */}
      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-white/90 text-zinc-900 text-[10px] font-semibold shadow-sm border border-zinc-200 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" /> AI
      </div>
    </div>
  )
}

export function JaraAvatarPreview({ config, mood, speakingLevel }: { config: any; mood?: JaraMood; speakingLevel?: number }) {
  if (!config) return null
  let colors = null
  try { colors = config.colors ? JSON.parse(typeof config.colors === "string" ? config.colors : JSON.stringify(config.colors)) : null } catch {}
  return (
    <JaraAvatar
      face={config.face}
      background={config.background}
      theme={config.theme}
      mood={mood || "idle"}
      speakingLevel={speakingLevel || 0}
      colors={colors}
      size={220}
    />
  )
}
