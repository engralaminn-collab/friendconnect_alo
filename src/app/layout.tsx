import type { Metadata } from "next"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { Providers } from "@/components/providers"
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt"

// Offline-safe: self-contained font variables (Geist unavailable offline)
const geistSans = { variable: "--font-geist-sans" } as any
const geistMono = { variable: "--font-geist-mono" } as any

export const metadata: Metadata = {
  title: "FriendConnect — Personal messaging",
  description: "Private personal messaging, voice & video calls. Install as a standalone app.",
  keywords: ["chat", "messaging", "calls", "voice", "video", "friendconnect", "self-hosted"],
  authors: [{ name: "FriendConnect" }],
  manifest: "/manifest.json",
  applicationName: "FriendConnect",
  appleWebApp: { capable: true, title: "FriendConnect", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/friendconnect-icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/friendconnect-icon.svg" }],
    shortcut: ["/friendconnect-icon.svg"],
  },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        <Providers>
          {children}
          <Toaster />
          <SonnerToaster richColors position="top-center" />
          <PWAInstallPrompt />
        </Providers>
      </body>
    </html>
  )
}
