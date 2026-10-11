'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null; loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try { setUser((await api<{ user: User }>('/me')).user); }
    catch (err) { if (!(err instanceof ApiError) || err.status !== 401) console.warn('session check failed', err); setUser(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<AuthState>(() => ({
    user, loading, refresh,
    login: async (email, password) => { const d = await api<{ user: User }>('/auth/login', { json: { email, password } }); setUser(d.user); return d.user; },
    register: async (name, email, password) => { const d = await api<{ user: User }>('/auth/register', { json: { name, email, password } }); setUser(d.user); return d.user; },
    logout: async () => { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); setUser(null); },
  }), [user, loading, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
