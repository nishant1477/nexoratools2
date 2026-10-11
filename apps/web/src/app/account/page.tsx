'use client';
import { useState, type FormEvent } from 'react';
import { PageShell, RequireAuth } from '@/components/RequireAuth';
import { ErrorNotice, Field, Notice } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';

function Account() {
  const { user, logout, refresh } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault(); setDone(false); setError('');
    if (next.length < 10) { setFieldErr('Use at least 10 characters.'); return; }
    setFieldErr(''); setBusy(true);
    try { await api('/me/password', { json: { currentPassword: current, newPassword: next } }); setDone(true); setCurrent(''); setNext(''); await refresh(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  return (
    <PageShell title="Account">
      <section aria-labelledby="profile-h">
        <h2 id="profile-h" className="mb-4 text-2xl">Profile</h2>
        <dl className="grid max-w-xl grid-cols-[8rem_1fr] gap-y-3">
          <dt className="text-muted">Name</dt><dd className="font-medium">{user?.name}</dd>
          <dt className="text-muted">Email</dt><dd className="break-all font-medium">{user?.email}</dd>
          <dt className="text-muted">Plan</dt><dd className="font-medium">{user && user.plan[0] + user.plan.slice(1).toLowerCase()}</dd>
          <dt className="text-muted">Member since</dt><dd className="font-medium">{formatDate(user?.createdAt)}</dd>
        </dl>
      </section>

      <section className="mt-14 max-w-md" aria-labelledby="pw-h">
        <h2 id="pw-h" className="mb-4 text-2xl">Change password</h2>
        <form onSubmit={submit} noValidate className="space-y-5">
          {done && <Notice>Password changed. Other devices have been signed out.</Notice>}
          {error && <ErrorNotice title="Couldn't change the password" message={error} />}
          <Field label="Current password" htmlFor="cur"><input id="cur" type="password" className="field" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
          <Field label="New password" htmlFor="new" hint="At least 10 characters." error={fieldErr}><input id="new" type="password" className="field" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={!!fieldErr} /></Field>
          <button type="submit" className="btn btn-primary" disabled={busy || !current}>{busy ? 'Saving…' : 'Change password'}</button>
        </form>
      </section>

      <section className="mt-14"><button type="button" className="btn btn-quiet" onClick={async () => { await logout(); window.location.assign('/'); }}>Sign out</button></section>
    </PageShell>
  );
}
export default function Page() { return <RequireAuth><Account /></RequireAuth>; }
