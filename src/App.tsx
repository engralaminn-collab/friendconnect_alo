import React, { Suspense, lazy, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { auth } from './firebase/config';
import { useAuthStore } from './core/store/authStore';
import Login from './features/auth/Login';

const MessengerApp = lazy(() => import('./features/messenger/MessengerApp'));
const SelfHostedApp = lazy(() => import('./features/self-hosted/SelfHostedApp'));
const AppLoading = () => <div className="auth-loading"><span className="spinner" /><span>Opening your private circle…</span></div>;

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { firebaseUser, userProfile, loading } = useAuthStore();
  const inactiveAccount = Boolean(firebaseUser && !loading && (!userProfile?.isActive || userProfile.approved === false));

  useEffect(() => {
    if (inactiveAccount) void signOut(auth).catch(() => undefined);
  }, [inactiveAccount]);

  if (loading) {
    return <div className="auth-loading"><span className="spinner" /><span>Opening your private circle…</span></div>;
  }

  if (!firebaseUser) return <Navigate to="/login" replace />;
  if (!userProfile?.isActive || userProfile.approved === false) return <Navigate to="/login?blocked=1" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const initializeAuth = useAuthStore(state => state.initializeAuth);
  const location = useLocation();
  const selfHostedRoute = location.pathname === '/self-hosted' || location.pathname.startsWith('/self-hosted/');

  useEffect(() => {
    if (selfHostedRoute) return undefined;
    return initializeAuth();
  }, [initializeAuth, selfHostedRoute]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Navigate to="/login" replace />} />
      <Route path="/self-hosted/*" element={<Suspense fallback={<AppLoading />}><SelfHostedApp /></Suspense>} />
      <Route path="/demo" element={<Suspense fallback={<AppLoading />}><MessengerApp mode="demo" /></Suspense>} />
      <Route path="*" element={<ProtectedRoute><Suspense fallback={<AppLoading />}><MessengerApp mode="live" /></Suspense></ProtectedRoute>} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
