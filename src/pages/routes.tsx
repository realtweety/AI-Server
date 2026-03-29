// routes.tsx
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RootLayout } from '../components/RootLayout';
import { LoginPage } from './LoginPage';
import { RegisterPage } from './RegisterPage';
import { AdminPage } from './AdminPage';
import { ChatPage } from './ChatPage';
import { useAuth } from '../contexts/AuthContext';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user?.is_admin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, element: <RequireAuth><ChatPage /></RequireAuth> },
      { path: 'login', element: <RedirectIfAuthed><LoginPage /></RedirectIfAuthed> },
      { path: 'register', element: <RedirectIfAuthed><RegisterPage /></RedirectIfAuthed> },
      { path: 'admin', element: <RequireAuth><RequireAdmin><AdminPage /></RequireAdmin></RequireAuth> },
    ],
  },
]);