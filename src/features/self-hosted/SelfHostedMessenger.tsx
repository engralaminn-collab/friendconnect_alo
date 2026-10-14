import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { SelfHostedApiError, SelfHostedConversation, SelfHostedMember, SelfHostedMessage, SelfHostedUser, selfHostedApi } from './api';

type Props = { user: SelfHostedUser; onLogout: () => void };
type Ack = { ok: boolean; data?: unknown; error?: { code?: string } };
type Panel = 'chats' | 'people';

function emitAck(socket: Socket, event: string, payload: Record<string, unknown>): Promise<Ack> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve({ ok: false, error: { code: 'SOCKET_TIMEOUT' } }), 8000);
    socket.emit(event, payload, (result: Ack) => {
      window.clearTimeout(timer);
      resolve(result);
    });
  });
}

function upsertMessage(current: SelfHostedMessage[], incoming: SelfHostedMessage) {
  const index = current.findIndex((message) => message.id === incoming.id);
  const next = [...current];
  if (index === -1) next.push(incoming);
  else next[index] = { ...next[index], ...incoming };
  return next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function conversationTitle(conversation: SelfHostedConversation, userId: string) {
  if (conversation.type === 'group') return conversation.name || 'Group chat';
  const other = conversation.members.find((member) => member.id !== userId);
  return other?.displayName || other?.username || 'Private chat';
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
  if (error instanceof SelfHostedApiError) {
    if (error.code === 'API_UNAVAILABLE') return 'The API is not reachable. Check the first-party service and proxy.';
    if (error.code === 'MALWARE_SCANNER_UNAVAILABLE' || error.code === 'MALWARE_SCANNER_NOT_CONFIGURED') return 'Attachments are disabled until the malware scanner is healthy.';
    if (error.code === 'FILE_TOO_LARGE') return 'That file exceeds the upload size limit.';
    if (error.code === 'UNSUPPORTED_FILE_TYPE') return 'That file type is not allowed.';
    return `Request failed (${error.code}).`;
  }
  return 'The request failed. Please try again.';
}

export default function SelfHostedMessenger({ user, onLogout }: Props) {
  const [conversations, setConversations] = useState<SelfHostedConversation[]>([]);
  const [friends, setFriends] = useState<SelfHostedMember[]>([]);
  const [friendRequests, setFriendRequests] = useState<Array<{
    otherUserId: string; otherUsername: string; otherDisplayName: string; direction: 'incoming' | 'outgoing'; createdAt: string;
  }>>([]);
  const [messages, setMessages] = useState<SelfHostedMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('chats');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SelfHostedMember[]>([]);
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<{ id: string; createdAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [typingId, setTypingId] = useState<string | null>(null);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const joinedConversationRef = useRef<string | null>(null);
  const messageRequestRef = useRef(0);
  const typingTimerRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );
  const title = selectedConversation ? conversationTitle(selectedConversation, user.id) : '';

  const refreshLists = useCallback(async () => {
    const [nextConversations, nextFriends, requestResult] = await Promise.all([
      selfHostedApi.listConversations(),
      selfHostedApi.listFriends(),
      selfHostedApi.listFriendRequests(),
    ]);
    setConversations(nextConversations);
    setFriends(nextFriends.friends);
    setFriendRequests(requestResult.requests);
  }, []);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    let alive = true;
    void refreshLists().catch((caught) => {
      if (alive) setError(getErrorMessage(caught));
    }).finally(() => {
      if (alive) setLoading(false);
    });

    const socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], reconnection: true });
    socketRef.current = socket;
    socket.on('connect_error', () => {
      if (alive) setError('Realtime connection is unavailable. Text and attachments can still be sent through the API.');
    });
    socket.on('connect', () => {
      if (alive) setError('');
      const activeId = selectedIdRef.current;
      if (activeId) void emitAck(socket, 'conversation:join', { conversationId: activeId });
    });
    socket.on('session:revoked', (payload: { reason?: string }, acknowledge?: (result: { received: boolean }) => void) => {
      acknowledge?.({ received: true });
      setError(payload?.reason ? `Session ended: ${payload.reason}.` : 'This session was revoked.');
      window.setTimeout(onLogout, 0);
    });
    socket.on('message:new', (message: SelfHostedMessage) => {
      if (selectedIdRef.current === message.conversationId) {
        setMessages((current) => upsertMessage(current, message));
        if (message.senderId !== user.id) {
          const receipt = document.visibilityState === 'visible' ? 'seen' : 'delivered';
          void emitAck(socket, `message:${receipt}`, { conversationId: message.conversationId, messageId: message.id });
        }
      }
      void refreshLists().catch(() => undefined);
    });
    socket.on('message:updated', (message: SelfHostedMessage) => {
      setMessages((current) => upsertMessage(current, message));
    });
    socket.on('message:deleted', ({ messageId }: { messageId: string }) => {
      setMessages((current) => current.map((message) => message.id === messageId
        ? { ...message, body: null, deletedAt: new Date().toISOString() }
        : message));
    });
    socket.on('message:receipt', (receipt: { conversationId: string; messageId: string; userId: string; status: 'seen' | 'delivered' }) => {
      if (selectedIdRef.current !== receipt.conversationId) return;
      setMessages((current) => current.map((message) => {
        if (message.id !== receipt.messageId) return message;
        const previous = message.receipts.find((item) => item.userId === receipt.userId);
        const receipts = message.receipts.filter((item) => item.userId !== receipt.userId);
        const now = new Date().toISOString();
        receipts.push({
          userId: receipt.userId,
          deliveredAt: previous?.deliveredAt || now,
          seenAt: receipt.status === 'seen' ? previous?.seenAt || now : previous?.seenAt || null,
        });
        return { ...message, receipts };
      }));
    });
    socket.on('message:reaction', (reaction: { messageId: string; userId: string; emoji: string; active: boolean }) => {
      setMessages((current) => current.map((message) => {
        if (message.id !== reaction.messageId) return message;
        const reactions = message.reactions.filter((item) => !(item.userId === reaction.userId && item.emoji === reaction.emoji));
        if (reaction.active) reactions.push({ userId: reaction.userId, emoji: reaction.emoji });
        return { ...message, reactions };
      }));
    });
    socket.on('presence:snapshot', ({ conversationId, onlineUserIds }: { conversationId: string; onlineUserIds: string[] }) => {
      if (selectedIdRef.current === conversationId) setOnlineIds(new Set(onlineUserIds));
    });
    socket.on('presence:update', ({ conversationId, userId: changedUserId, online }: { conversationId: string; userId: string; online: boolean }) => {
      if (selectedIdRef.current !== conversationId) return;
      setOnlineIds((current) => {
        const next = new Set(current);
        if (online) next.add(changedUserId);
        else next.delete(changedUserId);
        return next;
      });
    });
    socket.on('typing:update', ({ conversationId, userId: changedUserId, active }: { conversationId: string; userId: string; active: boolean }) => {
      if (selectedIdRef.current !== conversationId || changedUserId === user.id) return;
      setTypingId(active ? changedUserId : null);
      if (active) {
        if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
        typingTimerRef.current = window.setTimeout(() => setTypingId(null), 1800);
      }
    });
    socket.connect();

    return () => {
      alive = false;
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [onLogout, refreshLists, user.id]);

  useEffect(() => {
    const requestId = ++messageRequestRef.current;
    if (!selectedId) {
      setMessages([]);
      setNextCursor(null);
      setHasMore(false);
      setOnlineIds(new Set());
      setTypingId(null);
      return;
    }

    const previousId = joinedConversationRef.current;
    const socket = socketRef.current;
    if (previousId && previousId !== selectedId && socket?.connected) {
      void emitAck(socket, 'conversation:leave', { conversationId: previousId });
    }
    joinedConversationRef.current = selectedId;
    setMobileChatOpen(true);
    setMessages([]);
    setError('');
    setLoading(true);
    void selfHostedApi.listMessages(selectedId).then((result) => {
      if (requestId !== messageRequestRef.current) return;
      setMessages(result.messages);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
      const currentSocket = socketRef.current;
      if (currentSocket?.connected) void emitAck(currentSocket, 'conversation:join', { conversationId: selectedId });
      for (const message of result.messages) {
        if (message.senderId !== user.id && !message.deletedAt) {
          const receipt = document.visibilityState === 'visible' ? 'seen' : 'delivered';
          if (currentSocket?.connected) void emitAck(currentSocket, `message:${receipt}`, { conversationId: selectedId, messageId: message.id });
          else void selfHostedApi.markReceipt(selectedId, message.id, receipt).catch(() => undefined);
        }
      }
    }).catch((caught) => {
      if (requestId === messageRequestRef.current) setError(getErrorMessage(caught));
    }).finally(() => {
      if (requestId === messageRequestRef.current) setLoading(false);
    });
  }, [selectedId, user.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, selectedId]);

  async function loadOlderMessages() {
    if (!selectedId || !nextCursor || !hasMore) return;
    setSending(true);
    try {
      const result = await selfHostedApi.listMessages(selectedId, nextCursor);
      setMessages((current) => [...result.messages, ...current]);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSending(false);
    }
  }

  async function searchUsers(event: FormEvent) {
    event.preventDefault();
    if (search.trim().length < 2) return;
    try {
      const result = await selfHostedApi.searchUsers(search.trim());
      setSearchResults(result.users.filter((candidate) => candidate.id !== user.id));
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function sendFriendRequest(targetId: string) {
    try {
      await selfHostedApi.requestFriend(targetId);
      await refreshLists();
      setSearchResults((current) => current.filter((candidate) => candidate.id !== targetId));
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function acceptFriendRequest(otherUserId: string) {
    try {
      await selfHostedApi.acceptFriendRequest(otherUserId);
      await refreshLists();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function openFriend(friend: SelfHostedMember) {
    setError('');
    try {
      const result = await selfHostedApi.createDirectConversation(friend.id);
      await refreshLists();
      setSelectedId(result.conversationId);
      setPanel('chats');
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    if (groupMembers.length < 2) {
      setError('Choose at least two friends for a group.');
      return;
    }
    try {
      const result = await selfHostedApi.createGroup(groupName.trim(), groupMembers);
      setShowGroupForm(false);
      setGroupName('');
      setGroupMembers([]);
      await refreshLists();
      setSelectedId(result.conversationId);
      setPanel('chats');
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  function updateDraft(value: string) {
    setDraft(value);
    const socket = socketRef.current;
    if (!selectedId || !socket?.connected) return;
    void emitAck(socket, 'typing:update', { conversationId: selectedId, active: Boolean(value.trim()) });
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    if (value.trim()) {
      typingTimerRef.current = window.setTimeout(() => {
        void emitAck(socket, 'typing:update', { conversationId: selectedId, active: false });
      }, 1200);
    }
  }

  async function sendPayload(payload: { kind: SelfHostedMessage['kind']; body?: string; attachmentId?: string }) {
    if (!selectedId) return;
    const socket = socketRef.current;
    if (socket?.connected) {
      const result = await emitAck(socket, 'message:send', { conversationId: selectedId, ...payload });
      if (!result.ok) throw new Error(result.error?.code || 'MESSAGE_SEND_FAILED');
      if (result.data) setMessages((current) => upsertMessage(current, result.data as SelfHostedMessage));
      return;
    }
    if (payload.kind === 'text' && payload.body) {
      const message = await selfHostedApi.sendMessage(selectedId, payload.body);
      setMessages((current) => upsertMessage(current, message));
      return;
    }
    if (payload.attachmentId) {
      const message = await selfHostedApi.sendAttachment(selectedId, payload.kind, payload.attachmentId);
      setMessages((current) => upsertMessage(current, message));
    }
  }

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || sending || (!draft.trim() && !file)) return;
    setSending(true);
    setError('');
    try {
      if (file) {
        const uploadResult = await selfHostedApi.upload(selectedId, file);
        await sendPayload({ kind: uploadResult.attachment.kind, attachmentId: uploadResult.attachment.id });
        setFile(null);
        const input = document.querySelector<HTMLInputElement>('#sh-attachment-input');
        if (input) input.value = '';
      } else {
        await sendPayload({ kind: 'text', body: draft.trim() });
      }
      setDraft('');
      if (socketRef.current?.connected) void emitAck(socketRef.current, 'typing:update', { conversationId: selectedId, active: false });
      void refreshLists().catch(() => undefined);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSending(false);
    }
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function toggleReaction(message: SelfHostedMessage) {
    if (!selectedId) return;
    const existing = message.reactions.some((reaction) => reaction.userId === user.id && reaction.emoji === '❤️');
    try {
      await selfHostedApi.setReaction(selectedId, message.id, '❤️', !existing);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function editMessage(message: SelfHostedMessage) {
    const nextBody = window.prompt('Edit message', message.body || '');
    if (nextBody === null || !nextBody.trim()) return;
    try {
      const updated = await selfHostedApi.editMessage(message.id, nextBody.trim());
      setMessages((current) => upsertMessage(current, updated));
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function deleteMessage(message: SelfHostedMessage) {
    if (!window.confirm('Delete this message for everyone in the conversation?')) return;
    try {
      await selfHostedApi.deleteMessage(message.id);
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, body: null, deletedAt: new Date().toISOString() } : item));
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function logout() {
    try {
      await selfHostedApi.logout();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      onLogout();
    }
  }

  const incomingRequests = friendRequests.filter((request) => request.direction === 'incoming');

  return (
    <main className="sh-messenger-page">
      <header className="sh-topbar">
        <div className="sh-topbar-brand"><span className="sh-brand-mark">fc</span><div><strong>FriendConnect</strong><small>Self-hosted preview</small></div></div>
        <div className="sh-topbar-user"><span className="sh-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><span className="sh-user-name">{user.displayName}</span><button className="sh-quiet-button" onClick={() => void logout()}>Sign out</button></div>
      </header>

      <div className={`sh-workspace ${mobileChatOpen ? 'sh-chat-open' : ''}`}>
        <aside className="sh-sidebar">
          <div className="sh-sidebar-header"><div><p className="sh-eyebrow">YOUR CIRCLE</p><h1>Messages</h1></div><button className="sh-icon-button" aria-label="Create group" title="Create group" onClick={() => setShowGroupForm(true)}>＋</button></div>
          <div className="sh-panel-tabs"><button className={panel === 'chats' ? 'active' : ''} onClick={() => setPanel('chats')}>Chats</button><button className={panel === 'people' ? 'active' : ''} onClick={() => setPanel('people')}>People{incomingRequests.length ? <span className="sh-count">{incomingRequests.length}</span> : null}</button></div>

          {panel === 'chats' ? <div className="sh-conversation-list">
            {loading && <p className="sh-muted sh-list-empty">Loading conversations…</p>}
            {!loading && conversations.length === 0 && <div className="sh-list-empty"><strong>No conversations yet</strong><span>Add a friend from People to start a private chat.</span></div>}
            {conversations.map((conversation) => {
              const other = conversation.members.find((member) => member.id !== user.id);
              const online = Boolean(other && onlineIds.has(other.id));
              return <button key={conversation.id} className={`sh-conversation-item ${conversation.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(conversation.id)}>
                <span className="sh-avatar sh-avatar-large">{conversationTitle(conversation, user.id).slice(0, 1).toUpperCase()}</span>
                <span className="sh-conversation-text"><strong>{conversationTitle(conversation, user.id)}</strong><small>{conversation.lastMessageBody || (conversation.lastMessageKind ? `Sent a ${conversation.lastMessageKind} attachment` : 'Start the conversation')}</small></span>
                {online && <span className="sh-online-dot" title="Online" />}
              </button>;
            })}
          </div> : <div className="sh-people-panel">
            {incomingRequests.length > 0 && <section className="sh-request-section"><h2>Friend requests</h2>{incomingRequests.map((request) => <div className="sh-request-row" key={request.otherUserId}><span><strong>{request.otherDisplayName}</strong><small>@{request.otherUsername}</small></span><button className="sh-small-primary" onClick={() => void acceptFriendRequest(request.otherUserId)}>Accept</button></div>)}</section>}
            <form className="sh-search-form" onSubmit={searchUsers}><input aria-label="Search members" placeholder="Search by username" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="sh-small-primary">Search</button></form>
            {searchResults.map((candidate) => <div className="sh-person-row" key={candidate.id}><span><strong>{candidate.displayName}</strong><small>@{candidate.username}</small></span><button className="sh-small-primary" onClick={() => void sendFriendRequest(candidate.id)}>Add</button></div>)}
            <h2 className="sh-friends-heading">Friends</h2>
            {friends.length === 0 && <p className="sh-muted">No accepted friends yet.</p>}
            {friends.map((friend) => <button className="sh-person-row sh-person-button" key={friend.id} onClick={() => void openFriend(friend)}><span className="sh-avatar">{friend.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{friend.displayName}</strong><small>@{friend.username}</small></span><span className="sh-open-arrow">›</span></button>)}
          </div>}
          <div className="sh-sidebar-foot"><span className="sh-status-dot" /> Private API session <span className="sh-security-note">Messages are not end-to-end encrypted.</span></div>
        </aside>

        <section className="sh-chat-pane">
          {selectedConversation ? <>
            <header className="sh-chat-header"><button className="sh-back-button" onClick={() => setMobileChatOpen(false)} aria-label="Back to conversations">‹</button><span className="sh-avatar">{title.slice(0, 1).toUpperCase()}</span><div><h2>{title}</h2><small>{typingId ? 'Typing…' : selectedConversation.type === 'group' ? `${selectedConversation.members.length} members` : onlineIds.size > 1 ? 'Online' : 'Private conversation'}</small></div><span className="sh-call-note">Calls not wired in this client</span></header>
            {error && <div className="sh-inline-error" role="status">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
            <div className="sh-message-list">
              {hasMore && <button className="sh-load-older" disabled={sending} onClick={() => void loadOlderMessages()}>Load older messages</button>}
              {loading && <p className="sh-muted sh-message-empty">Loading messages…</p>}
              {!loading && messages.length === 0 && <div className="sh-empty-chat"><span className="sh-empty-icon">✦</span><h3>Say hello</h3><p>Your conversation is private to its members.</p></div>}
              {messages.map((message) => {
                const own = message.senderId === user.id;
                const seenCount = message.receipts.filter((receipt) => receipt.seenAt).length;
                const deliveredCount = message.receipts.filter((receipt) => receipt.deliveredAt).length;
                const reacted = message.reactions.some((reaction) => reaction.userId === user.id && reaction.emoji === '❤️');
                return <article key={message.id} className={`sh-message-row ${own ? 'own' : ''}`}>
                  {!own && <span className="sh-avatar sh-message-avatar">{message.senderDisplayName.slice(0, 1).toUpperCase()}</span>}
                  <div className="sh-message-stack">
                    {!own && <small className="sh-sender-name">{message.senderDisplayName}</small>}
                    <div className={`sh-message-bubble ${own ? 'own' : ''}`}>
                      {message.deletedAt ? <em>This message was deleted.</em> : <>
                        {message.body && <p>{message.body}</p>}
                        {message.attachmentId && <a className="sh-attachment-link" href={`/api/attachments/${encodeURIComponent(message.attachmentId)}`} target="_blank" rel="noreferrer">↧ {message.attachmentName || 'Download attachment'} <small>{message.attachmentMime || message.kind} · {formatBytes(message.attachmentBytes)}</small></a>}
                      </>}
                    </div>
                    <div className="sh-message-meta"><time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>{message.editedAt && <span>edited</span>}{own && <span>{seenCount ? 'Seen' : deliveredCount ? 'Delivered' : 'Sent'}</span>}
                      {!message.deletedAt && <><button title={reacted ? 'Remove heart' : 'React with heart'} onClick={() => void toggleReaction(message)}>{reacted ? '❤️' : '♡'}</button>{own && message.kind === 'text' && <button title="Edit message" onClick={() => void editMessage(message)}>Edit</button>}{own && <button title="Delete message" onClick={() => void deleteMessage(message)}>Delete</button>}</>}
                    </div>
                    {message.reactions.length > 0 && <div className="sh-reactions">{message.reactions.map((reaction, index) => <span key={`${reaction.userId}-${reaction.emoji}-${index}`}>{reaction.emoji}</span>)}</div>}
                  </div>
                </article>;
              })}
              <div ref={bottomRef} />
            </div>
            <form className="sh-composer" onSubmit={submitMessage}>
              {file && <div className="sh-file-chip">{file.name}<button type="button" onClick={() => setFile(null)} aria-label="Remove attachment">×</button></div>}
              <div className="sh-composer-row"><label className="sh-attach-button" title="Attach a file">＋<input id="sh-attachment-input" type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><textarea aria-label="Write a message" placeholder="Write a message…" value={draft} onChange={(event) => updateDraft(event.target.value)} onKeyDown={submitOnEnter} maxLength={10000} rows={1} /><button className="sh-send-button" disabled={sending || (!draft.trim() && !file)}>{sending ? '…' : 'Send'}</button></div>
              <small className="sh-composer-hint">Enter to send · Shift+Enter for a new line · uploads are malware-scanned</small>
            </form>
          </> : <div className="sh-welcome-pane"><div className="sh-welcome-art"><span>✦</span><span>✧</span><span>✦</span></div><p className="sh-eyebrow">A PRIVATE CIRCLE</p><h2>Make time for your people.</h2><p>Choose a conversation or find a friend to reconnect.</p><button className="sh-primary-button" onClick={() => { setPanel('people'); setMobileChatOpen(false); }}>Find friends</button><small>Calls, notifications, and migration of existing Firebase history are not enabled in this client.</small></div>}
        </section>
      </div>

      {showGroupForm && <div className="sh-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowGroupForm(false); }}><form className="sh-group-modal" onSubmit={createGroup}><button type="button" className="sh-modal-close" onClick={() => setShowGroupForm(false)} aria-label="Close">×</button><p className="sh-eyebrow">NEW CONVERSATION</p><h2>Create a group</h2><label>Group name<input required maxLength={80} value={groupName} onChange={(event) => setGroupName(event.target.value)} /></label><fieldset><legend>Add at least two friends</legend>{friends.map((friend) => <label className="sh-checkbox-row" key={friend.id}><input type="checkbox" checked={groupMembers.includes(friend.id)} onChange={(event) => setGroupMembers((current) => event.target.checked ? [...current, friend.id] : current.filter((id) => id !== friend.id))} />{friend.displayName} <small>@{friend.username}</small></label>)}{friends.length === 0 && <p className="sh-muted">Add friends before creating a group.</p>}</fieldset>{error && <p className="sh-form-error">{error}</p>}<button className="sh-primary-button" disabled={groupMembers.length < 2 || !groupName.trim()}>Create group</button></form></div>}
    </main>
  );
}

function formatBytes(value: number | null) {
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
