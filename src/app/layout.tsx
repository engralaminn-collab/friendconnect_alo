import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { Providers } from "@/components/providers"
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

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
