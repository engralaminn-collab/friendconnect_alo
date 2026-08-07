'use client'

import { useAuth } from '@/hooks/use-auth'
import { useApp } from '@/lib/store'
import { api } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useTheme } from 'next-themes'
import { Moon, Sun, Monitor, Bell, Shield, HelpCircle, LogOut, Globe, Volume2, Vibrate, Trash2, Download, Info, Github, Heart } from 'lucide-react'
import { toast } from 'sonner'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export function SettingsView() {
  const { user, logout } = useAuth()
  const { setView } = useApp()
  const { theme, setTheme } = useTheme()
  const [notifSound, setNotifSound] = useState(true)
  const [notifVibrate, setNotifVibrate] = useState(true)
  const [readReceipts, setReadReceipts] = useState(true)

  return (
    <div className="fc-scroll h-full overflow-y-auto pb-6">
      <div className="border-b border-border px-4 py-3">
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      {/* Appearance */}
      <Section title="Appearance">
        <Card className="divide-y divide-border border-border shadow-none">
          <div className="flex items-center justify-between p-3">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><Moon size={16} /></div>
              <div>
                <div className="text-sm font-medium">Theme</div>
                <div className="text-xs text-muted-foreground">Light, dark or system</div>
              </div>
            </div>
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light"><span className="flex items-center gap-2"><Sun size={14} /> Light</span></SelectItem>
                <SelectItem value="dark"><span className="flex items-center gap-2"><Moon size={14} /> Dark</span></SelectItem>
                <SelectItem value="system"><span className="flex items-center gap-2"><Monitor size={14} /> System</span></SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>
      </Section>

      {/* Notifications */}
      <Section title="Notifications">
        <Card className="divide-y divide-border border-border shadow-none">
          <ToggleRow icon={Bell} label="Push notifications" desc="Friend requests, messages & calls" checked={notifSound} onChange={setNotifSound} />
          <ToggleRow icon={Volume2} label="Notification sound" desc="Play a sound for new activity" checked={notifSound} onChange={setNotifSound} />
          <ToggleRow icon={Vibrate} label="Vibration" desc="Vibrate on new messages" checked={notifVibrate} onChange={setNotifVibrate} />
        </Card>
      </Section>

      {/* Privacy */}
      <Section title="Privacy & Security">
        <Card className="divide-y divide-border border-border shadow-none">
          <ToggleRow icon={Shield} label="Read receipts" desc="Show others when you read messages" checked={readReceipts} onChange={setReadReceipts} />
          <button onClick={() => setView('friends')} className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent/40">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><Shield size={16} /></div>
            <div className="flex-1"><div className="text-sm font-medium">Blocked users</div><div className="text-xs text-muted-foreground">Manage who you've blocked</div></div>
          </button>
        </Card>
      </Section>

      {/* Account */}
      <Section title="Account">
        <Card className="divide-y divide-border border-border shadow-none">
          <Row icon={Globe} label="Email" value={user?.email || ''} />
          <Row icon={Info} label="Username" value={`@${user?.username}`} />
          <button onClick={() => setView('profile')} className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent/40">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><Shield size={16} /></div>
            <div className="flex-1"><div className="text-sm font-medium">Edit profile</div><div className="text-xs text-muted-foreground">Update your info & privacy</div></div>
          </button>
        </Card>
      </Section>

      {/* Data */}
      <Section title="Data & Storage">
        <Card className="divide-y divide-border border-border shadow-none">
          <button className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent/40" onClick={() => toast.info('Export started — you’ll be notified when ready.')}>
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><Download size={16} /></div>
            <div className="flex-1"><div className="text-sm font-medium">Export my data</div><div className="text-xs text-muted-foreground">Download a copy of your data</div></div>
          </button>
        </Card>
      </Section>

      {/* About */}
      <Section title="About">
        <Card className="divide-y divide-border border-border shadow-none">
          <Row icon={Info} label="Version" value="1.0.0" />
          <Row icon={HelpCircle} label="Help & support" value="Tap to view" />
          <Row icon={Github} label="Open source" value="MIT licensed" />
        </Card>
        <p className="mt-3 flex items-center justify-center gap-1 text-xs text-muted-foreground">
          Made with <Heart size={12} className="text-destructive" /> for reconnecting friends
        </p>
      </Section>

      {/* Sign out */}
      <div className="mt-4 px-4">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="w-full rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"><LogOut size={16} className="mr-1" />Sign out</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out?</AlertDialogTitle>
              <AlertDialogDescription>You’ll need to sign in again to use FriendConnect.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={async () => { await logout(); toast.success('Signed out') }}>Sign out</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h2 className="mb-2 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="px-4">{children}</div>
    </div>
  )
}

function Row({ icon: Icon, label, value }: { icon: typeof Globe; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-3">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon size={16} /></div>
      <div className="flex-1"><div className="text-sm font-medium">{label}</div></div>
      <span className="truncate text-sm text-muted-foreground">{value}</span>
    </div>
  )
}

function ToggleRow({ icon: Icon, label, desc, checked, onChange }: { icon: typeof Bell; label: string; desc: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 p-3">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon size={16} /></div>
      <div className="flex-1"><div className="text-sm font-medium">{label}</div><div className="text-xs text-muted-foreground">{desc}</div></div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
