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
  initializeAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  firebaseUser: null,
  userProfile: null,
  loading: true,
  setUser: (user) => set({ firebaseUser: user }),
  setProfile: (profile) => set({ userProfile: profile }),
  initializeAuth: () => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        set({ firebaseUser: user });
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          set({ userProfile: docSnap.data() as User });
          // Update online status
          await updateDoc(docRef, { onlineStatus: true, lastSeen: Date.now() });
        }
      } else {
        set({ firebaseUser: null, userProfile: null });
      }
      set({ loading: false });
    });
  }
}));
