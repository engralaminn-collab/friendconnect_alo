export type MessageType = 'text' | 'image' | 'video' | 'file' | 'audio';
export type RequestStatus = 'pending' | 'accepted' | 'rejected';

export interface Person {
  uid: string;
  name: string;
  username: string;
  email?: string;
  phone?: string;
  photoUrl?: string;
  bio?: string;
  onlineStatus?: boolean;
  lastSeen?: number;
  createdAt?: number;
  isActive?: boolean;
  approved?: boolean;
  role?: 'user' | 'admin';
  profileVisibility?: 'private' | 'hidden' | 'public';
}

export interface MessengerChat {
  id: string;
  participants: string[];
  createdAt: number;
  lastMessage?: string;
  lastMessageTime?: number;
  groupName?: string;
  isGroup?: boolean;
}

export interface MessengerMessage {
  id: string;
  chatId: string;
  senderId: string;
  type: MessageType;
  content: string;
  createdAt: number;
  status: 'sent' | 'delivered' | 'seen';
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  reactions?: Record<string, string>;
}

export interface FriendRequestRecord {
  id: string;
  senderId: string;
  receiverId: string;
  status: RequestStatus;
  createdAt: number;
}

export interface CallHistoryItem {
  id: string;
  peerId: string;
  direction: 'incoming' | 'outgoing';
  type: 'audio' | 'video';
  status: 'missed' | 'completed' | 'declined';
  createdAt: number;
}

export interface DemoData {
  profile: Person;
  people: Person[];
  friends: string[];
  requests: FriendRequestRecord[];
  chats: MessengerChat[];
  messages: Record<string, MessengerMessage[]>;
  calls: CallHistoryItem[];
}
