// App.tsx
import { RouterProvider } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { router } from '../pages/routes';

function AppContent() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="glass p-6 text-white/80 rounded-xl">Loading…</div>
      </div>
    );
  }

  return <RouterProvider router={router} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}