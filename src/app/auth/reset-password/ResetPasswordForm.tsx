'use client';

// Set-a-new-password form, reached from the emailed reset link (via
// /auth/callback). Without a recovery session the link was bad or expired,
// so it offers a way back to request another one.
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Field } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { resetPassword } from '@/lib/auth-actions';
import { BrandPanel } from '@/app/login/BrandPanel';

export function ResetPasswordForm({ hasSession }: { hasSession: boolean }) {
  const router = useRouter();
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [pwVisible, setPwVisible] = React.useState(false);
  const [err, setErr] = React.useState<{ password?: string; confirm?: string }>({});
  const [pending, setPending] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ne: typeof err = {};
    if (password.length < 6) ne.password = 'At least 6 characters';
    else if (password !== confirm) ne.confirm = "Doesn't match";
    if (Object.keys(ne).length) {
      setErr(ne);
      return;
    }
    setErr({});
    setPending(true);
    const res = await resetPassword(password);
    if (res.error) {
      setErr({ password: res.error });
      setPending(false);
      return;
    }
    // Same as Settings: the member set their own password — clear the
    // onboarding reminder.
    try {
      localStorage.setItem('restruc:pw-changed', '1');
      localStorage.removeItem('restruc:pw-reminder');
    } catch {
      /* localStorage unavailable */
    }
    router.replace('/dashboard');
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
          {hasSession ? (
            <>
              <h1 className="text-3xl mb-2">Set a new password</h1>
              <p className="text-grey mb-6">Choose a password you haven&apos;t used here before.</p>
              <form onSubmit={submit} className="grid gap-4">
                <Field label="New password" error={err.password}>
                  <div className="pw-field">
                    <input
                      className="input pw-input"
                      type={pwVisible ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="pw-toggle"
                      onClick={() => setPwVisible((v) => !v)}
                      aria-label={pwVisible ? 'Hide password' : 'Show password'}
                      aria-pressed={pwVisible}
                    >
                      <Icon name={pwVisible ? 'eye-off' : 'eye'} size={17} />
                    </button>
                  </div>
                </Field>
                <Field label="Confirm password" error={err.confirm}>
                  <input
                    className="input"
                    type={pwVisible ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </Field>
                <Button type="submit" size="lg" loading={pending}>
                  {pending ? 'Saving…' : 'Save password'}
                </Button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-3xl mb-2">Link expired</h1>
              <p className="text-grey mb-6">
                This reset link is invalid or has already been used. Request a new one from
                the sign-in page.
              </p>
              <Link href="/login?forgot=1" className="btn btn-lg">
                Request a new link
              </Link>
            </>
          )}
        </div>
      </div>
      <div className="auth-art">
        <BrandPanel />
      </div>
    </div>
  );
}
