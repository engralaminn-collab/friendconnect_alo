import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './core/store/authStore';

import Login from './features/auth/Login';
import Register from './features/auth/Register';
import Layout from './components/ui/Layout';
import ChatList from './features/chat/ChatList';
import ChatScreen from './features/chat/ChatScreen';
import FriendList from './features/friends/FriendList';
import Profile from './features/profile/Profile';
import AdminPanel from './features/admin/AdminPanel';

function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode, adminOnly?: boolean }) {
  const { firebaseUser, userProfile, loading } = useAuthStore();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!firebaseUser) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && userProfile?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const { initializeAuth } = useAuthStore();

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        
        <Route path="/" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route index element={<ChatList />} />
          <Route path="chat/:id" element={<ChatScreen />} />
          <Route path="friends" element={<FriendList />} />
          <Route path="profile" element={<Profile />} />
          <Route path="admin" element={
            <ProtectedRoute adminOnly>
              <AdminPanel />
            </ProtectedRoute>
          } />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
