// #/login: the sign-in card. Shown whenever the agent answers 401; after sign-in it returns to `?next=`.
import { Backdrop } from '../components/chat/Backdrop.tsx';
import { useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Mochi } from '@mochi/ui/mochi';
import { Button, shake } from '../components/ds.tsx';
import './login.css';

/** Only a hash route of this app, never another origin. */
const nextHash = () => {
  const n = new URLSearchParams(location.hash.split('?')[1]).get('next') ?? '';
  return /^#\/(?!login)/.test(n) ? n : '#/';
};

export function Login() {
  const [show, setShow] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: f.get('username'), password: f.get('password') }) });
      if (r.ok) { location.hash = nextHash(); return; }
      setError((await r.json().catch(() => null))?.error ?? `The agent answered ${r.status}.`);
    } catch { setError('I can’t reach the Mochi agent right now.'); }
    setBusy(false);
    const btn = form.current?.querySelector<HTMLElement>('.mb-btn-primary');
    if (btn) shake(btn);
  };
  return (
    <main className="mb-login">
      <Backdrop mood="home" /> {/* the same grain and dither sky as the empty chat: one brand moment */}
      <form className="mb-login-card" ref={form} onSubmit={submit} aria-labelledby="login-title">
        <div className="mb-login-brand">
          <Mochi size="md" mood={error ? 'sorry' : busy ? 'thinking' : 'idle'} label="Mochi" />
          <h1 id="login-title" className="mb-login-wm">mochi</h1>
        </div>
        <p className="mb-login-line">Sign in and I’ll brief you on every ticket.</p>
        <label className="mb-login-field">
          <span>Username</span>
          <input name="username" autoComplete="username" autoFocus required autoCapitalize="off" spellCheck={false} aria-invalid={!!error || undefined} />
        </label>
        <label className="mb-login-field">
          <span>Password</span>
          <span className="mb-login-pw">
            <input name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required aria-invalid={!!error || undefined} aria-describedby={error ? 'login-error' : undefined} />
            <button type="button" className="mb-icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
              {show ? <EyeOff size={16} strokeWidth={1.5} aria-hidden="true" /> : <Eye size={16} strokeWidth={1.5} aria-hidden="true" />}
            </button>
          </span>
        </label>
        {error && <p id="login-error" className="mb-login-error" role="alert">{error}</p>}
        <Button variant="primary" type="submit" loading={busy}>Sign in</Button>
        <p className="mb-login-hint">Demo login: <code>admin</code> / <code>admin@1234</code></p>
      </form>
    </main>
  );
}
