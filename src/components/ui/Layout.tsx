import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { MessageSquare, Users, User, LogOut, Shield } from 'lucide-react';
import { useAuthStore } from '../../core/store/authStore';
import { auth, db } from '../../firebase/config';
import { signOut } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';

export default function Layout() {
  const { userProfile, firebaseUser } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    if (firebaseUser) {
      const docRef = doc(db, 'users', firebaseUser.uid);
      await updateDoc(docRef, { onlineStatus: false, lastSeen: Date.now() });
    }
    await signOut(auth);
    navigate('/login');
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50 text-gray-900 font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-gray-200 bg-white flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-100">
          <h1 className="text-xl font-bold tracking-tight text-blue-600">FriendConnect</h1>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-3">
            <li>
              <NavLink
                to="/"
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                <MessageSquare className="h-5 w-5" />
                Chats
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/friends"
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                <Users className="h-5 w-5" />
                Friends
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/profile"
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                <User className="h-5 w-5" />
                Profile
              </NavLink>
            </li>
            {userProfile?.role === 'admin' && (
              <li>
                <NavLink
                  to="/admin"
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  <Shield className="h-5 w-5" />
                  Admin
                </NavLink>
              </li>
            )}
          </ul>
        </nav>

        <div className="p-4 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <LogOut className="h-5 w-5" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full bg-white relative">
        <Outlet />
      </main>
    </div>
  );
}
