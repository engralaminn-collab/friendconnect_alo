import { create } from 'zustand';
import { User as FirebaseUser, onAuthStateChanged, Unsubscribe } from 'firebase/auth';
import { auth, db } from '../../firebase/config';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { User } from '../models/types';

interface AuthState {
  firebaseUser: FirebaseUser | null;
  userProfile: User | null;
  loading: boolean;
  unsubscribe?: Unsubscribe;
  setUser: (user: FirebaseUser | null) => void;
  setProfile: (profile: User | null) => void;
  initializeAuth: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  firebaseUser: null,
  userProfile: null,
  loading: true,
  unsubscribe: undefined,
  setUser: (user) => set({ firebaseUser: user }),
  setProfile: (profile) => set({ userProfile: profile }),
  initializeAuth: () => {
    // React Strict Mode can mount effects twice in development. Keep one listener only.
    if (get().unsubscribe) return;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        set({ firebaseUser: null, userProfile: null, loading: false });
        return;
      }

      set({ firebaseUser: user, loading: true });
      try {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
          set({ userProfile: null });
          return;
        }

        const profile = docSnap.data() as User;
        set({ userProfile: profile });

        // Presence is best-effort; a failure must not leave the app in a loading state.
        await updateDoc(docRef, { onlineStatus: true, lastSeen: Date.now() });
      } catch (error) {
        console.error('Unable to load the signed-in user profile.', error);
        set({ userProfile: null });
      } finally {
        set({ loading: false });
      }
    });

    set({ unsubscribe });
  }
}));
