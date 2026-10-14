import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { Check, Eye, EyeOff, FileText, ImagePlus, MessageCircleMore, Phone, ShieldCheck, Sparkles, Video } from 'lucide-react';
import { auth, db } from '../../firebase/config';
import { useAuthStore } from '../../core/store/authStore';
import type { User } from '../../core/models/types';

function friendlyError(message: string) {
  if (message.includes('auth/invalid-credential') || message.includes('auth/wrong-password') || message.includes('auth/user-not-found')) return 'That email and password don’t match. Please try again.';
  if (message.includes('auth/too-many-requests')) return 'Too many attempts. Give it a little while, then try again.';
  if (message.includes('auth/network-request-failed')) return 'Could not reach the sign-in service. Check your connection and try again.';
  return message;
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const setProfile = useAuthStore(state => state.setProfile);
  const blocked = new URLSearchParams(location.search).get('blocked') === '1';

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const profileSnap = await getDoc(doc(db, 'users', credential.user.uid));

      if (!profileSnap.exists()) {
        await signOut(auth);
        setError('This account has not been added to the private circle yet. Please contact your admin.');
        return;
      }

      const profile = profileSnap.data() as User;
      if (!profile.isActive || profile.approved === false) {
        await signOut(auth);
        setError('This account is not active yet. Please contact your admin.');
        return;
      }

      setProfile(profile);
      navigate('/');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not sign in.';
      setError(friendlyError(message));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setError('');
    setInfo('');
    if (!email.trim()) {
      setError('Enter your email above and we’ll send you a reset link.');
      return;
    }
    setResetting(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfo('If there’s an account for that email, a password reset link is on its way.');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not request a password reset.';
      setError(friendlyError(message));
    } finally {
      setResetting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-intro" aria-label="About FriendConnect">
        <div className="login-brand"><span className="login-brand-icon"><MessageCircleMore size={21} /></span><span>friendconnect</span></div>
        <div className="login-intro-content">
          <span className="login-eyebrow"><i /> YOUR CIRCLE, CLOSER</span>
          <h1>Good friends.<br /><em>Great catch-ups.</em></h1>
          <p>A little private place for the people who have been part of your story — old photos, new memories, and all the “remember when?” in between.</p>
          <ul className="login-feature-list">
            <li><MessageCircleMore size={14} /> Private chats</li>
            <li><Phone size={14} /> Voice calls</li>
            <li><Video size={14} /> Video calls</li>
            <li><ImagePlus size={14} /> Share photos & files</li>
            <li><Sparkles size={14} /> Plenty of emojis</li>
          </ul>
        </div>
        <div className="login-mock-chat" aria-hidden="true">
          <div className="mock-chat-header">
            <span className="avatar avatar-small avatar-sage"><span>MC</span></span>
            <span className="mock-chat-title"><strong>Maya Chen</strong><span>online · old friend, new stories</span></span>
            <span className="mock-chat-actions"><Phone size={15} /><Video size={16} /></span>
          </div>
          <div className="mock-chat-body">
            <span className="mock-bubble">I found the best photo from that lake weekend 🥹</span>
            <span className="mock-photo"><span className="mock-photo-swatch" /><span><ImagePlus size={11} /> lake-weekend.jpg</span></span>
            <span className="mock-bubble sent">We have to make another one of those memories ✨</span>
          </div>
        </div>
        <div className="login-footer">Made for your people. Kept within your circle.</div>
      </section>

      <section className="login-panel" aria-label="Sign in">
        <div className="login-card">
          <div className="login-mobile-brand"><span className="mini-brand"><MessageCircleMore size={16} /></span> friendconnect</div>
          <div className="login-card-head">
            <span className="section-kicker">WELCOME BACK</span>
            <h2>Come on in.</h2>
            <p>Sign in to reconnect with your friends.</p>
          </div>
          <form className="login-form" onSubmit={handleLogin}>
            <label>Email address<input type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} /></label>
            <label>
              <span className="login-password-row"><span>Password</span><button type="button" onClick={() => void handleResetPassword()} disabled={resetting}>{resetting ? 'Sending…' : 'Forgot password?'}</button></span>
              <span className="password-input-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required placeholder="Enter your password" value={password} onChange={event => setPassword(event.target.value)} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
            </label>
            {blocked && !error && <p className="login-error">Your account is not active yet. Please contact your admin.</p>}
            {error && <p className="login-error" role="alert">{error}</p>}
            {info && <p className="login-info" role="status"><Check size={15} />{info}</p>}
            <button className="login-submit" type="submit" disabled={loading}>{loading ? 'Opening your circle…' : 'Sign in securely'}</button>
          </form>
          <div className="login-privacy-note"><ShieldCheck size={16} /><span>FriendConnect is invite-only. New real accounts are created or approved by your admin.</span></div>
          <div className="login-divider"><span>OR TAKE A LOOK AROUND</span></div>
          <Link to="/demo" className="demo-login-button"><Sparkles size={16} /> Explore the interactive preview <span>→</span></Link>
          {import.meta.env.VITE_SELF_HOSTED_API_ENABLED === 'true' && <Link to="/self-hosted" className="demo-login-button"><ShieldCheck size={16} /> Open isolated self-hosted client <span>→</span></Link>}
          <div className="login-card-foot"><FileText size={13} /><span>Preview activity stays in this browser. No account needed.</span></div>
        </div>
      </section>
    </main>
  );
}
