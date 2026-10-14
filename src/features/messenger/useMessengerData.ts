import { useCallback, useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { useAuthStore } from '../../core/store/authStore';
import type { User } from '../../core/models/types';
import { db, storage } from '../../firebase/config';
import { createDemoData, DEMO_STORAGE_KEY, restoreDemoData } from './demoData';
import type { CallHistoryItem, DemoData, FriendRequestRecord, MessengerChat, MessengerMessage, MessageType, Person } from './types';

type MessengerMode = 'demo' | 'live';

const displayMessage = (message: Pick<MessengerMessage, 'type' | 'content' | 'fileName'>) => {
  if (message.type === 'image') return '📷 Photo';
  if (message.type === 'video') return '🎬 Video';
  if (message.type === 'file') return `📎 ${message.fileName || 'Document'}`;
  if (message.type === 'audio') return '🎙️ Voice message';
  return message.content;
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read this file.'));
    reader.onerror = () => reject(new Error('Could not read this file.'));
    reader.readAsDataURL(file);
  });
}

function contentTypeFor(file: File): MessageType {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'file';
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'attachment';
}

interface UseMessengerDataResult {
  mode: MessengerMode;
  currentUserId: string;
  profile: Person;
  people: Person[];
  friends: string[];
  requests: FriendRequestRecord[];
  chats: MessengerChat[];
  messagesByChat: Record<string, MessengerMessage[]>;
  callHistory: CallHistoryItem[];
  selectedChatId: string;
  setSelectedChatId: (chatId: string) => void;
  loading: boolean;
  error: string;
  clearError: () => void;
  sendText: (text: string) => Promise<void>;
  sendFile: (chatId: string, file: File, onProgress?: (progress: number) => void) => Promise<void>;
  toggleReaction: (chatId: string, messageId: string, emoji: string) => Promise<void>;
  startChat: (person: Person) => Promise<string>;
  requestFriend: (person: Person) => Promise<void>;
  respondToRequest: (request: FriendRequestRecord, accepted: boolean) => Promise<void>;
  updateProfile: (changes: Partial<Pick<Person, 'name' | 'username' | 'bio' | 'phone'>>) => Promise<void>;
  resetDemo: () => void;
}

export function useMessengerData(mode: MessengerMode): UseMessengerDataResult {
  const firebaseUser = useAuthStore(state => state.firebaseUser);
  const authProfile = useAuthStore(state => state.userProfile);
  const setAuthProfile = useAuthStore(state => state.setProfile);
  const currentUserId = mode === 'demo' ? 'demo-jamie' : firebaseUser?.uid || '';

  const [profileState, setProfileState] = useState<Person>(createDemoData().profile);
  const [people, setPeople] = useState<Person[]>([]);
  const [friends, setFriends] = useState<string[]>([]);
  const [requests, setRequests] = useState<FriendRequestRecord[]>([]);
  const [chats, setChats] = useState<MessengerChat[]>([]);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, MessengerMessage[]>>({});
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>([]);
  const [selectedChatId, setSelectedChatId] = useState('');
  const [loading, setLoading] = useState(mode === 'live');
  const [error, setError] = useState('');
  const [demoHydrated, setDemoHydrated] = useState(false);

  const profile = mode === 'demo' ? profileState : ((authProfile as Person | null) || profileState);

  useEffect(() => {
    if (mode === 'demo') {
      const restored: DemoData = restoreDemoData();
      setProfileState(restored.profile);
      setPeople(restored.people);
      setFriends(restored.friends);
      setRequests(restored.requests);
      setChats(restored.chats);
      setMessagesByChat(restored.messages);
      setCallHistory(restored.calls);
      setSelectedChatId(current => current || restored.chats[0]?.id || '');
      setLoading(false);
      setDemoHydrated(true);
      return;
    }

    setLoading(true);
    setDemoHydrated(false);
    setError('');
    setPeople([]);
    setFriends([]);
    setRequests([]);
    setChats([]);
    setMessagesByChat({});
    setCallHistory([]);
    setSelectedChatId('');

    if (!currentUserId) {
      setLoading(false);
      return;
    }

    const cleanups: Array<() => void> = [];
    let usersLoaded = false;
    let chatsLoaded = false;
    const fail = (reason: Error) => {
      setError(reason.message || 'Could not load your messages.');
      setLoading(false);
    };

    cleanups.push(onSnapshot(collection(db, 'users'), snapshot => {
      const members = snapshot.docs
        .map(item => ({ ...item.data(), uid: item.id } as Person))
        .filter(person => person.isActive !== false && person.approved !== false);
      setPeople(members);
      usersLoaded = true;
      if (usersLoaded && chatsLoaded) setLoading(false);
    }, fail));

    cleanups.push(onSnapshot(query(collection(db, 'friends'), where('userId', '==', currentUserId)), snapshot => {
      setFriends(snapshot.docs.map(item => String(item.data().friendId || '')).filter(Boolean));
    }, fail));

    const outgoing = new Map<string, FriendRequestRecord>();
    const incoming = new Map<string, FriendRequestRecord>();
    const publishRequests = () => setRequests([...outgoing.values(), ...incoming.values()].sort((a, b) => b.createdAt - a.createdAt));
    cleanups.push(onSnapshot(query(collection(db, 'friendRequests'), where('senderId', '==', currentUserId)), snapshot => {
      outgoing.clear();
      snapshot.docs.forEach(item => outgoing.set(item.id, { ...item.data(), id: item.id } as FriendRequestRecord));
      publishRequests();
    }, fail));
    cleanups.push(onSnapshot(query(collection(db, 'friendRequests'), where('receiverId', '==', currentUserId)), snapshot => {
      incoming.clear();
      snapshot.docs.forEach(item => incoming.set(item.id, { ...item.data(), id: item.id } as FriendRequestRecord));
      publishRequests();
    }, fail));

    cleanups.push(onSnapshot(query(collection(db, 'chats'), where('participants', 'array-contains', currentUserId)), snapshot => {
      const loadedChats = snapshot.docs.map(item => ({ ...item.data(), id: item.id } as MessengerChat))
        .sort((a, b) => (b.lastMessageTime || b.createdAt) - (a.lastMessageTime || a.createdAt));
      setChats(loadedChats);
      setSelectedChatId(current => current || loadedChats[0]?.id || '');
      chatsLoaded = true;
      if (usersLoaded && chatsLoaded) setLoading(false);
    }, fail));

    const callerItems = new Map<string, CallHistoryItem>();
    const receiverItems = new Map<string, CallHistoryItem>();
    const publishCalls = () => setCallHistory([...callerItems.values(), ...receiverItems.values()].sort((a, b) => b.createdAt - a.createdAt));
    cleanups.push(onSnapshot(query(collection(db, 'calls'), where('callerId', '==', currentUserId)), snapshot => {
      callerItems.clear();
      snapshot.docs.forEach(item => {
        const data = item.data();
        if (data.status === 'preparing' || data.status === 'calling' || data.status === 'accepted') return;
        callerItems.set(item.id, {
          id: item.id,
          peerId: data.receiverId,
          direction: 'outgoing',
          type: data.type === 'video' ? 'video' : 'audio',
          status: data.status === 'rejected' ? 'declined' : data.status === 'ended' ? 'completed' : 'missed',
          createdAt: Number(data.createdAt || 0),
        });
      });
      publishCalls();
    }, fail));
    cleanups.push(onSnapshot(query(collection(db, 'calls'), where('receiverId', '==', currentUserId)), snapshot => {
      receiverItems.clear();
      snapshot.docs.forEach(item => {
        const data = item.data();
        if (data.status === 'preparing' || data.status === 'calling' || data.status === 'accepted') return;
        receiverItems.set(item.id, {
          id: item.id,
          peerId: data.callerId,
          direction: 'incoming',
          type: data.type === 'video' ? 'video' : 'audio',
          status: data.status === 'rejected' ? 'declined' : data.status === 'ended' ? 'completed' : 'missed',
          createdAt: Number(data.createdAt || 0),
        });
      });
      publishCalls();
    }, fail));

    return () => cleanups.forEach(unsubscribe => unsubscribe());
  }, [mode, currentUserId]);

  useEffect(() => {
    if (mode !== 'demo' || !demoHydrated) return;
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ profile: profileState, people, friends, requests, chats, messages: messagesByChat, calls: callHistory }));
    } catch {
      setError('This browser is low on local storage. Try a smaller demo attachment.');
    }
  }, [mode, demoHydrated, profileState, people, friends, requests, chats, messagesByChat, callHistory]);

  useEffect(() => {
    if (mode !== 'demo' || !selectedChatId) return;
    setMessagesByChat(current => {
      const messages = current[selectedChatId] || [];
      const hasUnread = messages.some(message => message.senderId !== currentUserId && message.status !== 'seen');
      if (!hasUnread) return current;
      return { ...current, [selectedChatId]: messages.map(message => message.senderId !== currentUserId ? { ...message, status: 'seen' } : message) };
    });
  }, [mode, currentUserId, selectedChatId]);

  useEffect(() => {
    if (mode !== 'live' || !currentUserId || !selectedChatId) return;
    const messagesQuery = query(collection(db, 'chats', selectedChatId, 'messages'), orderBy('createdAt', 'asc'));
    return onSnapshot(messagesQuery, snapshot => {
      const loadedMessages = snapshot.docs.map(item => ({ ...item.data(), id: item.id, chatId: selectedChatId } as MessengerMessage));
      setMessagesByChat(current => ({ ...current, [selectedChatId]: loadedMessages }));
      snapshot.docs.forEach(item => {
        const data = item.data();
        if (data.senderId !== currentUserId && data.status !== 'seen') {
          void updateDoc(item.ref, { status: 'seen', readAt: Date.now() }).catch(() => undefined);
        }
      });
    }, reason => setError(reason.message || 'Could not load this conversation.'));
  }, [mode, currentUserId, selectedChatId]);

  const appendMessage = useCallback((chatId: string, next: MessengerMessage) => {
    setMessagesByChat(current => ({ ...current, [chatId]: [...(current[chatId] || []), next] }));
    const lastMessage = displayMessage(next);
    setChats(current => current.map(chat => chat.id === chatId ? { ...chat, lastMessage, lastMessageTime: next.createdAt } : chat)
      .sort((a, b) => (b.lastMessageTime || b.createdAt) - (a.lastMessageTime || a.createdAt)));
  }, []);

  const sendText = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || !selectedChatId || !currentUserId) return;
    const createdAt = Date.now();
    if (mode === 'demo') {
      appendMessage(selectedChatId, {
        id: `demo-message-${createdAt}-${Math.random().toString(16).slice(2, 7)}`,
        chatId: selectedChatId,
        senderId: currentUserId,
        type: 'text',
        content,
        createdAt,
        status: 'seen',
      });
      return;
    }
    const messageRef = await addDoc(collection(db, 'chats', selectedChatId, 'messages'), {
      chatId: selectedChatId,
      senderId: currentUserId,
      type: 'text',
      content,
      createdAt,
      status: 'sent',
    });
    appendMessage(selectedChatId, { id: messageRef.id, chatId: selectedChatId, senderId: currentUserId, type: 'text', content, createdAt, status: 'sent' });
    await updateDoc(doc(db, 'chats', selectedChatId), { lastMessage: content, lastMessageTime: createdAt });
  }, [mode, selectedChatId, currentUserId, appendMessage]);

  const sendFile = useCallback(async (chatId: string, file: File, onProgress?: (progress: number) => void) => {
    if (!currentUserId) throw new Error('Sign in to share files.');
    const type = contentTypeFor(file);
    const createdAt = Date.now();
    let content: string;
    if (mode === 'demo') {
      if (file.size > 1_000_000) throw new Error('Demo files are limited to 1 MB. Sign in to share full-size files.');
      content = await readAsDataUrl(file);
      onProgress?.(100);
    } else {
      if (file.size > 50 * 1024 * 1024) throw new Error('Files must be smaller than 50 MB.');
      const objectRef = ref(storage, `chat/${chatId}/${currentUserId}/${createdAt}_${safeFileName(file.name)}`);
      const task = uploadBytesResumable(objectRef, file, { contentType: file.type || 'application/octet-stream' });
      await new Promise<void>((resolve, reject) => {
        task.on('state_changed', snapshot => onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)), reject, resolve);
      });
      content = await getDownloadURL(task.snapshot.ref);
    }

    const message: MessengerMessage = {
      id: `media-${createdAt}-${Math.random().toString(16).slice(2, 7)}`,
      chatId,
      senderId: currentUserId,
      type,
      content,
      createdAt,
      status: mode === 'demo' ? 'seen' : 'sent',
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    };

    if (mode === 'demo') {
      appendMessage(chatId, message);
      return;
    }

    const messageRef = await addDoc(collection(db, 'chats', chatId, 'messages'), {
      chatId,
      senderId: currentUserId,
      type,
      content,
      createdAt,
      status: 'sent',
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    });
    appendMessage(chatId, { ...message, id: messageRef.id });
    await updateDoc(doc(db, 'chats', chatId), { lastMessage: displayMessage(message), lastMessageTime: createdAt });
  }, [mode, currentUserId, appendMessage]);

  const toggleReaction = useCallback(async (chatId: string, messageId: string, emoji: string) => {
    if (!currentUserId) return;
    const target = (messagesByChat[chatId] || []).find(item => item.id === messageId);
    if (!target) return;
    const reactions = { ...(target.reactions || {}) };
    const remove = reactions[currentUserId] === emoji;
    if (remove) delete reactions[currentUserId];
    else reactions[currentUserId] = emoji;
    if (mode === 'demo') {
      setMessagesByChat(current => ({
        ...current,
        [chatId]: (current[chatId] || []).map(item => item.id === messageId ? { ...item, reactions } : item),
      }));
      return;
    }
    await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), {
      [`reactions.${currentUserId}`]: remove ? deleteField() : emoji,
    });
  }, [mode, currentUserId, messagesByChat]);

  const startChat = useCallback(async (person: Person) => {
    const existing = chats.find(chat => !chat.isGroup && chat.participants.length === 2 && chat.participants.includes(person.uid));
    if (existing) {
      setSelectedChatId(existing.id);
      return existing.id;
    }
    if (mode === 'demo') {
      const id = `demo-chat-${Date.now()}-${person.uid}`;
      const createdAt = Date.now();
      setChats(current => [{ id, participants: [currentUserId, person.uid], createdAt, lastMessage: '', lastMessageTime: createdAt }, ...current]);
      setMessagesByChat(current => ({ ...current, [id]: [] }));
      setSelectedChatId(id);
      return id;
    }
    if (!friends.includes(person.uid)) throw new Error('Add this person as a friend before starting a chat.');
    const chatRef = doc(collection(db, 'chats'));
    const createdAt = Date.now();
    await setDoc(chatRef, { participants: [currentUserId, person.uid], createdAt, lastMessage: '', lastMessageTime: createdAt, typing: {} });
    setSelectedChatId(chatRef.id);
    return chatRef.id;
  }, [mode, currentUserId, chats, friends]);

  const requestFriend = useCallback(async (person: Person) => {
    if (!currentUserId || person.uid === currentUserId) return;
    if (mode === 'demo') {
      setRequests(current => {
        if (current.some(request => request.senderId === currentUserId && request.receiverId === person.uid && request.status === 'pending')) return current;
        return [{ id: `${currentUserId}_${person.uid}`, senderId: currentUserId, receiverId: person.uid, status: 'pending', createdAt: Date.now() }, ...current];
      });
      return;
    }
    const id = `${currentUserId}_${person.uid}`;
    await setDoc(doc(db, 'friendRequests', id), {
      senderId: currentUserId,
      receiverId: person.uid,
      status: 'pending',
      createdAt: Date.now(),
    });
  }, [mode, currentUserId]);

  const respondToRequest = useCallback(async (request: FriendRequestRecord, accepted: boolean) => {
    if (mode === 'demo') {
      setRequests(current => current.map(item => item.id === request.id ? { ...item, status: accepted ? 'accepted' : 'rejected' } : item));
      if (accepted) {
        const friendId = request.senderId === currentUserId ? request.receiverId : request.senderId;
        setFriends(current => current.includes(friendId) ? current : [...current, friendId]);
      }
      return;
    }
    await updateDoc(doc(db, 'friendRequests', request.id), { status: accepted ? 'accepted' : 'rejected' });
    if (!accepted) return;
    const otherId = request.senderId === currentUserId ? request.receiverId : request.senderId;
    const createdAt = Date.now();
    const batch = writeBatch(db);
    batch.set(doc(db, 'friends', `${currentUserId}_${otherId}`), { userId: currentUserId, friendId: otherId, createdAt });
    batch.set(doc(db, 'friends', `${otherId}_${currentUserId}`), { userId: otherId, friendId: currentUserId, createdAt });
    await batch.commit();
  }, [mode, currentUserId]);

  const updateProfile = useCallback(async (changes: Partial<Pick<Person, 'name' | 'username' | 'bio' | 'phone'>>) => {
    if (mode === 'demo') {
      setProfileState(current => ({ ...current, ...changes }));
      return;
    }
    if (!currentUserId) throw new Error('Sign in to update your profile.');
    await updateDoc(doc(db, 'users', currentUserId), changes);
    if (authProfile) setAuthProfile({ ...authProfile, ...changes } as User);
  }, [mode, currentUserId, authProfile, setAuthProfile]);

  const resetDemo = useCallback(() => {
    if (mode !== 'demo') return;
    const fresh = createDemoData();
    setProfileState(fresh.profile);
    setPeople(fresh.people);
    setFriends(fresh.friends);
    setRequests(fresh.requests);
    setChats(fresh.chats);
    setMessagesByChat(fresh.messages);
    setCallHistory(fresh.calls);
    setSelectedChatId(fresh.chats[0]?.id || '');
    try { localStorage.removeItem(DEMO_STORAGE_KEY); } catch { /* ignore browser storage restrictions */ }
  }, [mode]);

  return {
    mode,
    currentUserId,
    profile,
    people,
    friends,
    requests,
    chats,
    messagesByChat,
    callHistory,
    selectedChatId,
    setSelectedChatId,
    loading,
    error,
    clearError: () => setError(''),
    sendText,
    sendFile,
    toggleReaction,
    startChat,
    requestFriend,
    respondToRequest,
    updateProfile,
    resetDemo,
  };
}
