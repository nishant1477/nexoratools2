'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ErrorNotice, Field } from './ui';

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard');

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const isLogin = mode === 'login';

  useEffect(() => { if (user && !busy) router.replace(next); }, [user, busy, next, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!isLogin && !name.trim()) errs.name = 'Enter your name.';
    if (!/^\S+@\S+\.\S+$/.test(email)) errs.email = 'Enter a valid email address.';
    if (!password) errs.password = 'Enter your password.';
    else if (!isLogin && password.length < 10) errs.password = 'Use at least 10 characters.';
    setFieldErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError('');
    try {
      if (isLogin) await login(email.trim(), password); else await register(name.trim(), email.trim(), password);
      router.replace(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') setFieldErr({ email: err.message });
      else setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-14 sm:py-20">
      <h1 className="text-4xl font-extrabold">{isLogin ? 'Sign in' : 'Create your account'}</h1>
      <p className="mt-2 text-muted">{isLogin ? 'Welcome back.' : 'Free. It takes a few seconds.'}</p>
      <form onSubmit={submit} noValidate className="mt-8 space-y-5">
        {error && <ErrorNotice title={isLogin ? "Couldn't sign you in" : "Couldn't create the account"} message={error} />}
        {!isLogin && <Field label="Name" htmlFor="name" error={fieldErr.name}><input id="name" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!fieldErr.name} aria-describedby={fieldErr.name ? 'name-error' : undefined} /></Field>}
        <Field label="Email" htmlFor="email" error={fieldErr.email}><input id="email" type="email" className="field" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!fieldErr.email} aria-describedby={fieldErr.email ? 'email-error' : undefined} /></Field>
        <Field label="Password" htmlFor="password" hint={isLogin ? undefined : 'At least 10 characters.'} error={fieldErr.password}>
          <input id="password" type="password" className="field" autoComplete={isLogin ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!fieldErr.password} aria-describedby={fieldErr.password ? 'password-error' : !isLogin ? 'password-hint' : undefined} />
        </Field>
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>{busy ? 'Please wait…' : isLogin ? 'Sign in' : 'Create account'}</button>
      </form>
      <p className="mt-6 text-sm text-muted">
        {isLogin ? <>New here? <Link className="font-semibold text-pine underline" href={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link></> : <>Already registered? <Link className="font-semibold text-pine underline" href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></>}
      </p>
    </div>
  );
}
