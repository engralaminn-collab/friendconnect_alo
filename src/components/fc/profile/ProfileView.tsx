'use client'

import { useEffect, useState } from 'react'
import { useAuth, AuthUser } from '@/hooks/use-auth'
import { useApp } from '@/lib/store'
import { useSocket } from '@/hooks/use-socket'
import { api, lastSeenText, formatLastSeenPrecise, uploadFile } from '@/lib/api'
import { UserAvatar, EmptyState } from '@/components/fc/ui'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Camera, MapPin, Phone, Cake, GraduationCap, Briefcase, Pencil, MessageCircle, PhoneCall, Video, UserPlus, Check, Ban, ShieldOff, ArrowLeft, Lock, Sparkles, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ProfileResult {
  user: { id: string; username: string; name: string; photoUrl: string | null; photoFilter: string | null; bio: string | null; phone: string | null; location: string | null; birthday: string | null; education: string | null; work: string | null; lastSeen?: string | null }
  relation: { isFriend: boolean; isBlocked: boolean; blockedByMe: boolean; status: string; incomingRequest: boolean; outgoingRequest: boolean }
  canMessage: boolean
  canCall: boolean
}

export function ProfileView() {
  const { user, refresh } = useAuth()
  const { activeProfileId, setView, openChat } = useApp()
  const { isOnline } = useSocket()
  const [profile, setProfile] = useState<ProfileResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const isMe = !activeProfileId || activeProfileId === user?.id
  const targetId = isMe ? user!.id : activeProfileId!

  useEffect(() => {
    if (isMe) {
      setProfile(null)
      setLoading(false)
      return
    }
    setLoading(true)
    api<ProfileResult>(`/api/users/${targetId}`)
      .then(setProfile)
      .catch(() => toast.error('Could not load profile'))
      .finally(() => setLoading(false))
  }, [targetId, isMe])

  if (isMe) {
    return <MyProfile />
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="fc-pulse text-muted-foreground">Loading…</div></div>
  }
  if (!profile) {
    return <EmptyState title="Profile not found" description="This user may not exist anymore." action={<Button onClick={() => setView('friends')}>Back to friends</Button>} />
  }

  const u = profile.user
  const online = isOnline(u.id)

  const act = async (action: string, msg: string) => {
    setActionLoading(true)
    try {
      await api('/api/friends', { method: 'POST', body: JSON.stringify({ action, targetId: u.id }) })
      toast.success(msg)
      const p = await api<ProfileResult>(`/api/users/${u.id}`)
      setProfile(p)
    } catch (e: any) {
      toast.error(e.message || 'Failed')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="fc-scroll h-full overflow-y-auto pb-6">
      <div className="flex items-center gap-2 px-2 py-2">
        <button onClick={() => setView('friends')} className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent"><ArrowLeft size={18} /></button>
        <span className="text-sm font-medium">Profile</span>
      </div>

      {/* Header */}
      <div className="relative px-4 pb-4">
        <div className="h-24 rounded-b-3xl bg-gradient-to-br from-primary/40 via-primary/20 to-accent" />
        <div className="-mt-12 flex items-end gap-4">
          <UserAvatar name={u.name} src={u.photoUrl} size={96} online={online} filter={u.photoFilter} className="border-4 border-background" />
          <div className="pb-1">
            <h1 className="text-xl font-bold">{u.name}</h1>
            <p className="text-sm text-muted-foreground">@{u.username}</p>
            <p
              className={online ? 'text-xs font-medium text-primary' : 'text-xs text-muted-foreground'}
              title={!online ? formatLastSeenPrecise(u.lastSeen).detail : undefined}
            >
              {lastSeenText(online, u.lastSeen)}
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-4">
        {profile.relation.isFriend ? (
          <>
            <Button className="flex-1 rounded-xl" onClick={() => openChat(u.id)}><MessageCircle size={16} className="mr-1" />Message</Button>
            <Button variant="secondary" className="rounded-xl" onClick={() => startCall(u.id, 'audio')}><PhoneCall size={16} /></Button>
            <Button variant="secondary" className="rounded-xl" onClick={() => startCall(u.id, 'video')}><Video size={16} /></Button>
          </>
        ) : profile.relation.outgoingRequest ? (
          <Button variant="secondary" className="flex-1 rounded-xl" disabled>Request sent</Button>
        ) : profile.relation.incomingRequest ? (
          <Button className="flex-1 rounded-xl" disabled={actionLoading} onClick={() => act('accept', 'You are now friends!')}>Accept request</Button>
        ) : profile.relation.blockedByMe ? (
          <Button variant="secondary" className="flex-1 rounded-xl" disabled={actionLoading} onClick={() => act('unblock', 'User unblocked')}>Unblock</Button>
        ) : (
          <Button className="flex-1 rounded-xl" disabled={actionLoading} onClick={() => act('request', 'Friend request sent')}><UserPlus size={16} className="mr-1" />Add friend</Button>
        )}
      </div>

      {/* Bio */}
      {u.bio && (
        <Card className="mx-4 mt-4 border-border p-4 shadow-none">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">About</h3>
          <p className="text-sm leading-relaxed">{u.bio}</p>
        </Card>
      )}

      {/* Details */}
      <Card className="mx-4 mt-3 border-border p-2 shadow-none">
        {u.location && <Detail icon={MapPin} label="Location" value={u.location} />}
        {u.phone && <Detail icon={Phone} label="Phone" value={u.phone} />}
        {u.birthday && <Detail icon={Cake} label="Birthday" value={u.birthday} />}
        {u.education && <Detail icon={GraduationCap} label="Education" value={u.education} />}
        {u.work && <Detail icon={Briefcase} label="Work" value={u.work} />}
        {!u.location && !u.phone && !u.birthday && !u.education && !u.work && (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">No additional details shared.</p>
        )}
      </Card>

      {!profile.relation.isFriend && !profile.relation.blockedByMe && (
        <div className="mt-4 px-4">
          <Button variant="ghost" className="w-full rounded-xl text-destructive hover:bg-destructive/10" disabled={actionLoading} onClick={() => act('block', 'User blocked')}><Ban size={16} className="mr-1" />Block user</Button>
        </div>
      )}
    </div>
  )

  function startCall(id: string, type: 'audio' | 'video') {
    // dispatch a custom event the CallOverlay listens to
    window.dispatchEvent(new CustomEvent('fc:start-call', { detail: { targetUserId: id, type } }))
  }
}

function Detail({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon size={16} /></div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  )
}

function MyProfile() {
  const { user, refresh } = useAuth()
  const { setView } = useApp()
  const { isOnline } = useSocket()
  const [open, setOpen] = useState(false)
  if (!user) return null
  const p = user.profile
  const meOnline = isOnline(user.id)
  const lastActive = meOnline
    ? { label: 'online', detail: 'active now' }
    : formatLastSeenPrecise(p?.lastSeen)

  const fields: { k: string; label: string; value: string }[] = [
    { k: 'bio', label: 'Bio', value: p?.bio || '' },
    { k: 'phone', label: 'Phone', value: p?.phone || '' },
    { k: 'location', label: 'Location', value: p?.location || '' },
    { k: 'birthday', label: 'Birthday', value: p?.birthday || '' },
    { k: 'education', label: 'Education', value: p?.education || '' },
    { k: 'work', label: 'Work', value: p?.work || '' },
  ]

  return (
    <div className="fc-scroll h-full overflow-y-auto pb-6">
      <div className="relative px-4 pb-4">
        <div className="h-24 rounded-b-3xl bg-gradient-to-br from-primary/40 via-primary/20 to-accent" />
        <div className="-mt-12 flex items-end gap-4">
          <div className="relative">
            <UserAvatar name={user.name} src={p?.photoUrl} size={96} filter={p?.photoFilter} className="border-4 border-background" />
            <div className="absolute bottom-1 right-1 flex items-center gap-1">
              <PhotoFilterPicker user={user} refresh={refresh} />
              <label className="grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground shadow-lg">
                <Camera size={14} />
                <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  try {
                    const { file } = await uploadFile(f)
                    await api('/api/users/me', { method: 'PUT', body: JSON.stringify({ photoUrl: file.url }) })
                    await refresh()
                    toast.success('Photo updated')
                  } catch (e: any) { toast.error(e.message) }
                }} />
              </label>
            </div>
          </div>
          <div className="pb-1">
            <h1 className="text-xl font-bold">{user.name}</h1>
            <p className="text-sm text-muted-foreground">@{user.username}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
            {lastActive.label !== 'offline' && (
              <p
                className="text-[10px] text-muted-foreground"
                title={lastActive.detail}
              >
                {lastActive.label === 'online' ? 'Active now' : lastActive.detail}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="px-4">
        <Button className="w-full rounded-xl" onClick={() => setOpen(true)}><Pencil size={16} className="mr-1" />Edit profile</Button>
      </div>

      {p?.bio && (
        <Card className="mx-4 mt-4 border-border p-4 shadow-none">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">About</h3>
          <p className="text-sm leading-relaxed">{p.bio}</p>
        </Card>
      )}

      <Card className="mx-4 mt-3 border-border p-2 shadow-none">
        {fields.map((f) => f.value ? <Detail key={f.k} icon={iconFor(f.k)} label={f.label} value={f.value} /> : null)}
        {fields.every((f) => !f.value) && <p className="px-3 py-4 text-center text-sm text-muted-foreground">No details yet. Tap “Edit profile”.</p>}
      </Card>

      <Card className="mx-4 mt-3 border-border p-4 shadow-none">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Lock size={12} />Privacy</h3>
        <div className="space-y-2 text-sm">
          <PrivacyRow label="Profile visibility" value={p?.profileVisibility || 'PUBLIC'} />
          <PrivacyRow label="Who can message" value={p?.messagePermission || 'FRIENDS'} />
          <PrivacyRow label="Who can call" value={p?.callPermission || 'FRIENDS'} />
        </div>
      </Card>

      <EditProfileDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}

function iconFor(k: string) {
  switch (k) {
    case 'phone': return Phone
    case 'location': return MapPin
    case 'birthday': return Cake
    case 'education': return GraduationCap
    case 'work': return Briefcase
    default: return Pencil
  }
}

function PrivacyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{value}</span>
    </div>
  )
}

function EditProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const { user, refresh } = useAuth()
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && user) {
      setForm({
        name: user.name,
        username: user.username,
        bio: user.profile?.bio || '',
        phone: user.profile?.phone || '',
        location: user.profile?.location || '',
        birthday: user.profile?.birthday || '',
        education: user.profile?.education || '',
        work: user.profile?.work || '',
        profileVisibility: user.profile?.profileVisibility || 'PUBLIC',
        messagePermission: user.profile?.messagePermission || 'FRIENDS',
        callPermission: user.profile?.callPermission || 'FRIENDS',
      })
    }
  }, [open, user])

  const submit = async () => {
    setSaving(true)
    try {
      await api('/api/users/me', { method: 'PUT', body: JSON.stringify(form) })
      await refresh()
      toast.success('Profile updated')
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (!user) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fc-scroll max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name || ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Username</Label><Input value={form.username || ''} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} /></div>
          </div>
          <div className="space-y-1.5"><Label>Bio</Label><Textarea rows={2} value={form.bio || ''} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone || ''} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Location</Label><Input value={form.location || ''} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>Birthday</Label><Input placeholder="YYYY-MM-DD" value={form.birthday || ''} onChange={(e) => setForm((f) => ({ ...f, birthday: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Education</Label><Input value={form.education || ''} onChange={(e) => setForm((f) => ({ ...f, education: e.target.value }))} /></div>
          </div>
          <div className="space-y-1.5"><Label>Work</Label><Input value={form.work || ''} onChange={(e) => setForm((f) => ({ ...f, work: e.target.value }))} /></div>
          <div className="rounded-xl border border-border p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Privacy</h4>
            <div className="grid gap-2">
              <SelectField label="Profile visibility" value={form.profileVisibility || 'PUBLIC'} onChange={(v) => setForm((f) => ({ ...f, profileVisibility: v }))} options={['PUBLIC', 'FRIENDS', 'PRIVATE']} />
              <SelectField label="Who can message" value={form.messagePermission || 'FRIENDS'} onChange={(v) => setForm((f) => ({ ...f, messagePermission: v }))} options={['PUBLIC', 'FRIENDS']} />
              <SelectField label="Who can call" value={form.callPermission || 'FRIENDS'} onChange={(v) => setForm((f) => ({ ...f, callPermission: v }))} options={['PUBLIC', 'FRIENDS']} />
            </div>
          </div>
          <Button disabled={saving} onClick={submit} className="rounded-xl">{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o} value={o}>{o.charAt(0) + o.slice(1).toLowerCase()}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * Preset photo filters for the profile avatar picker.
 * `value` is the CSS filter value sent to the backend (stored on Profile.photoFilter).
 * "none" is the special sentinel meaning "clear the filter".
 */
const PHOTO_FILTERS: { id: string; name: string; value: string }[] = [
  { id: 'none', name: 'None', value: 'none' },
  { id: 'grayscale', name: 'Grayscale', value: 'grayscale(1)' },
  { id: 'sepia', name: 'Sepia', value: 'sepia(0.6)' },
  { id: 'saturate', name: 'Saturate', value: 'saturate(1.5)' },
  { id: 'contrast', name: 'Contrast', value: 'contrast(1.2)' },
  { id: 'brightness', name: 'Bright', value: 'brightness(1.1)' },
  { id: 'vintage', name: 'Vintage', value: 'sepia(0.5) contrast(1.1) brightness(0.95) saturate(1.2)' },
  { id: 'cool', name: 'Cool', value: 'hue-rotate(30deg)' },
  { id: 'warm', name: 'Warm', value: 'hue-rotate(-30deg)' },
]

function PhotoFilterPicker({
  user,
  refresh,
}: {
  user: AuthUser
  refresh: () => Promise<AuthUser | null>
}) {
  const [open, setOpen] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const profile = user.profile
  const current = profile?.photoFilter || 'none'

  const apply = async (value: string) => {
    if (applying) return
    setApplying(value)
    try {
      // Backend treats empty string as null (clears the filter).
      const body = value === 'none' ? { photoFilter: '' } : { photoFilter: value }
      await api('/api/users/me', { method: 'PUT', body: JSON.stringify(body) })
      await refresh()
      toast.success('Photo filter updated')
      setOpen(false)
    } catch (e: any) {
      toast.error(e.message || 'Failed to update filter')
    } finally {
      setApplying(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-primary shadow-sm transition hover:bg-primary/25"
          aria-label="Photo filters"
          title="Photo filters"
        >
          <Sparkles size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end" sideOffset={8}>
        <div className="mb-2 flex items-center gap-1.5">
          <Sparkles size={14} className="text-primary" />
          <span className="text-sm font-semibold">Photo filter</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PHOTO_FILTERS.map((f) => {
            const selected = current === f.value
            const isApplying = applying === f.value
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => apply(f.value)}
                disabled={!!applying}
                className={cn(
                  'relative flex flex-col items-center gap-1 rounded-xl p-2 transition hover:bg-accent',
                  selected && 'ring-2 ring-primary'
                )}
              >
                <UserAvatar
                  name={user.name}
                  src={profile?.photoUrl}
                  size={48}
                  filter={f.value === 'none' ? undefined : f.value}
                />
                <span className="text-[10px] font-medium text-muted-foreground">{f.name}</span>
                {isApplying && (
                  <span className="absolute inset-0 grid place-items-center rounded-xl bg-background/60">
                    <Loader2 size={14} className="animate-spin text-primary" />
                  </span>
                )}
                {selected && <span className="sr-only">Selected</span>}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
