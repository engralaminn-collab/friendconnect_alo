import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { SelfHostedApiError, SelfHostedUser, selfHostedApi } from './api';
import SelfHostedMessenger from './SelfHostedMessenger';
import './self-hosted.css';

const featureEnabled = import.meta.env.VITE_SELF_HOSTED_API_ENABLED === 'true';

function tokenFromFragment() {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return fragment.get('token') || '';
}

function clearFragment() {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

function friendlyError(error: unknown) {
  if (!(error instanceof SelfHostedApiError)) return 'Something went wrong. Please try again.';
  if (error.code === 'API_UNAVAILABLE') return 'The self-hosted service is not reachable. It may not be running yet.';
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: 'Email or password is incorrect.',
    EMAIL_NOT_VERIFIED: 'Verify your email before signing in. You can request a fresh link below.',
    ACCOUNT_DISABLED: 'This account is unavailable. Contact an administrator.',
    INVALID_INVITE: 'This invitation is invalid, expired, or already used.',
    INVITE_EMAIL_MISMATCH: 'This invitation is tied to a different email address.',
    ACCOUNT_ALREADY_EXISTS: 'An account already uses that email or username.',
    WEAK_PASSWORD: 'Choose a password with at least 12 characters.',
    INVALID_OR_EXPIRED_TOKEN: 'That link is invalid or expired. Request a new one.',
    RATE_LIMITED: 'Too many attempts. Wait a little and try again.',
    VERIFICATION_EMAIL_FAILED: 'The account was created, but email delivery failed. Try resending verification.',
  };
  return messages[error.code] || `Request failed (${error.code}).`;
}

function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="sh-auth-page">
      <section className="sh-auth-card">
        <div className="sh-brand-mark" aria-hidden="true">fc</div>
        <p className="sh-eyebrow">FIRST-PARTY SERVICE</p>
        <h1>{title}</h1>
        {children}
        <p className="sh-auth-footnote">This separate client is feature-flagged. Your existing Firebase app is unchanged.</p>
      </section>
    </main>
  );
}

function LoginPage({ onLogin }: { onLogin: (user: SelfHostedUser) => void }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resend, setResend] = useState(false);
  const [notice, setNotice] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await selfHostedApi.login(email, password);
      onLogin(result.user);
    } catch (caught) {
      setError(friendlyError(caught));
      setResend(caught instanceof SelfHostedApiError && caught.code === 'EMAIL_NOT_VERIFIED');
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    setError('');
    try {
      await selfHostedApi.resendVerification(email, password);
      setNotice('If the account is pending verification, a new link has been sent.');
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Welcome back">
      <p className="sh-auth-description">Sign in to your private circle.</p>
      <form className="sh-form" onSubmit={submit}>
        <label>Email<input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="sh-form-error" role="alert">{error}</p>}
        {notice && <p className="sh-form-success" role="status">{notice}</p>}
        <button className="sh-primary-button" disabled={busy}>{busy ? 'Please wait…' : 'Sign in'}</button>
      </form>
      {resend && <button className="sh-link-button" disabled={busy} onClick={() => void resendVerification()}>Resend verification email</button>}
      <div className="sh-auth-links">
        <Link to="reset-password">Forgot password?</Link>
        <Link to="accept-invite">I have an invitation</Link>
      </div>
      <button className="sh-back-link" onClick={() => navigate('/login')}>Return to the current app</button>
    </AuthFrame>
  );
}

function InvitePage() {
  const navigate = useNavigate();
  const [inviteToken, setInviteToken] = useState(tokenFromFragment);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await selfHostedApi.register({ inviteToken: inviteToken.trim(), email: email.trim(), username: username.trim(), displayName: displayName.trim(), password });
      clearFragment();
      setSubmitted(true);
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return <AuthFrame title="Check your email"><p className="sh-auth-description">If delivery succeeded, a verification link is on its way. Your account cannot sign in until it is verified.</p><button className="sh-primary-button" onClick={() => navigate('/self-hosted')}>Back to sign in</button></AuthFrame>;
  }

  return (
    <AuthFrame title="Accept invitation">
      <p className="sh-auth-description">Registration is available only with an active, single-use invitation.</p>
      <form className="sh-form" onSubmit={submit}>
        <label>Invitation token<input autoComplete="off" required value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} /></label>
        <label>Email<input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Username<input autoComplete="username" minLength={3} maxLength={32} required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label>Display name<input autoComplete="name" maxLength={80} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label>Password<input autoComplete="new-password" type="password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /><small>Use at least 12 characters.</small></label>
        {error && <p className="sh-form-error" role="alert">{error}</p>}
        <button className="sh-primary-button" disabled={busy}>{busy ? 'Creating account…' : 'Create invited account'}</button>
      </form>
      <div className="sh-auth-links"><Link to="/self-hosted">Back to sign in</Link></div>
    </AuthFrame>
  );
}

function VerifyEmailPage() {
  const [state, setState] = useState<'working' | 'success' | 'error'>('working');
  const [error, setError] = useState('');
  useEffect(() => {
    const token = tokenFromFragment();
    if (!token) {
      setState('error');
      setError('Verification token is missing. Open the complete link from your email.');
      return;
    }
    void selfHostedApi.verifyEmail(token).then(() => {
      clearFragment();
      setState('success');
    }).catch((caught) => {
      setError(friendlyError(caught));
      setState('error');
    });
  }, []);
  return <AuthFrame title={state === 'success' ? 'Email verified' : 'Verify your email'}>
    {state === 'working' && <p className="sh-auth-description">Checking your one-time verification link…</p>}
    {state === 'success' && <><p className="sh-form-success">Your account is verified. You can sign in now.</p><Link className="sh-primary-button sh-button-link" to="/self-hosted">Continue to sign in</Link></>}
    {state === 'error' && <><p className="sh-form-error" role="alert">{error}</p><Link to="/self-hosted">Back to sign in</Link></>}
  </AuthFrame>;
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(tokenFromFragment);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const hasToken = Boolean(token);

  async function request(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await selfHostedApi.requestPasswordReset(email.trim());
      setNotice('If an active account uses that email, a reset link will be sent.');
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function reset(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await selfHostedApi.resetPassword(token, password);
      clearFragment();
      setNotice('Password reset. All existing sessions were revoked.');
      setTimeout(() => navigate('/self-hosted'), 1200);
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setBusy(false);
    }
  }

  return <AuthFrame title={hasToken ? 'Choose a new password' : 'Reset your password'}>
    <p className="sh-auth-description">{hasToken ? 'Reset links are single-use and expire.' : 'We will not reveal whether an account exists.'}</p>
    {hasToken ? <form className="sh-form" onSubmit={reset}>
      <label>New password<input autoComplete="new-password" type="password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <p className="sh-form-error" role="alert">{error}</p>}
      {notice && <p className="sh-form-success" role="status">{notice}</p>}
      <button className="sh-primary-button" disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</button>
    </form> : <form className="sh-form" onSubmit={request}>
      <label>Email<input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      {error && <p className="sh-form-error" role="alert">{error}</p>}
      {notice && <p className="sh-form-success" role="status">{notice}</p>}
      <button className="sh-primary-button" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
    </form>}
    <div className="sh-auth-links"><Link to="/self-hosted">Back to sign in</Link></div>
  </AuthFrame>;
}

function SelfHostedDisabled() {
  return <main className="sh-auth-page"><section className="sh-auth-card">
    <div className="sh-brand-mark" aria-hidden="true">fc</div>
    <p className="sh-eyebrow">MIGRATION CLIENT</p>
    <h1>Not configured</h1>
    <p className="sh-auth-description">The self-hosted API client is feature-flagged off. The current Firebase app has not been replaced.</p>
    <Link className="sh-primary-button sh-button-link" to="/login">Open current sign-in</Link>
    <p className="sh-auth-footnote">Enable only in an environment with a verified API deployment and approved origin.</p>
  </section></main>;
}

export default function SelfHostedApp() {
  const [user, setUser] = useState<SelfHostedUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionError, setSessionError] = useState('');

  useEffect(() => {
    if (!featureEnabled) {
      setChecking(false);
      return;
    }
    let current = true;
    void selfHostedApi.session().then((result) => {
      if (current) setUser(result.user);
    }).catch((error) => {
      if (current && !(error instanceof SelfHostedApiError && error.status === 401)) setSessionError(friendlyError(error));
    }).finally(() => {
      if (current) setChecking(false);
    });
    return () => { current = false; };
  }, []);

  if (!featureEnabled) return <SelfHostedDisabled />;
  if (checking) return <main className="sh-auth-page"><p className="sh-auth-description">Checking first-party session…</p></main>;
  if (user) return <SelfHostedMessenger user={user} onLogout={() => setUser(null)} />;

  return <>
    {sessionError && <div className="sh-global-error" role="status">{sessionError}</div>}
    <Routes>
      <Route index element={<LoginPage onLogin={setUser} />} />
      <Route path="accept-invite" element={<InvitePage />} />
      <Route path="verify-email" element={<VerifyEmailPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />
      <Route path="*" element={<LoginPage onLogin={setUser} />} />
    </Routes>
  </>;
}
