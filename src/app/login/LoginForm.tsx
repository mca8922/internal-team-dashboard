'use client';

// Login form — backed by Supabase Auth. There is no public sign-up; only
// Board Members create accounts (from the Team page).
import * as React from 'react';
import { Button, Field } from '@/components/ui';
import { signIn } from '@/lib/auth-actions';
import { BrandPanel } from './BrandPanel';

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h13" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function LoginForm() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [err, setErr] = React.useState<{ email?: string; password?: string }>({});
  const [pending, setPending] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ne: typeof err = {};
    if (!email) ne.email = 'Email is required';
    if (!password) ne.password = 'Password is required';
    if (Object.keys(ne).length) {
      setErr(ne);
      return;
    }
    setErr({});
    setPending(true);
    const res = await signIn(email, password);
    if (res?.error) {
      setErr({ password: res.error });
      setPending(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-form-wrap">
        <div className="auth-form-inner">
          <div
            className="mb-8"
            style={{ fontSize: 28, letterSpacing: '-0.02em', fontWeight: 700 }}
          >
            Team Dashboard
          </div>
          <h1 className="text-3xl mb-2">Sign in</h1>
          <p className="text-grey mb-6">Welcome back. Pick up where you left off.</p>
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Email" error={err.email}>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@maheshchandra.com"
                autoFocus
              />
            </Field>
            <Field label="Password" error={err.password}>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>
            <Button type="submit" size="lg" loading={pending} className="signin-submit">
              {pending ? (
                'Signing in…'
              ) : (
                <>
                  Sign in
                  {/* Two stacked arrows clipped in a fixed box: on hover the
                      live one shoots off the right while a fresh one slides in
                      from the left — a continuous "forward" motion. */}
                  <span className="signin-arrow" aria-hidden="true">
                    <ArrowGlyph />
                    <ArrowGlyph className="signin-arrow-ghost" />
                  </span>
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
      {/* Right panel — premium brand experience (hidden on mobile). */}
      <div className="auth-art">
        <BrandPanel />
      </div>
    </div>
  );
}
