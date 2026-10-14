import { create } from 'zustand';
import { User as FirebaseUser, onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../../firebase/config';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { User } from '../models/types';

interface AuthState {
  firebaseUser: FirebaseUser | null;
  userProfile: User | null;
  loading: boolean;
  setUser: (user: FirebaseUser | null) => void;
  setProfile: (profile: User | null) => void;
  initializeAuth: () => () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  firebaseUser: null,
  userProfile: null,
  loading: true,
  setUser: (user) => set({ firebaseUser: user }),
  setProfile: (profile) => set({ userProfile: profile }),
  initializeAuth: () => onAuthStateChanged(auth, async (user) => {
    set({ firebaseUser: user, loading: true });
    if (!user) {
      set({ userProfile: null, loading: false });
      return;
    }

    const docRef = doc(db, 'users', user.uid);
    try {
      const docSnap = await getDoc(docRef);
      set({ userProfile: docSnap.exists() ? docSnap.data() as User : null });
      if (docSnap.exists()) {
        await updateDoc(docRef, { onlineStatus: true, lastSeen: Date.now() }).catch(() => undefined);
      }
    } catch {
      set({ userProfile: null });
    } finally {
      set({ loading: false });
    }
  })
}));
