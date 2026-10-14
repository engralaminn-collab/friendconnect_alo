import weekendPhoto from '../../assets/friends-weekend.jpg';
import type { CallHistoryItem, DemoData, FriendRequestRecord, MessengerChat, MessengerMessage, Person } from './types';

export const DEMO_STORAGE_KEY = 'friendconnect-demo-workspace-v1';

export const demoProfile: Person = {
  uid: 'demo-jamie',
  name: 'Jamie Taylor',
  username: 'jamietaylor',
  email: 'jamie@example.com',
  bio: 'Collecting stories, old photos, and good people.',
  onlineStatus: true,
  isActive: true,
  approved: true,
  role: 'user',
};

const people: Person[] = [
  { uid: 'friend-maya', name: 'Maya Chen', username: 'mayac', bio: 'Always up for one more story.', onlineStatus: true, isActive: true },
  { uid: 'friend-elliot', name: 'Elliot Brooks', username: 'elliotb', bio: 'Weekend cyclist and terrible pun-maker.', onlineStatus: false, lastSeen: Date.now() - 1000 * 60 * 28, isActive: true },
  { uid: 'friend-noor', name: 'Noor Haddad', username: 'noorh', bio: 'Food, family, and faraway places.', onlineStatus: true, isActive: true },
  { uid: 'friend-sam', name: 'Sam Rivera', username: 'samrivera', bio: 'Still making playlists for the group.', onlineStatus: false, lastSeen: Date.now() - 1000 * 60 * 63, isActive: true },
  { uid: 'friend-ava', name: 'Ava Patel', username: 'avap', bio: 'A little bit of everything.', onlineStatus: true, isActive: true },
  { uid: 'friend-lena', name: 'Lena Morris', username: 'lenam', bio: 'It has been too long. Let’s fix that.', onlineStatus: false, lastSeen: Date.now() - 1000 * 60 * 60 * 2, isActive: true },
  { uid: 'friend-oliver', name: 'Oliver James', username: 'ojames', bio: 'Here for the catch-ups.', onlineStatus: false, lastSeen: Date.now() - 1000 * 60 * 60 * 5, isActive: true },
];

function makeChat(id: string, participants: string[], lastMessage: string, minsAgo: number, groupName?: string): MessengerChat {
  return {
    id,
    participants,
    lastMessage,
    lastMessageTime: Date.now() - minsAgo * 60_000,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 21,
    ...(groupName ? { groupName, isGroup: true } : {}),
  };
}

function message(chatId: string, id: string, senderId: string, content: string, minsAgo: number, extra: Partial<MessengerMessage> = {}): MessengerMessage {
  return {
    id,
    chatId,
    senderId,
    content,
    type: 'text',
    createdAt: Date.now() - minsAgo * 60_000,
    status: senderId === demoProfile.uid ? 'seen' : 'delivered',
    ...extra,
  };
}

export function createDemoData(): DemoData {
  const mayaChat = 'demo-chat-maya';
  const noorChat = 'demo-chat-noor';
  const sundayChat = 'demo-chat-sunday';
  const elliotChat = 'demo-chat-elliot';
  const avaChat = 'demo-chat-ava';

  const chats: MessengerChat[] = [
    makeChat(mayaChat, [demoProfile.uid, 'friend-maya'], 'We need to make this a yearly thing ✨', 3),
    makeChat(sundayChat, [demoProfile.uid, 'friend-maya', 'friend-elliot', 'friend-noor', 'friend-sam'], 'Sam: I found the old playlist 😂', 41, 'The Sunday Crew'),
    makeChat(noorChat, [demoProfile.uid, 'friend-noor'], 'Sending you the recipe now!', 136),
    makeChat(elliotChat, [demoProfile.uid, 'friend-elliot'], 'Voice message · 0:18', 60 * 7),
    makeChat(avaChat, [demoProfile.uid, 'friend-ava'], 'That made my whole week 💛', 60 * 22),
  ];

  const messages: Record<string, MessengerMessage[]> = {
    [mayaChat]: [
      message(mayaChat, 'maya-1', 'friend-maya', 'Okay, important question: when are we finally doing a proper catch-up?', 53),
      message(mayaChat, 'maya-2', demoProfile.uid, 'This summer. No “we should” and then six months of silence 😄', 49),
      message(mayaChat, 'maya-3', 'friend-maya', 'Deal. I was looking through the old photos and found this one from the lake!', 18),
      message(mayaChat, 'maya-4', 'friend-maya', weekendPhoto, 17, { type: 'image', fileName: 'lake-weekend.jpg', mimeType: 'image/jpeg', sizeBytes: 834_000, reactions: { [demoProfile.uid]: '🥹' } }),
      message(mayaChat, 'maya-5', demoProfile.uid, 'We need to make this a yearly thing ✨', 3, { reactions: { 'friend-maya': '❤️' } }),
    ],
    [sundayChat]: [
      message(sundayChat, 'sun-1', 'friend-noor', 'I made a little group so we can actually pick a weekend this time 👋', 220),
      message(sundayChat, 'sun-2', 'friend-elliot', 'I’m free the first weekend in July. Bikes optional, snacks mandatory.', 122),
      message(sundayChat, 'sun-3', 'friend-sam', 'I found the old playlist 😂', 41, { reactions: { 'friend-maya': '😂', [demoProfile.uid]: '🎶' } }),
    ],
    [noorChat]: [
      message(noorChat, 'noor-1', 'friend-noor', 'I finally wrote down my grandmother’s lemon cake recipe.', 175),
      message(noorChat, 'noor-2', demoProfile.uid, 'Please send it! I have been thinking about that cake for years 🍋', 154),
      message(noorChat, 'noor-3', 'friend-noor', 'Sending you the recipe now!', 136),
    ],
    [elliotChat]: [
      message(elliotChat, 'elliot-1', demoProfile.uid, 'How is the new job treating you?', 60 * 8),
      message(elliotChat, 'elliot-2', 'friend-elliot', 'Really good. I’ll send you a voice note on my walk home.', 60 * 7 + 1),
      message(elliotChat, 'elliot-3', 'friend-elliot', 'Audio note', 60 * 7, { type: 'audio', content: '', fileName: 'walk-home-note.webm', mimeType: 'audio/webm' }),
    ],
    [avaChat]: [
      message(avaChat, 'ava-1', 'friend-ava', 'Your message was such a lovely surprise. We have to get coffee soon ☕', 60 * 24),
      message(avaChat, 'ava-2', demoProfile.uid, 'I would love that. I’m free next week!', 60 * 23),
      message(avaChat, 'ava-3', 'friend-ava', 'That made my whole week 💛', 60 * 22),
    ],
  };

  const requests: FriendRequestRecord[] = [
    { id: 'friend-lena_demo-jamie', senderId: 'friend-lena', receiverId: demoProfile.uid, status: 'pending', createdAt: Date.now() - 1000 * 60 * 40 },
  ];

  const calls: CallHistoryItem[] = [
    { id: 'call-1', peerId: 'friend-maya', direction: 'incoming', type: 'video', status: 'completed', createdAt: Date.now() - 1000 * 60 * 60 * 4 },
    { id: 'call-2', peerId: 'friend-noor', direction: 'outgoing', type: 'audio', status: 'completed', createdAt: Date.now() - 1000 * 60 * 60 * 26 },
    { id: 'call-3', peerId: 'friend-elliot', direction: 'incoming', type: 'audio', status: 'missed', createdAt: Date.now() - 1000 * 60 * 60 * 24 * 3 },
  ];

  return {
    profile: { ...demoProfile },
    people: people.map(person => ({ ...person })),
    friends: ['friend-maya', 'friend-elliot', 'friend-noor', 'friend-sam', 'friend-ava'],
    requests,
    chats,
    messages,
    calls,
  };
}

export function restoreDemoData(): DemoData {
  const fresh = createDemoData();
  try {
    const saved = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!saved) return fresh;
    const parsed = JSON.parse(saved) as Partial<DemoData>;
    return {
      ...fresh,
      ...parsed,
      profile: { ...fresh.profile, ...parsed.profile },
      people: Array.isArray(parsed.people) ? parsed.people : fresh.people,
      friends: Array.isArray(parsed.friends) ? parsed.friends : fresh.friends,
      requests: Array.isArray(parsed.requests) ? parsed.requests : fresh.requests,
      chats: Array.isArray(parsed.chats) ? parsed.chats : fresh.chats,
      messages: parsed.messages && typeof parsed.messages === 'object' ? parsed.messages : fresh.messages,
      calls: Array.isArray(parsed.calls) ? parsed.calls : fresh.calls,
    };
  } catch {
    return fresh;
  }
}
