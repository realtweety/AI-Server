import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom'; // ✅ Correct
import { useAuth } from '@/contexts/AuthContext';

export function LoginPage() {
  const { login }      = useAuth();
  const navigate       = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="glass-card rounded-3xl p-8 md:p-10 shine-effect">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mb-4 shadow-2xl">
              <span className="text-4xl font-bold text-white">W</span>
            </div>
            <h1 className="text-2xl font-bold text-white">WilburtAI</h1>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-xl font-semibold text-white mb-2">Welcome back</h2>
            <p className="text-sm text-white/70">Sign in to continue your conversations.</p>
          </div>

          {error && (
            <div className="mb-5 px-4 py-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-white/90 mb-2">Username</label>
              <input
                id="username" type="text" value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="your username"
                className="glass-input w-full px-4 py-3 rounded-xl text-white placeholder-white/50 focus:ring-2 focus:ring-purple-500 outline-none"
                required autoFocus autoComplete="username"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-white/90 mb-2">Password</label>
              <input
                id="password" type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="glass-input w-full px-4 py-3 rounded-xl text-white placeholder-white/50 focus:ring-2 focus:ring-purple-500 outline-none"
                required autoComplete="current-password"
              />
            </div>
            <button
              type="submit" disabled={loading}
              className="glass-button w-full py-3.5 rounded-xl text-white font-semibold text-base mt-6 hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-sm text-white/70 mt-6">
            Don't have an account?{' '}
            <Link to="/register" className="text-white font-medium hover:text-purple-300 transition-colors">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
