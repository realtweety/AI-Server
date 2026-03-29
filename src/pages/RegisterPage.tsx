import { createBrowserRouter, Navigate } from 'react-router-dom';

import { RootLayout } from '../components/RootLayout';
import { LoginPage } from './LoginPage';
import { AdminPage } from './AdminPage';
import { ChatPage } from './ChatPage';
import { useAuth } from '../contexts/AuthContext';

export function RegisterPage() {
  return (
    <div>
      <h1>Register</h1>
      {/* Your register form */}
    </div>
  );
}

// ── Auth guards ───────────────────────────────────────────────────────────────

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="h-screen gradient-bg flex items-center justify-center"><div className="glass rounded-2xl p-8 text-white/80 text-sm">Loading…</div></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user?.is_admin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// ── Router ────────────────────────────────────────────────────────────────────

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      {
        index: true,
        element: <RequireAuth><ChatPage /></RequireAuth>,
      },
      {
        path: 'login',
        element: <RedirectIfAuthed><LoginPage /></RedirectIfAuthed>,
      },
      {
        path: 'register',
        element: <RedirectIfAuthed><RegisterPage /></RedirectIfAuthed>,
      },
      {
        path: 'admin',
        element: <RequireAuth><RequireAdmin><AdminPage /></RequireAdmin></RequireAuth>,
      },
    ],
  },
]);