// app/static/script.js  —  WilburtAI

// ─────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────
let currentChatId        = null;
let lastUserMessage      = '';
let isStreaming          = false;
let pendingImages        = [];
let pendingFiles         = [];
let allChats             = [];
let modelSettings        = { temperature: 0.7, maxTokens: -1 };
let socket               = null;
let streamBuffer         = '';
let activeStreamingWrapper = null;
let activeStreamingBubble  = null;
let pendingStreamMeta      = null;
let autoScroll           = true;
let userScrolledUp       = false;
let webToolsEnabled      = false;
let searchMatches        = [];
let searchIndex          = 0;
let glassAnimId          = null;
let heartbeatInterval    = null;
let ftsDebounce          = null;
let isShowingFTS         = false;
let soundEnabled         = localStorage.getItem('wilburt_sound') !== 'false';
let streamTokenTimes     = [];
let _chatsFirstLoad      = true;   // only restore last-chat + check admin on first loadChats()

// ─────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────
const SIDEBAR_KEY       = 'wilburt_sidebar';
const SIDEBAR_WIDTH_KEY = 'wilburt_sidebar_w';
const THEME_KEY         = 'wilburt_theme';
const ACCENT_KEY        = 'wilburt_accent';
const GLASS_KEY         = 'wilburt_glass';
const LAST_CHAT_KEY     = 'wilburt_last_chat';
const SCROLL_THRESHOLD  = 60;

// ─────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────
const chatContainer       = document.getElementById('chatContainer');
const emptyState          = document.getElementById('emptyState');
const messageInput        = document.getElementById('messageInput');
const modelSelect         = document.getElementById('modelSelect');
const newChatBtn          = document.getElementById('newChatBtn');
const emptyNewChatBtn     = document.getElementById('emptyNewChatBtn');
const chatList            = document.getElementById('chatList');
const settingsToggleBtn   = document.getElementById('settingsToggleBtn');
const settingsPopover     = document.getElementById('settingsPopover');
const systemPromptInput   = document.getElementById('systemPromptInput');
const saveSystemPromptBtn = document.getElementById('saveSystemPromptBtn');
const temperatureSlider   = document.getElementById('temperatureSlider');
const tempDisplay         = document.getElementById('tempDisplay');
const maxTokensInput      = document.getElementById('maxTokensInput');
const tokenCounter        = document.getElementById('tokenCounter');
const scrollToBottomBtn   = document.getElementById('scrollToBottomBtn');
const themeToggleBtn      = document.getElementById('themeToggleBtn');
const chatSearch          = document.getElementById('chatSearch');
const clearSearchBtn      = document.getElementById('clearSearchBtn');
const attachBtn           = document.getElementById('attachBtn');
const attachFileInput     = document.getElementById('attachFileInput');
const imagePreviewStrip   = document.getElementById('imagePreviewStrip');
const sidebarToggleBtn    = document.getElementById('sidebarToggleBtn');
const sidebarOverlay      = document.getElementById('sidebarOverlay');
const sidebar             = document.getElementById('sidebar');
const resizeHandle        = document.getElementById('resizeHandle');
const accentPickerBtn     = document.getElementById('accentPickerBtn');
const accentColorInput    = document.getElementById('accentColorInput');
const pruneWarning        = document.getElementById('pruneWarning');
const pruneWarningClose   = document.getElementById('pruneWarningClose');
const topbarTitle         = document.getElementById('topbarTitle');
const actionBtn           = document.getElementById('actionBtn');
const attachMenuEl        = document.getElementById('attachMenu');
const attachFilesBtn      = document.getElementById('attachFilesBtn');
const attachFolderBtn     = document.getElementById('attachFolderBtn');
const folderFileInput     = document.getElementById('folderFileInput');
const chatSkeleton        = document.getElementById('chatSkeleton');
const uploadProgressWrap  = document.getElementById('uploadProgressWrap');
const uploadProgressBar   = document.getElementById('uploadProgressBar');
const uploadProgressLbl   = document.getElementById('uploadProgressLabel');
const mobileNavChats      = document.getElementById('mobileNavChats');
const mobileNavNew        = document.getElementById('mobileNavNew');
const mobileNavSearch     = document.getElementById('mobileNavSearch');
const connStatusDot       = document.getElementById('connStatus');
const memoryToggle        = document.getElementById('memoryToggle');
const memoryTextarea      = document.getElementById('memoryTextarea');
const memorySaveBtn       = document.getElementById('memorySaveBtn');
const searchResultsPanel  = document.getElementById('searchResultsPanel');
const inChatSearchBtn     = document.getElementById('inChatSearchBtn');
const inChatSearchBar     = document.getElementById('inChatSearchBar');
const inChatSearchInput   = document.getElementById('inChatSearchInput');
const inChatSearchCount   = document.getElementById('inChatSearchCount');
const inChatSearchPrev    = document.getElementById('inChatSearchPrev');
const inChatSearchNext    = document.getElementById('inChatSearchNext');
const inChatSearchClose   = document.getElementById('inChatSearchClose');
const glassBg             = document.getElementById('glassBg');
const liquidGlassBtn      = document.getElementById('liquidGlassBtn');
const webToolsBtn         = document.getElementById('webToolsBtn');

// ─────────────────────────────────────────────────
// Sidebar: collapse + resize + mobile drawer
// ─────────────────────────────────────────────────
function isMobile() { return window.innerWidth <= 700; }

function setSidebar(open) {
    if (isMobile()) {
        sidebar.classList.toggle('mobile-open', open);
        sidebarOverlay.classList.toggle('visible', open);
    } else {
        document.body.classList.toggle('sidebar-collapsed', !open);
        localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'collapsed');
    }
}
function toggleSidebar() {
    if (isMobile()) setSidebar(!sidebar.classList.contains('mobile-open'));
    else             setSidebar(document.body.classList.contains('sidebar-collapsed'));
}
sidebarToggleBtn.addEventListener('click', toggleSidebar);
sidebarOverlay.addEventListener('click', () => setSidebar(false));
function closeMobileSidebar() { if (isMobile()) setSidebar(false); }
window.addEventListener('resize', () => {
    if (!isMobile()) { sidebar.classList.remove('mobile-open'); sidebarOverlay.classList.remove('visible'); }
});

// Drag-to-resize sidebar (desktop only)
let resizing = false, resizeStartX = 0, resizeStartW = 0;
resizeHandle.addEventListener('mousedown', e => {
    if (isMobile()) return;
    resizing = true; resizeStartX = e.clientX; resizeStartW = sidebar.offsetWidth;
    document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', e => {
    if (!resizing) return;
    const w = Math.min(480, Math.max(180, resizeStartW + (e.clientX - resizeStartX)));
    sidebar.style.width = w + 'px';
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    localStorage.setItem(SIDEBAR_WIDTH_KEY, w);
});
document.addEventListener('mouseup', () => { if (resizing) { resizing = false; document.body.style.userSelect = ''; } });

// ─────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('hljs-theme').href = theme === 'light'
        ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css'
        : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css';
    const icon = document.getElementById('themeIcon');
    icon.innerHTML = theme === 'dark'
        ? `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`
        : `<circle cx="12" cy="12" r="5"/>
           <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
           <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
           <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
           <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
}
themeToggleBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next); applyTheme(next);
});

// Init theme — follow OS if no saved preference
(function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) { applyTheme(saved); return; }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? 'dark' : 'light');
    });
})();

// ─────────────────────────────────────────────────
// Accent colour
// ─────────────────────────────────────────────────
function applyAccent(hex) {
    document.documentElement.style.setProperty('--accent', hex);
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    const dh = `#${[r,g,b].map(c=>Math.max(0,c-40).toString(16).padStart(2,'0')).join('')}`;
    document.documentElement.style.setProperty('--accent-hover', dh);
    document.documentElement.style.setProperty('--accent-rgb', `${r},${g},${b}`);
    accentColorInput.value = hex;
}
accentPickerBtn.addEventListener('click', () => accentColorInput.click());
accentColorInput.addEventListener('input', e => {
    applyAccent(e.target.value);
    localStorage.setItem(ACCENT_KEY, e.target.value);
});

// ─────────────────────────────────────────────────
// Web tools toggle
// ─────────────────────────────────────────────────
if (webToolsBtn) {
    webToolsBtn.addEventListener('click', () => {
        webToolsEnabled = !webToolsEnabled;
        webToolsBtn.setAttribute('aria-pressed', webToolsEnabled ? 'true' : 'false');
        webToolsBtn.classList.toggle('web-tools-active', webToolsEnabled);
        webToolsBtn.title = webToolsEnabled ? 'Web Tools: On' : 'Web Tools: Off';
    });
}

// ─────────────────────────────────────────────────
// Fix #5: Settings popover toggle
// ─────────────────────────────────────────────────
if (settingsToggleBtn && settingsPopover) {
    settingsToggleBtn.addEventListener('click', e => {
        e.stopPropagation();
        settingsPopover.classList.toggle('hidden');
        settingsToggleBtn.setAttribute('aria-pressed',
            !settingsPopover.classList.contains('hidden') ? 'true' : 'false');
    });
    // Close when clicking outside
    document.addEventListener('click', e => {
        if (!settingsPopover.contains(e.target) && e.target !== settingsToggleBtn) {
            settingsPopover.classList.add('hidden');
            settingsToggleBtn.setAttribute('aria-pressed', 'false');
        }
    });
}

// ─────────────────────────────────────────────────
// Liquid Glass
// ─────────────────────────────────────────────────
const GLASS_ORBS = [
    { x: 0.18, y: 0.25, r: 0.42, h: 262, s: 70, l: 55, phase: 0.0,  period: 8000 },
    { x: 0.80, y: 0.12, r: 0.36, h: 215, s: 75, l: 58, phase: 1.1,  period: 9500 },
    { x: 0.58, y: 0.78, r: 0.38, h: 162, s: 60, l: 52, phase: 2.2,  period: 7500 },
    { x: 0.10, y: 0.72, r: 0.30, h:  37, s: 85, l: 60, phase: 3.4,  period: 8800 },
    { x: 0.88, y: 0.58, r: 0.33, h: 330, s: 65, l: 58, phase: 4.5,  period: 6800 },
    { x: 0.44, y: 0.40, r: 0.25, h: 192, s: 80, l: 55, phase: 5.7,  period: 9200 },
];

function drawGlassBg(ts) {
    const canvas = glassBg, w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = isDark ? '#07070d' : '#e8eaf0';
    ctx.fillRect(0, 0, w, h);
    GLASS_ORBS.forEach(orb => {
        const breath    = Math.sin(orb.phase + (ts / orb.period) * Math.PI * 2);
        const scale     = 0.85 + 0.15 * (breath * 0.5 + 0.5);
        const baseAlpha = isDark ? 0.26 : 0.20;
        const alpha     = baseAlpha * (0.7 + 0.3 * (breath * 0.5 + 0.5));
        const cx = orb.x * w, cy = orb.y * h, r = orb.r * Math.max(w, h) * scale;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0,   `hsla(${orb.h}, ${orb.s}%, ${orb.l}%, ${alpha})`);
        grad.addColorStop(0.5, `hsla(${orb.h}, ${orb.s}%, ${orb.l}%, ${alpha * 0.45})`);
        grad.addColorStop(1,   `hsla(${orb.h}, ${orb.s}%, ${orb.l}%, 0)`);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill();
    });
    glassAnimId = requestAnimationFrame(drawGlassBg);
}
function resizeGlassBg() {
    if (!glassBg) return;
    glassBg.width  = document.documentElement.clientWidth;
    glassBg.height = document.documentElement.clientHeight;
}
function startGlassAnimation() {
    if (glassAnimId) return;
    resizeGlassBg();
    glassAnimId = requestAnimationFrame(drawGlassBg);
}
function stopGlassAnimation() {
    if (glassAnimId) { cancelAnimationFrame(glassAnimId); glassAnimId = null; }
    if (glassBg) { const ctx = glassBg.getContext('2d'); ctx.clearRect(0,0,glassBg.width,glassBg.height); }
}
function applyGlass(on) {
    document.documentElement.setAttribute('data-glass', on ? 'on' : 'off');
    if (liquidGlassBtn) {
        liquidGlassBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        liquidGlassBtn.title = on ? 'Liquid Glass: On' : 'Liquid Glass: Off';
    }
    if (on) startGlassAnimation(); else stopGlassAnimation();
}
if (liquidGlassBtn) {
    liquidGlassBtn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-glass') !== 'on';
        localStorage.setItem(GLASS_KEY, next ? '1' : '0');
        applyGlass(next);
    });
}
window.addEventListener('resize', () => {
    if (document.documentElement.getAttribute('data-glass') === 'on') resizeGlassBg();
});
applyGlass(localStorage.getItem(GLASS_KEY) === '1');

// ─────────────────────────────────────────────────
// Markdown + syntax highlighting
// ─────────────────────────────────────────────────
marked.use({
    renderer: (() => {
        const r = new marked.Renderer();
        r.code = (code, lang) => {
            const vl  = lang && hljs.getLanguage(lang) ? lang : null;
            const hi  = vl ? hljs.highlight(code,{language:vl}).value : hljs.highlightAuto(code).value;
            const esc = code.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
            return `<div class="code-block" data-raw="${esc}">
                <div class="code-block-header"><span class="code-lang-label">${vl||'code'}</span></div>
                <pre><code class="hljs">${hi}</code></pre></div>`;
        };
        return r;
    })(),
    gfm: true, breaks: true,
});
function renderMarkdown(text) {
    return DOMPurify.sanitize(marked.parse(text), {ADD_TAGS:['details','summary'],ADD_ATTR:['data-raw']});
}
function attachCodeCopyButtons(el) {
    el.querySelectorAll('.code-block').forEach(block => {
        if (block.querySelector('.code-copy-btn')) return;
        const hdr = block.querySelector('.code-block-header'); if (!hdr) return;
        const btn = document.createElement('button');
        btn.className = 'code-copy-btn'; btn.title = 'Copy code';
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
        btn.addEventListener('click', () => {
            const raw = (block.dataset.raw||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"');
            copyToClipboard(raw||block.querySelector('code')?.textContent||'', btn);
        });
        hdr.appendChild(btn);
    });
}

// ─────────────────────────────────────────────────
// Thinking-block parser
// ─────────────────────────────────────────────────
function separateThought(text) {
    const m = text.match(/^<think>([\s\S]*?)<\/think>([\s\S]*)$/)
           || text.match(/^\[THINK\]([\s\S]*?)\[\/THINK\]([\s\S]*)$/i);
    if (m)                         return {thought:m[1].trim(), response:m[2].trimStart(), done:true};
    if (text.startsWith('<think>')) return {thought:text.slice(7), response:'', done:false};
    if (/^\[THINK\]/i.test(text))  return {thought:text.slice(7), response:'', done:false};
    return {thought:'', response:text, done:true};
}
function buildBubbleHTML(parsed) {
    let html = '';
    if (parsed.thought) {
        const s = parsed.thought.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        html += `<details class="thought-block" ${!parsed.done?'open':''}><summary>Thought</summary>
                 <div class="thought-content">${s}</div></details>`;
    }
    if (parsed.response) html += renderMarkdown(parsed.response);
    else if (!parsed.thought) html += '<span class="thinking">Thinking…</span>';
    return DOMPurify.sanitize(html,{ADD_TAGS:['details','summary'],ADD_ATTR:['data-raw']});
}

// ─────────────────────────────────────────────────
// Tool call renderer
// ─────────────────────────────────────────────────
function buildToolCallsHTML(tcs) {
    return (tcs||[]).map(tc => {
        const name = tc.function?.name||'unknown';
        let args = '';
        try { args = JSON.stringify(JSON.parse(tc.function?.arguments||'{}'),null,2); }
        catch { args = tc.function?.arguments||''; }
        return `<details class="tool-call-block">
          <summary><span class="tool-call-icon">⚙</span>
          <span class="tool-call-name">${name}</span></summary>
          <pre class="tool-args">${args.replace(/</g,'&lt;')}</pre></details>`;
    }).join('');
}

// ─────────────────────────────────────────────────
// Clipboard
// ─────────────────────────────────────────────────
function copyToClipboard(text, btn) {
    const ok = () => { const o=btn.innerHTML; btn.innerHTML='✓ Copied!'; setTimeout(()=>btn.innerHTML=o,1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(ok).catch(()=>execCopy(text,ok));
    else execCopy(text,ok);
}
function execCopy(text,cb) {
    const t=Object.assign(document.createElement('textarea'),{value:text,style:'position:fixed;opacity:0'});
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); cb(); } catch {}
    t.remove();
}

// ─────────────────────────────────────────────────
// Token counter
// ─────────────────────────────────────────────────
function updateTokenCounter() {
    if (!currentChatId) { tokenCounter.textContent='—'; return; }
    let ch = systemPromptInput.value.length;
    chatContainer.querySelectorAll('.bubble').forEach(b=>ch+=b.textContent.length);
    tokenCounter.textContent=`~${Math.ceil(ch/4).toLocaleString()} ctx tokens`;
}

// ─────────────────────────────────────────────────
// Empty / chat state
// ─────────────────────────────────────────────────
function showEmptyState() {
    emptyState.style.display='flex'; chatContainer.style.display='none';
    tokenCounter.textContent='—'; topbarTitle.textContent='';
    document.title = 'WilburtAI';
}
function hideEmptyState() {
    emptyState.style.display='none'; chatContainer.style.display='block';
}

// ─────────────────────────────────────────────────
// Action button (send ↔ stop morph)
// ─────────────────────────────────────────────────
function setActionBtn(mode) {
    actionBtn.className = mode === 'stop' ? 'action-stop' : 'action-send';
    actionBtn.title     = mode === 'stop' ? 'Stop generating' : 'Send message';
}
actionBtn.addEventListener('click', () => {
    if (actionBtn.classList.contains('action-stop')) stopStream(); else sendMessage();
});

// ─────────────────────────────────────────────────
// Streaming state
// ─────────────────────────────────────────────────
function setStreamingState(on) {
    isStreaming = on;
    setActionBtn(on ? 'stop' : 'send');
    updateSendBtnState();
}
function updateSendBtnState() {
    const empty = (!messageInput.value.trim() && !pendingImages.length && !pendingFiles.length);
    actionBtn.classList.toggle('disabled', empty && !isStreaming);
}

// ─────────────────────────────────────────────────
// Scroll
// ─────────────────────────────────────────────────
function updateScrollBtn() {
    const dist = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
    scrollToBottomBtn.style.display = dist > 120 ? 'flex' : 'none';
}
function isNearBottom() {
    const dist = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
    return dist < SCROLL_THRESHOLD;
}
chatContainer && chatContainer.addEventListener('scroll', () => {
    if (isNearBottom()) userScrolledUp = false;
    else if (isStreaming) userScrolledUp = true;
    updateScrollBtn();
});
scrollToBottomBtn.addEventListener('click', () => {
    userScrolledUp = false;
    chatContainer.scrollTo({top:chatContainer.scrollHeight,behavior:'smooth'});
});
function smartScroll() {
    if (!userScrolledUp) chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ─────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────
function showToast(msg, isError=false) {
    const t=Object.assign(document.createElement('div'),{className:`toast${isError?' toast-error':''}`,textContent:msg});
    document.body.appendChild(t);
    requestAnimationFrame(()=>t.classList.add('toast-visible'));
    setTimeout(()=>{t.classList.remove('toast-visible');setTimeout(()=>t.remove(),300);},3000);
}

// ─────────────────────────────────────────────────
// Timestamp formatter
// ─────────────────────────────────────────────────
function formatTimestamp(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((today - msgDay) / 86400000);
    const timeStr = date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    if (diffDays === 0) return timeStr;
    if (diffDays === 1) return `Yesterday ${timeStr}`;
    if (diffDays < 7)  return `${date.toLocaleDateString([],{weekday:'short'})} ${timeStr}`;
    return `${date.toLocaleDateString([],{month:'short',day:'numeric'})} ${timeStr}`;
}

// ─────────────────────────────────────────────────
// Connection status
// ─────────────────────────────────────────────────
function setConnStatus(state) {
    if (!connStatusDot) return;
    connStatusDot.className = state === 'connected' ? '' : state === 'reconnecting' ? 'reconnecting' : 'disconnected';
    connStatusDot.title     = state === 'connected' ? 'Connected' : state === 'reconnecting' ? 'Reconnecting…' : 'Disconnected';
}

// ─────────────────────────────────────────────────
// Heartbeat
// ─────────────────────────────────────────────────
function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => { if (socket?.connected) socket.emit('ping_heartbeat'); }, 25000);
}
function stopHeartbeat() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

// ─────────────────────────────────────────────────
// Completion chime
// ─────────────────────────────────────────────────
function playCompletionChime() {
    if (!soundEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t   = ctx.currentTime;
        [[659.25, t, 0.08], [830.61, t + 0.12, 0.06]].forEach(([freq, when, dur]) => {
            const osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'sine'; osc.frequency.setValueAtTime(freq, when);
            gain.gain.setValueAtTime(0, when);
            gain.gain.linearRampToValueAtTime(0.18, when + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, when + dur + 0.3);
            osc.start(when); osc.stop(when + dur + 0.35);
        });
        setTimeout(() => ctx.close(), 1000);
    } catch {}
}

// ─────────────────────────────────────────────────
// Typing speed indicator
// ─────────────────────────────────────────────────
function recordTokenTime() {
    const now = Date.now();
    streamTokenTimes.push(now);
    if (streamTokenTimes.length > 10) streamTokenTimes.shift();
    if (streamTokenTimes.length < 2 || !activeStreamingBubble) return;
    const elapsed = (streamTokenTimes[streamTokenTimes.length-1] - streamTokenTimes[0]) / 1000;
    const tps = (streamTokenTimes.length - 1) / elapsed;
    const dur = Math.max(0.4, Math.min(2.0, 2.0 - (tps / 10) * 1.6));
    const th = activeStreamingBubble.querySelector('.thinking, .thinking-dots');
    if (th) th.style.animationDuration = dur + 's';
}

// ─────────────────────────────────────────────────
// Upload progress
// ─────────────────────────────────────────────────
function showUploadProgress(done, total) {
    uploadProgressWrap.style.display = 'flex';
    const pct = total ? Math.round((done / total) * 100) : 0;
    uploadProgressBar.style.width = pct + '%';
    uploadProgressLbl.textContent  = total > 1 ? `${done} / ${total} files` : 'Processing…';
}
function hideUploadProgress() {
    uploadProgressWrap.style.display = 'none';
    uploadProgressBar.style.width = '0%';
}

// ─────────────────────────────────────────────────
// Unified file attachment
// ─────────────────────────────────────────────────
const TEXT_EXTS = new Set([
    'txt','md','markdown','py','js','ts','jsx','tsx','json','jsonc',
    'css','scss','sass','less','html','htm','xml','svg','yaml','yml',
    'toml','ini','cfg','conf','sh','bash','zsh','fish','ps1','bat',
    'c','cpp','cc','h','hpp','cs','java','rb','php','go','rs','swift',
    'kt','kts','r','m','lua','sql','graphql','proto','tf','hcl',
    'dockerfile','makefile','env','log','csv','tsv',
]);
function getExt(name) { return name.split('.').pop().toLowerCase(); }
function isImageFile(file) { return file.type.startsWith('image/'); }
function isPDF(file)        { return file.type === 'application/pdf' || getExt(file.name) === 'pdf'; }
function isText(file)       { return file.type.startsWith('text/') || TEXT_EXTS.has(getExt(file.name)); }
function langHint(name) {
    const map = {py:'python',js:'javascript',ts:'typescript',jsx:'jsx',tsx:'tsx',
        json:'json',jsonc:'json',css:'css',scss:'scss',html:'html',xml:'xml',
        sh:'bash',bash:'bash',zsh:'bash',ps1:'powershell',bat:'batch',
        c:'c',cpp:'cpp',h:'c',hpp:'cpp',cs:'csharp',java:'java',rb:'ruby',
        php:'php',go:'go',rs:'rust',swift:'swift',kt:'kotlin',r:'r',
        lua:'lua',sql:'sql',graphql:'graphql',yaml:'yaml',yml:'yaml',
        toml:'toml',md:'markdown',csv:'',tsv:''};
    return map[getExt(name)] ?? '';
}
function fileIcon(name) {
    const ext = getExt(name);
    if (['py'].includes(ext))                    return '🐍';
    if (['js','ts','jsx','tsx'].includes(ext))   return '⚡';
    if (['json','jsonc'].includes(ext))          return '{}';
    if (['md','markdown'].includes(ext))         return '📝';
    if (['pdf'].includes(ext))                   return '📄';
    if (['csv','tsv'].includes(ext))             return '📊';
    if (['html','htm','xml'].includes(ext))      return '🌐';
    if (['sh','bash','zsh','ps1','bat'].includes(ext)) return '⚙';
    if (['sql'].includes(ext))                   return '🗄';
    return '📎';
}

function dispatchFile(file) {
    if (!file) return;
    if (isImageFile(file)) { addImageFile(file); return; }
    if (isPDF(file))       { addPDFFile(file);   return; }
    if (isText(file))      { addTextFile(file);  return; }
    showToast(`"${file.name}" — unsupported file type`, true);
}

// Fix #10 consolidated: addImageFile with progress (no wrapper)
function addImageFile(file) {
    showUploadProgress(0, 1);
    const reader = new FileReader();
    reader.addEventListener('progress', e => { if (e.lengthComputable) showUploadProgress(e.loaded, e.total); });
    reader.onload = e => {
        pendingImages.push({dataUri: e.target.result, name: file.name});
        renderAttachPreviews(); updateSendBtnState(); hideUploadProgress();
    };
    reader.readAsDataURL(file);
}

// Fix #10 consolidated: addTextFile with progress (no wrapper)
function addTextFile(file) {
    showUploadProgress(0, 1);
    const reader = new FileReader();
    reader.addEventListener('progress', e => { if (e.lengthComputable) showUploadProgress(e.loaded, e.total); });
    reader.onload = e => {
        const content = e.target.result;
        if (content.length > 120000) { showToast(`"${file.name}" is too large (max ~120 KB)`, true); hideUploadProgress(); return; }
        pendingFiles.push({name: file.name, content, lang: langHint(file.name)});
        renderAttachPreviews(); updateSendBtnState(); hideUploadProgress();
    };
    reader.readAsText(file);
}

async function addPDFFile(file) {
    showToast(`Extracting text from "${file.name}"…`);
    const fd = new FormData(); fd.append('file', file);
    try {
        const r = await fetch('/api/rag/extract', {method:'POST', body:fd});
        const d = await r.json();
        if (!r.ok) { showToast(`PDF error: ${d.error||r.status}`, true); return; }
        pendingFiles.push({name: file.name, content: d.text, lang: ''});
        renderAttachPreviews(); updateSendBtnState();
    } catch(e) { showToast(`Failed to extract PDF: ${e}`, true); }
}

function renderAttachPreviews() {
    const hasAny = pendingImages.length || pendingFiles.length;
    imagePreviewStrip.style.display = hasAny ? 'flex' : 'none';
    imagePreviewStrip.innerHTML = '';
    pendingImages.forEach((img, i) => {
        const w = document.createElement('div'); w.className = 'img-preview-wrap';
        const t = document.createElement('img'); t.src = img.dataUri; t.className = 'img-preview-thumb'; t.title = img.name;
        const r = document.createElement('button'); r.className = 'img-preview-remove'; r.textContent = '✕';
        r.addEventListener('click', ()=>{ pendingImages.splice(i,1); renderAttachPreviews(); updateSendBtnState(); });
        w.appendChild(t); w.appendChild(r); imagePreviewStrip.appendChild(w);
    });
    pendingFiles.forEach((f, i) => {
        const chip = document.createElement('div'); chip.className = 'file-chip'; chip.title = f.name;
        const icon = document.createElement('span'); icon.className = 'file-chip-icon'; icon.textContent = fileIcon(f.name);
        const name = document.createElement('span'); name.className = 'file-chip-name'; name.textContent = f.name;
        const rm   = document.createElement('button'); rm.className = 'img-preview-remove file-chip-rm'; rm.textContent = '✕';
        rm.addEventListener('click', ()=>{ pendingFiles.splice(i,1); renderAttachPreviews(); updateSendBtnState(); });
        chip.appendChild(icon); chip.appendChild(name); chip.appendChild(rm);
        imagePreviewStrip.appendChild(chip);
    });
}

attachBtn.addEventListener('click', e => { e.stopPropagation(); attachMenuEl.classList.toggle('hidden'); });
document.addEventListener('click', () => attachMenuEl.classList.add('hidden'));
attachFilesBtn.addEventListener('click', () => { attachMenuEl.classList.add('hidden'); attachFileInput.click(); });
attachFolderBtn.addEventListener('click', () => { attachMenuEl.classList.add('hidden'); folderFileInput.click(); });

attachFileInput.addEventListener('change', () => {
    Array.from(attachFileInput.files).forEach(dispatchFile); attachFileInput.value = '';
});
folderFileInput.addEventListener('change', () => {
    const files = Array.from(folderFileInput.files); if (!files.length) return;
    showUploadProgress(0, files.length);
    let done = 0;
    files.forEach(f => { dispatchFile(f); done++; showUploadProgress(done, files.length); });
    setTimeout(hideUploadProgress, 800); folderFileInput.value = '';
});

document.addEventListener('paste', e => {
    const items = Array.from(e.clipboardData?.items||[]);
    const imgs  = items.filter(i=>i.type.startsWith('image/'));
    if (imgs.length) { e.preventDefault(); imgs.forEach(i=>dispatchFile(i.getAsFile())); }
});

const inputWrapper = document.getElementById('inputWrapper');
inputWrapper.addEventListener('dragover',  e=>{e.preventDefault();inputWrapper.classList.add('drag-over');});
inputWrapper.addEventListener('dragleave', ()=>inputWrapper.classList.remove('drag-over'));
inputWrapper.addEventListener('drop', e=>{
    e.preventDefault(); inputWrapper.classList.remove('drag-over');
    Array.from(e.dataTransfer.files).forEach(dispatchFile);
});

// ─────────────────────────────────────────────────
// Textarea auto-resize
// ─────────────────────────────────────────────────
messageInput.addEventListener('input', () => {
    messageInput.style.height='auto';
    messageInput.style.height=Math.min(messageInput.scrollHeight,200)+'px';
    updateSendBtnState();
});
messageInput.addEventListener('keypress', e => {
    if (e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMessage(); }
});

// ─────────────────────────────────────────────────
// Settings panel inputs
// ─────────────────────────────────────────────────
temperatureSlider.addEventListener('input', () => {
    modelSettings.temperature = parseFloat(temperatureSlider.value);
    tempDisplay.textContent   = temperatureSlider.value;
    localStorage.setItem('wilburt_temp', temperatureSlider.value);
});
maxTokensInput.addEventListener('change', () => {
    modelSettings.maxTokens = parseInt(maxTokensInput.value)||-1;
    localStorage.setItem('wilburt_maxtok', maxTokensInput.value);
});
saveSystemPromptBtn.addEventListener('click', async () => {
    if (!currentChatId) return;
    await fetch(`/chats/api/chats/${currentChatId}`,{
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({system_prompt: systemPromptInput.value}),
    });
    saveSystemPromptBtn.textContent='Saved ✓';
    setTimeout(()=>saveSystemPromptBtn.textContent='Save',1500);
});
pruneWarningClose.addEventListener('click', ()=>pruneWarning.style.display='none');

// RAG embedding model: save to localStorage so it persists
const ragEmbeddingInput = document.getElementById('ragEmbeddingInput');
if (ragEmbeddingInput) {
    const saved = localStorage.getItem('wilburt_rag_embedding');
    if (saved) ragEmbeddingInput.value = saved;
    ragEmbeddingInput.addEventListener('change', () => {
        localStorage.setItem('wilburt_rag_embedding', ragEmbeddingInput.value.trim());
    });
}
const ragToggleEl = document.getElementById('ragToggle');
if (ragToggleEl) {
    ragToggleEl.checked = localStorage.getItem('wilburt_rag_enabled') === '1';
    ragToggleEl.addEventListener('change', () => {
        localStorage.setItem('wilburt_rag_enabled', ragToggleEl.checked ? '1' : '0');
    });
}

// ─────────────────────────────────────────────────
// Sidebar search
// ─────────────────────────────────────────────────
chatSearch.addEventListener('input', () => {
    const q = chatSearch.value.trim().toLowerCase();
    clearSearchBtn.style.display = q ? 'flex' : 'none';
    if (q.length < 2) { hideFTSResults(); return; }
    renderChatList(allChats, q);

    // Full-text search with debounce
    clearTimeout(ftsDebounce);
    ftsDebounce = setTimeout(async () => {
        if (chatSearch.value.trim().length < 2) return;
        try {
            const r = await fetch(`/chats/api/search?q=${encodeURIComponent(chatSearch.value.trim())}`);
            const d = await r.json();
            if (d.results?.length > 0) showFTSResults(d.results);
            else hideFTSResults();
        } catch {}
    }, 400);
});
clearSearchBtn.addEventListener('click', () => {
    chatSearch.value=''; clearSearchBtn.style.display='none'; hideFTSResults(); renderChatList(allChats,'');
});

// FTS panel
function showFTSResults(results) {
    if (!searchResultsPanel) return;
    if (!results?.length) {
        searchResultsPanel.innerHTML = '<div class="search-no-results">No messages found</div>';
        searchResultsPanel.classList.remove('hidden'); return;
    }
    searchResultsPanel.innerHTML = results.map(r => `
        <div class="search-result-item" data-chat-id="${r.chat_id}">
            <div class="search-result-title">${escapeHtml(r.title)}</div>
            <div class="search-result-snippet">${r.snippet}</div>
        </div>`).join('');
    searchResultsPanel.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', () => { loadChat(el.dataset.chatId); hideFTSResults(); chatSearch.value=''; });
    });
    searchResultsPanel.classList.remove('hidden');
    isShowingFTS = true;
}
function hideFTSResults() {
    if (searchResultsPanel) searchResultsPanel.classList.add('hidden');
    isShowingFTS = false;
}
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

document.addEventListener('click', e => {
    if (searchResultsPanel && !searchResultsPanel.contains(e.target) && e.target !== chatSearch) hideFTSResults();
});

// ─────────────────────────────────────────────────
// In-chat search
// ─────────────────────────────────────────────────
function openInChatSearch() {
    if (!currentChatId) return;
    inChatSearchBar.style.display='flex'; inChatSearchInput.focus(); inChatSearchInput.select();
}
function closeInChatSearch() {
    inChatSearchBar.style.display='none'; clearSearchHighlights();
    searchMatches=[]; searchIndex=0; inChatSearchCount.textContent=''; inChatSearchInput.value='';
}
inChatSearchBtn.addEventListener('click', openInChatSearch);
inChatSearchClose.addEventListener('click', closeInChatSearch);
inChatSearchPrev.addEventListener('click', () => navigateSearch(-1));
inChatSearchNext.addEventListener('click', () => navigateSearch(1));
inChatSearchInput.addEventListener('input', () => runSearch(inChatSearchInput.value.trim()));
inChatSearchInput.addEventListener('keydown', e => {
    if (e.key==='Enter')  { e.preventDefault(); navigateSearch(e.shiftKey?-1:1); }
    if (e.key==='Escape') closeInChatSearch();
});

document.addEventListener('keydown', e => {
    if ((e.ctrlKey||e.metaKey) && e.key==='f' && currentChatId) { e.preventDefault(); openInChatSearch(); }
    if (e.key==='Escape' && inChatSearchBar.style.display!=='none') closeInChatSearch();
    if (e.key==='Escape' && isShowingFTS) { hideFTSResults(); chatSearch.value=''; }
    if ((e.ctrlKey||e.metaKey) && e.shiftKey && e.key==='N') { e.preventDefault(); createNewChat(); }
    if ((e.ctrlKey||e.metaKey) && e.key==='k') { e.preventDefault(); chatSearch.focus(); chatSearch.select(); }
});

function clearSearchHighlights() {
    chatContainer.querySelectorAll('mark.search-hl').forEach(m=>m.replaceWith(document.createTextNode(m.textContent)));
    chatContainer.querySelectorAll('.bubble').forEach(b=>b.normalize());
}
function runSearch(query) {
    clearSearchHighlights(); searchMatches=[]; searchIndex=0;
    if (!query||query.length<2) { inChatSearchCount.textContent=''; return; }
    const bubbles = Array.from(chatContainer.querySelectorAll('.bubble'));
    const regex   = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
    bubbles.forEach(b=>highlightInNode(b,regex));
    searchMatches = Array.from(chatContainer.querySelectorAll('mark.search-hl'));
    inChatSearchCount.textContent = searchMatches.length ? `1 / ${searchMatches.length}` : 'No results';
    if (searchMatches.length) { searchIndex=0; activateMatch(0); }
}
function highlightInNode(node, regex) {
    if (node.nodeType===Node.TEXT_NODE) {
        const text=node.textContent; if (!regex.test(text)) { regex.lastIndex=0; return; }
        regex.lastIndex=0;
        const frag=document.createDocumentFragment(); let last=0,m;
        while ((m=regex.exec(text))!==null) {
            if (m.index>last) frag.appendChild(document.createTextNode(text.slice(last,m.index)));
            const mark=document.createElement('mark'); mark.className='search-hl'; mark.textContent=m[0]; frag.appendChild(mark);
            last=m.index+m[0].length;
        }
        if (last<text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.replaceWith(frag); return;
    }
    if (node.nodeType===Node.ELEMENT_NODE) {
        if (node.tagName==='CODE'||node.tagName==='PRE') return;
        Array.from(node.childNodes).forEach(child=>highlightInNode(child,regex));
    }
}
function activateMatch(idx) {
    searchMatches.forEach(m=>m.classList.remove('search-hl-active'));
    if (!searchMatches.length) return;
    const m=searchMatches[idx]; m.classList.add('search-hl-active');
    m.scrollIntoView({block:'center',behavior:'smooth'});
    inChatSearchCount.textContent=`${idx+1} / ${searchMatches.length}`;
}
function navigateSearch(dir) {
    if (!searchMatches.length) return;
    searchIndex=(searchIndex+dir+searchMatches.length)%searchMatches.length;
    activateMatch(searchIndex);
}

// ─────────────────────────────────────────────────
// Memory panel
// ─────────────────────────────────────────────────
async function loadMemory() {
    if (!memoryTextarea) return;
    try { const r=await fetch('/api/memory'); const d=await r.json(); memoryTextarea.value=d.content||''; } catch {}
}
if (memorySaveBtn) {
    memorySaveBtn.addEventListener('click', async () => {
        const content=memoryTextarea.value.trim();
        const r=await fetch('/api/memory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content})});
        if (r.ok) showToast('Memory saved ✓'); else showToast('Failed to save memory',true);
    });
}
if (memoryToggle) {
    const bodyEl=document.querySelector('#memorySection .section-body');
    let collapsed=localStorage.getItem('wilburt_memory_collapsed')==='1';
    if (collapsed&&bodyEl) bodyEl.classList.add('collapsed');
    if (collapsed) document.getElementById('memorySection')?.classList.add('section-collapsed');
    memoryToggle.addEventListener('click', () => {
        collapsed=!collapsed; localStorage.setItem('wilburt_memory_collapsed',collapsed?'1':'0');
        bodyEl?.classList.toggle('collapsed',collapsed);
        document.getElementById('memorySection')?.classList.toggle('section-collapsed',collapsed);
    });
}

// ─────────────────────────────────────────────────
// DOMContentLoaded init
// ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Accent
    const savedAccent = localStorage.getItem(ACCENT_KEY);
    if (savedAccent) applyAccent(savedAccent);

    // Sidebar state
    if (!isMobile() && localStorage.getItem(SIDEBAR_KEY)==='collapsed')
        document.body.classList.add('sidebar-collapsed');
    const savedW = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (savedW && !isMobile()) {
        sidebar.style.width = savedW+'px';
        document.documentElement.style.setProperty('--sidebar-w', savedW+'px');
    }

    // Restore model settings
    const savedTemp = localStorage.getItem('wilburt_temp');
    if (savedTemp) { temperatureSlider.value=savedTemp; tempDisplay.textContent=savedTemp; modelSettings.temperature=parseFloat(savedTemp); }
    const savedMax = localStorage.getItem('wilburt_maxtok');
    if (savedMax) { maxTokensInput.value=savedMax; modelSettings.maxTokens=parseInt(savedMax)||-1; }

    showEmptyState();
    initSocket();
    await loadModels();
    await loadChats();  // also handles last-chat restore and admin check on first call

    newChatBtn.addEventListener('click', createNewChat);
    emptyNewChatBtn.addEventListener('click', createNewChat);
    updateSendBtnState();

    // Fix #4: mobile nav button listeners — were declared but never wired
    if (mobileNavChats) {
        mobileNavChats.addEventListener('click', () => setSidebar(true));
    }
    if (mobileNavNew) {
        mobileNavNew.addEventListener('click', () => { setSidebar(false); createNewChat(); });
    }
    if (mobileNavSearch) {
        mobileNavSearch.addEventListener('click', () => { setSidebar(true); setTimeout(()=>chatSearch.focus(), 300); });
    }

    // Rebuild FTS index and load memory on startup
    fetch('/chats/api/fts-index', {method:'POST'}).catch(()=>{});
    loadMemory();
    setConnStatus('connected');
});

// ─────────────────────────────────────────────────
// WebSocket — Fix #10 consolidated: single initSocket() with ALL handlers
// ─────────────────────────────────────────────────
function initSocket() {
    socket = io({ transports:['websocket'], upgrade:false });

    socket.on('connect', () => {
        setConnStatus('connected');
        startHeartbeat();
    });

    socket.on('disconnect', reason => {
        setConnStatus('disconnected');
        stopHeartbeat();
        if (isStreaming) {
            if (activeStreamingBubble) {
                activeStreamingBubble.innerHTML =
                    '<span style="color:var(--text3);font-style:italic">Connection lost mid-stream. Reconnecting…</span>';
            }
            setStreamingState(false);
            activeStreamingWrapper = null;
            activeStreamingBubble  = null;
            streamBuffer = '';
        }
    });

    socket.on('reconnect', n => {
        setConnStatus('connected');
        showToast('Reconnected ✓');
    });
    socket.on('reconnect_attempt', () => {
        setConnStatus('reconnecting');
        showToast('Connection lost — reconnecting…', true);
    });
    socket.on('reconnect_failed', () => {
        setConnStatus('disconnected');
        showToast('Could not reconnect. Please refresh.', true);
    });

    // Stream tokens
    socket.on('stream_token', ({token, word_count}) => {
        streamBuffer += token;
        recordTokenTime();
        if (!activeStreamingBubble) return;
        const p = separateThought(streamBuffer);
        activeStreamingBubble.innerHTML = buildBubbleHTML(p);
        attachCodeCopyButtons(activeStreamingBubble);
        smartScroll();
        const badge = activeStreamingBubble.closest('.message')?.querySelector('.live-wc');
        if (badge) badge.textContent = `${word_count} words`;
    });

    // Fix #1: Tool activity events from backend tool execution loop
    socket.on('stream_tool_activity', ({phase, names, name, summary}) => {
        if (!activeStreamingBubble) return;
        if (phase === 'start') {
            const toolNames = (names || [name]).filter(Boolean);
            activeStreamingBubble.innerHTML =
                `<div class="tool-activity-card">` +
                `<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span> ` +
                `Running ${toolNames.join(', ')}…</div>`;
        } else if (phase === 'result') {
            activeStreamingBubble.innerHTML =
                `<div class="tool-activity-card">` +
                `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` +
                ` ${name}: ${escapeHtml(summary||'')}</div>`;
        }
        smartScroll();
    });

    socket.on('stream_done', ({stats, tool_calls, pruned}) => {
        finalizeStream(stats, tool_calls||[], pruned);
    });

    socket.on('stream_error', ({error}) => {
        if (activeStreamingBubble)
            activeStreamingBubble.innerHTML = `<span class="stream-error">Error: ${error}</span>`;
        showToast(error, true);
        setStreamingState(false);
        activeStreamingWrapper = null; activeStreamingBubble = null;
    });
}

// ─────────────────────────────────────────────────
// Begin stream UI — Fix #10 consolidated (no wrappers)
// ─────────────────────────────────────────────────
function beginStreamUI() {
    streamBuffer = ''; streamTokenTimes = []; autoScroll = true; userScrolledUp = false;
    activeStreamingWrapper = document.createElement('div');
    activeStreamingWrapper.className = 'message assistant stream-entering';
    activeStreamingBubble = document.createElement('div');
    activeStreamingBubble.className = 'bubble markdown';
    activeStreamingBubble.innerHTML = '<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>';
    const wc = document.createElement('span'); wc.className = 'live-wc';
    activeStreamingWrapper.appendChild(activeStreamingBubble);
    activeStreamingWrapper.appendChild(wc);
    chatContainer.appendChild(activeStreamingWrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ─────────────────────────────────────────────────
// Finalize stream — Fix #10 consolidated (no wrappers)
// ─────────────────────────────────────────────────
function finalizeStream(stats, toolCalls, pruned) {
    setStreamingState(false);
    const wrapper = activeStreamingWrapper;
    const bubble  = activeStreamingBubble;
    activeStreamingWrapper = null; activeStreamingBubble = null;
    if (!wrapper) return;

    wrapper.querySelector('.live-wc')?.remove();
    wrapper.classList.remove('stream-entering');

    if (streamBuffer.trim()) {
        const p = separateThought(streamBuffer);
        bubble.innerHTML = buildBubbleHTML(p);
        attachCodeCopyButtons(bubble);
    } else {
        bubble.innerHTML = '<span style="color:var(--text3);font-style:italic">No response.</span>';
    }

    // Stats badge
    if (stats?.tokens > 0) {
        const badge = document.createElement('div'); badge.className='msg-stats';
        const wc = stats.word_count ? ` · ${stats.word_count} words` : '';
        badge.textContent = `${stats.tokens} tokens${stats.tokens_per_sec>0?` · ${stats.tokens_per_sec} tok/s`:''}${wc}`;
        wrapper.appendChild(badge);
    }

    // Tool calls
    if (toolCalls.length) {
        const tw = document.createElement('div'); tw.className='tool-calls-wrapper';
        tw.innerHTML = buildToolCallsHTML(toolCalls);
        wrapper.appendChild(tw);
    }

    // Copy button
    const copyBtn = document.createElement('div'); copyBtn.className='copy-btn'; copyBtn.title='Copy';
    copyBtn.innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener('click', ()=>copyToClipboard(streamBuffer.trim(), copyBtn));
    wrapper.appendChild(copyBtn);

    // Regen button
    const regenBtn = document.createElement('div'); regenBtn.className='regenerate-btn';
    regenBtn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg> Regenerate`;
    regenBtn.addEventListener('click', ()=>regenerate());
    wrapper.appendChild(regenBtn);

    // Timestamp
    const ts = document.createElement('div'); ts.className='msg-timestamp';
    ts.textContent = formatTimestamp(new Date());
    wrapper.appendChild(ts);

    // Stream-complete animation
    wrapper.classList.add('stream-complete');
    setTimeout(()=>wrapper.classList.remove('stream-complete'), 600);

    if (pruned) pruneWarning.style.display='flex';
    updateTokenCounter();

    // Auto-title on first user message
    if (pendingStreamMeta?.isFirst && !pendingStreamMeta?.isRegenerate)
        triggerAutoTitle(currentChatId);
    pendingStreamMeta = null;

    // Focus input on desktop
    if (!isMobile()) messageInput.focus();

    // Chime + FTS rebuild
    playCompletionChime();
    fetch('/chats/api/fts-index', {method:'POST'}).catch(()=>{});

    loadChats(); highlightActiveChat();
}

// ─────────────────────────────────────────────────
// Stop stream — Fix #10 consolidated
// ─────────────────────────────────────────────────
function stopStream() {
    const partial = streamBuffer.trim();
    socket?.emit('stop_stream', {});
    setStreamingState(false);
    if (activeStreamingBubble && streamBuffer) {
        const p = separateThought(streamBuffer);
        activeStreamingBubble.innerHTML = buildBubbleHTML(p);
        attachCodeCopyButtons(activeStreamingBubble);
    }
    activeStreamingWrapper = null; activeStreamingBubble = null;
    // Save partial response to DB
    if (partial && currentChatId) {
        fetch(`/api/chats/${currentChatId}/save-partial`,{
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({content: partial}),
        }).then(()=>loadChats()).catch(()=>{});
    }
}

// ─────────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────────
async function loadModels() {
    try {
        const r=await fetch('/api/models'); const d=await r.json();
        modelSelect.innerHTML='';
        if (!d.models?.length) {
            const o=document.createElement('option'); o.textContent='No models loaded'; o.disabled=true; modelSelect.appendChild(o);
        } else {
            const last=localStorage.getItem('wilburt_model');
            d.models.forEach(m => {
                const o=document.createElement('option'); o.value=o.textContent=m;
                if (m===last) o.selected=true;
                modelSelect.appendChild(o);
            });
        }
    } catch(e) { showToast('Could not connect to LM Studio.',true); }
}
modelSelect.addEventListener('change', () => localStorage.setItem('wilburt_model',modelSelect.value));

// ─────────────────────────────────────────────────
// Chat list — Fix #10 consolidated
// ─────────────────────────────────────────────────
async function loadChats() {
    const r = await fetch('/chats/api/chats').catch(()=>null);
    if (!r?.ok) return;
    allChats = await r.json();
    renderChatList(allChats, chatSearch.value.trim().toLowerCase());

    if (_chatsFirstLoad) {
        _chatsFirstLoad = false;
        if (!currentChatId) {
            const lastId = localStorage.getItem(LAST_CHAT_KEY);
            if (lastId && allChats.some(c=>c.id===lastId)) {
                await loadChat(lastId);
            } else {
                localStorage.removeItem(LAST_CHAT_KEY);
                showEmptyState();
            }
        }
        // Check admin access
        try {
            const ra = await fetch('/admin/api/users');
            if (ra.ok) document.getElementById('adminLink').style.display='block';
        } catch {}
    }
}

function renderChatList(chats, q) {
    const filtered = q ? chats.filter(c=>c.title.toLowerCase().includes(q)) : chats;
    chatList.innerHTML='';
    filtered.forEach((c,i) => {
        const el = makeChatItem(c); el.style.animationDelay=`${i*40}ms`; chatList.appendChild(el);
    });
    highlightActiveChat();
}

// Fix #10 consolidated: makeChatItem with pin button (no wrapper)
function makeChatItem(chat) {
    const el = document.createElement('div');
    el.className = 'chat-item' + (chat.pinned ? ' pinned' : '');
    el.dataset.chatId = chat.id;

    const title = document.createElement('div'); title.className='chat-title'; title.textContent=chat.title;
    title.addEventListener('dblclick', e=>{ e.stopPropagation(); startRename(chat.id,title); });

    const preview = document.createElement('div'); preview.className='chat-preview'; preview.textContent=chat.preview||'';

    const actions = document.createElement('div'); actions.className='chat-actions';

    // Pin button
    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin-chat-btn' + (chat.pinned ? ' pinned' : '');
    pinBtn.title = chat.pinned ? 'Unpin chat' : 'Pin chat';
    pinBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="${chat.pinned?'currentColor':'none'}"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/></svg>`;
    pinBtn.addEventListener('click', e=>togglePinChat(chat.id,e));

    // Delete button
    const del = document.createElement('button'); del.className='delete-chat-btn'; del.title='Delete';
    del.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    del.addEventListener('click', e=>{ e.stopPropagation(); deleteChat(chat.id); });

    actions.appendChild(pinBtn); actions.appendChild(del);
    el.appendChild(title); el.appendChild(preview); el.appendChild(actions);
    el.addEventListener('click', ()=>{ loadChat(chat.id); closeMobileSidebar(); });
    return el;
}

function highlightActiveChat() {
    document.querySelectorAll('.chat-item').forEach(i=>i.classList.toggle('active', i.dataset.chatId===currentChatId));
}

function startRename(chatId, titleEl) {
    const cur = titleEl.textContent;
    const inp = Object.assign(document.createElement('input'),{type:'text',value:cur,className:'rename-input'});
    titleEl.replaceWith(inp); inp.focus(); inp.select();
    const finish = async () => {
        const nv = inp.value.trim()||cur;
        const s = document.createElement('div'); s.className='chat-title'; s.textContent=nv;
        s.addEventListener('dblclick',e=>{ e.stopPropagation(); startRename(chatId,s); });
        inp.replaceWith(s);
        if (nv!==cur) {
            await fetch(`/chats/api/chats/${chatId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:nv})}).catch(()=>{});
            const c=allChats.find(c=>c.id===chatId); if(c) c.title=nv;
        }
    };
    inp.addEventListener('blur', finish);
    inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){e.preventDefault();inp.blur();} if(e.key==='Escape'){inp.value=cur;inp.blur();} });
}

async function deleteChat(chatId) {
    if (!confirm('Delete this chat?')) return;
    await fetch(`/chats/api/chats/${chatId}`,{method:'DELETE'});
    if (currentChatId===chatId){ currentChatId=null; showEmptyState(); systemPromptInput.value=''; }
    loadChats();
}

async function togglePinChat(chatId, e) {
    e.stopPropagation();
    const r = await fetch(`/chats/api/chats/${chatId}/pin`,{method:'POST'});
    if (!r.ok) { showToast('Failed to pin/unpin chat',true); return; }
    const d = await r.json();
    const c = allChats.find(c=>c.id===chatId); if(c) c.pinned=d.pinned;
    renderChatList(allChats, chatSearch.value.trim().toLowerCase());
    highlightActiveChat();
}

async function createNewChat() {
    const r=await fetch('/chats/api/chats',{method:'POST'});
    const d=await r.json();
    currentChatId=d.chat_id; chatContainer.innerHTML=''; hideEmptyState();
    systemPromptInput.value=''; topbarTitle.textContent='New Chat'; document.title='New Chat — WilburtAI';
    await loadChats(); highlightActiveChat(); updateTokenCounter();
    return d.chat_id;
}

// Fix #10 consolidated: loadChat with skeleton, regen, page title, remember (no wrappers)
async function loadChat(chatId) {
    emptyState.style.display='none'; chatContainer.style.display='none'; chatSkeleton.style.display='block';

    const r=await fetch(`/chats/api/chats/${chatId}`);
    const d=await r.json();
    currentChatId=chatId; chatContainer.innerHTML=''; hideEmptyState();
    systemPromptInput.value=d.system_prompt||'';

    const chat=allChats.find(c=>c.id===chatId);
    topbarTitle.textContent=chat?.title||'Chat';
    document.title=`${chat?.title||'Chat'} — WilburtAI`;

    if (d.history?.length) {
        d.history.forEach((msg,i) => {
            const isLastAI=msg.role==='assistant'&&i===d.history.length-1;
            addMessageToUI(msg.role,msg.content,null,isLastAI,i);
        });
    }

    // Add regen button to last assistant message
    const msgs=Array.from(chatContainer.querySelectorAll('.message.assistant'));
    if (msgs.length) {
        const lastAI=msgs[msgs.length-1];
        if (!lastAI.querySelector('.regenerate-btn')) {
            const rb=document.createElement('div'); rb.className='regenerate-btn';
            rb.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg> Regenerate`;
            rb.addEventListener('click',()=>regenerate());
            lastAI.appendChild(rb);
        }
    }

    chatSkeleton.style.display='none';
    highlightActiveChat(); updateTokenCounter();
    chatContainer.scrollTop=chatContainer.scrollHeight; updateScrollBtn();
    if (chatId) localStorage.setItem(LAST_CHAT_KEY,chatId); else localStorage.removeItem(LAST_CHAT_KEY);
}

// ─────────────────────────────────────────────────
// Auto-title — Fix #10 consolidated
// ─────────────────────────────────────────────────
async function triggerAutoTitle(chatId) {
    const model=modelSelect.value; if (!model||!chatId) return;
    try {
        const r=await fetch(`/api/chats/${chatId}/generate-title`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model})});
        const d=await r.json();
        if (d.title) {
            const c=allChats.find(c=>c.id===chatId); if(c) c.title=d.title;
            topbarTitle.textContent=d.title;
            document.title=`${d.title} — WilburtAI`;
            renderChatList(allChats, chatSearch.value.trim().toLowerCase());
            highlightActiveChat();
        }
    } catch {}
}

// ─────────────────────────────────────────────────
// Add message to UI — Fix #10 consolidated (with timestamps + animation)
// ─────────────────────────────────────────────────
function addMessageToUI(role, content, stats=null, showRegen=false, historyIndex=null) {
    document.querySelectorAll('.regenerate-btn').forEach(b=>b.remove());
    const wrapper=document.createElement('div'); wrapper.className=`message ${role}`;
    if (historyIndex!==null) wrapper.dataset.historyIndex=historyIndex;
    const bubble=document.createElement('div'); bubble.className='bubble';
    const ts=document.createElement('div'); ts.className='msg-timestamp';
    ts.textContent=formatTimestamp(new Date());

    if (role==='assistant') {
        bubble.classList.add('markdown');
        const p=separateThought(typeof content==='string'?content:'');
        let html='';
        if (p.thought){ const s=p.thought.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); html+=`<details class="thought-block"><summary>Thought</summary><div class="thought-content">${s}</div></details>`; }
        if (p.response) html+=renderMarkdown(p.response);
        bubble.innerHTML=DOMPurify.sanitize(html,{ADD_TAGS:['details','summary'],ADD_ATTR:['data-raw']});
        attachCodeCopyButtons(bubble);
        const copy=document.createElement('div'); copy.className='copy-btn'; copy.title='Copy';
        copy.innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        copy.addEventListener('click',()=>copyToClipboard((p.response||content||'').toString().trim(),copy));
        wrapper.appendChild(copy);
        if (stats?.tokens>0){ const b=document.createElement('div');b.className='msg-stats';b.textContent=`${stats.tokens} tokens${stats.tokens_per_sec>0?` · ${stats.tokens_per_sec} tok/s`:''}`;wrapper.appendChild(b); }
        if (showRegen){ const rb=document.createElement('div');rb.className='regenerate-btn';rb.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg> Regenerate`;rb.addEventListener('click',()=>regenerate());wrapper.appendChild(rb); }
    } else {
        if (Array.isArray(content)){
            content.forEach(part=>{
                if (part.type==='text'){ const p=document.createElement('p');p.style.margin='0 0 6px';p.textContent=part.text;bubble.appendChild(p); }
                else if (part.type==='image_url'){ const img=document.createElement('img');img.src=part.image_url.url;img.className='msg-image';bubble.appendChild(img); }
            });
        } else { bubble.textContent=content; }
        if (historyIndex!==null){
            const eb=document.createElement('button');eb.className='edit-msg-btn';eb.title='Edit';
            eb.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
            eb.addEventListener('click',()=>startEditMessage(wrapper,historyIndex));
            wrapper.appendChild(eb);
        }
        // Animate user bubbles in
        wrapper.classList.add('msg-enter');
        wrapper.addEventListener('animationend',()=>wrapper.classList.remove('msg-enter'),{once:true});
    }
    wrapper.appendChild(bubble); wrapper.appendChild(ts);
    chatContainer.appendChild(wrapper);
    chatContainer.scrollTop=chatContainer.scrollHeight; updateScrollBtn(); updateTokenCounter();
}

// ─────────────────────────────────────────────────
// Edit user message
// ─────────────────────────────────────────────────
function startEditMessage(wrapper, historyIndex) {
    const bubble=wrapper.querySelector('.bubble');
    const origText=bubble.textContent.trim();
    const editArea=document.createElement('div'); editArea.className='edit-area';
    const textarea=Object.assign(document.createElement('textarea'),{className:'edit-textarea',value:origText});
    const btnRow=document.createElement('div'); btnRow.className='edit-btn-row';
    const saveBtn=Object.assign(document.createElement('button'),{className:'edit-save-btn',textContent:'Save & Regenerate'});
    const cancelBtn=Object.assign(document.createElement('button'),{className:'edit-cancel-btn',textContent:'Cancel'});
    cancelBtn.addEventListener('click',()=>{ editArea.replaceWith(bubble); wrapper.querySelector('.edit-msg-btn')?.style.removeProperty('display'); });
    saveBtn.addEventListener('click', async()=>{
        const nt=textarea.value.trim(); if(!nt||nt===origText){ cancelBtn.click(); return; }
        await submitEditedMessage(nt,historyIndex,wrapper);
    });
    textarea.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();saveBtn.click();} if(e.key==='Escape')cancelBtn.click(); });
    btnRow.appendChild(cancelBtn); btnRow.appendChild(saveBtn);
    editArea.appendChild(textarea); editArea.appendChild(btnRow);
    bubble.replaceWith(editArea);
    wrapper.querySelector('.edit-msg-btn')&&(wrapper.querySelector('.edit-msg-btn').style.display='none');
    textarea.focus(); textarea.style.height=Math.min(textarea.scrollHeight,300)+'px';
    textarea.addEventListener('input',()=>{ textarea.style.height='auto'; textarea.style.height=Math.min(textarea.scrollHeight,300)+'px'; });
}
async function submitEditedMessage(newText, historyIndex, editedWrapper) {
    if (isStreaming||!currentChatId) return;
    await fetch(`/chats/api/chats/${currentChatId}/truncate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from_index:historyIndex})});
    const all=Array.from(chatContainer.querySelectorAll('.message'));
    const idx=all.indexOf(editedWrapper);
    if (idx!==-1) all.slice(idx).forEach(m=>m.remove());
    lastUserMessage=newText;
    addMessageToUI('user',newText,null,false,historyIndex);
    doStreamRequest(newText,false,[]);
}

// ─────────────────────────────────────────────────
// Send + stream
// ─────────────────────────────────────────────────
async function sendMessage() {
    const message=messageInput.value.trim();
    const model=modelSelect.value;
    if (isStreaming||(!message&&!pendingImages.length)) return;
    if (!model){ showToast('No model selected — is LM Studio running?',true); return; }
    if (!currentChatId){ const id=await createNewChat(); if (!id) return; }

    const imgs=[...pendingImages]; pendingImages=[];
    const files=[...pendingFiles]; pendingFiles=[];
    renderAttachPreviews();

    let fileContext='';
    if (files.length) {
        fileContext=files.map(f=>{ const fence=f.lang?('```'+f.lang):'```'; return '### '+f.name+'\n'+fence+'\n'+f.content+'\n```'; }).join('\n\n');
    }
    const fullMessage=fileContext?(fileContext+(message?'\n\n'+message:''))  :message;

    const histIndex=chatContainer.querySelectorAll('.message').length;
    addMessageToUI('user',
        imgs.length
            ? [{type:'text',text:message||' '},...imgs.map(i=>({type:'image_url',image_url:{url:i.dataUri}}))]
            : message||(files.length?`📎 ${files.map(f=>f.name).join(', ')}`:''),
        null,false,histIndex);
    messageInput.value=''; messageInput.style.height='auto'; lastUserMessage=fullMessage;
    doStreamRequest(fullMessage, false, imgs.map(i=>i.dataUri));
}

// Fix #2 + Fix #10: doStreamRequest consolidated with RAG wiring and animations
function doStreamRequest(message, isRegenerate=false, images=[]) {
    if (!socket?.connected){ showToast('WebSocket not connected.',true); return; }
    const isFirst=chatContainer.querySelectorAll('.message.user').length===1&&!isRegenerate;
    pendingStreamMeta={isFirst, isRegenerate, images};
    setStreamingState(true);
    beginStreamUI();

    // Input flash animation
    const iw=document.getElementById('inputWrapper');
    if (iw&&!isRegenerate){ iw.classList.add('input-sent'); setTimeout(()=>iw.classList.remove('input-sent'),350); }
    // Button ripple
    actionBtn.classList.add('btn-sending'); setTimeout(()=>actionBtn.classList.remove('btn-sending'),400);

    // Fix #2: read RAG settings and include them in the payload
    const useRag         = document.getElementById('ragToggle')?.checked || false;
    const embeddingRaw   = document.getElementById('ragEmbeddingInput')?.value.trim() || '';
    const embeddingModel = embeddingRaw || modelSelect.value;

    socket.emit('start_stream',{
        message,
        model:            modelSelect.value,
        chat_id:          currentChatId,
        temperature:      modelSettings.temperature,
        max_tokens:       modelSettings.maxTokens,
        regenerate:       isRegenerate,
        images,
        use_rag:          useRag,            // Fix #2: was always missing
        embedding_model:  embeddingModel,    // Fix #2: was always missing
        use_web_tools:    webToolsEnabled,
    });
}

async function regenerate() {
    if (isStreaming||!currentChatId||!lastUserMessage) return;
    const r=await fetch(`/chats/api/chats/${currentChatId}/pop`,{method:'POST'});
    if (!r.ok) return;
    const last=chatContainer.querySelector('.message.assistant:last-of-type');
    if (last) last.remove();
    doStreamRequest(lastUserMessage,true,[]);
}
