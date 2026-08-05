import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { User } from '../../core/models/types';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const blocked = new URLSearchParams(location.search).get('blocked') === '1';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const profileSnap = await getDoc(doc(db, 'users', credential.user.uid));

      if (!profileSnap.exists()) {
        await signOut(auth);
        setError('Your account is not approved. Contact admin.');
        return;
      }

      const profile = profileSnap.data() as User;
      if (!profile.isActive || profile.approved === false) {
        await signOut(auth);
        setError('Your account is not approved. Contact admin.');
        return;
      }

      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-white p-8 shadow-lg border border-gray-100">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">FriendConnect Private</h2>
          <p className="mt-2 text-sm text-gray-600">Log in with an approved friends-only account</p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          <div className="space-y-4 rounded-md shadow-sm">
            <div>
              <label className="sr-only" htmlFor="email">Email address</label>
              <Input
                id="email"
                type="email"
                required
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="sr-only" htmlFor="password">Password</label>
              <Input
                id="password"
                type="password"
                required
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {(blocked || error) && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error || 'Your account is not approved. Contact admin.'}
            </p>
          )}

          <div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </div>

          <p className="text-center text-sm">
            <Link to="/forgot-password" className="font-medium text-blue-600 hover:text-blue-500">
              Forgot your password?
            </Link>
          </p>

          <p className="text-center text-xs text-gray-500">
            This is a private app. New accounts are created only by the admin.
          </p>
        </form>
      </div>
    </div>
  );
}
