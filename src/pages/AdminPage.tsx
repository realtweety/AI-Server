import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { Trash2, Key, Shield, ShieldOff, Plus, X } from 'lucide-react';
import { adminApi, AdminUser } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export function AdminPage() {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  const [users, setUsers]       = useState<AdminUser[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [msg, setMsg]           = useState('');

  // Create user form
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail]       = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newIsAdmin, setNewIsAdmin]   = useState(false);
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState('');

  // Reset password modal
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPw, setResetPw]         = useState('');
  const [resetting, setResetting]     = useState(false);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  const loadUsers = async () => {
    try {
      const data = await adminApi.listUsers();
      setUsers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const handleDelete = async (u: AdminUser) => {
    if (!confirm(`Delete "${u.username}" and all their chats? This cannot be undone.`)) return;
    try {
      await adminApi.deleteUser(u.id);
      flash(`Deleted ${u.username}`);
      loadUsers();
    } catch (e) { alert(e instanceof Error ? e.message : 'Delete failed'); }
  };

  const handleToggleAdmin = async (u: AdminUser) => {
    try {
      await adminApi.toggleAdmin(u.id);
      flash(`Updated ${u.username}`);
      loadUsers();
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      await adminApi.createUser({ username: newUsername, email: newEmail, password: newPassword, is_admin: newIsAdmin });
      setNewUsername(''); setNewEmail(''); setNewPassword(''); setNewIsAdmin(false);
      flash('User created');
      loadUsers();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const handleResetPw = async () => {
    if (!resetTarget || resetPw.length < 6) return;
    setResetting(true);
    try {
      await adminApi.resetPassword(resetTarget.id, resetPw);
      setResetTarget(null); setResetPw('');
      flash('Password updated');
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
    finally { setResetting(false); }
  };

  return (
    <div className="min-h-screen w-full p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="glass-card rounded-2xl p-6 mb-6 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
              <span className="text-2xl font-bold text-white">W</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">WilburtAI Admin</h1>
              <p className="text-sm text-white/60">Manage users and settings</p>
            </div>
          </div>
          <Link to="/" className="glass-button px-4 py-2 rounded-lg text-white text-sm font-medium hover:scale-105 transition-transform">
            ← Back to chat
          </Link>
        </div>

        {msg && <div className="mb-4 px-4 py-3 rounded-xl bg-green-500/15 border border-green-500/30 text-green-300 text-sm">{msg}</div>}
        {error && <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-sm">{error}</div>}

        {/* Users table */}
        <div className="glass-card rounded-2xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Users</h2>
          {loading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="skeleton-shimmer h-12 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    {['Username','Email','Role','Chats','Joined','Actions'].map(h => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-white/50 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4">
                        <span className="text-white font-medium">{u.username}</span>
                        {u.id === user?.id && <span className="ml-2 text-white/30 text-xs">(you)</span>}
                      </td>
                      <td className="py-3 px-4 text-white/60 text-sm">{u.email}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${u.is_admin ? 'bg-purple-500/20 text-purple-300' : 'bg-white/10 text-white/50'}`}>
                          {u.is_admin ? 'Admin' : 'User'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-white/60 text-sm">{u.chat_count}</td>
                      <td className="py-3 px-4 text-white/60 text-sm">{new Date(u.created_at).toLocaleDateString()}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <button onClick={() => { setResetTarget(u); setResetPw(''); }} disabled={u.id === user?.id}
                            className="glass-button p-2 rounded-lg hover:scale-110 transition-transform disabled:opacity-30 disabled:cursor-default" title="Reset Password">
                            <Key className="w-4 h-4 text-white/70" />
                          </button>
                          <button onClick={() => handleToggleAdmin(u)} disabled={u.id === user?.id}
                            className="glass-button p-2 rounded-lg hover:scale-110 transition-transform disabled:opacity-30 disabled:cursor-default" title={u.is_admin ? 'Remove Admin' : 'Make Admin'}>
                            {u.is_admin ? <ShieldOff className="w-4 h-4 text-white/70" /> : <Shield className="w-4 h-4 text-white/70" />}
                          </button>
                          <button onClick={() => handleDelete(u)} disabled={u.id === user?.id}
                            className="glass-button p-2 rounded-lg hover:scale-110 transition-transform hover:bg-red-500/20 disabled:opacity-30 disabled:cursor-default" title="Delete">
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Create user */}
        <div className="glass-card rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Create New User</h2>
          {createError && <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-sm">{createError}</div>}
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Username</label>
                <input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="username" required minLength={3}
                  className="glass-input w-full px-4 py-2.5 rounded-lg text-white placeholder-white/30 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Email</label>
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="user@example.com" required
                  className="glass-input w-full px-4 py-2.5 rounded-lg text-white placeholder-white/30 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Password</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="min 6 characters" required minLength={6}
                  className="glass-input w-full px-4 py-2.5 rounded-lg text-white placeholder-white/30 outline-none" />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={newIsAdmin} onChange={e => setNewIsAdmin(e.target.checked)}
                    className="w-5 h-5 rounded accent-purple-500" />
                  <span className="text-sm text-white/80 font-medium">Make admin</span>
                </label>
              </div>
            </div>
            <button type="submit" disabled={creating}
              className="glass-button flex items-center gap-2 px-6 py-2.5 rounded-lg text-white font-semibold hover:scale-105 transition-transform disabled:opacity-50">
              <Plus className="w-4 h-4" /> {creating ? 'Creating…' : 'Create User'}
            </button>
          </form>
        </div>
      </div>

      {/* Reset password modal */}
      {resetTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="glass-strong rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Reset Password for {resetTarget.username}</h3>
              <button onClick={() => setResetTarget(null)} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <input type="password" value={resetPw} onChange={e => setResetPw(e.target.value)}
              placeholder="New password (min 6 chars)" minLength={6}
              className="glass-input w-full px-4 py-3 rounded-xl text-white placeholder-white/40 outline-none mb-4" />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setResetTarget(null)} className="glass-button px-4 py-2 rounded-lg text-white/70 text-sm">Cancel</button>
              <button onClick={handleResetPw} disabled={resetPw.length < 6 || resetting}
                className="glass-button px-4 py-2 rounded-lg text-white text-sm font-semibold border border-purple-500/40 disabled:opacity-50">
                {resetting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
