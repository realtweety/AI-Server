// app/static/script.js - WilburtAI Micro Server

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentChatId    = null;
let lastUserMessage  = '';
let isStreaming      = false;
let abortController  = null;
let modelSettings    = { temperature: 0.7, maxTokens: -1 };
let pendingImages    = [];   // array of { dataUri, name } waiting to be sent
let allChats         = [];   // cache for client-side search filtering

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const chatContainer      = document.getElementById('chatContainer');
const emptyState         = document.getElementById('emptyState');
const messageInput       = document.getElementById('messageInput');
const modelSelect        = document.getElementById('modelSelect');
const sendBtn            = document.getElementById('sendBtn');
const stopBtn            = document.getElementById('stopBtn');
const newChatBtn         = document.getElementById('newChatBtn');
const emptyNewChatBtn    = document.getElementById('emptyNewChatBtn');
const chatList           = document.getElementById('chatList');
const settingsToggleBtn  = document.getElementById('settingsToggleBtn');
const settingsPanel      = document.getElementById('settingsPanel');
const systemPromptInput  = document.getElementById('systemPromptInput');
const saveSystemPromptBtn= document.getElementById('saveSystemPromptBtn');
const temperatureSlider  = document.getElementById('temperatureSlider');
const tempDisplay        = document.getElementById('tempDisplay');
const maxTokensInput     = document.getElementById('maxTokensInput');
const tokenCounter       = document.getElementById('tokenCounter');
const scrollToBottomBtn  = document.getElementById('scrollToBottomBtn');
const unloadModelBtn     = document.getElementById('unloadModelBtn');
const themeToggleBtn     = document.getElementById('themeToggleBtn');
const chatSearch         = document.getElementById('chatSearch');
const clearSearchBtn     = document.getElementById('clearSearchBtn');
const imageAttachBtn     = document.getElementById('imageAttachBtn');
const imageFileInput     = document.getElementById('imageFileInput');
const imagePreviewStrip  = document.getElementById('imagePreviewStrip');

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const THEME_KEY = 'wilburt_theme';

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // Swap highlight.js stylesheet
    const hljsLink = document.getElementById('hljs-theme');
    hljsLink.href = theme === 'light'
        ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css'
        : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css';
    // Update icon: sun in dark mode (click to go light), moon in light mode (click to go dark)
    const icon = document.getElementById('themeIcon');
    if (theme === 'dark') {
        icon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
    } else {
        icon.innerHTML = `
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>`;
    }
}

themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next    = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
});

// ---------------------------------------------------------------------------
// Markdown + syntax highlighting
// ---------------------------------------------------------------------------
marked.use({
    renderer: (() => {
        const r = new marked.Renderer();
        r.code = function(code, language) {
            const validLang = language && hljs.getLanguage(language) ? language : null;
            const highlighted = validLang
                ? hljs.highlight(code, { language: validLang }).value
                : hljs.highlightAuto(code).value;
            const langLabel = validLang
                ? `<span class="code-lang-label">${validLang}</span>` : '<span class="code-lang-label">code</span>';
            const escaped = code.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
            return `<div class="code-block" data-raw="${escaped}">
                <div class="code-block-header">${langLabel}</div>
                <pre><code class="hljs">${highlighted}</code></pre>
            </div>`;
        };
        return r;
    })(),
    gfm: true, breaks: true,
});

function renderMarkdown(text) {
    return DOMPurify.sanitize(marked.parse(text), {
        ADD_TAGS: ['details', 'summary'], ADD_ATTR: ['data-raw'],
    });
}

function attachCodeCopyButtons(container) {
    container.querySelectorAll('.code-block').forEach(block => {
        const header = block.querySelector('.code-block-header');
        if (!header || header.querySelector('.code-copy-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.title     = 'Copy code';
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy`;
        btn.addEventListener('click', () => {
            const raw = block.dataset.raw
                ? block.dataset.raw.replace(/&amp;/g,'&').replace(/&quot;/g,'"')
                : (block.querySelector('code')?.textContent || '');
            copyToClipboard(raw, btn);
        });
        header.appendChild(btn);
    });
}

// ---------------------------------------------------------------------------
// Thinking model — parse <think>...</think>
// ---------------------------------------------------------------------------
function separateThought(text) {
    const complete = text.match(/^<think>([\s\S]*?)<\/think>([\s\S]*)$/);
    if (complete) return { thought: complete[1].trim(), response: complete[2].trimStart(), done: true };
    if (text.startsWith('<think>')) return { thought: text.slice(7), response: '', done: false };
    return { thought: '', response: text, done: true };
}

function buildBubbleHTML(parsed) {
    let html = '';
    if (parsed.thought) {
        const isOpen    = !parsed.done ? 'open' : '';
        const safeThought = parsed.thought
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        html += `<details class="thought-block" ${isOpen}>
            <summary>Thought</summary>
            <div class="thought-content">${safeThought}</div>
        </details>`;
    }
    if (parsed.response) html += renderMarkdown(parsed.response);
    else if (!parsed.thought) html += '<span class="thinking">Thinking\u2026</span>';
    return DOMPurify.sanitize(html, { ADD_TAGS:['details','summary'], ADD_ATTR:['data-raw'] });
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------
function copyToClipboard(text, btn) {
    const succeed = () => {
        const orig = btn.innerHTML;
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="#4ade80" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!`;
        setTimeout(() => { btn.innerHTML = orig; }, 1500);
    };
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(succeed).catch(() => execCopy(text, succeed));
    } else { execCopy(text, succeed); }
}

function execCopy(text, onSuccess) {
    const ta = Object.assign(document.createElement('textarea'), {
        value: text, style: 'position:fixed;top:-9999px;left:-9999px;opacity:0'
    });
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { if (document.execCommand('copy')) onSuccess(); } catch {}
    document.body.removeChild(ta);
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------
function updateTokenCounter() {
    if (!currentChatId) { tokenCounter.textContent = '—'; return; }
    let chars = systemPromptInput.value.length;
    chatContainer.querySelectorAll('.bubble').forEach(b => { chars += b.textContent.length; });
    tokenCounter.textContent = `~${Math.ceil(chars/4).toLocaleString()} ctx tokens`;
}

// ---------------------------------------------------------------------------
// Empty state / visibility
// ---------------------------------------------------------------------------
function showEmptyState() {
    emptyState.style.display    = 'flex';
    chatContainer.style.display = 'none';
    tokenCounter.textContent    = '—';
}
function hideEmptyState() {
    emptyState.style.display    = 'none';
    chatContainer.style.display = 'block';
}

// ---------------------------------------------------------------------------
// Streaming state
// ---------------------------------------------------------------------------
function setStreamingState(streaming) {
    isStreaming           = streaming;
    sendBtn.style.display = streaming ? 'none' : 'flex';
    stopBtn.style.display = streaming ? 'flex' : 'none';
    updateSendBtnState();
}
function updateSendBtnState() {
    sendBtn.classList.toggle('disabled',
        (messageInput.value.trim() === '' && pendingImages.length === 0) || isStreaming);
}

// ---------------------------------------------------------------------------
// Scroll
// ---------------------------------------------------------------------------
function updateScrollBtn() {
    const dist = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
    scrollToBottomBtn.style.display = dist > 120 ? 'flex' : 'none';
}
scrollToBottomBtn.addEventListener('click', () =>
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' }));

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------
settingsToggleBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('collapsed');
    settingsToggleBtn.classList.toggle('active');
});
temperatureSlider.addEventListener('input', () => {
    modelSettings.temperature = parseFloat(temperatureSlider.value);
    tempDisplay.textContent   = temperatureSlider.value;
});
maxTokensInput.addEventListener('change', () => {
    modelSettings.maxTokens = parseInt(maxTokensInput.value) || -1;
});
saveSystemPromptBtn.addEventListener('click', async () => {
    if (!currentChatId) return;
    try {
        await fetch(`/chats/api/chats/${currentChatId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ system_prompt: systemPromptInput.value }),
        });
        saveSystemPromptBtn.textContent = 'Saved ✓';
        setTimeout(() => { saveSystemPromptBtn.textContent = 'Save'; }, 1500);
    } catch (e) { console.error('Failed to save system prompt:', e); }
});

// ---------------------------------------------------------------------------
// Unload model
// ---------------------------------------------------------------------------
unloadModelBtn.addEventListener('click', async () => {
    const modelId = modelSelect.value;
    if (!modelId) return;
    if (!confirm(`Unload "${modelId}" from LM Studio?`)) return;
    try {
        const res  = await fetch('/api/models/unload', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model_id: modelId }),
        });
        const data = await res.json();
        if (res.ok) { showToast(`Model "${modelId}" unloaded.`); await loadModels(); }
        else         showToast(`Unload failed: ${data.error || res.status}`, true);
    } catch (e) { showToast('Could not reach LM Studio to unload the model.', true); }
});

// ---------------------------------------------------------------------------
// Image handling
// ---------------------------------------------------------------------------
imageAttachBtn.addEventListener('click', () => imageFileInput.click());

imageFileInput.addEventListener('change', () => {
    Array.from(imageFileInput.files).forEach(file => addImageFile(file));
    imageFileInput.value = '';
});

// Paste images from clipboard
document.addEventListener('paste', (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(i => i.type.startsWith('image/'));
    if (imageItems.length) {
        e.preventDefault();
        imageItems.forEach(item => addImageFile(item.getAsFile()));
    }
});

// Drag and drop onto the input area
const inputWrapper = document.getElementById('inputWrapper');
inputWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    inputWrapper.classList.add('drag-over');
});
inputWrapper.addEventListener('dragleave', () => inputWrapper.classList.remove('drag-over'));
inputWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    inputWrapper.classList.remove('drag-over');
    Array.from(e.dataTransfer.files)
        .filter(f => f.type.startsWith('image/'))
        .forEach(f => addImageFile(f));
});

function addImageFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUri = e.target.result;
        pendingImages.push({ dataUri, name: file.name });
        renderImagePreviews();
        updateSendBtnState();
    };
    reader.readAsDataURL(file);
}

function renderImagePreviews() {
    if (pendingImages.length === 0) {
        imagePreviewStrip.style.display = 'none';
        imagePreviewStrip.innerHTML = '';
        return;
    }
    imagePreviewStrip.style.display = 'flex';
    imagePreviewStrip.innerHTML = '';
    pendingImages.forEach((img, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'img-preview-wrap';

        const thumb = document.createElement('img');
        thumb.src       = img.dataUri;
        thumb.className = 'img-preview-thumb';
        thumb.title     = img.name;

        const removeBtn = document.createElement('button');
        removeBtn.className   = 'img-preview-remove';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => {
            pendingImages.splice(i, 1);
            renderImagePreviews();
            updateSendBtnState();
        });

        wrap.appendChild(thumb);
        wrap.appendChild(removeBtn);
        imagePreviewStrip.appendChild(wrap);
    });
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className   = `toast${isError ? ' toast-error' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ---------------------------------------------------------------------------
// Auto-resize textarea
// ---------------------------------------------------------------------------
messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
    updateSendBtnState();
});
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
chatSearch.addEventListener('input', () => {
    const q = chatSearch.value.trim().toLowerCase();
    clearSearchBtn.style.display = q ? 'flex' : 'none';
    renderChatList(allChats, q);
});
clearSearchBtn.addEventListener('click', () => {
    chatSearch.value             = '';
    clearSearchBtn.style.display = 'none';
    renderChatList(allChats, '');
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    // Restore saved theme
    const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(savedTheme);

    showEmptyState();
    await loadModels();
    await loadChats();

    sendBtn.addEventListener('click', sendMessage);
    stopBtn.addEventListener('click', stopGeneration);
    newChatBtn.addEventListener('click', createNewChat);
    emptyNewChatBtn.addEventListener('click', createNewChat);
    chatContainer.addEventListener('scroll', updateScrollBtn);
    updateSendBtnState();
});

// ---------------------------------------------------------------------------
// Stop generation
// ---------------------------------------------------------------------------
function stopGeneration() {
    if (abortController) { abortController.abort(); abortController = null; }
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------
async function loadModels() {
    try {
        const res  = await fetch('/api/models');
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        modelSelect.innerHTML = '';
        if (!data.models || data.models.length === 0) {
            const o = document.createElement('option');
            o.textContent = 'No models loaded'; o.disabled = true;
            modelSelect.appendChild(o);
        } else {
            data.models.forEach(m => {
                const o = document.createElement('option');
                o.value = o.textContent = m;
                modelSelect.appendChild(o);
            });
        }
    } catch (e) {
        console.error('Failed to load models:', e);
        showSystemMessage('Error: Could not load models from LM Studio. Is it running?');
    }
}

// ---------------------------------------------------------------------------
// Chat list — load from server and cache, then render
// ---------------------------------------------------------------------------
async function loadChats() {
    try {
        const res = await fetch('/chats/api/chats');
        if (!res.ok) throw new Error(res.status);
        allChats = await res.json();
        renderChatList(allChats, chatSearch.value.trim().toLowerCase());
    } catch (e) { console.error('Failed to load chats:', e); }
}

function renderChatList(chats, query) {
    const filtered = query
        ? chats.filter(c => c.title.toLowerCase().includes(query))
        : chats;

    chatList.innerHTML = '';

    filtered.forEach(c => chatList.appendChild(makeChatItem(c)));

    highlightActiveChat();
}


function makeChatItem(chat) {
    const el = document.createElement('div');
    el.className      = 'chat-item';
    el.dataset.chatId = chat.id;
    const titleEl = document.createElement('div');
    titleEl.className   = 'chat-title';
    titleEl.textContent = chat.title;
    titleEl.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(chat.id, titleEl); });

    const previewEl = document.createElement('div');
    previewEl.className   = 'chat-preview';
    previewEl.textContent = chat.preview || '';

    // Action buttons row, revealed on hover
    const actionsEl = document.createElement('div');
    actionsEl.className = 'chat-actions';

    actionsEl.appendChild(deleteBtn);

    el.appendChild(titleEl);
    el.appendChild(previewEl);
    el.appendChild(actionsEl);
    el.addEventListener('click', () => loadChat(chat.id));
    return el;
}

function highlightActiveChat() {
    document.querySelectorAll('.chat-item').forEach(item =>
        item.classList.toggle('active', item.dataset.chatId === currentChatId));
}

function startRename(chatId, titleEl) {
    const current = titleEl.textContent;
    const input   = document.createElement('input');
    input.type = 'text'; input.value = current; input.className = 'rename-input';
    titleEl.replaceWith(input);
    input.focus(); input.select();

    const finish = async () => {
        const newTitle = input.value.trim() || current;
        const span = document.createElement('div');
        span.className = 'chat-title'; span.textContent = newTitle;
        span.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(chatId, span); });
        input.replaceWith(span);
        if (newTitle !== current) {
            try {
                await fetch(`/chats/api/chats/${chatId}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: newTitle }),
                });
                // Update cache
                const c = allChats.find(c => c.id === chatId);
                if (c) c.title = newTitle;
            } catch (e) { console.error('Rename failed:', e); }
        }
    };
    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = current; input.blur(); }
    });
}

async function deleteChat(chatId) {
    if (!confirm('Delete this chat? This cannot be undone.')) return;
    try {
        const res = await fetch(`/chats/api/chats/${chatId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(res.status);
        if (currentChatId === chatId) { currentChatId = null; showEmptyState(); systemPromptInput.value = ''; }
        await loadChats();
    } catch (e) { console.error('Failed to delete chat:', e); }
}

async function createNewChat() {
    try {
        const res  = await fetch('/chats/api/chats', { method: 'POST' });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        currentChatId           = data.chat_id;
        chatContainer.innerHTML = '';
        hideEmptyState();
        systemPromptInput.value = '';
        await loadChats();
        highlightActiveChat();
        if (!modelSelect.value) modelSelect.selectedIndex = 0;
        updateTokenCounter();
        return data.chat_id;
    } catch (e) { console.error('Failed to create new chat:', e); return null; }
}

async function loadChat(chatId) {
    try {
        const res  = await fetch(`/chats/api/chats/${chatId}`);
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();

        currentChatId           = chatId;
        chatContainer.innerHTML = '';
        hideEmptyState();
        systemPromptInput.value = data.system_prompt || '';

        if (data.history && data.history.length > 0) {
            data.history.forEach((msg, i) => {
                const isLastAssistant = msg.role === 'assistant' && i === data.history.length - 1;
                addMessageToUI(msg.role, msg.content, null, isLastAssistant);
            });
        }

        highlightActiveChat();
        updateTokenCounter();
        chatContainer.scrollTop = chatContainer.scrollHeight;
        updateScrollBtn();
    } catch (e) { console.error('Failed to load chat:', e); }
}

// ---------------------------------------------------------------------------
// Auto-title — called after the first completed exchange
// ---------------------------------------------------------------------------
async function triggerAutoTitle(chatId) {
    const model = modelSelect.value;
    if (!model || !chatId) return;
    try {
        const res  = await fetch(`/api/chats/${chatId}/generate-title`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.title) {
            // Update cache and sidebar without a full reload
            const c = allChats.find(c => c.id === chatId);
            if (c) c.title = data.title;
            renderChatList(allChats, chatSearch.value.trim().toLowerCase());
            highlightActiveChat();
        }
    } catch (e) { console.error('Auto-title failed (non-critical):', e); }
}

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------
function addMessageToUI(role, content, stats = null, showRegenerate = false) {
    document.querySelectorAll('.regenerate-btn').forEach(b => b.remove());

    const wrapper   = document.createElement('div');
    wrapper.className = `message ${role}`;

    const bubble    = document.createElement('div');
    bubble.className = 'bubble';

    const timestamp = document.createElement('div');
    timestamp.className   = 'msg-timestamp';
    timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (role === 'assistant') {
        bubble.classList.add('markdown');
        const parsed = separateThought(typeof content === 'string' ? content : '');
        let html = '';
        if (parsed.thought) {
            const safe = parsed.thought.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            html += `<details class="thought-block"><summary>Thought</summary><div class="thought-content">${safe}</div></details>`;
        }
        if (parsed.response) html += renderMarkdown(parsed.response);
        bubble.innerHTML = DOMPurify.sanitize(html, { ADD_TAGS:['details','summary'], ADD_ATTR:['data-raw'] });
        attachCodeCopyButtons(bubble);

        const copyBtn = document.createElement('div');
        copyBtn.className = 'copy-btn'; copyBtn.title = 'Copy response';
        copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        copyBtn.addEventListener('click', () => copyToClipboard((parsed.response || content || '').toString().trim(), copyBtn));
        wrapper.appendChild(copyBtn);

        if (stats && stats.tokens > 0) {
            const badge = document.createElement('div');
            badge.className = 'msg-stats';
            badge.textContent = `${stats.tokens} tokens${stats.tokens_per_sec > 0 ? ` · ${stats.tokens_per_sec} tok/s` : ''}`;
            wrapper.appendChild(badge);
        }

        if (showRegenerate) {
            const regenBtn = document.createElement('div');
            regenBtn.className = 'regenerate-btn';
            regenBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1 4 1 10 7 10"></polyline>
                <path d="M3.51 15a9 9 0 1 0 .49-4.5"></path></svg> Regenerate`;
            regenBtn.addEventListener('click', () => regenerateLastResponse(wrapper));
            wrapper.appendChild(regenBtn);
        }

    } else {
        // User message — handle vision content (array) or plain text
        if (Array.isArray(content)) {
            content.forEach(part => {
                if (part.type === 'text') {
                    const p = document.createElement('p');
                    p.style.margin = '0 0 6px';
                    p.textContent  = part.text;
                    bubble.appendChild(p);
                } else if (part.type === 'image_url') {
                    const img = document.createElement('img');
                    img.src       = part.image_url.url;
                    img.className = 'msg-image';
                    bubble.appendChild(img);
                }
            });
        } else {
            bubble.textContent = content;
        }
    }

    wrapper.appendChild(bubble);
    wrapper.appendChild(timestamp);
    chatContainer.appendChild(wrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    updateScrollBtn();
    updateTokenCounter();
}

function showSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message assistant';
    const b = document.createElement('div');
    b.className = 'bubble'; b.style.color = '#f87171'; b.textContent = text;
    div.appendChild(b);
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ---------------------------------------------------------------------------
// Regenerate
// ---------------------------------------------------------------------------
async function regenerateLastResponse(lastAssistantWrapper) {
    if (isStreaming || !currentChatId || !lastUserMessage) return;
    try {
        const res = await fetch(`/chats/api/chats/${currentChatId}/pop`, { method: 'POST' });
        if (!res.ok) throw new Error(res.status);
        lastAssistantWrapper.remove();
        await streamResponse(lastUserMessage, true);
    } catch (e) { console.error('Regenerate failed:', e); }
}

// ---------------------------------------------------------------------------
// Send message — auto-creates a chat if none is selected
// ---------------------------------------------------------------------------
async function sendMessage() {
    const message = messageInput.value.trim();
    const model   = modelSelect.value;
    if (isStreaming) return;
    if (!message && pendingImages.length === 0) return;
    if (!model) { showSystemMessage('No model selected. Is LM Studio running with a model loaded?'); return; }

    if (!currentChatId) {
        const newId = await createNewChat();
        if (!newId) { showSystemMessage('Could not create a new chat. Please try again.'); return; }
    }

    // Snapshot images before clearing
    const imagesToSend = [...pendingImages];
    pendingImages = [];
    renderImagePreviews();

    addMessageToUI('user', imagesToSend.length
        ? [{ type: 'text', text: message || ' ' },
           ...imagesToSend.map(i => ({ type: 'image_url', image_url: { url: i.dataUri } }))]
        : message);

    messageInput.value        = '';
    messageInput.style.height = 'auto';
    lastUserMessage           = message;
    await streamResponse(message, false, imagesToSend.map(i => i.dataUri));
}

// ---------------------------------------------------------------------------
// Stream response
// ---------------------------------------------------------------------------
async function streamResponse(message, isRegenerate = false, images = []) {
    const model = modelSelect.value;
    setStreamingState(true);

    const streamingWrapper = document.createElement('div');
    streamingWrapper.className = 'message assistant';
    const streamingBubble = document.createElement('div');
    streamingBubble.className = 'bubble markdown';
    streamingBubble.innerHTML = '<span class="thinking">Thinking\u2026</span>';
    streamingWrapper.appendChild(streamingBubble);
    chatContainer.appendChild(streamingWrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    let fullResponse = '';
    let finalStats   = null;
    let stopped      = false;
    const isFirstExchange = (() => {
        const msgs = chatContainer.querySelectorAll('.message.user');
        return msgs.length === 1;
    })();

    try {
        abortController = new AbortController();
        const res = await fetch('/api/chat_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortController.signal,
            body: JSON.stringify({
                message, model, chat_id: currentChatId,
                temperature: modelSettings.temperature,
                max_tokens:  modelSettings.maxTokens,
                regenerate:  isRegenerate,
                images,
            }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();

        outer: while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const line of decoder.decode(value).split('\n')) {
                if (!line.startsWith('data: ')) continue;
                let parsed;
                try { parsed = JSON.parse(line.substring(6)); } catch { continue; }
                if (parsed.error) {
                    streamingBubble.innerHTML = `<span style="color:#f87171">Error: ${parsed.error}</span>`;
                    return;
                }
                if (parsed.done) { finalStats = parsed.stats || null; break outer; }
                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                    fullResponse += delta;
                    const p = separateThought(fullResponse);
                    streamingBubble.innerHTML = buildBubbleHTML(p);
                    attachCodeCopyButtons(streamingBubble);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                    updateScrollBtn();
                }
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            stopped = true;
            if (fullResponse) {
                const p = separateThought(fullResponse);
                streamingBubble.innerHTML = buildBubbleHTML(p);
                attachCodeCopyButtons(streamingBubble);
            } else {
                streamingBubble.innerHTML = '<span style="color:#888;font-style:italic">Stopped.</span>';
            }
        } else {
            console.error('Streaming error:', e);
            streamingBubble.innerHTML = '<span style="color:#f87171">Error: Could not get a response.</span>';
        }
    } finally {
        setStreamingState(false);
        abortController = null;
    }

    streamingWrapper.remove();
    if (fullResponse) {
        addMessageToUI('assistant', fullResponse, stopped ? null : finalStats, !stopped);

        // Auto-title on first completed exchange (not regenerate, not stopped)
        if (isFirstExchange && !isRegenerate && !stopped) {
            triggerAutoTitle(currentChatId);
        }
    }

    await loadChats();
    highlightActiveChat();
}
