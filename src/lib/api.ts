// src/lib/api.ts
// Thin fetch wrapper. All requests include credentials (session cookie).

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || res.statusText);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(url: string)                  => request<T>(url),
  post:   <T>(url: string, body?: unknown)  => request<T>(url, { method: 'POST',   body: body != null ? JSON.stringify(body) : undefined }),
  put:    <T>(url: string, body?: unknown)  => request<T>(url, { method: 'PUT',    body: body != null ? JSON.stringify(body) : undefined }),
  delete: <T>(url: string)                  => request<T>(url, { method: 'DELETE' }),
};

// ── Typed API helpers ────────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  username: string;
  is_admin: boolean;
}

export interface Chat {
  id: string;
  title: string;
  system_prompt: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  preview?: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  is_admin: boolean;
  chat_count: number;
  created_at: string;
}

// Auth
export const authApi = {
  status:   ()                                          => api.get<{ authenticated: boolean; user?: AuthUser }>('/api/auth/status'),
  login:    (username: string, password: string)        => api.post<{ success: boolean; user: AuthUser }>('/api/auth/login', { username, password }),
  register: (username: string, email: string, password: string) => api.post<{ success: boolean; user: AuthUser }>('/api/auth/register', { username, email, password }),
  logout:   ()                                          => api.post<{ success: boolean }>('/api/auth/logout'),
};

// Chats
export const chatsApi = {
  list:     ()                                          => api.get<Chat[]>('/chats/api/chats'),
  create:   ()                                          => api.post<{ chat_id: string }>('/chats/api/chats'),
  load:     (id: string)                                => api.get<{ history: Message[]; system_prompt: string }>(`/chats/api/chats/${id}`),
  update:   (id: string, data: Partial<{ title: string; system_prompt: string }>) => api.put(`/chats/api/chats/${id}`, data),
  delete:   (id: string)                                => api.delete(`/chats/api/chats/${id}`),
  pin:      (id: string)                                => api.post<{ pinned: boolean }>(`/chats/api/chats/${id}/pin`),
  pop:      (id: string)                                => api.post(`/chats/api/chats/${id}/pop`),
  truncate: (id: string, from_index: number)            => api.post(`/chats/api/chats/${id}/truncate`, { from_index }),
  search:   (q: string)                                 => api.get<{ results: FTSResult[] }>(`/chats/api/search?q=${encodeURIComponent(q)}`),
  rebuildFts: ()                                        => api.post('/chats/api/fts-index'),
  savePartial: (id: string, content: string)            => api.post(`/api/chats/${id}/save-partial`, { content }),
};

export interface FTSResult {
  chat_id: string;
  title: string;
  snippet: string;
  role: string;
}

// Models
export const modelsApi = {
  list:        ()                           => api.get<{ models: string[] }>('/api/models'),
  context:     (model: string)              => api.get<{ context_length: number }>(`/api/model-context?model=${encodeURIComponent(model)}`),
  generateTitle: (chatId: string, model: string) => api.post<{ title: string }>(`/api/chats/${chatId}/generate-title`, { model }),
};

// Memory
export const memoryApi = {
  get:  ()                    => api.get<{ content: string }>('/api/memory'),
  save: (content: string)     => api.post('/api/memory', { content }),
};

// Admin
export const adminApi = {
  listUsers:     ()                                     => api.get<AdminUser[]>('/admin/api/users'),
  createUser:    (data: { username: string; email: string; password: string; is_admin: boolean }) => api.post('/admin/api/users', data),
  deleteUser:    (id: number)                           => api.delete(`/admin/api/users/${id}`),
  toggleAdmin:   (id: number)                           => api.post(`/admin/api/users/${id}/toggle-admin`),
  resetPassword: (id: number, password: string)         => api.post(`/admin/api/users/${id}/reset-password`, { password }),
};

// RAG
export const ragApi = {
  uploadDocument: (file: File, embedding_model: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('embedding_model', embedding_model);
    return fetch('/api/rag/upload', { method: 'POST', credentials: 'include', body: fd }).then(r => r.json());
  },
  listDocuments:  ()          => api.get<Array<{ id: string; filename: string; char_count: number; chunk_count: number; created_at: string }>>('/api/rag/documents'),
  deleteDocument: (id: string) => api.delete(`/api/rag/documents/${id}`),
  extractText:    (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/rag/extract', { method: 'POST', credentials: 'include', body: fd }).then(r => r.json());
  },
};
