export type SelfHostedUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: 'member' | 'admin';
  status: 'active' | 'suspended' | 'pending_verification';
  emailVerifiedAt: string | null;
};

export type SelfHostedMember = {
  id: string;
  username: string;
  displayName: string;
  role: 'member' | 'admin';
};

export type SelfHostedConversation = {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  updatedAt: string;
  lastMessageId: string | null;
  lastMessageKind: string | null;
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  members: SelfHostedMember[];
};

export type SelfHostedMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  kind: 'text' | 'image' | 'video' | 'file' | 'audio';
  body: string | null;
  attachmentId: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
  attachmentBytes: number | null;
  replyToId: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  receipts: Array<{ userId: string; deliveredAt: string | null; seenAt: string | null }>;
  reactions: Array<{ userId: string; emoji: string }>;
};

export class SelfHostedApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = 'SelfHostedApiError';
  }
}

const apiRoot = '/api';
const unsafeMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

class SelfHostedApi {
  private csrfToken: string | null = null;

  private async request<T>(path: string, options: {
    method?: string;
    body?: unknown;
    formData?: FormData;
    query?: URLSearchParams;
  } = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const query = options.query?.toString();
    const url = `${apiRoot}${path}${query ? `?${query}` : ''}`;
    const headers = new Headers();
    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData;
    } else if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }
    if (unsafeMethods.has(method) && this.csrfToken) headers.set('X-CSRF-Token', this.csrfToken);

    let response: Response;
    try {
      response = await fetch(url, { method, body, headers, credentials: 'include', cache: 'no-store' });
    } catch {
      throw new SelfHostedApiError(0, 'API_UNAVAILABLE');
    }
    if (response.status === 204) return undefined as T;
    const payload = await response.json().catch(() => null) as { error?: { code?: string } } | T | null;
    if (!response.ok) {
      const code = payload && typeof payload === 'object' && 'error' in payload
        ? (payload.error as { code?: string } | undefined)?.code
        : undefined;
      throw new SelfHostedApiError(response.status, code || 'REQUEST_FAILED');
    }
    return payload as T;
  }

  async session() {
    const result = await this.request<{ user: SelfHostedUser; csrfToken?: string; expiresAt: string }>('/auth/session');
    this.csrfToken = result.csrfToken ?? null;
    return result;
  }

  async login(email: string, password: string) {
    const result = await this.request<{ user: SelfHostedUser; csrfToken?: string; expiresAt: string }>('/auth/login', {
      method: 'POST',
      body: { email, password, clientType: 'web' },
    });
    this.csrfToken = result.csrfToken ?? null;
    return result;
  }

  async logout() {
    await this.request('/auth/logout', { method: 'POST' });
    this.csrfToken = null;
  }

  async register(input: { inviteToken: string; email: string; username: string; displayName: string; password: string }) {
    return this.request<{ verificationRequired: boolean }>('/auth/register', { method: 'POST', body: input });
  }

  async verifyEmail(token: string) {
    return this.request<{ verified: boolean }>('/auth/verify-email', { method: 'POST', body: { token } });
  }

  async resendVerification(email: string, password: string) {
    return this.request<{ accepted: boolean }>('/auth/verification/resend', { method: 'POST', body: { email, password } });
  }

  async requestPasswordReset(email: string) {
    return this.request<{ accepted: boolean }>('/auth/password-reset/request', { method: 'POST', body: { email } });
  }

  async resetPassword(token: string, password: string) {
    return this.request<{ passwordReset: boolean }>('/auth/password-reset/confirm', { method: 'POST', body: { token, password } });
  }

  async listConversations() {
    const result = await this.request<{ conversations: SelfHostedConversation[] }>('/conversations');
    return result.conversations;
  }

  async listMessages(conversationId: string, before?: { id: string; createdAt: string }) {
    const query = new URLSearchParams({ limit: '50' });
    if (before) {
      query.set('beforeId', before.id);
      query.set('beforeCreatedAt', before.createdAt);
    }
    return this.request<{ messages: SelfHostedMessage[]; hasMore: boolean; nextCursor: { id: string; createdAt: string } | null }>(
      `/conversations/${encodeURIComponent(conversationId)}/messages`, { query },
    );
  }

  async sendMessage(conversationId: string, body: string) {
    return this.request<SelfHostedMessage>(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: { kind: 'text', body },
    });
  }

  async sendAttachment(conversationId: string, kind: SelfHostedMessage['kind'], attachmentId: string) {
    return this.request<SelfHostedMessage>(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: { kind, attachmentId },
    });
  }

  async markReceipt(conversationId: string, messageId: string, status: 'delivered' | 'seen') {
    return this.request<{ updated: boolean }>(
      `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/receipt`,
      { method: 'POST', body: { status } },
    );
  }

  async editMessage(messageId: string, body: string) {
    return this.request<SelfHostedMessage>(`/messages/${encodeURIComponent(messageId)}`, { method: 'PATCH', body: { body } });
  }

  async deleteMessage(messageId: string) {
    return this.request<{ deleted: boolean }>(`/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
  }

  async setReaction(conversationId: string, messageId: string, emoji: string, active: boolean) {
    return this.request<{ messageId: string; userId: string; emoji: string; active: boolean }>(
      `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions`,
      { method: 'POST', body: { emoji, active } },
    );
  }

  async upload(conversationId: string, file: File) {
    const form = new FormData();
    form.set('file', file);
    return this.request<{ attachment: { id: string; kind: SelfHostedMessage['kind']; originalName: string; detectedMime: string; byteSize: number } }>(
      `/conversations/${encodeURIComponent(conversationId)}/attachments`,
      { method: 'POST', formData: form },
    );
  }

  async createDirectConversation(userId: string) {
    return this.request<{ conversationId: string }>(`/conversations/direct`, { method: 'POST', body: { userId } });
  }

  async searchUsers(query: string) {
    const params = new URLSearchParams({ q: query, limit: '20' });
    return this.request<{ users: SelfHostedMember[] }>('/users/search', { query: params });
  }

  async requestFriend(targetId: string) {
    return this.request<{ status: 'pending' | 'accepted' }>('/friends/requests', { method: 'POST', body: { targetId } });
  }

  async listFriends() {
    return this.request<{ friends: SelfHostedMember[] }>('/friends');
  }

  async listFriendRequests() {
    return this.request<{ requests: Array<{
      otherUserId: string;
      otherUsername: string;
      otherDisplayName: string;
      direction: 'incoming' | 'outgoing';
      createdAt: string;
    }> }>('/friends/requests');
  }

  async acceptFriendRequest(userId: string) {
    return this.request<{ accepted: boolean }>(`/friends/requests/${encodeURIComponent(userId)}/accept`, { method: 'POST', body: {} });
  }

  async createGroup(name: string, memberIds: string[]) {
    return this.request<{ conversationId: string }>('/conversations/group', {
      method: 'POST',
      body: { name, memberIds },
    });
  }

  async turnCredentials() {
    return this.request<{ iceServers: RTCIceServer[]; expiresAt: string }>('/rtc/turn-credentials', { method: 'POST' });
  }
}

export const selfHostedApi = new SelfHostedApi();
