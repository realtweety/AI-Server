import {
  useState, useEffect, useRef, useCallback,
  KeyboardEvent, ClipboardEvent, DragEvent,
} from 'react';
import {
  Menu, Send, Square, Plus, Search, Settings, Sparkles,
  User, Globe, Pin, Trash2, Edit2, ChevronDown,
  Paperclip, X, Folder, Brain, ChevronRight,
} from 'lucide-react';
import { useAuth }    from '@/contexts/AuthContext';
import { chatsApi, modelsApi, memoryApi, ragApi, Chat, Message, FTSResult } from '@/lib/api';
import { getSocket, StartStreamPayload, StreamTokenPayload, StreamDonePayload, StreamErrorPayload, StreamToolPayload, ToolCall } from '@/lib/socket';
import { renderMarkdown, separateThought, escapeHtml, formatTimestamp } from '@/lib/markdown';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PendingImage  { dataUri: string; name: string }
interface PendingFile   { name: string; content: string; lang: string }
interface StreamingMsg  { buffer: string; done: boolean; toolActivity?: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const TEXT_EXTS = new Set([
  'txt','md','py','js','ts','jsx','tsx','json','jsonc','css','scss','html','xml',
  'yaml','yml','toml','sh','bash','c','cpp','h','cs','java','rb','go','rs','sql',
  'graphql','dockerfile','makefile','env','log','csv','tsv',
]);

function getExt(name: string) { return name.split('.').pop()?.toLowerCase() ?? ''; }
function langHint(name: string): string {
  const m: Record<string,string> = {py:'python',js:'javascript',ts:'typescript',jsx:'jsx',tsx:'tsx',json:'json',css:'css',html:'html',sh:'bash',rs:'rust',go:'go',java:'java',rb:'ruby',cs:'csharp',cpp:'cpp',c:'c',sql:'sql',yml:'yaml',yaml:'yaml'};
  return m[getExt(name)] ?? '';
}

// ── ChatPage ──────────────────────────────────────────────────────────────────

export function ChatPage() {
  const { user, logout }    = useAuth();

  // Sidebar
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const [chats, setChats]               = useState<Chat[]>([]);
  const [chatSearch, setChatSearch]     = useState('');
  const [ftsResults, setFtsResults]     = useState<FTSResult[]>([]);
  const [showFts, setShowFts]           = useState(false);
  const ftsTimer = useRef<ReturnType<typeof setTimeout>>();

  // Active chat
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [history, setHistory]           = useState<Message[]>([]);
  const [systemPrompt, setSystemPrompt] = useState('');

  // Models
  const [models, setModels]             = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('wilburt_model') ?? '');

  // Streaming
  const [isStreaming, setIsStreaming]   = useState(false);
  const [streaming, setStreaming]       = useState<StreamingMsg | null>(null);
  const lastUserMsg = useRef('');
  const streamBufferRef = useRef('');

  // Input
  const [input, setInput]               = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingFiles, setPendingFiles]   = useState<PendingFile[]>([]);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll]     = useState(true);

  // Settings
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [temperature, setTemperature]   = useState(() => parseFloat(localStorage.getItem('wilburt_temp') ?? '0.7'));
  const [maxTokens, setMaxTokens]       = useState(() => parseInt(localStorage.getItem('wilburt_maxtok') ?? '-1'));
  const [webTools, setWebTools]         = useState(false);
  const [ragEnabled, setRagEnabled]     = useState(() => localStorage.getItem('wilburt_rag') === '1');
  const [embeddingModel, setEmbeddingModel] = useState(() => localStorage.getItem('wilburt_rag_embedding') ?? '');

  // Memory
  const [memoryOpen, setMemoryOpen]     = useState(false);
  const [memoryContent, setMemoryContent] = useState('');
  const [memorySaving, setMemorySaving] = useState(false);

  // Prune warning
  const [pruned, setPruned]             = useState(false);

  // Attach menu
  const [attachOpen, setAttachOpen]     = useState(false);
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // In-chat search
  const [inChatSearch, setInChatSearch] = useState('');
  const [inChatOpen, setInChatOpen]     = useState(false);

  // ── Init ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadModels();
    loadChats();
    loadMemory();
    fetch('/chats/api/fts-index', { method: 'POST', credentials: 'include' }).catch(() => {});
    const socket = getSocket();
    socket.on('stream_token',        handleStreamToken);
    socket.on('stream_done',         handleStreamDone);
    socket.on('stream_error',        handleStreamError);
    socket.on('stream_tool_activity', handleToolActivity);
    return () => {
      socket.off('stream_token',        handleStreamToken);
      socket.off('stream_done',         handleStreamDone);
      socket.off('stream_error',        handleStreamError);
      socket.off('stream_tool_activity', handleToolActivity);
    };
  }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, streaming, autoScroll]);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadModels = async () => {
    try {
      const { models: m } = await modelsApi.list();
      setModels(m);
      if (!selectedModel && m.length) setSelectedModel(m[0]);
    } catch {}
  };

  const loadChats = async () => {
    try {
      const data = await chatsApi.list();
      setChats(data);
    } catch {}
  };

  const loadChat = async (id: string) => {
    try {
      const { history: h, system_prompt } = await chatsApi.load(id);
      setActiveChatId(id);
      setHistory(h);
      setSystemPrompt(system_prompt);
      setStreaming(null);
      setPruned(false);
      localStorage.setItem('wilburt_last_chat', id);
    } catch {}
  };

  const loadMemory = async () => {
    try {
      const { content } = await memoryApi.get();
      setMemoryContent(content);
    } catch {}
  };

  // ── Chat management ────────────────────────────────────────────────────────

  const createChat = async () => {
    const { chat_id } = await chatsApi.create();
    await loadChats();
    await loadChat(chat_id);
  };

  const deleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this chat?')) return;
    await chatsApi.delete(id);
    if (activeChatId === id) { setActiveChatId(null); setHistory([]); }
    loadChats();
  };

  const pinChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await chatsApi.pin(id);
    loadChats();
  };

  // ── FTS search ─────────────────────────────────────────────────────────────

  const onChatSearchChange = (q: string) => {
    setChatSearch(q);
    clearTimeout(ftsTimer.current);
    if (q.length < 2) { setShowFts(false); return; }
    ftsTimer.current = setTimeout(async () => {
      const { results } = await chatsApi.search(q);
      setFtsResults(results);
      setShowFts(results.length > 0);
    }, 400);
  };

  // ── Streaming handlers ─────────────────────────────────────────────────────

  const handleStreamToken = useCallback(({ token }: StreamTokenPayload) => {
    streamBufferRef.current += token;
    setStreaming({ buffer: streamBufferRef.current, done: false });
  }, []);

  const handleToolActivity = useCallback(({ phase, names, name, summary }: StreamToolPayload) => {
    const msg = phase === 'start'
      ? `Running ${(names || [name]).filter(Boolean).join(', ')}…`
      : `${name}: ${summary ?? ''}`;
    setStreaming(s => s ? { ...s, toolActivity: msg } : { buffer: '', done: false, toolActivity: msg });
  }, []);

  const handleStreamDone = useCallback(({ stats, tool_calls, pruned: wasPruned }: StreamDonePayload) => {
    setIsStreaming(false);
    if (wasPruned) setPruned(true);
    const finalContent = streamBufferRef.current;
    setStreaming(null);
    streamBufferRef.current = '';
    if (finalContent || tool_calls?.length) {
      setHistory(h => [...h, { role: 'assistant', content: finalContent }]);
    }
    loadChats();
    if (activeChatId && selectedModel) {
      // Auto-title on first exchange
      const userMsgCount = history.filter(m => m.role === 'user').length;
      if (userMsgCount === 1) {
        modelsApi.generateTitle(activeChatId, selectedModel)
          .then(({ title }) => {
            setChats(cs => cs.map(c => c.id === activeChatId ? { ...c, title } : c));
          }).catch(() => {});
      }
    }
  }, [activeChatId, selectedModel, history]);

  const handleStreamError = useCallback(({ error }: StreamErrorPayload) => {
    setIsStreaming(false);
    setStreaming(null);
    streamBufferRef.current = '';
    setHistory(h => [...h, { role: 'assistant', content: `⚠ Error: ${error}` }]);
  }, []);

  // ── Send message ───────────────────────────────────────────────────────────

  const sendMessage = async () => {
    const text = input.trim();
    if (isStreaming || (!text && !pendingImages.length)) return;
    if (!selectedModel) { alert('No model selected — is LM Studio running?'); return; }

    let chatId = activeChatId;
    if (!chatId) {
      const { chat_id } = await chatsApi.create();
      chatId = chat_id;
      await loadChats();
      await loadChat(chat_id);
    }

    // Build file context
    let fileContext = '';
    if (pendingFiles.length) {
      fileContext = pendingFiles.map(f => {
        const fence = f.lang ? '```' + f.lang : '```';
        return `### ${f.name}\n${fence}\n${f.content}\n\`\`\``;
      }).join('\n\n');
    }
    const fullMessage = fileContext ? (fileContext + (text ? '\n\n' + text : '')) : text;

    // UI user message
    const uiContent = pendingImages.length
      ? [{ type: 'text' as const, text: text || ' ' }, ...pendingImages.map(i => ({ type: 'image_url' as const, image_url: { url: i.dataUri } }))]
      : (text || `📎 ${pendingFiles.map(f => f.name).join(', ')}`);

    setHistory(h => [...h, { role: 'user', content: uiContent as any }]);
    lastUserMsg.current = fullMessage;
    setInput('');
    setPendingImages([]);
    setPendingFiles([]);
    setAutoScroll(true);

    // Start stream
    streamBufferRef.current = '';
    setStreaming({ buffer: '', done: false });
    setIsStreaming(true);

    const socket = getSocket();
    const payload: StartStreamPayload = {
      message:         fullMessage,
      model:           selectedModel,
      chat_id:         chatId,
      temperature,
      max_tokens:      maxTokens,
      regenerate:      false,
      images:          pendingImages.map(i => i.dataUri),
      use_rag:         ragEnabled,
      embedding_model: embeddingModel || selectedModel,
      use_web_tools:   webTools,
    };
    socket.emit('start_stream', payload);
  };

  const stopStream = () => {
    const socket = getSocket();
    socket.emit('stop_stream', {});
    setIsStreaming(false);
    const partial = streamBufferRef.current.trim();
    if (partial && activeChatId) {
      chatsApi.savePartial(activeChatId, partial).catch(() => {});
      setHistory(h => [...h, { role: 'assistant', content: partial }]);
    }
    setStreaming(null);
    streamBufferRef.current = '';
  };

  const regenerate = async () => {
    if (isStreaming || !activeChatId || !lastUserMsg.current) return;
    await chatsApi.pop(activeChatId);
    setHistory(h => h.slice(0, -1));
    streamBufferRef.current = '';
    setStreaming({ buffer: '', done: false });
    setIsStreaming(true);
    const socket = getSocket();
    socket.emit('start_stream', {
      message: lastUserMsg.current, model: selectedModel, chat_id: activeChatId,
      temperature, max_tokens: maxTokens, regenerate: true, images: [],
      use_rag: ragEnabled, embedding_model: embeddingModel || selectedModel,
      use_web_tools: webTools,
    });
  };

  // ── File handling ──────────────────────────────────────────────────────────

  const dispatchFile = (file: File) => {
    if (!file) return;
    const ext = getExt(file.name);
    if (file.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = e => setPendingImages(imgs => [...imgs, { dataUri: e.target!.result as string, name: file.name }]);
      r.readAsDataURL(file);
    } else if (file.type === 'application/pdf' || ext === 'pdf') {
      ragApi.extractText(file).then((d: any) => {
        if (d.text) setPendingFiles(fs => [...fs, { name: file.name, content: d.text, lang: '' }]);
      });
    } else if (file.type.startsWith('text/') || TEXT_EXTS.has(ext)) {
      const r = new FileReader();
      r.onload = e => {
        const content = e.target!.result as string;
        if (content.length > 120000) { alert(`"${file.name}" is too large (max ~120 KB)`); return; }
        setPendingFiles(fs => [...fs, { name: file.name, content, lang: langHint(file.name) }]);
      };
      r.readAsText(file);
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imgs = items.filter(i => i.type.startsWith('image/'));
    if (imgs.length) { e.preventDefault(); imgs.forEach(i => dispatchFile(i.getAsFile()!)); }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    Array.from(e.dataTransfer.files).forEach(dispatchFile);
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderBubble = (content: string) => {
    const p = separateThought(content);
    let html = '';
    if (p.thought) {
      html += `<details class="thought-block"><summary>Thought</summary><div class="thought-content">${escapeHtml(p.thought)}</div></details>`;
    }
    if (p.response) html += renderMarkdown(p.response);
    return html;
  };

  const addCodeCopyButtons = (el: HTMLDivElement | null) => {
    if (!el) return;
    el.querySelectorAll<HTMLElement>('.code-block').forEach(block => {
      if (block.querySelector('.code-copy-btn')) return;
      const hdr = block.querySelector('.code-block-header');
      if (!hdr) return;
      const btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
      btn.onclick = () => {
        const raw = (block as HTMLElement).dataset.raw?.replace(/&amp;/g,'&').replace(/&quot;/g,'"') ?? block.querySelector('code')?.textContent ?? '';
        navigator.clipboard.writeText(raw).then(() => { const o = btn.innerHTML; btn.innerHTML = '✓ Copied!'; setTimeout(() => btn.innerHTML = o, 1500); });
      };
      hdr.appendChild(btn);
    });
  };

  const filteredChats = chatSearch.length >= 2
    ? chats.filter(c => c.title.toLowerCase().includes(chatSearch.toLowerCase()))
    : chats;

  const activeChat = chats.find(c => c.id === activeChatId);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && activeChatId) { e.preventDefault(); setInChatOpen(o => !o); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') { e.preventDefault(); createChat(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeChatId]);

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen w-full flex overflow-hidden">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <div className={`${sidebarOpen ? 'w-72' : 'w-0'} transition-all duration-300 flex-shrink-0 overflow-hidden`}>
        <div className="h-full glass-dark border-r border-white/10 flex flex-col">

          {/* Brand + new chat */}
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg flex-shrink-0">
                <span className="text-xl font-bold text-white">W</span>
              </div>
              <span className="text-lg font-bold text-white">WilburtAI</span>
            </div>
            <button onClick={createChat}
              className="glass-button w-full py-2.5 rounded-lg text-white font-medium flex items-center justify-center gap-2 hover:scale-[1.02]">
              <Plus className="w-4 h-4" /> New Chat
            </button>
          </div>

          {/* Search */}
          <div className="p-3 border-b border-white/10 relative">
            <div className="glass-input rounded-lg px-3 py-2 flex items-center gap-2">
              <Search className="w-4 h-4 text-white/40 flex-shrink-0" />
              <input value={chatSearch} onChange={e => onChatSearchChange(e.target.value)}
                placeholder="Search chats…"
                className="bg-transparent border-none outline-none text-white placeholder-white/40 text-sm flex-1" />
              {chatSearch && <button onClick={() => { setChatSearch(''); setShowFts(false); }} className="text-white/40 hover:text-white"><X className="w-3 h-3" /></button>}
            </div>
            {showFts && (
              <div className="absolute left-3 right-3 top-full mt-1 glass-strong rounded-xl overflow-hidden z-50 max-h-72 overflow-y-auto">
                {ftsResults.map(r => (
                  <button key={r.chat_id} onClick={() => { loadChat(r.chat_id); setShowFts(false); setChatSearch(''); }}
                    className="w-full px-4 py-3 text-left hover:bg-white/10 border-b border-white/5 last:border-0">
                    <div className="text-white text-sm font-medium truncate">{r.title}</div>
                    <div className="text-white/50 text-xs truncate" dangerouslySetInnerHTML={{ __html: r.snippet }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Chat list */}
          <div className="flex-1 overflow-y-auto p-2">
            {filteredChats.map(chat => (
              <button key={chat.id} onClick={() => loadChat(chat.id)}
                className={`w-full p-3 rounded-xl mb-1 text-left transition-all group relative ${activeChatId === chat.id ? 'glass-light' : 'hover:bg-white/5'}`}>
                <div className="flex items-start gap-2 pr-12">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {chat.pinned && <Pin className="w-3 h-3 text-purple-400 flex-shrink-0" />}
                      <h3 className="text-white text-sm font-medium truncate">{chat.title}</h3>
                    </div>
                    {chat.preview && <p className="text-white/40 text-xs truncate mt-0.5">{chat.preview}</p>}
                  </div>
                </div>
                {/* Actions */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={e => pinChat(chat.id, e)} className="p-1 rounded-md hover:bg-white/10 text-white/50 hover:text-purple-400">
                    <Pin className="w-3 h-3" />
                  </button>
                  <button onClick={e => deleteChat(chat.id, e)} className="p-1 rounded-md hover:bg-white/10 text-white/50 hover:text-red-400">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </button>
            ))}
          </div>

          {/* Memory panel */}
          <div className="border-t border-white/10">
            <button onClick={() => setMemoryOpen(o => !o)}
              className="w-full px-4 py-3 flex items-center gap-2 text-white/60 hover:text-white text-xs font-semibold uppercase tracking-wider transition-colors">
              <Brain className="w-3.5 h-3.5" />
              Memory
              <ChevronRight className={`w-3.5 h-3.5 ml-auto transition-transform ${memoryOpen ? 'rotate-90' : ''}`} />
            </button>
            {memoryOpen && (
              <div className="px-3 pb-3">
                <textarea value={memoryContent} onChange={e => setMemoryContent(e.target.value)} rows={3}
                  placeholder="Notes the AI will always remember…"
                  className="glass-input w-full rounded-lg px-3 py-2 text-white placeholder-white/30 text-xs resize-none outline-none" />
                <button onClick={async () => { setMemorySaving(true); await memoryApi.save(memoryContent); setMemorySaving(false); }}
                  className="mt-2 px-3 py-1 rounded-lg glass-button text-white text-xs font-medium">
                  {memorySaving ? 'Saving…' : 'Save memory'}
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <span className="text-xs font-bold text-white">{user?.username?.[0]?.toUpperCase()}</span>
              </div>
              <span className="text-white/70 text-sm font-medium truncate max-w-[100px]">{user?.username}</span>
            </div>
            <div className="flex gap-1.5">
              {user?.is_admin && (
                <a href="/admin" className="p-1.5 rounded-lg glass-button text-white/50 hover:text-white" title="Admin">
                  <Settings className="w-3.5 h-3.5" />
                </a>
              )}
              <button onClick={logout} className="p-1.5 rounded-lg glass-button text-white/50 hover:text-red-400 text-xs" title="Sign out">
                ⏻
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Topbar */}
        <div className="glass-dark border-b border-white/10 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button onClick={() => setSidebarOpen(o => !o)} className="glass-button p-2 rounded-lg hover:scale-110 transition-transform">
            <Menu className="w-5 h-5 text-white" />
          </button>
          <h2 className="text-white font-semibold flex-1 truncate text-sm">
            {activeChat?.title ?? (activeChatId ? 'Chat' : 'WilburtAI')}
          </h2>
          <div className="flex items-center gap-2">
            {/* Web tools toggle */}
            <button onClick={() => setWebTools(w => !w)} title={webTools ? 'Web tools on' : 'Web tools off'}
              className={`glass-button p-2 rounded-lg hover:scale-110 transition-transform ${webTools ? 'text-green-400 border-green-400/30' : 'text-white/50'}`}>
              <Globe className="w-4 h-4" />
            </button>
            {/* Settings */}
            <button onClick={() => setSettingsOpen(o => !o)}
              className={`glass-button p-2 rounded-lg hover:scale-110 transition-transform ${settingsOpen ? 'text-purple-300' : 'text-white/50'}`}>
              <Settings className="w-4 h-4" />
            </button>
            {/* In-chat search */}
            <button onClick={() => setInChatOpen(o => !o)}
              className="glass-button p-2 rounded-lg hover:scale-110 transition-transform text-white/50">
              <Search className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Settings panel */}
        {settingsOpen && (
          <div className="glass-dark border-b border-white/10 p-4 flex-shrink-0">
            <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">System Prompt</label>
                <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={2}
                  placeholder="You are a helpful assistant…"
                  className="glass-input w-full rounded-lg px-3 py-2 text-white placeholder-white/30 text-sm resize-none outline-none" />
                <button onClick={() => activeChatId && chatsApi.update(activeChatId, { system_prompt: systemPrompt })}
                  className="mt-1 px-3 py-1 rounded-lg glass-button text-white text-xs">Save prompt</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1">
                    Temperature: {temperature.toFixed(2)}
                  </label>
                  <input type="range" min={0} max={2} step={0.05} value={temperature}
                    onChange={e => { const v = parseFloat(e.target.value); setTemperature(v); localStorage.setItem('wilburt_temp', String(v)); }}
                    className="w-full accent-purple-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1">Max tokens (-1 = unlimited)</label>
                  <input type="number" value={maxTokens} onChange={e => { const v = parseInt(e.target.value) || -1; setMaxTokens(v); localStorage.setItem('wilburt_maxtok', String(v)); }}
                    className="glass-input w-full rounded-lg px-3 py-1.5 text-white text-sm outline-none" />
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-white/70">
                    <input type="checkbox" checked={ragEnabled} onChange={e => { setRagEnabled(e.target.checked); localStorage.setItem('wilburt_rag', e.target.checked ? '1' : '0'); }}
                      className="accent-purple-500" />
                    Enable RAG
                  </label>
                </div>
                {ragEnabled && (
                  <div>
                    <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1">Embedding model</label>
                    <input value={embeddingModel} onChange={e => { setEmbeddingModel(e.target.value); localStorage.setItem('wilburt_rag_embedding', e.target.value); }}
                      placeholder="e.g. nomic-embed-text"
                      className="glass-input w-full rounded-lg px-3 py-1.5 text-white text-sm outline-none placeholder-white/30" />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* In-chat search bar */}
        {inChatOpen && (
          <div className="glass-dark border-b border-white/10 px-4 py-2 flex items-center gap-3 flex-shrink-0">
            <Search className="w-4 h-4 text-white/40" />
            <input value={inChatSearch} onChange={e => setInChatSearch(e.target.value)} placeholder="Search messages…" autoFocus
              className="flex-1 bg-transparent outline-none text-white text-sm placeholder-white/40" />
            <button onClick={() => { setInChatOpen(false); setInChatSearch(''); }} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Prune warning */}
        {pruned && (
          <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-xs flex items-center gap-2 flex-shrink-0">
            ⚠ Some early messages were trimmed to fit the model context.
            <button onClick={() => setPruned(false)} className="ml-auto text-amber-300/60 hover:text-amber-300"><X className="w-3 h-3" /></button>
          </div>
        )}

        {/* Messages */}
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6"
          onScroll={() => {
            const el = chatContainerRef.current;
            if (!el) return;
            const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
            setAutoScroll(dist < 80);
          }}>
          {!activeChatId ? (
            // Empty state
            <div className="h-full flex flex-col items-center justify-center text-center gap-6">
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-2xl">
                <span className="text-5xl font-bold text-white">W</span>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white mb-2">WilburtAI</h1>
                <p className="text-white/60 text-lg max-w-md">Select a chat or start a new one. Paste or drag files. Upload docs for RAG.</p>
              </div>
              <button onClick={createChat} className="glass-button px-8 py-3 rounded-xl text-white font-semibold hover:scale-105 transition-transform">
                + New Chat
              </button>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-6">
              {history.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] ${msg.role === 'user' ? 'glass-strong rounded-2xl rounded-br-md p-4' : 'p-2'}`}>
                    {msg.role === 'assistant' ? (
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Sparkles className="w-4 h-4 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div ref={el => addCodeCopyButtons(el)} className="md text-white text-sm leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: renderBubble(typeof msg.content === 'string' ? msg.content : '') }} />
                          <div className="text-white/30 text-xs mt-2">{formatTimestamp(new Date())}</div>
                          {i === history.length - 1 && !isStreaming && (
                            <button onClick={regenerate} className="mt-2 flex items-center gap-1.5 text-white/40 hover:text-white/70 text-xs transition-colors">
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
                              Regenerate
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          {Array.isArray(msg.content) ? (
                            <div>
                              {(msg.content as any[]).map((part, pi) => (
                                part.type === 'text'
                                  ? <p key={pi} className="text-white text-sm">{part.text}</p>
                                  : <img key={pi} src={part.image_url?.url} className="max-w-[200px] rounded-lg mt-2" />
                              ))}
                            </div>
                          ) : (
                            <p className="text-white text-sm">{msg.content as string}</p>
                          )}
                          <div className="text-white/40 text-xs mt-1">{formatTimestamp(new Date())}</div>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <User className="w-4 h-4 text-white" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Streaming bubble */}
              {streaming && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] p-2">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Sparkles className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        {streaming.toolActivity && (
                          <div className="tool-activity-card mb-3">
                            <span className="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
                            {streaming.toolActivity}
                          </div>
                        )}
                        {streaming.buffer ? (
                          <div ref={el => addCodeCopyButtons(el)} className="md text-white text-sm leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: renderBubble(streaming.buffer) }} />
                        ) : !streaming.toolActivity ? (
                          <span className="thinking-dots text-white/50"><span>.</span><span>.</span><span>.</span></span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Scroll to bottom */}
        {!autoScroll && (
          <button onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
            className="absolute bottom-32 right-6 glass-button p-2 rounded-full shadow-lg">
            <ChevronDown className="w-5 h-5 text-white" />
          </button>
        )}

        {/* Input area */}
        {activeChatId !== null || true ? (
          <div className="glass-dark border-t border-white/10 p-4 flex-shrink-0"
            onDragOver={e => e.preventDefault()} onDrop={onDrop}>
            <div className="max-w-4xl mx-auto">

              {/* Attach previews */}
              {(pendingImages.length > 0 || pendingFiles.length > 0) && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {pendingImages.map((img, i) => (
                    <div key={i} className="relative">
                      <img src={img.dataUri} className="w-14 h-14 rounded-lg object-cover border border-white/20" />
                      <button onClick={() => setPendingImages(imgs => imgs.filter((_,j) => j !== i))}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center">
                        <X className="w-2.5 h-2.5 text-white" />
                      </button>
                    </div>
                  ))}
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 glass-light rounded-lg px-3 py-1.5 text-white text-xs">
                      <span>{f.name}</span>
                      <button onClick={() => setPendingFiles(fs => fs.filter((_,j) => j !== i))} className="text-white/40 hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="glass-light rounded-2xl p-3 flex items-end gap-3">
                {/* Model selector */}
                <select value={selectedModel} onChange={e => { setSelectedModel(e.target.value); localStorage.setItem('wilburt_model', e.target.value); }}
                  className="bg-transparent text-white/70 text-xs outline-none border-none cursor-pointer hidden md:block max-w-[140px] truncate">
                  {models.map(m => <option key={m} value={m} className="bg-gray-900">{m}</option>)}
                  {!models.length && <option disabled className="bg-gray-900">No models</option>}
                </select>

                {/* Attach button */}
                <div className="relative flex-shrink-0">
                  <button onClick={() => setAttachOpen(o => !o)} className="glass-button p-2 rounded-xl hover:scale-110 transition-transform text-white/60 hover:text-white">
                    <Paperclip className="w-5 h-5" />
                  </button>
                  {attachOpen && (
                    <div className="absolute bottom-full mb-2 left-0 glass-strong rounded-xl overflow-hidden z-50 min-w-[140px]">
                      <button onClick={() => { setAttachOpen(false); fileInputRef.current?.click(); }}
                        className="w-full px-4 py-2.5 text-left text-white text-sm hover:bg-white/10 flex items-center gap-2">
                        <Paperclip className="w-4 h-4" /> Files
                      </button>
                      <button onClick={() => { setAttachOpen(false); folderInputRef.current?.click(); }}
                        className="w-full px-4 py-2.5 text-left text-white text-sm hover:bg-white/10 flex items-center gap-2">
                        <Folder className="w-4 h-4" /> Folder
                      </button>
                    </div>
                  )}
                </div>

                {/* Textarea */}
                <textarea ref={inputRef} value={input}
                  onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }}
                  onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  onPaste={onPaste}
                  placeholder="Message WilburtAI… (Enter to send, Shift+Enter for new line)"
                  rows={1}
                  className="flex-1 bg-transparent border-none outline-none text-white placeholder-white/40 resize-none max-h-48 text-sm leading-relaxed" />

                {/* Send / Stop */}
                <button onClick={isStreaming ? stopStream : sendMessage}
                  disabled={!isStreaming && !input.trim() && !pendingImages.length}
                  className={`p-2.5 rounded-xl hover:scale-110 transition-transform flex-shrink-0 ${isStreaming ? 'glass-button text-red-400 border border-red-400/30' : 'glass-button text-white disabled:opacity-30 disabled:cursor-not-allowed'}`}>
                  {isStreaming ? <Square className="w-5 h-5" /> : <Send className="w-5 h-5" />}
                </button>
              </div>
              <p className="text-white/30 text-xs mt-2 text-center">Enter to send · Shift+Enter for new line · Ctrl+F to search · drag files to attach</p>
            </div>
          </div>
        ) : null}

        {/* Hidden file inputs */}
        <input ref={fileInputRef} type="file" multiple accept="*" className="hidden"
          onChange={e => { Array.from(e.target.files ?? []).forEach(dispatchFile); e.target.value = ''; }} />
        <input ref={folderInputRef} type="file" multiple className="hidden"
          {...({ webkitdirectory: '' } as any)}
          onChange={e => { Array.from(e.target.files ?? []).forEach(dispatchFile); e.target.value = ''; }} />
      </div>
    </div>
  );
}
