import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowLeft,
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  FileText,
  Film,
  Heart,
  ImagePlus,
  Info,
  LogOut,
  MessageCircle,
  MessageCircleMore,
  Mic,
  MicOff,
  MoreHorizontal,
  Paperclip,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  Sparkles,
  UserRound,
  UserRoundPlus,
  UsersRound,
  Video,
  VideoOff,
  X,
  XCircle,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { useAuthStore } from '../../core/store/authStore';
import { useMessengerData } from './useMessengerData';
import { useWebRtcCall, type ActiveCall } from './useWebRtcCall';
import type { CallHistoryItem, FriendRequestRecord, MessengerChat, MessengerMessage, Person } from './types';

type MessengerMode = 'demo' | 'live';
type WorkspaceView = 'chats' | 'friends' | 'calls' | 'profile';
type ChatFilter = 'all' | 'unread' | 'groups';
type FriendTab = 'friends' | 'requests' | 'discover';

const everydayEmojis = ['😀', '😄', '😂', '🥹', '😊', '😍', '🥰', '😘', '😎', '🤔', '🙌', '👏', '🤗', '🫶', '❤️', '💛', '✨', '🌿', '🎉', '☕', '🌻', '🤍'];
const flirtyEmojis = ['😉', '😏', '😈', '💋', '🫦', '🥵', '🔥', '💌', '🍑', '🍆', '💦', '👀'];
const avatarPalettes = [
  'avatar-sage', 'avatar-coral', 'avatar-lilac', 'avatar-sky', 'avatar-peach', 'avatar-berry', 'avatar-aqua',
];

function initials(name?: string) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function paletteFor(uid?: string) {
  const seed = [...(uid || 'friend')].reduce((total, char) => total + char.charCodeAt(0), 0);
  return avatarPalettes[seed % avatarPalettes.length];
}

function Avatar({ person, size = 'medium', online, className = '' }: { person?: Person | null; size?: 'small' | 'medium' | 'large' | 'hero'; online?: boolean; className?: string }) {
  const name = person?.name || 'Friend';
  return (
    <span className={`avatar avatar-${size} ${paletteFor(person?.uid)} ${className}`} aria-label={name}>
      {person?.photoUrl ? <img src={person.photoUrl} alt="" /> : <span>{initials(name)}</span>}
      {online && <i className="avatar-presence" aria-label="Online" />}
    </span>
  );
}

function timeLabel(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
}

function dateDivider(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined }).format(date);
}

function timeOfDay(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp));
}

function formatBytes(size?: number) {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getChatPerson(chat: MessengerChat | undefined, peopleById: Map<string, Person>, currentUserId: string): Person | null {
  if (!chat || chat.isGroup) return null;
  return peopleById.get(chat.participants.find(uid => uid !== currentUserId) || '') || null;
}

function chatName(chat: MessengerChat, peopleById: Map<string, Person>, currentUserId: string) {
  if (chat.groupName) return chat.groupName;
  return getChatPerson(chat, peopleById, currentUserId)?.name || 'Friend';
}

function chatInitialPerson(chat: MessengerChat, peopleById: Map<string, Person>, currentUserId: string): Person | null {
  if (chat.isGroup) return { uid: chat.id, name: chat.groupName || 'Group', username: '' };
  return getChatPerson(chat, peopleById, currentUserId);
}

function PresenceText({ person }: { person: Person | null }) {
  if (!person) return <span className="presence-muted">Group conversation</span>;
  if (person.onlineStatus) return <span className="presence-online"><i /> online</span>;
  if (person.lastSeen) {
    const minutes = Math.max(1, Math.round((Date.now() - person.lastSeen) / 60_000));
    if (minutes < 60) return <span className="presence-muted">last seen {minutes}m ago</span>;
    const hours = Math.round(minutes / 60);
    return <span className="presence-muted">last seen {hours}h ago</span>;
  }
  return <span className="presence-muted">offline</span>;
}

function lastMessagePreview(chat: MessengerChat, messages: MessengerMessage[]) {
  const latest = messages[messages.length - 1];
  if (latest) {
    if (latest.type === 'image') return '📷 Photo';
    if (latest.type === 'video') return '🎬 Video';
    if (latest.type === 'file') return `📎 ${latest.fileName || 'Document'}`;
    if (latest.type === 'audio') return '🎙️ Voice message';
    return latest.content;
  }
  return chat.lastMessage || 'Start a conversation';
}

function AvatarStack({ members }: { members: Person[] }) {
  return (
    <span className="avatar-stack" aria-hidden="true">
      {members.slice(0, 3).map(person => <Avatar key={person.uid} person={person} size="small" />)}
      {members.length > 3 && <span className="avatar-stack-more">+{members.length - 3}</span>}
    </span>
  );
}

function NavRail({ view, setView, profile, requestsCount, onLogout, isDemo }: {
  view: WorkspaceView;
  setView: (view: WorkspaceView) => void;
  profile: Person;
  requestsCount: number;
  onLogout: () => void;
  isDemo: boolean;
}) {
  const navItems: Array<{ id: WorkspaceView; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'chats', label: 'Chats', icon: <MessageCircleMore /> },
    { id: 'friends', label: 'Friends', icon: <UsersRound />, count: requestsCount },
    { id: 'calls', label: 'Calls', icon: <Phone /> },
  ];
  return (
    <aside className="nav-rail">
      <button className="brand-mark" onClick={() => setView('chats')} aria-label="FriendConnect home">
        <MessageCircleMore size={23} strokeWidth={2.5} />
        <span className="brand-mark-dot" />
      </button>
      <div className="rail-divider" />
      <nav className="rail-nav" aria-label="Main navigation">
        {navItems.map(item => (
          <button key={item.id} className={`rail-button ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)} aria-label={item.label} title={item.label}>
            {item.icon}
            {item.count ? <span className="rail-count">{item.count}</span> : null}
          </button>
        ))}
      </nav>
      <div className="rail-bottom">
        <button className={`rail-button ${view === 'profile' ? 'active' : ''}`} onClick={() => setView('profile')} aria-label="Your profile" title="Your profile">
          <Avatar person={profile} size="small" />
        </button>
        <button className="rail-button rail-logout" onClick={onLogout} aria-label={isDemo ? 'Exit preview' : 'Sign out'} title={isDemo ? 'Exit preview' : 'Sign out'}>
          <LogOut />
        </button>
      </div>
    </aside>
  );
}

function ConversationRow({ chat, peopleById, currentUserId, messages, active, unreadCount, onClick }: {
  chat: MessengerChat;
  peopleById: Map<string, Person>;
  currentUserId: string;
  messages: MessengerMessage[];
  active: boolean;
  unreadCount: number;
  onClick: () => void;
}) {
  const contact = chatInitialPerson(chat, peopleById, currentUserId);
  const groupMembers = chat.isGroup ? chat.participants.filter(uid => uid !== currentUserId).map(uid => peopleById.get(uid)).filter((person): person is Person => Boolean(person)) : [];
  return (
    <button className={`conversation-row ${active ? 'selected' : ''}`} onClick={onClick}>
      {chat.isGroup ? <AvatarStack members={groupMembers} /> : <Avatar person={contact} size="medium" online={Boolean(contact?.onlineStatus)} />}
      <span className="conversation-copy">
        <span className="conversation-topline">
          <span className="conversation-name">{chatName(chat, peopleById, currentUserId)}</span>
          <span className={`conversation-time ${unreadCount ? 'unread-time' : ''}`}>{timeLabel(messages[messages.length - 1]?.createdAt || chat.lastMessageTime)}</span>
        </span>
        <span className="conversation-bottomline">
          <span className="conversation-preview">{lastMessagePreview(chat, messages)}</span>
          {unreadCount > 0 ? <span className="unread-pill">{unreadCount}</span> : null}
        </span>
      </span>
    </button>
  );
}

function MessageContent({ message, onPreview }: { message: MessengerMessage; onPreview: (message: MessengerMessage) => void }) {
  if (message.type === 'image') {
    return (
      <button className="image-attachment" onClick={() => onPreview(message)} aria-label={`Open image ${message.fileName || ''}`}>
        <img src={message.content} alt={message.fileName || 'Shared image'} loading="lazy" />
        {message.fileName && <span className="image-caption">{message.fileName}</span>}
      </button>
    );
  }
  if (message.type === 'video') {
    return <video className="video-attachment" controls preload="metadata" src={message.content} aria-label={message.fileName || 'Shared video'} />;
  }
  if (message.type === 'file') {
    return (
      <a className="file-attachment" href={message.content} download={message.fileName || true} target="_blank" rel="noreferrer">
        <span className="file-icon"><FileText size={20} /></span>
        <span className="file-copy"><strong>{message.fileName || 'Shared document'}</strong><small>{formatBytes(message.sizeBytes) || 'Tap to open'}</small></span>
        <ArrowDownToLine size={17} className="file-download-icon" />
      </a>
    );
  }
  if (message.type === 'audio') {
    if (message.content) return <audio className="audio-attachment" controls src={message.content} aria-label="Voice message" />;
    return (
      <div className="voice-note-preview">
        <span className="voice-note-play"><Send size={14} /></span>
        <span className="voice-wave" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} style={{ height: `${8 + ((index * 7) % 16)}px` }} />)}</span>
        <span className="voice-note-time">0:18</span>
      </div>
    );
  }
  return <span className="message-text">{message.content}</span>;
}

function MessageBubble({ message, isMine, sender, currentUserId, onReact, onPreview }: {
  message: MessengerMessage;
  isMine: boolean;
  sender?: Person;
  currentUserId: string;
  onReact: (emoji: string) => void;
  onPreview: (message: MessengerMessage) => void;
}) {
  return (
    <div className={`message-row ${isMine ? 'from-me' : 'from-them'}`}>
      {!isMine && sender ? <Avatar person={sender} size="small" className="message-avatar" /> : null}
      <div className={`message-column ${isMine ? 'align-end' : ''}`}>
        <div className={`message-bubble ${isMine ? 'bubble-me' : 'bubble-them'} ${message.type !== 'text' ? 'bubble-media' : ''}`}>
          <MessageContent message={message} onPreview={onPreview} />
          <span className="message-meta">
            <span>{timeOfDay(message.createdAt)}</span>
            {isMine && (message.status === 'seen' ? <CheckCheck size={14} className="seen-check" /> : message.status === 'delivered' ? <CheckCheck size={14} /> : <Check size={14} />)}
          </span>
        </div>
        {message.reactions && Object.keys(message.reactions).length > 0 && (
          <div className={`reaction-list ${isMine ? 'reaction-right' : ''}`}>
            {Object.entries(message.reactions).map(([reactor, emoji]) => <button key={reactor} onClick={() => onReact(emoji)} className={reactor === currentUserId ? 'my-reaction' : ''} aria-label={`React with ${emoji}`}>{emoji}</button>)}
          </div>
        )}
        <button className="quick-react" onClick={() => onReact('❤️')} aria-label="Add a heart reaction"><Heart size={13} /></button>
      </div>
    </div>
  );
}

function CallOverlay({ call, onAccept, onReject, onEnd, onToggleMute, onToggleCamera }: {
  call: ActiveCall;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
}) {
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (remoteVideo.current) remoteVideo.current.srcObject = call.remoteStream || null;
    if (remoteAudio.current) remoteAudio.current.srcObject = call.remoteStream || null;
    if (localVideo.current) localVideo.current.srcObject = call.localStream || null;
  }, [call.localStream, call.remoteStream]);

  useEffect(() => {
    if (call.status !== 'connected' || !call.startedAt) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - (call.startedAt || Date.now())) / 1000)));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [call.status, call.startedAt]);

  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const incoming = call.direction === 'incoming' && call.status === 'incoming';
  const finished = call.status === 'ended' || call.status === 'rejected';
  const statusText = call.status === 'calling' ? 'Calling…' : call.status === 'connecting' ? 'Connecting…' : call.status === 'connected' ? timer : call.status === 'rejected' ? 'Call declined' : 'Call ended';

  return (
    <div className={`call-overlay ${call.type === 'video' ? 'video-call' : 'audio-call'}`} role="dialog" aria-modal="true" aria-label={`${call.type} call with ${call.contact.name}`}>
      <div className="call-backdrop" />
      {call.type === 'video' && !call.demo && <video ref={remoteVideo} className="remote-video" autoPlay playsInline />}
      {call.type === 'audio' && !call.demo && <audio ref={remoteAudio} className="remote-audio" autoPlay />}
      {call.type === 'video' && call.demo && <div className="preview-call-scene"><div className="preview-call-sun" /><div className="preview-call-hill one" /><div className="preview-call-hill two" /></div>}
      <div className="call-topline">
        <span className="call-security"><ShieldCheck size={15} /> Private connection</span>
        <button className="call-close" onClick={onEnd} aria-label="End call"><X size={19} /></button>
      </div>
      <div className={`call-person ${call.type === 'video' && !call.demo && call.remoteStream ? 'call-person-overlay' : ''}`}>
        {call.type !== 'video' || call.demo || !call.remoteStream ? <Avatar person={call.contact} size="hero" online /> : null}
        <h2>{call.contact.name}</h2>
        <p>{incoming ? `Incoming ${call.type} call` : statusText}</p>
        {call.demo && <span className="preview-call-note">Preview only · no call is placed</span>}
      </div>
      {call.type === 'video' && !call.demo && call.localStream && <video ref={localVideo} className="local-video" autoPlay muted playsInline />}
      {incoming ? (
        <div className="incoming-actions">
          <button className="call-control decline" onClick={onReject} aria-label="Decline call"><Phone size={21} /></button>
          <button className="call-control accept" onClick={onAccept} aria-label="Accept call"><Phone size={21} /></button>
        </div>
      ) : !finished ? (
        <div className="call-controls">
          <button className={`call-control ${call.muted ? 'control-muted' : ''}`} onClick={onToggleMute} aria-label={call.muted ? 'Turn microphone on' : 'Mute microphone'}>{call.muted ? <MicOff size={20} /> : <Mic size={20} />}</button>
          {call.type === 'video' && <button className={`call-control ${call.cameraOff ? 'control-muted' : ''}`} onClick={onToggleCamera} aria-label={call.cameraOff ? 'Turn camera on' : 'Turn camera off'}>{call.cameraOff ? <VideoOff size={20} /> : <Video size={20} />}</button>}
          <button className="call-control decline end-call" onClick={onEnd} aria-label="End call"><Phone size={21} /></button>
        </div>
      ) : (
        <button className="call-dismiss" onClick={onEnd}>Close</button>
      )}
      {call.demo && <p className="call-demo-footnote">This preview does not access your microphone or camera.</p>}
    </div>
  );
}

export default function MessengerApp({ mode }: { mode: MessengerMode }) {
  const isDemo = mode === 'demo';
  const navigate = useNavigate();
  const authUser = useAuthStore(state => state.firebaseUser);
  const data = useMessengerData(mode);
  const { currentUserId, profile, people, friends, requests, chats, messagesByChat, callHistory, selectedChatId } = data;
  const [view, setView] = useState<WorkspaceView>('chats');
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [chatSearch, setChatSearch] = useState('');
  const [friendSearch, setFriendSearch] = useState('');
  const [friendTab, setFriendTab] = useState<FriendTab>('friends');
  const [draft, setDraft] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [fileProgress, setFileProgress] = useState<number | null>(null);
  const [imagePreview, setImagePreview] = useState<MessengerMessage | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: profile.name, username: profile.username, bio: profile.bio || '', phone: profile.phone || '' });
  const [recording, setRecording] = useState(false);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatSearchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const noticeTimerRef = useRef<number | null>(null);
  const { call, error: callError, clearError: clearCallError, startCall, acceptCall, rejectCall, endCall, toggleMute, toggleCamera } = useWebRtcCall(mode, currentUserId, people);

  const peopleById = useMemo(() => new Map(people.map(person => [person.uid, person])), [people]);
  const selectedChat = chats.find(chat => chat.id === selectedChatId);
  const selectedPerson = getChatPerson(selectedChat, peopleById, currentUserId);
  const selectedMessages = selectedChat ? (messagesByChat[selectedChat.id] || []) : [];
  const incomingRequests = requests.filter(request => request.receiverId === currentUserId && request.status === 'pending');
  const outgoingRequests = requests.filter(request => request.senderId === currentUserId && request.status === 'pending');

  const notify = (message: string) => {
    setNotice(message);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 3_600);
  };

  useEffect(() => {
    setProfileForm({ name: profile.name, username: profile.username, bio: profile.bio || '', phone: profile.phone || '' });
  }, [profile.name, profile.username, profile.bio, profile.phone]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setView('chats');
        window.setTimeout(() => chatSearchInputRef.current?.focus(), 0);
      }
      if (event.key === 'Escape') {
        setEmojiOpen(false);
        setAttachOpen(false);
        setImagePreview(null);
        setShowInfo(false);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (!selectedChat || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [selectedChatId, selectedMessages.length]);

  useEffect(() => {
    if (data.error) notify(data.error);
  }, [data.error]);

  useEffect(() => {
    if (callError) notify(callError);
  }, [callError]);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    recorderRef.current?.state === 'recording' && recorderRef.current.stop();
    recordingStreamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  const openChat = (chatId: string) => {
    data.setSelectedChatId(chatId);
    setView('chats');
    setMobileChatOpen(true);
    setShowInfo(false);
    setEmojiOpen(false);
    setAttachOpen(false);
  };

  const handleSendText = async (override?: string) => {
    const content = (override ?? draft).trim();
    if (!content || !selectedChat) return;
    try {
      await data.sendText(content);
      if (override === undefined) setDraft('');
      setEmojiOpen(false);
      setAttachOpen(false);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Message could not be sent.');
    }
  };

  const handleAttach = async (file: File, chatId = selectedChatId) => {
    if (!file || !chatId) return;
    setFileProgress(0);
    setAttachOpen(false);
    try {
      await data.sendFile(chatId, file, progress => setFileProgress(progress));
      notify(isDemo ? 'Shared in this preview' : 'Attachment sent');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not share this file.');
    } finally {
      setFileProgress(null);
    }
  };

  const onImageChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void handleAttach(file);
  };

  const startVoiceNote = async () => {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    if (!selectedChat) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined;
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = event => { if (event.data.size) recordingChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        recordingStreamRef.current = null;
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size) {
          const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
          void handleAttach(new File([blob], `voice-note-${Date.now()}.${ext}`, { type: blob.type }));
        }
      };
      recorder.start();
      setRecording(true);
      notify('Recording… tap the red microphone to send your voice note.');
    } catch {
      notify('Microphone access was not available. Check your browser permissions.');
    }
  };

  const handleStartCall = async (person: Person | null, type: 'audio' | 'video') => {
    if (!person) {
      notify('Choose a friend to call.');
      return;
    }
    setNotice('');
    clearCallError();
    await startCall(person, type);
  };

  const onLogout = async () => {
    if (isDemo) {
      navigate('/login');
      return;
    }
    try {
      if (authUser) await updateDoc(doc(db, 'users', authUser.uid), { onlineStatus: false, lastSeen: Date.now() });
    } catch { /* logout should still complete if presence is unavailable */ }
    await signOut(auth);
    navigate('/login');
  };

  const handleStartChat = async (person: Person) => {
    try {
      const id = await data.startChat(person);
      openChat(id);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not open a conversation.');
    }
  };

  const handleFriendRequest = async (person: Person) => {
    setRequestBusy(person.uid);
    try {
      await data.requestFriend(person);
      notify(`Friend request sent to ${person.name}`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not send this request.');
    } finally {
      setRequestBusy(null);
    }
  };

  const handleRespond = async (request: FriendRequestRecord, accepted: boolean) => {
    setRequestBusy(request.id);
    try {
      await data.respondToRequest(request, accepted);
      const person = peopleById.get(request.senderId === currentUserId ? request.receiverId : request.senderId);
      notify(accepted ? `${person?.name || 'Friend'} added to your circle` : 'Request declined');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not update this request.');
    } finally {
      setRequestBusy(null);
    }
  };

  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profileForm.name.trim() || !profileForm.username.trim()) {
      notify('Please add your name and username.');
      return;
    }
    setSavingProfile(true);
    try {
      await data.updateProfile({ name: profileForm.name.trim(), username: profileForm.username.trim().replace(/^@/, ''), bio: profileForm.bio.trim(), phone: profileForm.phone.trim() });
      setEditingProfile(false);
      notify('Your profile has been updated.');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not save your profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const sortedChats = [...chats].sort((a, b) => (b.lastMessageTime || b.createdAt) - (a.lastMessageTime || a.createdAt));
  const visibleChats = sortedChats.filter(chat => {
    const title = chatName(chat, peopleById, currentUserId).toLowerCase();
    const preview = lastMessagePreview(chat, messagesByChat[chat.id] || []).toLowerCase();
    const matchesSearch = `${title} ${preview}`.includes(chatSearch.toLowerCase());
    const messages = messagesByChat[chat.id] || [];
    const unread = messages.filter(message => message.senderId !== currentUserId && message.status !== 'seen').length;
    return matchesSearch && (filter === 'all' || (filter === 'groups' ? Boolean(chat.isGroup) : unread > 0));
  });

  const visibleFriends = people.filter(person => friends.includes(person.uid)).sort((a, b) => a.name.localeCompare(b.name));
  const discoverPeople = people.filter(person => person.uid !== currentUserId && !friends.includes(person.uid) && `${person.name} ${person.username}`.toLowerCase().includes(friendSearch.toLowerCase()));
  const pendingForPerson = (uid: string) => outgoingRequests.find(request => request.receiverId === uid && request.status === 'pending');

  const renderMessageRows = () => {
    const rows: React.ReactNode[] = [];
    let previousDate = '';
    selectedMessages.forEach(message => {
      const label = dateDivider(message.createdAt);
      if (label !== previousDate) {
        rows.push(<div className="date-divider" key={`date-${message.id}`}><span>{label}</span></div>);
        previousDate = label;
      }
      const isMine = message.senderId === currentUserId;
      const sender = peopleById.get(message.senderId);
      rows.push(
        <MessageBubble
          key={message.id}
          message={message}
          isMine={isMine}
          sender={sender}
          currentUserId={currentUserId}
          onReact={emoji => void data.toggleReaction(message.chatId, message.id, emoji)}
          onPreview={setImagePreview}
        />,
      );
    });
    return rows;
  };

  const renderChatWorkspace = () => (
    <div className={`chat-workspace ${mobileChatOpen ? 'mobile-chat-open' : ''}`}>
      <aside className="inbox-pane">
        <header className="inbox-brand-row">
          <div className="brand-lockup">
            <span className="mini-brand"><MessageCircleMore size={18} /></span>
            <span>friendconnect</span>
          </div>
          {isDemo && <span className="preview-badge">Preview</span>}
          <button className="icon-button inbox-new-button" onClick={() => { setView('friends'); setFriendTab('discover'); }} title="Find a friend" aria-label="Start a new conversation"><Plus size={20} /></button>
        </header>
        <div className="inbox-title-row">
          <div><span className="section-kicker">YOUR PEOPLE</span><h1>Chats<span className="chat-count">{chats.length}</span></h1></div>
          <button className="inbox-compose" onClick={() => { setView('friends'); setFriendTab('discover'); }} aria-label="New message"><MessageCircleMore size={19} /></button>
        </div>
        <label className="search-box">
          <Search size={17} />
          <input ref={chatSearchInputRef} value={chatSearch} onChange={event => setChatSearch(event.target.value)} placeholder="Search messages" aria-label="Search conversations" />
          {chatSearch && <button onClick={() => setChatSearch('')} aria-label="Clear search"><X size={15} /></button>}
          {!chatSearch && <kbd>⌘ K</kbd>}
        </label>
        <div className="chat-filters" role="tablist" aria-label="Filter chats">
          {(['all', 'unread', 'groups'] as ChatFilter[]).map(item => <button key={item} role="tab" aria-selected={filter === item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'all' ? 'All' : item === 'unread' ? 'Unread' : 'Groups'}</button>)}
        </div>
        <div className="chat-list-scroll">
          {isDemo && <div className="circle-note"><Sparkles size={15} /><span>A little space for your favorite people.</span></div>}
          {data.loading && <div className="loading-list"><span className="spinner" /> Loading your chats…</div>}
          {!data.loading && visibleChats.length === 0 && <div className="empty-list"><span className="empty-icon"><MessageCircle size={22} /></span><strong>No chats here yet</strong><span>Find a friend and start catching up.</span><button onClick={() => { setView('friends'); setFriendTab('discover'); }}>Find friends</button></div>}
          {visibleChats.map(chat => {
            const messages = messagesByChat[chat.id] || [];
            const unreadCount = messages.filter(message => message.senderId !== currentUserId && message.status !== 'seen').length;
            return <ConversationRow key={chat.id} chat={chat} peopleById={peopleById} currentUserId={currentUserId} messages={messages} active={chat.id === selectedChatId} unreadCount={unreadCount} onClick={() => openChat(chat.id)} />;
          })}
        </div>
        <div className="inbox-footer"><ShieldCheck size={15} /><span>{isDemo ? 'Sample people · your activity stays in this browser' : 'A private circle for people you know'}</span></div>
      </aside>

      <main className="conversation-pane">
        {selectedChat ? (
          <>
            <header className="conversation-header">
              <button className="mobile-back icon-button" onClick={() => setMobileChatOpen(false)} aria-label="Back to chats"><ChevronLeft size={21} /></button>
              {selectedChat.isGroup ? <AvatarStack members={selectedChat.participants.filter(uid => uid !== currentUserId).map(uid => peopleById.get(uid)).filter((person): person is Person => Boolean(person))} /> : <Avatar person={selectedPerson} size="medium" online={Boolean(selectedPerson?.onlineStatus)} />}
              <div className="conversation-heading">
                <h2>{chatName(selectedChat, peopleById, currentUserId)}</h2>
                {selectedChat.isGroup ? <span className="conversation-subtitle">{selectedChat.participants.length} people · your old crew</span> : <PresenceText person={selectedPerson} />}
              </div>
              <div className="conversation-actions">
                <button className="call-action" disabled={selectedChat.isGroup} onClick={() => void handleStartCall(selectedPerson, 'audio')} aria-label="Start an audio call" title={selectedChat.isGroup ? 'One-to-one calls only' : 'Audio call'}><Phone size={18} /></button>
                <button className="call-action video-action" disabled={selectedChat.isGroup} onClick={() => void handleStartCall(selectedPerson, 'video')} aria-label="Start a video call" title={selectedChat.isGroup ? 'One-to-one calls only' : 'Video call'}><Video size={19} /></button>
                <span className="action-divider" />
                <button className={`icon-button info-action ${showInfo ? 'toggled' : ''}`} onClick={() => setShowInfo(!showInfo)} aria-label="Conversation details" title="Conversation details"><Info size={19} /></button>
                <button className="icon-button more-action" onClick={() => notify('Your conversations are just for your circle.')} aria-label="More conversation actions"><MoreHorizontal size={20} /></button>
              </div>
            </header>
            <div className={`conversation-content ${showInfo ? 'with-info' : ''}`}>
              <div className="messages-column">
                <div className="messages-scroll" ref={scrollRef}>
                  {isDemo && <div className="chat-encryption-note"><ShieldCheck size={13} /> Your memories, shared with friends</div>}
                  {selectedMessages.length === 0 ? (
                    <div className="empty-conversation"><div className="empty-sparkle">✦</div><h3>Say hello to {chatName(selectedChat, peopleById, currentUserId)}</h3><p>Send a note, a photo, or a silly emoji to get things going.</p></div>
                  ) : renderMessageRows()}
                </div>
                {fileProgress !== null && <div className="upload-progress"><span style={{ width: `${fileProgress}%` }} /><small>{fileProgress >= 100 ? 'Finishing up…' : `Sharing… ${fileProgress}%`}</small></div>}
                <div className="composer-shell">
                  {emojiOpen && (
                    <div className="emoji-popover">
                      <div className="emoji-popover-head"><div><strong>Pick an emoji</strong><span>Say it with a little more feeling</span></div><button onClick={() => setEmojiOpen(false)} aria-label="Close emoji picker"><X size={16} /></button></div>
                      <div className="emoji-group-label">Everyday</div>
                      <div className="emoji-grid">{everydayEmojis.map(emoji => <button key={emoji} onClick={() => setDraft(current => current + emoji)} aria-label={`Insert ${emoji}`}>{emoji}</button>)}</div>
                      <div className="emoji-group-label flirty-label">Flirty</div>
                      <div className="emoji-grid">{flirtyEmojis.map(emoji => <button key={emoji} onClick={() => setDraft(current => current + emoji)} aria-label={`Insert ${emoji}`}>{emoji}</button>)}</div>
                    </div>
                  )}
                  {attachOpen && (
                    <div className="attachment-popover">
                      <button onClick={() => imageInputRef.current?.click()}><span className="attach-menu-icon attach-photo"><ImagePlus size={18} /></span><span><strong>Photos & videos</strong><small>Share a moment</small></span></button>
                      <button onClick={() => fileInputRef.current?.click()}><span className="attach-menu-icon attach-file"><FileText size={18} /></span><span><strong>Document</strong><small>Share a file</small></span></button>
                      <button onClick={() => void startVoiceNote()}><span className="attach-menu-icon attach-voice"><Mic size={18} /></span><span><strong>Voice note</strong><small>Record a quick hello</small></span></button>
                    </div>
                  )}
                  <div className="composer-row">
                    <button className={`composer-tool ${attachOpen ? 'tool-active' : ''}`} onClick={() => { setAttachOpen(!attachOpen); setEmojiOpen(false); }} aria-label="Add an attachment" title="Add an attachment"><Paperclip size={20} /></button>
                    <div className="composer-input-wrap">
                      <textarea
                        rows={1}
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            void handleSendText();
                          }
                        }}
                        placeholder={`Message ${selectedChat.isGroup ? 'the group' : (selectedPerson?.name.split(' ')[0] || 'your friend')}…`}
                        aria-label="Write a message"
                      />
                      <button className={`composer-tool emoji-tool ${emojiOpen ? 'tool-active' : ''}`} onClick={() => { setEmojiOpen(!emojiOpen); setAttachOpen(false); }} aria-label="Open emoji picker" title="Emoji"><Smile size={20} /></button>
                    </div>
                    {draft.trim() ? (
                      <button className="send-button" onClick={() => void handleSendText()} aria-label="Send message"><Send size={17} /></button>
                    ) : (
                      <button className={`voice-button ${recording ? 'recording' : ''}`} onClick={() => void startVoiceNote()} aria-label={recording ? 'Stop and send voice note' : 'Record a voice note'} title={recording ? 'Stop and send' : 'Voice note'}>{recording ? <MicOff size={18} /> : <Mic size={18} />}</button>
                    )}
                  </div>
                  <div className="composer-hint">Press <kbd>Enter</kbd> to send <span>·</span> <kbd>Shift + Enter</kbd> for a new line</div>
                </div>
                <input ref={imageInputRef} type="file" accept="image/*,video/*" className="visually-hidden" onChange={onImageChosen} />
                <input ref={fileInputRef} type="file" className="visually-hidden" onChange={onImageChosen} />
              </div>
              {showInfo && (
                <aside className="conversation-info">
                  <div className="info-panel-heading"><strong>Details</strong><button className="icon-button" onClick={() => setShowInfo(false)} aria-label="Close details"><X size={17} /></button></div>
                  {selectedChat.isGroup ? <AvatarStack members={selectedChat.participants.filter(uid => uid !== currentUserId).map(uid => peopleById.get(uid)).filter((person): person is Person => Boolean(person))} /> : <Avatar person={selectedPerson} size="large" />}
                  <h3>{chatName(selectedChat, peopleById, currentUserId)}</h3>
                  {selectedPerson && <><span className="info-username">@{selectedPerson.username}</span><p>{selectedPerson.bio || 'A friend in your circle.'}</p></>}
                  {selectedChat.isGroup && <p>{selectedChat.participants.length} people sharing the memories.</p>}
                  <div className="info-divider" />
                  <span className="info-label">Shared in this chat</span>
                  <div className="shared-photo-grid">{selectedMessages.filter(message => message.type === 'image').slice(-4).map(message => <button key={message.id} onClick={() => setImagePreview(message)}><img src={message.content} alt={message.fileName || 'Shared image'} /></button>)}{selectedMessages.every(message => message.type !== 'image') && <span>No photos shared yet</span>}</div>
                  <div className="info-privacy"><ShieldCheck size={16} /><span>Only members of this conversation can see its messages.</span></div>
                </aside>
              )}
            </div>
          </>
        ) : (
          <div className="conversation-empty-state"><span className="empty-orbit"><MessageCircleMore size={32} /></span><span className="section-kicker">FRIENDCONNECT</span><h2>Your people, a message away.</h2><p>Pick a conversation or find an old friend to say hello.</p><button className="primary-button" onClick={() => { setView('friends'); setFriendTab('discover'); }}><UserRoundPlus size={17} /> Find a friend</button><span className="empty-state-footnote"><ShieldCheck size={14} /> A private place for your circle</span></div>
        )}
      </main>
    </div>
  );

  const renderFriends = () => (
    <section className="full-page friends-page">
      <div className="page-topline"><div><span className="section-kicker">YOUR CIRCLE</span><h1>Friends <span className="page-count">{visibleFriends.length}</span></h1><p>Stay close to the people who know your stories.</p></div><button className="primary-button" onClick={() => setFriendTab('discover')}><UserRoundPlus size={17} /> Find someone</button></div>
      <div className="page-search-row"><label className="search-box"><Search size={17} /><input value={friendSearch} onChange={event => setFriendSearch(event.target.value)} placeholder={friendTab === 'discover' ? 'Search by name or username' : 'Search your people'} aria-label="Search friends" />{friendSearch && <button onClick={() => setFriendSearch('')} aria-label="Clear search"><X size={15} /></button>}</label></div>
      <div className="friends-tabs" role="tablist" aria-label="Friend lists">
        <button className={friendTab === 'friends' ? 'active' : ''} role="tab" aria-selected={friendTab === 'friends'} onClick={() => setFriendTab('friends')}>All friends <span>{visibleFriends.length}</span></button>
        <button className={friendTab === 'requests' ? 'active' : ''} role="tab" aria-selected={friendTab === 'requests'} onClick={() => setFriendTab('requests')}>Requests {incomingRequests.length > 0 && <span className="request-count">{incomingRequests.length}</span>}</button>
        <button className={friendTab === 'discover' ? 'active' : ''} role="tab" aria-selected={friendTab === 'discover'} onClick={() => setFriendTab('discover')}>Find people</button>
      </div>
      {friendTab === 'friends' && (
        visibleFriends.length ? <div className="people-grid">{visibleFriends.filter(person => `${person.name} ${person.username}`.toLowerCase().includes(friendSearch.toLowerCase())).map(person => (
          <article className="person-card" key={person.uid}>
            <div className="person-card-cover" />
            <Avatar person={person} size="large" online={Boolean(person.onlineStatus)} />
            <div className="person-card-copy"><h3>{person.name}</h3><span>@{person.username}</span><p>{person.bio || 'A friend in your circle.'}</p></div>
            <div className="person-card-actions"><button className="primary-button compact" onClick={() => void handleStartChat(person)}><MessageCircleMore size={16} /> Message</button><button className="icon-button outlined" onClick={() => void handleStartCall(person, 'video')} aria-label={`Video call ${person.name}`}><Video size={17} /></button></div>
          </article>
        ))}</div> : <div className="empty-page-state"><span className="empty-icon"><UsersRound size={23} /></span><h3>No friends to show</h3><p>Try a different search or look for someone you know.</p><button className="primary-button" onClick={() => setFriendTab('discover')}><UserRoundPlus size={17} /> Find people</button></div>
      )}
      {friendTab === 'requests' && (
        <div className="request-list">
          {incomingRequests.length === 0 && outgoingRequests.length === 0 ? <div className="empty-page-state"><span className="empty-icon"><Heart size={22} /></span><h3>All caught up</h3><p>Friend requests will show up here.</p><button className="text-button" onClick={() => setFriendTab('discover')}>Find someone to invite <ArrowLeft size={15} className="arrow-rotated" /></button></div> : <>
            {incomingRequests.length > 0 && <><div className="subsection-title"><h2>Received</h2><span>{incomingRequests.length} waiting</span></div>{incomingRequests.map(request => {
              const person = peopleById.get(request.senderId);
              if (!person) return null;
              return <article className="request-card" key={request.id}><Avatar person={person} size="medium" online={Boolean(person.onlineStatus)} /><div className="request-card-copy"><strong>{person.name}</strong><span>@{person.username} · wants to reconnect</span></div><button className="primary-button compact" disabled={requestBusy === request.id} onClick={() => void handleRespond(request, true)}>{requestBusy === request.id ? '…' : 'Accept'}</button><button className="subtle-button" disabled={requestBusy === request.id} onClick={() => void handleRespond(request, false)}>Decline</button></article>;
            })}</>}
            {outgoingRequests.length > 0 && <><div className="subsection-title outgoing-title"><h2>Sent</h2><span>They’ll see it when they’re back</span></div>{outgoingRequests.map(request => {
              const person = peopleById.get(request.receiverId);
              return <article className="request-card sent-request" key={request.id}><Avatar person={person} size="medium" /><div className="request-card-copy"><strong>{person?.name || 'Friend'}</strong><span>Request sent · @{person?.username}</span></div><span className="pending-label">Pending</span></article>;
            })}</>}
          </>}</div>
      )}
      {friendTab === 'discover' && (
        <div className="discover-panel">
          <div className="discover-intro"><span className="discover-spark"><Sparkles size={19} /></span><div><h2>A familiar face?</h2><p>Find someone from your past and bring them into your circle.</p></div></div>
          {discoverPeople.length === 0 ? <div className="empty-page-state compact-empty"><span className="empty-icon"><Search size={22} /></span><h3>No people found</h3><p>Try searching for a name or username.</p></div> : <div className="discover-list">{discoverPeople.map(person => {
            const pending = pendingForPerson(person.uid);
            const waitingOnYou = incomingRequests.some(request => request.senderId === person.uid);
            return <article className="discover-row" key={person.uid}><Avatar person={person} size="medium" online={Boolean(person.onlineStatus)} /><div className="discover-row-copy"><strong>{person.name}</strong><span>@{person.username} {person.bio ? `· ${person.bio}` : ''}</span></div>{waitingOnYou ? <button className="text-button" onClick={() => setFriendTab('requests')}>Respond <ChevronDown size={15} /></button> : pending ? <span className="pending-label">Requested</span> : <button className="outline-button" disabled={requestBusy === person.uid} onClick={() => void handleFriendRequest(person)}><Plus size={16} /> {requestBusy === person.uid ? 'Sending' : 'Add friend'}</button>}</article>;
          })}</div>}
          {isDemo && <div className="demo-directory-note"><ShieldCheck size={16} /><span>Names here are examples. Preview requests stay in this browser.</span></div>}
        </div>
      )}
    </section>
  );

  const renderCalls = () => {
    const sortedCalls = [...callHistory].sort((a, b) => b.createdAt - a.createdAt);
    return (
      <section className="full-page calls-page">
        <div className="page-topline"><div><span className="section-kicker">A QUICK HELLO</span><h1>Calls</h1><p>Catch up with a voice or a familiar face.</p></div><button className="primary-button" onClick={() => { setView('friends'); setFriendTab('friends'); }}><PhoneCall size={17} /> Call a friend</button></div>
        <div className="call-page-card"><div className="call-page-card-icon"><Video size={21} /></div><div><strong>Voice and video calls</strong><span>{isDemo ? 'Explore the call screen with a safe, simulated preview call.' : 'Start an encrypted peer-to-peer call with a friend in your circle.'}</span></div><span className="call-quality-pill"><i /> {isDemo ? 'Preview mode' : 'Ready to connect'}</span></div>
        <div className="call-history-heading"><h2>Recent</h2><span>{sortedCalls.length} calls</span></div>
        {sortedCalls.length ? <div className="call-history-list">{sortedCalls.map(item => {
          const person = peopleById.get(item.peerId);
          const Icon = item.status === 'missed' ? PhoneMissed : item.direction === 'incoming' ? PhoneIncoming : PhoneOutgoing;
          return <article className="call-history-row" key={item.id}><Avatar person={person} size="medium" online={Boolean(person?.onlineStatus)} /><span className={`call-history-icon ${item.status === 'missed' ? 'missed-call' : ''}`}><Icon size={17} /></span><div className="call-history-copy"><strong>{person?.name || 'Friend'}</strong><span>{item.direction === 'incoming' ? 'Incoming' : 'Outgoing'} {item.type} call {item.status === 'missed' ? '· missed' : item.status === 'declined' ? '· declined' : ''}</span></div><time>{timeLabel(item.createdAt)}{item.createdAt && new Date(item.createdAt).toDateString() === new Date().toDateString() ? ` · ${timeOfDay(item.createdAt)}` : ''}</time><button className="icon-button call-again" onClick={() => void handleStartCall(person || null, item.type)} aria-label={`Call ${person?.name || 'friend'} again`}><Phone size={17} /></button></article>;
        })}</div> : <div className="empty-page-state"><span className="empty-icon"><Phone size={22} /></span><h3>No calls yet</h3><p>When you call a friend, your recent calls will appear here.</p><button className="primary-button" onClick={() => { setView('friends'); setFriendTab('friends'); }}><UsersRound size={17} /> See your friends</button></div>}
        <div className="call-privacy-note"><ShieldCheck size={16} /><span>Calls connect directly between devices. A relay may be needed on some networks.</span><button onClick={() => notify('Your audio and video stay between participants in the call.')}>How calls work</button></div>
      </section>
    );
  };

  const renderProfile = () => (
    <section className="full-page profile-page">
      <div className="page-topline"><div><span className="section-kicker">A LITTLE ABOUT YOU</span><h1>Your profile</h1><p>Make it easy for old friends to find you.</p></div>{!editingProfile && <button className="outline-button" onClick={() => setEditingProfile(true)}><Settings size={16} /> Edit profile</button>}</div>
      <div className="profile-layout">
        <div className="profile-card-main">
          <div className="profile-cover"><span className="cover-sun" /><span className="cover-line line-one" /><span className="cover-line line-two" /><span className="cover-caption">GOOD TO SEE YOU AGAIN</span></div>
          <div className="profile-main-info"><Avatar person={profile} size="hero" /><div><h2>{profile.name}</h2><span>@{profile.username}</span><p>{profile.bio || 'Add a few words so friends know it’s you.'}</p></div></div>
          <div className="profile-info-grid"><div><span>Circle</span><strong>Private</strong></div><div><span>Friends</span><strong>{friends.length} people</strong></div><div><span>Member since</span><strong>{profile.createdAt ? new Date(profile.createdAt).getFullYear() : isDemo ? 'Demo' : 'Recently'}</strong></div></div>
          {editingProfile && <form className="profile-edit-form" onSubmit={handleSaveProfile}>
            <label>Display name<input value={profileForm.name} onChange={event => setProfileForm(current => ({ ...current, name: event.target.value }))} maxLength={60} required /></label>
            <label>Username<div className="username-input"><span>@</span><input value={profileForm.username} onChange={event => setProfileForm(current => ({ ...current, username: event.target.value.replace(/^@/, '') }))} maxLength={30} required /></div></label>
            <label>About you<textarea value={profileForm.bio} onChange={event => setProfileForm(current => ({ ...current, bio: event.target.value }))} maxLength={180} rows={3} placeholder="A little hello to your friends…" /></label>
            <label>Phone number <span className="optional-label">optional</span><input value={profileForm.phone} onChange={event => setProfileForm(current => ({ ...current, phone: event.target.value }))} type="tel" placeholder="Add a number" /></label>
            <div className="profile-form-actions"><button type="button" className="subtle-button" onClick={() => { setEditingProfile(false); setProfileForm({ name: profile.name, username: profile.username, bio: profile.bio || '', phone: profile.phone || '' }); }}>Cancel</button><button className="primary-button" disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save changes'}</button></div>
          </form>}
        </div>
        <aside className="profile-side-column">
          <div className="privacy-card"><div className="privacy-icon"><ShieldCheck size={19} /></div><div><h3>Your circle is private</h3><p>FriendConnect is a space for people you invite and approve. Your conversations are only visible to their participants.</p></div></div>
          <div className="profile-settings-card"><span className="section-kicker">ACCOUNT</span><button onClick={() => notify('Notification preferences are coming soon.')}><Bell size={18} /><span><strong>Notifications</strong><small>Choose how you hear from friends</small></span><ChevronLeft size={17} className="settings-chevron" /></button><button onClick={() => notify('Your profile is only visible to your approved circle.')}><ShieldCheck size={18} /><span><strong>Privacy & safety</strong><small>Manage your private circle</small></span><ChevronLeft size={17} className="settings-chevron" /></button><button onClick={() => notify('For support, contact the person who invited you.')}><CircleHelp size={18} /><span><strong>Help & support</strong><small>We’re here to help</small></span><ChevronLeft size={17} className="settings-chevron" /></button></div>
          {isDemo && <button className="reset-demo-button" onClick={() => { data.resetDemo(); setEditingProfile(false); notify('Sample workspace restored.'); }}><Sparkles size={16} /> Reset sample workspace</button>}
          <div className="account-mode-note"><span className="mode-dot" />{isDemo ? 'You’re exploring a sample workspace' : 'Signed in to your private account'}<button onClick={() => void onLogout()}>{isDemo ? 'Exit preview' : 'Sign out'}</button></div>
        </aside>
      </div>
    </section>
  );

  return (
    <div className={`messenger-app ${isDemo ? 'is-demo' : ''} ${view !== 'chats' ? 'page-view' : ''}`}>
      <NavRail view={view} setView={next => { setView(next); if (next === 'chats') setMobileChatOpen(false); }} profile={profile} requestsCount={incomingRequests.length} onLogout={() => void onLogout()} isDemo={isDemo} />
      <div className="workspace-main">
        {view === 'chats' && renderChatWorkspace()}
        {view === 'friends' && renderFriends()}
        {view === 'calls' && renderCalls()}
        {view === 'profile' && renderProfile()}
      </div>
      {notice && <div className="toast-message" role="status"><span className="toast-spark">✦</span><span>{notice}</span><button onClick={() => { setNotice(''); data.clearError(); clearCallError(); }} aria-label="Dismiss notification"><X size={16} /></button></div>}
      {call && <CallOverlay call={call} onAccept={() => void acceptCall()} onReject={() => void rejectCall()} onEnd={() => void endCall()} onToggleMute={toggleMute} onToggleCamera={toggleCamera} />}
      {imagePreview && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="Shared image" onClick={() => setImagePreview(null)}><button className="lightbox-close" onClick={() => setImagePreview(null)} aria-label="Close image"><X size={20} /></button><img src={imagePreview.content} alt={imagePreview.fileName || 'Shared image'} onClick={event => event.stopPropagation()} /><span>{imagePreview.fileName || 'Shared image'} · {formatBytes(imagePreview.sizeBytes)}</span></div>}
      <Link to="/login" className="sr-only">Sign in</Link>
    </div>
  );
}
