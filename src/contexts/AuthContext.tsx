// src/contexts/AuthContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { authApi, AuthUser } from '@/lib/api';

interface AuthContextValue {
  user:     AuthUser | null;
  isLoading: boolean;
  login:    (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout:   () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]         = useState<AuthUser | null>(null);
  const [isLoading, setLoading] = useState(true);

  // Check auth status on mount
  useEffect(() => {
    authApi.status()
      .then(({ authenticated, user }) => setUser(authenticated && user ? user : null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const { user } = await authApi.login(username, password);
    setUser(user);
  };

  const register = async (username: string, email: string, password: string) => {
    const { user } = await authApi.register(username, email, password);
    setUser(user);
  };

  const logout = async () => {
    await authApi.logout().catch(() => {});
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
