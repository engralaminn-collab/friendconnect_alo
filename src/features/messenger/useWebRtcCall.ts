import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type DocumentReference,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { Person } from './types';

type CallType = 'audio' | 'video';
type CallStatus = 'incoming' | 'calling' | 'connecting' | 'connected' | 'ended' | 'rejected';

export interface ActiveCall {
  id: string;
  contact: Person;
  type: CallType;
  direction: 'incoming' | 'outgoing';
  status: CallStatus;
  demo: boolean;
  localStream?: MediaStream | null;
  remoteStream?: MediaStream | null;
  muted?: boolean;
  cameraOff?: boolean;
  startedAt?: number;
  note?: string;
}

interface UseWebRtcCallResult {
  call: ActiveCall | null;
  error: string;
  clearError: () => void;
  startCall: (contact: Person, type: CallType) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
}

type SessionMode = 'demo' | 'live';

const turnUrls = (import.meta.env.VITE_TURN_URLS || '').split(',').map((url: string) => url.trim()).filter(Boolean);
const iceConfiguration: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    ...(turnUrls.length && import.meta.env.VITE_TURN_USERNAME && import.meta.env.VITE_TURN_CREDENTIAL
      ? [{ urls: turnUrls, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }]
      : []),
  ],
};

export function useWebRtcCall(mode: SessionMode, currentUserId: string, people: Person[]): UseWebRtcCallResult {
  const [callState, setCallState] = useState<ActiveCall | null>(null);
  const [error, setError] = useState('');
  const callRef = useRef<ActiveCall | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const callDocumentRef = useRef<DocumentReference | null>(null);
  const callUnsubscribeRef = useRef<(() => void) | null>(null);
  const candidateUnsubscribesRef = useRef<Array<() => void>>([]);
  const queuedCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const demoTimerRef = useRef<number | null>(null);

  const setCall = useCallback((next: ActiveCall | null) => {
    callRef.current = next;
    setCallState(next);
  }, []);

  const patchCall = useCallback((patch: Partial<ActiveCall>) => {
    const current = callRef.current;
    if (current) setCall({ ...current, ...patch });
  }, [setCall]);

  const detachTransport = useCallback(() => {
    callUnsubscribeRef.current?.();
    callUnsubscribeRef.current = null;
    candidateUnsubscribesRef.current.forEach(unsubscribe => unsubscribe());
    candidateUnsubscribesRef.current = [];
    const peer = peerRef.current;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.close();
    }
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current?.getTracks().forEach(track => track.stop());
    remoteStreamRef.current = null;
    queuedCandidatesRef.current = [];
    if (demoTimerRef.current !== null) {
      window.clearTimeout(demoTimerRef.current);
      demoTimerRef.current = null;
    }
  }, []);

  const setCallStatusFromRemote = useCallback((status: 'ended' | 'rejected') => {
    detachTransport();
    patchCall({ status });
    window.setTimeout(() => {
      if (callRef.current?.status === status) setCall(null);
    }, 2_200);
  }, [detachTransport, patchCall, setCall]);

  const watchCallDocument = useCallback((callDocument: DocumentReference, asCaller: boolean, peer: RTCPeerConnection) => {
    callUnsubscribeRef.current?.();
    callUnsubscribeRef.current = onSnapshot(callDocument, async snapshot => {
      if (!snapshot.exists()) return;
      const data = snapshot.data() as { status: string; answer?: RTCSessionDescriptionInit };
      if (data.status === 'ended' || data.status === 'rejected') {
        setCallStatusFromRemote(data.status);
        return;
      }
      if (data.status === 'accepted') patchCall({ status: 'connecting' });
      if (asCaller && data.answer && !peer.remoteDescription) {
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(data.answer as RTCSessionDescriptionInit));
          const queued = queuedCandidatesRef.current.splice(0);
          await Promise.all(queued.map(candidate => peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined)));
          patchCall({ status: 'connecting' });
        } catch {
          setError('Could not connect this call. Please try again.');
        }
      }
    }, reason => setError(reason.message || 'The call connection was interrupted.'));
  }, [patchCall, setCallStatusFromRemote]);

  const watchCandidates = useCallback((callId: string, collectionName: 'callerCandidates' | 'receiverCandidates', peer: RTCPeerConnection) => {
    const unsubscribe = onSnapshot(collection(db, 'calls', callId, collectionName), snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type !== 'added') return;
        const candidate = change.doc.data() as RTCIceCandidateInit;
        if (peer.remoteDescription) {
          void peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
        } else {
          queuedCandidatesRef.current.push(candidate);
        }
      });
    }, reason => setError(reason.message || 'Could not exchange call connection details.'));
    candidateUnsubscribesRef.current.push(unsubscribe);
  }, []);

  const createPeer = useCallback((type: CallType, callId: string, candidateCollection: 'callerCandidates' | 'receiverCandidates') => {
    const peer = new RTCPeerConnection(iceConfiguration);
    peerRef.current = peer;
    const localStream = localStreamRef.current;
    localStream?.getTracks().forEach(track => peer.addTrack(track, localStream));
    peer.ontrack = event => {
      const remote = event.streams[0] || new MediaStream([event.track]);
      remoteStreamRef.current = remote;
      patchCall({ remoteStream: remote });
    };
    peer.onicecandidate = event => {
      if (!event.candidate) return;
      void addDoc(collection(db, 'calls', callId, candidateCollection), event.candidate.toJSON()).catch(() => undefined);
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        patchCall({ status: 'connected', startedAt: callRef.current?.startedAt || Date.now() });
      } else if (peer.connectionState === 'failed') {
        setError('The call could not connect. A TURN relay may be needed on this network.');
      }
    };
    peer.oniceconnectionstatechange = () => {
      if (peer.iceConnectionState === 'failed') setError('The network could not establish a direct call. Please try another network.');
    };
    void type;
    return peer;
  }, [patchCall]);

  useEffect(() => {
    if (mode !== 'live' || !currentUserId) return;
    const pendingCalls = query(
      collection(db, 'calls'),
      where('receiverId', '==', currentUserId),
      where('status', '==', 'calling'),
    );
    return onSnapshot(pendingCalls, snapshot => {
      if (callRef.current) return;
      const incoming = snapshot.docs[0];
      if (!incoming) return;
      const data = incoming.data();
      const knownPerson = people.find(person => person.uid === data.callerId);
      void getDoc(doc(db, 'users', String(data.callerId || ''))).then(profile => {
        if (callRef.current || !profile.exists()) return;
        const caller = knownPerson || ({ ...profile.data(), uid: profile.id } as Person);
        setCall({
          id: incoming.id,
          contact: caller,
          type: data.type === 'video' ? 'video' : 'audio',
          direction: 'incoming',
          status: 'incoming',
          demo: false,
        });
        callDocumentRef.current = incoming.ref;
      }).catch(() => {
        if (callRef.current) return;
        setCall({
          id: incoming.id,
          contact: knownPerson || { uid: data.callerId, name: 'Friend', username: '' },
          type: data.type === 'video' ? 'video' : 'audio',
          direction: 'incoming',
          status: 'incoming',
          demo: false,
        });
        callDocumentRef.current = incoming.ref;
      });
    }, reason => setError(reason.message || 'Could not listen for incoming calls.'));
  }, [mode, currentUserId, people, setCall]);

  const startCall = useCallback(async (contact: Person, type: CallType) => {
    setError('');
    detachTransport();
    if (mode === 'demo') {
      const id = `preview-call-${Date.now()}`;
      setCall({ id, contact, type, direction: 'outgoing', status: 'calling', demo: true, note: 'Preview only — no call is placed.' });
      demoTimerRef.current = window.setTimeout(() => {
        patchCall({ status: 'connected', startedAt: Date.now() });
      }, 1_700);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Calls need a secure browser connection and microphone access.');
      return;
    }

    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      localStreamRef.current = localStream;
      const callDocument = doc(collection(db, 'calls'));
      callDocumentRef.current = callDocument;
      setCall({ id: callDocument.id, contact, type, direction: 'outgoing', status: 'calling', demo: false, localStream, muted: false, cameraOff: false });
      await setDoc(callDocument, {
        callerId: currentUserId,
        receiverId: contact.uid,
        type,
        status: 'preparing',
        createdAt: Date.now(),
      });
      const peer = createPeer(type, callDocument.id, 'callerCandidates');
      watchCandidates(callDocument.id, 'receiverCandidates', peer);
      watchCallDocument(callDocument, true, peer);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await updateDoc(callDocument, { offer: { type: offer.type, sdp: offer.sdp }, status: 'calling' });
    } catch (reason) {
      detachTransport();
      setCall(null);
      const message = reason instanceof Error ? reason.message : 'Could not start the call.';
      setError(message.toLowerCase().includes('permission') ? 'Please allow microphone and camera access, then try again.' : message);
    }
  }, [mode, currentUserId, detachTransport, setCall, patchCall, createPeer, watchCandidates, watchCallDocument]);

  const rejectCall = useCallback(async () => {
    const current = callRef.current;
    const callDocument = callDocumentRef.current;
    if (current && !current.demo && callDocument) {
      await updateDoc(callDocument, { status: 'rejected' }).catch(() => undefined);
    }
    detachTransport();
    setCall(null);
  }, [detachTransport, setCall]);

  const acceptCall = useCallback(async () => {
    const current = callRef.current;
    const callDocument = callDocumentRef.current;
    if (!current || current.demo || !callDocument) {
      if (current?.demo) patchCall({ status: 'connected', startedAt: Date.now() });
      return;
    }
    setError('');
    try {
      const snapshot = await getDoc(callDocument);
      if (!snapshot.exists()) throw new Error('This call is no longer available.');
      const data = snapshot.data() as { offer?: RTCSessionDescriptionInit };
      if (!data.offer) throw new Error('The caller is still connecting. Please try again in a moment.');
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: current.type === 'video' });
      localStreamRef.current = localStream;
      patchCall({ status: 'connecting', localStream, muted: false, cameraOff: false });
      const peer = createPeer(current.type, current.id, 'receiverCandidates');
      await peer.setRemoteDescription(new RTCSessionDescription(data.offer as RTCSessionDescriptionInit));
      watchCandidates(current.id, 'callerCandidates', peer);
      watchCallDocument(callDocument, false, peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await updateDoc(callDocument, { answer: { type: answer.type, sdp: answer.sdp }, status: 'accepted' });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not answer this call.';
      setError(message.toLowerCase().includes('permission') ? 'Please allow microphone and camera access, then try again.' : message);
      await rejectCall();
    }
  }, [createPeer, patchCall, rejectCall, watchCallDocument, watchCandidates]);

  const endCall = useCallback(async () => {
    const current = callRef.current;
    const callDocument = callDocumentRef.current;
    if (current && !current.demo && callDocument) {
      await updateDoc(callDocument, { status: 'ended' }).catch(() => undefined);
    }
    detachTransport();
    if (current) {
      setCall({ ...current, status: 'ended', localStream: null, remoteStream: null });
      window.setTimeout(() => {
        if (callRef.current?.status === 'ended') setCall(null);
      }, 1_500);
    }
  }, [detachTransport, setCall]);

  const toggleMute = useCallback(() => {
    const current = callRef.current;
    if (!current) return;
    const muted = !current.muted;
    localStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = !muted; });
    patchCall({ muted });
  }, [patchCall]);

  const toggleCamera = useCallback(() => {
    const current = callRef.current;
    if (!current) return;
    const cameraOff = !current.cameraOff;
    localStreamRef.current?.getVideoTracks().forEach(track => { track.enabled = !cameraOff; });
    patchCall({ cameraOff });
  }, [patchCall]);

  useEffect(() => () => detachTransport(), [detachTransport]);

  return {
    call: callState,
    error,
    clearError: () => setError(''),
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
  };
}
