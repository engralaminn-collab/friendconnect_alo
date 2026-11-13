"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Download, X, Smartphone } from "lucide-react"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const DISMISS_KEY = "fc-pwa-install-dismissed"
const DISMISS_TTL = 1000 * 60 * 60 * 24 * 7 // 7 days

export function PWAInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Don't show if already installed (standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches) return
    // iOS doesn't fire beforeinstallprompt — handle separately below
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
    if (isIOS) {
      // iOS users install via Share → Add to Home Screen.
      const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0)
      const shouldShow = Date.now() - dismissedAt > DISMISS_TTL
      // defer the setVisible to avoid setState-in-effect lint
      if (shouldShow) queueMicrotask(() => setVisible(true))
      return
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0)
      if (Date.now() - dismissedAt > DISMISS_TTL) {
        setVisible(true)
      }
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall)
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall)
  }, [])

  async function handleInstall() {
    if (deferred) {
      await deferred.prompt()
      const choice = await deferred.userChoice
      if (choice.outcome === "accepted") {
        setVisible(false)
      }
      setDeferred(null)
    } else {
      // iOS: can't programmatically install — close the hint
      setVisible(false)
    }
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  }

  function handleDismiss() {
    setVisible(false)
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  }

  if (!visible) return null

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4">
      <Card className="shadow-xl border-emerald-500/30">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">Install FriendConnect</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {isIOS
                ? "Tap Share → Add to Home Screen to install as a standalone app."
                : "Install as a standalone app for faster access and offline use."}
            </div>
            <div className="flex gap-2 mt-2">
              {!isIOS && (
                <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white" onClick={handleInstall}>
                  <Download className="w-3.5 h-3.5 mr-1" /> Install
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={handleDismiss}>
                Not now
              </Button>
            </div>
          </div>
          <button onClick={handleDismiss} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </CardContent>
      </Card>
    </div>
  )
}
