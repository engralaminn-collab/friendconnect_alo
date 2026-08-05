export type Role = "user" | "admin";
export type ProfileVisibility = "public" | "private" | "hidden";

export interface User {
  uid: string;
  name: string;
  username: string;
  email: string;
  phone?: string;
  photoUrl?: string;
  bio?: string;
  onlineStatus: boolean;
  lastSeen: number;
  createdAt: number;
  isActive: boolean;
  approved?: boolean;
  role: Role;
  profileVisibility: ProfileVisibility;
}

export interface FriendRequest {
  id: string;
  senderId: string;
  receiverId: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: number;
}

export interface Friend {
  userId: string;
  friendId: string;
  createdAt: number;
}

export interface Chat {
  id: string;
  participants: string[];
  lastMessage?: string;
  lastMessageTime?: number;
  createdAt: number;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  type: "text" | "image" | "video" | "file" | "voice";
  content: string;
  createdAt: number;
  status: "sent" | "delivered" | "seen";
}

export interface Call {
  id: string;
  callerId: string;
  receiverId: string;
  type: "audio" | "video";
  status: "calling" | "accepted" | "rejected" | "ended";
  createdAt: number;
}
