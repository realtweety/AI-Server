// app/static/script.js  —  WilburtAI Micro Server

// ─────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────
let currentChatId   = null;
let lastUserMessage = '';
let isStreaming     = false;
let pendingImages   = [];   // {dataUri, name} — vision
let pendingFiles    = [];   // {name, content, lang} — text context
let allChats        = [];
let modelSettings   = { temperature: 0.7, maxTokens: -1 };
let socket          = null;
let streamBuffer    = '';   // accumulates tokens for rendering

// ─────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────
const chatContainer       = document.getElementById('chatContainer');
const emptyState          = document.getElementById('emptyState');
const messageInput        = document.getElementById('messageInput');
const modelSelect         = document.getElementById('modelSelect');
const sendBtn             = document.getElementById('actionBtn');  // morphed into actionBtn
const stopBtn             = {style:{}, addEventListener:()=>{}};   // removed — actionBtn handles stop
const newChatBtn          = document.getElementById('newChatBtn');
const emptyNewChatBtn     = document.getElementById('emptyNewChatBtn');
const chatList            = document.getElementById('chatList');
const settingsToggleBtn   = document.getElementById('settingsToggleBtn');
const settingsPanel       = document.getElementById('settingsPopover'); // renamed to popover
const systemPromptInput   = document.getElementById('systemPromptInput');
const saveSystemPromptBtn = document.getElementById('saveSystemPromptBtn');
const temperatureSlider   = document.getElementById('temperatureSlider');
const tempDisplay         = document.getElementById('tempDisplay');
const maxTokensInput      = document.getElementById('maxTokensInput');
const tokenCounter        = document.getElementById('tokenCounter');
const scrollToBottomBtn   = document.getElementById('scrollToBottomBtn');
const unloadModelBtn      = {addEventListener:()=>{}};             // removed from UI
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

// ─────────────────────────────────────────────────
// Sidebar: collapse + resize + mobile drawer
// ─────────────────────────────────────────────────
const SIDEBAR_KEY      = 'wilburt_sidebar';
const SIDEBAR_WIDTH_KEY= 'wilburt_sidebar_w';

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
    resizing    = true;
    resizeStartX= e.clientX;
    resizeStartW= sidebar.offsetWidth;
    document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', e => {
    if (!resizing) return;
    const w = Math.min(480, Math.max(180, resizeStartW + (e.clientX - resizeStartX)));
    sidebar.style.width = w + 'px';
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    localStorage.setItem(SIDEBAR_WIDTH_KEY, w);
});
document.addEventListener('mouseup', () => {
    if (resizing) { resizing = false; document.body.style.userSelect = ''; }
});

// ─────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────
const THEME_KEY = 'wilburt_theme';
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

// ─────────────────────────────────────────────────
// Accent colour
// ─────────────────────────────────────────────────
const ACCENT_KEY = 'wilburt_accent';
function applyAccent(hex) {
    document.documentElement.style.setProperty('--accent', hex);
    // Darken by ~15% for hover
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
// Web Tools toggle
// ─────────────────────────────────────────────────
let webToolsEnabled = false;
const webToolsBtn = document.getElementById('webToolsBtn');
if (webToolsBtn) {
    webToolsBtn.addEventListener('click', () => {
        webToolsEnabled = !webToolsEnabled;
        webToolsBtn.setAttribute('aria-pressed', webToolsEnabled ? 'true' : 'false');
        webToolsBtn.classList.toggle('web-tools-active', webToolsEnabled);
        webToolsBtn.title = webToolsEnabled ? 'Web Tools: On' : 'Web Tools: Off';
    });
}

// ─────────────────────────────────────────────────
// Liquid Glass — canvas wallpaper + toggle
// ─────────────────────────────────────────────────
const GLASS_KEY = 'wilburt_glass';
const liquidGlassBtn = document.getElementById('liquidGlassBtn');
const glassBg = document.getElementById('glassBg');
let glassAnimId = null;

// Orbs are fixed in place — they only breathe (scale + opacity pulse)
// phase: offset into the breath cycle (0–2π), so each orb is out of sync
// period: full breath cycle in ms — 5000–9000ms = very slow and calming
const GLASS_ORBS = [
    { x: 0.18, y: 0.25, r: 0.42, h: 262, s: 70, l: 55, phase: 0.0,  period: 8000 },
    { x: 0.80, y: 0.12, r: 0.36, h: 215, s: 75, l: 58, phase: 1.1,  period: 9500 },
    { x: 0.58, y: 0.78, r: 0.38, h: 162, s: 60, l: 52, phase: 2.2,  period: 7500 },
    { x: 0.10, y: 0.72, r: 0.30, h:  37, s: 85, l: 60, phase: 3.4,  period: 8800 },
    { x: 0.88, y: 0.58, r: 0.33, h: 330, s: 65, l: 58, phase: 4.5,  period: 6800 },
    { x: 0.44, y: 0.40, r: 0.25, h: 192, s: 80, l: 55, phase: 5.7,  period: 9200 },
];

function drawGlassBg(ts) {
    const canvas = glassBg;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = isDark ? '#07070d' : '#e8eaf0';
    ctx.fillRect(0, 0, w, h);

    GLASS_ORBS.forEach(orb => {
        // Smooth sine breath: oscillates between 0.7 and 1.0 in scale
        // and between baseAlpha*0.7 and baseAlpha for opacity
        const breath = Math.sin(orb.phase + (ts / orb.period) * Math.PI * 2);
        const scale   = 0.85 + 0.15 * (breath * 0.5 + 0.5);   // 0.85 → 1.0
        const baseAlpha = isDark ? 0.26 : 0.20;
        const alpha   = baseAlpha * (0.7 + 0.3 * (breath * 0.5 + 0.5)); // 0.7x → 1x

        const cx = orb.x * w;
        const cy = orb.y * h;
        const r  = orb.r * Math.max(w, h) * scale;

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0,   `hsla(${orb.h}, ${orb.s}%, ${orb.l}%, ${alpha})`);
        grad.addColorStop(0.5, `hsla(${orb.h}, ${orb.s}%, ${orb.l}%, ${alpha * 0.45})`);
        grad.addColorStop(1,   `hsla(${orb.h}, ${orb.s}%, ${orb.l}%, 0)`);

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
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
    if (glassBg) {
        const ctx = glassBg.getContext('2d');
        ctx.clearRect(0, 0, glassBg.width, glassBg.height);
    }
}

function applyGlass(on) {
    document.documentElement.setAttribute('data-glass', on ? 'on' : 'off');
    if (liquidGlassBtn) {
        liquidGlassBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        liquidGlassBtn.title = on ? 'Liquid Glass: On' : 'Liquid Glass: Off';
    }
    if (on) startGlassAnimation();
    else    stopGlassAnimation();
}

if (liquidGlassBtn) {
    liquidGlassBtn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-glass') !== 'on';
        localStorage.setItem(GLASS_KEY, next ? '1' : '0');
        applyGlass(next);
    });
}

// Resize canvas on window resize
window.addEventListener('resize', () => {
    if (document.documentElement.getAttribute('data-glass') === 'on') resizeGlassBg();
});

// Init from storage
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
    if (m)                     return {thought:m[1].trim(), response:m[2].trimStart(), done:true};
    if (text.startsWith('<think>'))    return {thought:text.slice(7), response:'', done:false};
    if (/^\[THINK\]/i.test(text))     return {thought:text.slice(7), response:'', done:false};
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
// Clipboard helper
// ─────────────────────────────────────────────────
function copyToClipboard(text, btn) {
    const ok = () => { const o=btn.innerHTML; btn.innerHTML='✓ Copied!'; setTimeout(()=>btn.innerHTML=o,1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(ok).catch(()=>execCopy(text,ok));
    else execCopy(text,ok);
}
function execCopy(text,cb) {
    const t=Object.assign(document.createElement('textarea'),{value:text,style:'position:fixed;opacity:0'});
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); cb(); } catch{}
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
    emptyState.style.display='flex'; chatContainer.style.display='none'; tokenCounter.textContent='—';
    topbarTitle.textContent='';
}
function hideEmptyState() {
    emptyState.style.display='none'; chatContainer.style.display='block';
}

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
    if (document.getElementById('actionBtn'))
        document.getElementById('actionBtn').classList.toggle('disabled', empty && !isStreaming);
}

// ─────────────────────────────────────────────────
// Scroll
// ─────────────────────────────────────────────────
function updateScrollBtn() {
    const dist = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
    scrollToBottomBtn.style.display = dist > 120 ? 'flex' : 'none';
}
let autoScroll = true;
chatContainer && chatContainer.addEventListener('scroll', () => {
    const dist = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
    autoScroll = dist < 80;
    updateScrollBtn();
});
scrollToBottomBtn.addEventListener('click', () => {
    chatContainer.scrollTo({top:chatContainer.scrollHeight,behavior:'smooth'});
    autoScroll = true;
});
function scrollIfNeeded() {
    if (autoScroll) chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ─────────────────────────────────────────────────
// Settings panel
// ─────────────────────────────────────────────────
// settingsToggleBtn click handled in batch3 popover block

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
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({system_prompt:systemPromptInput.value}),
    });
    saveSystemPromptBtn.textContent='Saved ✓';
    setTimeout(()=>saveSystemPromptBtn.textContent='Save',1500);
});
pruneWarningClose.addEventListener('click',()=>pruneWarning.style.display='none');

// ─────────────────────────────────────────────────
// Unload model
// ─────────────────────────────────────────────────
// unloadModelBtn removed from UI

// ─────────────────────────────────────────────────
// Unified file attachment
// ─────────────────────────────────────────────────

// Extensions treated as plain text (read client-side)
const TEXT_EXTS = new Set([
    'txt','md','markdown','py','js','ts','jsx','tsx','json','jsonc',
    'css','scss','sass','less','html','htm','xml','svg','yaml','yml',
    'toml','ini','cfg','conf','sh','bash','zsh','fish','ps1','bat',
    'c','cpp','cc','h','hpp','cs','java','rb','php','go','rs','swift',
    'kt','kts','r','m','lua','sql','graphql','proto','tf','hcl',
    'dockerfile','makefile','env','log','csv','tsv',
]);

function getExt(name) { return name.split('.').pop().toLowerCase(); }

function isImage(file) { return file.type.startsWith('image/'); }
function isPDF(file)   { return file.type === 'application/pdf' || getExt(file.name) === 'pdf'; }
function isText(file)  {
    if (file.type.startsWith('text/')) return true;
    return TEXT_EXTS.has(getExt(file.name));
}

// Language hint for fenced code blocks
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

attachBtn.addEventListener('click', ()=>attachFileInput.click());
attachFileInput.addEventListener('change', ()=>{
    Array.from(attachFileInput.files).forEach(dispatchFile);
    attachFileInput.value='';
});

document.addEventListener('paste', e=>{
    const items = Array.from(e.clipboardData?.items||[]);
    const imgs  = items.filter(i=>i.type.startsWith('image/'));
    if (imgs.length){ e.preventDefault(); imgs.forEach(i=>dispatchFile(i.getAsFile())); }
});

const inputWrapper = document.getElementById('inputWrapper');
inputWrapper.addEventListener('dragover',  e=>{e.preventDefault();inputWrapper.classList.add('drag-over');});
inputWrapper.addEventListener('dragleave', ()=>inputWrapper.classList.remove('drag-over'));
inputWrapper.addEventListener('drop', e=>{
    e.preventDefault(); inputWrapper.classList.remove('drag-over');
    Array.from(e.dataTransfer.files).forEach(dispatchFile);
});

function dispatchFile(file) {
    if (!file) return;
    if (isImage(file))     { addImageFile(file); return; }
    if (isPDF(file))       { addPDFFile(file);   return; }
    if (isText(file))      { addTextFile(file);  return; }
    showToast(`"${file.name}" — unsupported file type`, true);
}

function addImageFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
        pendingImages.push({dataUri:e.target.result, name:file.name});
        renderAttachPreviews(); updateSendBtnState();
    };
    reader.readAsDataURL(file);
}

function addTextFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
        const content = e.target.result;
        if (content.length > 120000) {
            showToast(`"${file.name}" is too large (max ~120 KB of text)`, true); return;
        }
        pendingFiles.push({name:file.name, content, lang:langHint(file.name)});
        renderAttachPreviews(); updateSendBtnState();
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
        pendingFiles.push({name:file.name, content:d.text, lang:''});
        renderAttachPreviews(); updateSendBtnState();
    } catch(e) { showToast(`Failed to extract PDF: ${e}`, true); }
}

function renderAttachPreviews() {
    const hasAny = pendingImages.length || pendingFiles.length;
    imagePreviewStrip.style.display = hasAny ? 'flex' : 'none';
    imagePreviewStrip.innerHTML = '';

    // Image thumbnails
    pendingImages.forEach((img, i) => {
        const w = document.createElement('div'); w.className = 'img-preview-wrap';
        const t = document.createElement('img');
        t.src = img.dataUri; t.className = 'img-preview-thumb'; t.title = img.name;
        const r = document.createElement('button'); r.className = 'img-preview-remove'; r.textContent = '✕';
        r.addEventListener('click', ()=>{ pendingImages.splice(i,1); renderAttachPreviews(); updateSendBtnState(); });
        w.appendChild(t); w.appendChild(r); imagePreviewStrip.appendChild(w);
    });

    // Text file chips
    pendingFiles.forEach((f, i) => {
        const chip = document.createElement('div'); chip.className = 'file-chip';
        chip.title = f.name;
        const icon = document.createElement('span'); icon.className = 'file-chip-icon'; icon.textContent = fileIcon(f.name);
        const name = document.createElement('span'); name.className = 'file-chip-name'; name.textContent = f.name;
        const rm   = document.createElement('button'); rm.className = 'img-preview-remove file-chip-rm'; rm.textContent = '✕';
        rm.addEventListener('click', ()=>{ pendingFiles.splice(i,1); renderAttachPreviews(); updateSendBtnState(); });
        chip.appendChild(icon); chip.appendChild(name); chip.appendChild(rm);
        imagePreviewStrip.appendChild(chip);
    });
}

function fileIcon(name) {
    const ext = getExt(name);
    if (['py'].includes(ext))              return '🐍';
    if (['js','ts','jsx','tsx'].includes(ext)) return '⚡';
    if (['json','jsonc'].includes(ext))    return '{}';
    if (['md','markdown'].includes(ext))   return '📝';
    if (['pdf'].includes(ext))             return '📄';
    if (['csv','tsv'].includes(ext))       return '📊';
    if (['html','htm','xml'].includes(ext))return '🌐';
    if (['sh','bash','zsh','ps1','bat'].includes(ext)) return '⚙';
    if (['sql'].includes(ext))             return '🗄';
    return '📎';
}

// Keep old name as alias so sendMessage still works
function renderImagePreviews() { renderAttachPreviews(); }

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
// Textarea auto-resize + char counter
// ─────────────────────────────────────────────────
messageInput.addEventListener('input',()=>{
    messageInput.style.height='auto';
    messageInput.style.height=Math.min(messageInput.scrollHeight,200)+'px';
    updateSendBtnState();
});
messageInput.addEventListener('keypress',e=>{
    if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}
});

// ─────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────
chatSearch.addEventListener('input',()=>{
    const q=chatSearch.value.trim().toLowerCase();
    clearSearchBtn.style.display=q?'flex':'none';
    renderChatList(allChats,q);
});
clearSearchBtn.addEventListener('click',()=>{
    chatSearch.value='';clearSearchBtn.style.display='none';renderChatList(allChats,'');
});

// ─────────────────────────────────────────────────
// DOMContentLoaded init
// ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Theme
    applyTheme(localStorage.getItem(THEME_KEY)||'dark');

    // Accent
    const savedAccent=localStorage.getItem(ACCENT_KEY);
    if (savedAccent) applyAccent(savedAccent);

    // Sidebar
    if (!isMobile()&&localStorage.getItem(SIDEBAR_KEY)==='collapsed')
        document.body.classList.add('sidebar-collapsed');
    const savedW=localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (savedW&&!isMobile()){
        sidebar.style.width=savedW+'px';
        document.documentElement.style.setProperty('--sidebar-w',savedW+'px');
    }

    // Restore model settings
    const savedTemp=localStorage.getItem('wilburt_temp');
    if (savedTemp){ temperatureSlider.value=savedTemp; tempDisplay.textContent=savedTemp; modelSettings.temperature=parseFloat(savedTemp); }
    const savedMax=localStorage.getItem('wilburt_maxtok');
    if (savedMax){ maxTokensInput.value=savedMax; modelSettings.maxTokens=parseInt(savedMax)||-1; }

    showEmptyState();
    initSocket();
    await loadModels();
    await loadChats();

    // actionBtn handles both send and stop — listeners set up in batch3 block
    newChatBtn.addEventListener('click',createNewChat);
    emptyNewChatBtn.addEventListener('click',createNewChat);
    updateSendBtnState();
   
});

// ─────────────────────────────────────────────────
// WebSocket (Socket.IO)
// ─────────────────────────────────────────────────
function initSocket() {
    socket = io({ transports:['websocket'], upgrade:false });
    socket.on('connect',    ()=>console.log('Socket connected'));
    socket.on('disconnect', ()=>console.log('Socket disconnected'));

    socket.on('stream_token', ({token, word_count}) => {
        streamBuffer += token;
        if (!activeStreamingBubble) return;
        const p = separateThought(streamBuffer);
        activeStreamingBubble.innerHTML = buildBubbleHTML(p);
        attachCodeCopyButtons(activeStreamingBubble);
        scrollIfNeeded();
        // live word count badge
        const badge = activeStreamingBubble.closest('.message')?.querySelector('.live-wc');
        if (badge) badge.textContent = `${word_count} words`;
    });

    socket.on('stream_done', ({stats, tool_calls, pruned}) => {
        finalizeStream(stats, tool_calls||[], pruned);
    });

    socket.on('stream_error', ({error}) => {
        if (activeStreamingBubble) {
            activeStreamingBubble.innerHTML = `<span class="stream-error">Error: ${error}</span>`;
        }
        showToast(error, true);
        setStreamingState(false);
        activeStreamingWrapper = null; activeStreamingBubble = null;
    });
}

let activeStreamingWrapper = null;
let activeStreamingBubble  = null;
let pendingStreamMeta      = null;  // { isFirst, isRegenerate, images }

function stopStream() {
    socket?.emit('stop_stream', {});
    setStreamingState(false);
    if (activeStreamingBubble && streamBuffer) {
        const p = separateThought(streamBuffer);
        activeStreamingBubble.innerHTML = buildBubbleHTML(p);
        attachCodeCopyButtons(activeStreamingBubble);
    }
    activeStreamingWrapper = null; activeStreamingBubble = null;
}

function beginStreamUI() {
    streamBuffer = ''; autoScroll = true;
    activeStreamingWrapper = document.createElement('div');
    activeStreamingWrapper.className = 'message assistant';
    activeStreamingBubble = document.createElement('div');
    activeStreamingBubble.className = 'bubble markdown';
    activeStreamingBubble.innerHTML = '<span class="thinking">Thinking…</span>';

    const wc = document.createElement('span');
    wc.className = 'live-wc'; wc.textContent = '';
    activeStreamingWrapper.appendChild(activeStreamingBubble);
    activeStreamingWrapper.appendChild(wc);
    chatContainer.appendChild(activeStreamingWrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function finalizeStream(stats, toolCalls, pruned) {
    setStreamingState(false);
    const wrapper = activeStreamingWrapper;
    const bubble  = activeStreamingBubble;
    activeStreamingWrapper = null; activeStreamingBubble = null;
    if (!wrapper) return;

    // Replace live-WC badge with final stats
    wrapper.querySelector('.live-wc')?.remove();

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

    // Copy + regen buttons
    const copyBtn = document.createElement('div');
    copyBtn.className='copy-btn'; copyBtn.title='Copy';
    copyBtn.innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener('click', ()=>copyToClipboard(streamBuffer.trim(), copyBtn));
    wrapper.appendChild(copyBtn);

    const regenBtn = document.createElement('div'); regenBtn.className='regenerate-btn';
    regenBtn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg> Regenerate`;
    regenBtn.addEventListener('click', ()=>regenerate());
    wrapper.appendChild(regenBtn);

    // Timestamp
    const ts = document.createElement('div'); ts.className='msg-timestamp';
    ts.textContent = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    wrapper.appendChild(ts);

    if (pruned) pruneWarning.style.display='flex';

    updateTokenCounter();
    if (pendingStreamMeta?.isFirst && !pendingStreamMeta?.isRegenerate)
        triggerAutoTitle(currentChatId);
    pendingStreamMeta = null;
    loadChats(); highlightActiveChat();
}

// ─────────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────────
async function loadModels() {
    try {
        const r=await fetch('/api/models'); const d=await r.json();
        modelSelect.innerHTML='';
        if (!d.models?.length) {
            const o=document.createElement('option');o.textContent='No models loaded';o.disabled=true;modelSelect.appendChild(o);
        } else {
            // Restore last model
            const last=localStorage.getItem('wilburt_model');
            d.models.forEach(m=>{
                const o=document.createElement('option');o.value=o.textContent=m;
                if (m===last) o.selected=true;
                modelSelect.appendChild(o);
            });
        }
    } catch(e){ showToast('Could not connect to LM Studio.',true); }
}
modelSelect.addEventListener('change',()=>localStorage.setItem('wilburt_model',modelSelect.value));

// ─────────────────────────────────────────────────
// Chat list
// ─────────────────────────────────────────────────
async function loadChats() {
    const r=await fetch('/chats/api/chats').catch(()=>null);
    if (!r?.ok) return;
    allChats=await r.json();
    renderChatList(allChats, chatSearch.value.trim().toLowerCase());
}

function renderChatList(chats, q) {
    const filtered=q?chats.filter(c=>c.title.toLowerCase().includes(q)):chats;
    chatList.innerHTML='';
    filtered.forEach((c,i)=>{
        const el=makeChatItem(c);
        el.style.animationDelay=`${i*40}ms`;
        chatList.appendChild(el);
    });
    highlightActiveChat();
}

function makeChatItem(chat) {
    const el=document.createElement('div'); el.className='chat-item'; el.dataset.chatId=chat.id;
    const title=document.createElement('div'); title.className='chat-title'; title.textContent=chat.title;
    title.addEventListener('dblclick',e=>{e.stopPropagation();startRename(chat.id,title);});
    const preview=document.createElement('div'); preview.className='chat-preview'; preview.textContent=chat.preview||'';
    const actions=document.createElement('div'); actions.className='chat-actions';
    const del=document.createElement('button'); del.className='delete-chat-btn'; del.title='Delete';
    del.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    del.addEventListener('click',e=>{e.stopPropagation();deleteChat(chat.id);});
    actions.appendChild(del); el.appendChild(title); el.appendChild(preview); el.appendChild(actions);
    el.addEventListener('click',()=>{loadChat(chat.id);closeMobileSidebar();});
    return el;
}

function highlightActiveChat() {
    document.querySelectorAll('.chat-item').forEach(i=>i.classList.toggle('active',i.dataset.chatId===currentChatId));
}

function startRename(chatId, titleEl) {
    const cur=titleEl.textContent;
    const inp=Object.assign(document.createElement('input'),{type:'text',value:cur,className:'rename-input'});
    titleEl.replaceWith(inp); inp.focus(); inp.select();
    const finish=async()=>{
        const nv=inp.value.trim()||cur;
        const s=document.createElement('div'); s.className='chat-title'; s.textContent=nv;
        s.addEventListener('dblclick',e=>{e.stopPropagation();startRename(chatId,s);});
        inp.replaceWith(s);
        if (nv!==cur){
            await fetch(`/chats/api/chats/${chatId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:nv})}).catch(()=>{});
            const c=allChats.find(c=>c.id===chatId); if(c) c.title=nv;
        }
    };
    inp.addEventListener('blur',finish);
    inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();inp.blur();}if(e.key==='Escape'){inp.value=cur;inp.blur();}});
}

async function deleteChat(chatId) {
    if (!confirm('Delete this chat?')) return;
    await fetch(`/chats/api/chats/${chatId}`,{method:'DELETE'});
    if (currentChatId===chatId){currentChatId=null;showEmptyState();systemPromptInput.value='';}
    loadChats();
}

async function createNewChat() {
    const r=await fetch('/chats/api/chats',{method:'POST'});
    const d=await r.json();
    currentChatId=d.chat_id; chatContainer.innerHTML=''; hideEmptyState();
    systemPromptInput.value=''; topbarTitle.textContent='New Chat';
    await loadChats(); highlightActiveChat(); updateTokenCounter();
    return d.chat_id;
}

async function loadChat(chatId) {
    const r=await fetch(`/chats/api/chats/${chatId}`);
    const d=await r.json();
    currentChatId=chatId; chatContainer.innerHTML=''; hideEmptyState();
    systemPromptInput.value=d.system_prompt||'';
    const chat=allChats.find(c=>c.id===chatId);
    topbarTitle.textContent=chat?.title||'Chat';
    if (d.history?.length) {
        d.history.forEach((msg,i)=>{
            const isLastAI=msg.role==='assistant'&&i===d.history.length-1;
            addMessageToUI(msg.role,msg.content,null,isLastAI,i);
        });
    }
    highlightActiveChat(); updateTokenCounter();
    chatContainer.scrollTop=chatContainer.scrollHeight; updateScrollBtn();
}

// ─────────────────────────────────────────────────
// Auto-title
// ─────────────────────────────────────────────────
async function triggerAutoTitle(chatId) {
    const model=modelSelect.value; if (!model||!chatId) return;
    try {
        const r=await fetch(`/api/chats/${chatId}/generate-title`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model})});
        const d=await r.json();
        if (d.title){
            const c=allChats.find(c=>c.id===chatId); if(c) c.title=d.title;
            topbarTitle.textContent=d.title;
            renderChatList(allChats,chatSearch.value.trim().toLowerCase());
            highlightActiveChat();
        }
    } catch{}
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
    cancelBtn.addEventListener('click',()=>{editArea.replaceWith(bubble);wrapper.querySelector('.edit-msg-btn')?.style.removeProperty('display');});
    saveBtn.addEventListener('click',async()=>{
        const nt=textarea.value.trim();
        if (!nt||nt===origText){cancelBtn.click();return;}
        await submitEditedMessage(nt,historyIndex,wrapper);
    });
    textarea.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();saveBtn.click();}if(e.key==='Escape')cancelBtn.click();});
    btnRow.appendChild(cancelBtn); btnRow.appendChild(saveBtn);
    editArea.appendChild(textarea); editArea.appendChild(btnRow);
    bubble.replaceWith(editArea);
    wrapper.querySelector('.edit-msg-btn') && (wrapper.querySelector('.edit-msg-btn').style.display='none');
    textarea.focus(); textarea.style.height=Math.min(textarea.scrollHeight,300)+'px';
    textarea.addEventListener('input',()=>{textarea.style.height='auto';textarea.style.height=Math.min(textarea.scrollHeight,300)+'px';});
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
// Add message to UI
// ─────────────────────────────────────────────────
function addMessageToUI(role, content, stats=null, showRegen=false, historyIndex=null) {
    document.querySelectorAll('.regenerate-btn').forEach(b=>b.remove());
    const wrapper=document.createElement('div'); wrapper.className=`message ${role}`;
    if (historyIndex!==null) wrapper.dataset.historyIndex=historyIndex;
    const bubble=document.createElement('div'); bubble.className='bubble';
    const ts=document.createElement('div'); ts.className='msg-timestamp';
    ts.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});

    if (role==='assistant') {
        bubble.classList.add('markdown');
        const p=separateThought(typeof content==='string'?content:'');
        let html='';
        if (p.thought){const s=p.thought.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');html+=`<details class="thought-block"><summary>Thought</summary><div class="thought-content">${s}</div></details>`;}
        if (p.response) html+=renderMarkdown(p.response);
        bubble.innerHTML=DOMPurify.sanitize(html,{ADD_TAGS:['details','summary'],ADD_ATTR:['data-raw']});
        attachCodeCopyButtons(bubble);
        const copy=document.createElement('div'); copy.className='copy-btn'; copy.title='Copy';
        copy.innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        copy.addEventListener('click',()=>copyToClipboard((p.response||content||'').toString().trim(),copy));
        wrapper.appendChild(copy);
        if (stats?.tokens>0){const b=document.createElement('div');b.className='msg-stats';b.textContent=`${stats.tokens} tokens${stats.tokens_per_sec>0?` · ${stats.tokens_per_sec} tok/s`:''}`;wrapper.appendChild(b);}
        if (showRegen){const rb=document.createElement('div');rb.className='regenerate-btn';rb.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg> Regenerate`;rb.addEventListener('click',()=>regenerate());wrapper.appendChild(rb);}
    } else {
        if (Array.isArray(content)){
            content.forEach(part=>{
                if (part.type==='text'){const p=document.createElement('p');p.style.margin='0 0 6px';p.textContent=part.text;bubble.appendChild(p);}
                else if (part.type==='image_url'){const img=document.createElement('img');img.src=part.image_url.url;img.className='msg-image';bubble.appendChild(img);}
            });
        } else { bubble.textContent=content; }
        if (historyIndex!==null){
            const eb=document.createElement('button'); eb.className='edit-msg-btn'; eb.title='Edit';
            eb.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
            eb.addEventListener('click',()=>startEditMessage(wrapper,historyIndex));
            wrapper.appendChild(eb);
        }
    }
    wrapper.appendChild(bubble); wrapper.appendChild(ts);
    chatContainer.appendChild(wrapper);
    chatContainer.scrollTop=chatContainer.scrollHeight; updateScrollBtn(); updateTokenCounter();
}

// ─────────────────────────────────────────────────
// Send + stream
// ─────────────────────────────────────────────────
async function sendMessage() {
    const message=messageInput.value.trim();
    const model=modelSelect.value;
    if (isStreaming||(!message&&!pendingImages.length)) return;
    if (!model){showToast('No model selected — is LM Studio running?',true);return;}
    if (!currentChatId){ const id=await createNewChat(); if (!id) return; }

    const imgs=[...pendingImages]; pendingImages=[];
    const files=[...pendingFiles]; pendingFiles=[];
    renderAttachPreviews();

    // Build context block from attached text files
    let fileContext = '';
    if (files.length) {
        fileContext = files.map(f => {
            const fence = f.lang ? ('```' + f.lang) : '```';
            return '### ' + f.name + '\n' + fence + '\n' + f.content + '\n```';
        }).join('\n\n');
    }

    // Full message sent to model = file context + user text
    const fullMessage = fileContext ? (fileContext + (message ? '\n\n' + message : '')) : message;

    const histIndex=chatContainer.querySelectorAll('.message').length;
    // UI shows only what the user typed (+ image thumbs), not the raw file dump
    addMessageToUI('user',
        imgs.length
            ? [{type:'text',text:message||' '},...imgs.map(i=>({type:'image_url',image_url:{url:i.dataUri}}))]
            : message || (files.length ? `📎 ${files.map(f=>f.name).join(', ')}` : ''),
        null, false, histIndex);
    messageInput.value=''; messageInput.style.height='auto'; lastUserMessage=fullMessage;
   
    doStreamRequest(fullMessage, false, imgs.map(i=>i.dataUri));
}

function doStreamRequest(message, isRegenerate=false, images=[]) {
    if (!socket?.connected){showToast('WebSocket not connected.',true);return;}
    const isFirst=chatContainer.querySelectorAll('.message.user').length===1&&!isRegenerate;
    pendingStreamMeta={isFirst, isRegenerate, images};
    setStreamingState(true);
    beginStreamUI();
    socket.emit('start_stream',{
        message, model:modelSelect.value,
        chat_id:currentChatId,
        temperature:modelSettings.temperature,
        max_tokens:modelSettings.maxTokens,
        regenerate:isRegenerate,
        images,
        use_web_tools: webToolsEnabled,
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

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE ADDITIONS
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────
// 1. Remember last opened chat
// ─────────────────────────────────────────────────
const LAST_CHAT_KEY = 'wilburt_last_chat';

function rememberChat(chatId) {
    if (chatId) localStorage.setItem(LAST_CHAT_KEY, chatId);
    else        localStorage.removeItem(LAST_CHAT_KEY);
}

async function restoreLastChat() {
    const lastId = localStorage.getItem(LAST_CHAT_KEY);
    if (!lastId) return false;
    // Confirm the chat still exists in allChats
    const exists = allChats.some(c => c.id === lastId);
    if (!exists) { localStorage.removeItem(LAST_CHAT_KEY); return false; }
    await loadChat(lastId);
    return true;
}

// ─────────────────────────────────────────────────
// 2. Message timestamps with date
// ─────────────────────────────────────────────────
function formatTimestamp(date) {
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay= new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffMs= today - msgDay;
    const diffDays = Math.round(diffMs / 86400000);

    const timeStr = date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

    if (diffDays === 0) return timeStr;                                        // Today: time only
    if (diffDays === 1) return `Yesterday ${timeStr}`;                         // Yesterday
    if (diffDays < 7)  return `${date.toLocaleDateString([],{weekday:'short'})} ${timeStr}`; // Mon 14:32
    return `${date.toLocaleDateString([],{month:'short',day:'numeric'})} ${timeStr}`;        // Mar 3 14:32
}

// ─────────────────────────────────────────────────
// 3. Smooth send animation
// ─────────────────────────────────────────────────
function animateNewBubble(wrapper) {
    wrapper.classList.add('msg-enter');
    wrapper.addEventListener('animationend', () => wrapper.classList.remove('msg-enter'), {once: true});
}

// ─────────────────────────────────────────────────
// 4. Auto-scroll lock (improved)
// ─────────────────────────────────────────────────
const SCROLL_THRESHOLD = 60;   // px from bottom = "pinned"
let userScrolledUp = false;

function isNearBottom() {
    const dist = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
    return dist < SCROLL_THRESHOLD;
}

function onChatScroll() {
    if (isNearBottom()) {
        userScrolledUp = false;
    } else {
        // Only set scrolled-up if we're actively streaming
        if (isStreaming) userScrolledUp = true;
    }
    updateScrollBtn();
}

function smartScroll() {
    if (!userScrolledUp) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

// ─────────────────────────────────────────────────
// 5. In-chat search
// ─────────────────────────────────────────────────
const inChatSearchBtn   = document.getElementById('inChatSearchBtn');
const inChatSearchBar   = document.getElementById('inChatSearchBar');
const inChatSearchInput = document.getElementById('inChatSearchInput');
const inChatSearchCount = document.getElementById('inChatSearchCount');
const inChatSearchPrev  = document.getElementById('inChatSearchPrev');
const inChatSearchNext  = document.getElementById('inChatSearchNext');
const inChatSearchClose = document.getElementById('inChatSearchClose');

let searchMatches = [];
let searchIndex   = 0;

function openInChatSearch() {
    if (!currentChatId) return;
    inChatSearchBar.style.display = 'flex';
    inChatSearchInput.focus();
    inChatSearchInput.select();
}
function closeInChatSearch() {
    inChatSearchBar.style.display = 'none';
    clearSearchHighlights();
    searchMatches = []; searchIndex = 0;
    inChatSearchCount.textContent = '';
    inChatSearchInput.value = '';
}

inChatSearchBtn.addEventListener('click',  openInChatSearch);
inChatSearchClose.addEventListener('click', closeInChatSearch);
inChatSearchPrev.addEventListener('click',  () => navigateSearch(-1));
inChatSearchNext.addEventListener('click',  () => navigateSearch(1));

inChatSearchInput.addEventListener('input', () => {
    runSearch(inChatSearchInput.value.trim());
});
inChatSearchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); navigateSearch(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') closeInChatSearch();
});

document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && currentChatId) {
        e.preventDefault(); openInChatSearch();
    }
    if (e.key === 'Escape' && inChatSearchBar.style.display !== 'none') {
        closeInChatSearch();
    }
    // Ctrl+Shift+N = new chat
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
        e.preventDefault(); createNewChat();
    }
    // Ctrl+K = focus sidebar search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault(); chatSearch.focus(); chatSearch.select();
    }
});

function clearSearchHighlights() {
    chatContainer.querySelectorAll('mark.search-hl').forEach(m => {
        m.replaceWith(document.createTextNode(m.textContent));
    });
    // Merge adjacent text nodes
    chatContainer.querySelectorAll('.bubble').forEach(b => b.normalize());
}

function runSearch(query) {
    clearSearchHighlights();
    searchMatches = []; searchIndex = 0;
    if (!query || query.length < 2) { inChatSearchCount.textContent = ''; return; }

    const bubbles = Array.from(chatContainer.querySelectorAll('.bubble'));
    const regex   = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

    bubbles.forEach(bubble => {
        highlightInNode(bubble, regex);
    });

    searchMatches = Array.from(chatContainer.querySelectorAll('mark.search-hl'));
    inChatSearchCount.textContent = searchMatches.length
        ? `1 / ${searchMatches.length}`
        : 'No results';

    if (searchMatches.length) {
        searchIndex = 0;
        activateMatch(0);
    }
}

function highlightInNode(node, regex) {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (!regex.test(text)) { regex.lastIndex = 0; return; }
        regex.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0, m;
        while ((m = regex.exec(text)) !== null) {
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            const mark = document.createElement('mark');
            mark.className = 'search-hl';
            mark.textContent = m[0];
            frag.appendChild(mark);
            last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
        return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
        // Don't descend into code blocks — too noisy
        if (node.tagName === 'CODE' || node.tagName === 'PRE') return;
        Array.from(node.childNodes).forEach(child => highlightInNode(child, regex));
    }
}

function activateMatch(idx) {
    searchMatches.forEach(m => m.classList.remove('search-hl-active'));
    if (!searchMatches.length) return;
    const m = searchMatches[idx];
    m.classList.add('search-hl-active');
    m.scrollIntoView({block:'center', behavior:'smooth'});
    inChatSearchCount.textContent = `${idx + 1} / ${searchMatches.length}`;
}

function navigateSearch(dir) {
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + dir + searchMatches.length) % searchMatches.length;
    activateMatch(searchIndex);
}

// ─────────────────────────────────────────────────
// 6. WebSocket reconnect handler
// ─────────────────────────────────────────────────
function patchSocketReconnect() {
    socket.on('disconnect', reason => {
        console.warn('Socket disconnected:', reason);
        if (isStreaming) {
            // Clean up the orphaned streaming bubble
            if (activeStreamingBubble) {
                activeStreamingBubble.innerHTML =
                    '<span style="color:var(--text3);font-style:italic">Connection lost mid-stream. Reconnecting…</span>';
            }
            setStreamingState(false);
            activeStreamingWrapper = null;
            activeStreamingBubble  = null;
            streamBuffer           = '';
        }
    });

    socket.on('reconnect', attemptNumber => {
        console.log(`Socket reconnected after ${attemptNumber} attempt(s)`);
        showToast('Reconnected ✓');
    });

    socket.on('reconnect_attempt', attempt => {
        if (attempt === 1) showToast('Connection lost — reconnecting…', true);
    });

    socket.on('reconnect_failed', () => {
        showToast('Could not reconnect to server. Please refresh.', true);
    });
}

// ─────────────────────────────────────────────────
// 7. Admin link visibility
// ─────────────────────────────────────────────────
async function checkAdminStatus() {
    try {
        const r = await fetch('/admin/api/users');
        if (r.ok) {
            document.getElementById('adminLink').style.display = 'block';
        }
    } catch {}
}

// ═════════════════════════════════════════════════════════════════════════════
// PATCH existing functions
// ═════════════════════════════════════════════════════════════════════════════

// Override loadChat to remember it
const _origLoadChat = loadChat;
loadChat = async function(chatId) {
    await _origLoadChat(chatId);
    rememberChat(chatId);
};

// Override addMessageToUI to use new timestamp + animation
const _origAddMsg = addMessageToUI;
addMessageToUI = function(role, content, stats, showRegen, historyIndex) {
    _origAddMsg(role, content, stats, showRegen, historyIndex);
    // Update the timestamp on the last message with smart date formatting
    const allMsgs = chatContainer.querySelectorAll('.message');
    const last = allMsgs[allMsgs.length - 1];
    if (last) {
        const ts = last.querySelector('.msg-timestamp');
        if (ts) ts.textContent = formatTimestamp(new Date());
        // Only animate user messages (the "send" animation)
        if (role === 'user') animateNewBubble(last);
    }
};

// Override chatContainer scroll listener to use improved version
chatContainer.addEventListener('scroll', onChatScroll);

// Override scrollIfNeeded to use improved version
scrollIfNeeded = smartScroll;

// Override initSocket to also set up reconnect handlers
const _origInitSocket = initSocket;
initSocket = function() {
    _origInitSocket();
    patchSocketReconnect();
};

// Override DOMContentLoaded setup to add last-chat restore + admin check
const _origDCL = document.addEventListener.bind(document);
// We hook into the existing DOMContentLoaded by appending to loadChats
const _origLoadChats = loadChats;
loadChats = async function() {
    await _origLoadChats();
    // After chats are loaded, try to restore last chat (only on first call)
    if (!currentChatId) {
        const restored = await restoreLastChat();
        if (!restored) showEmptyState();
    }
    await checkAdminStatus();
};

// Re-wire scrollToBottomBtn to reset userScrolledUp
scrollToBottomBtn.addEventListener('click', () => {
    userScrolledUp = false;
    chatContainer.scrollTo({top: chatContainer.scrollHeight, behavior: 'smooth'});
});

// ═══════════════════════════════════════════════════════════════════════════
// BATCH 3 — New features & fixes
// ═══════════════════════════════════════════════════════════════════════════

// ─── DOM refs (new elements) ────────────────────────────────────────────────
const actionBtn          = document.getElementById('actionBtn');
const attachMenuEl       = document.getElementById('attachMenu');
const attachFilesBtn     = document.getElementById('attachFilesBtn');
const attachFolderBtn    = document.getElementById('attachFolderBtn');
const folderFileInput    = document.getElementById('folderFileInput');
const chatSkeleton       = document.getElementById('chatSkeleton');
const settingsPopover    = document.getElementById('settingsPopover');
const uploadProgressWrap = document.getElementById('uploadProgressWrap');
const uploadProgressBar  = document.getElementById('uploadProgressBar');
const uploadProgressLbl  = document.getElementById('uploadProgressLabel');
const mobileNavChats     = document.getElementById('mobileNavChats');
const mobileNavNew       = document.getElementById('mobileNavNew');
const mobileNavSearch    = document.getElementById('mobileNavSearch');

// ─── Auto dark/light mode detection ────────────────────────────────────────
(function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) { applyTheme(saved); return; }
    // No saved pref — follow OS
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
    // Listen for OS changes when no user pref is set
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? 'dark' : 'light');
    });
    // Once user manually toggles, that overrides OS detection
})();

// ─── Morphing action button (replaces sendBtn + stopBtn) ────────────────────
function setActionBtn(mode) {
    // mode: 'send' | 'stop'
    actionBtn.className = mode === 'stop' ? 'action-stop' : 'action-send';
    actionBtn.title     = mode === 'stop' ? 'Stop generating' : 'Send message';
}

actionBtn.addEventListener('click', () => {
    if (actionBtn.classList.contains('action-stop')) {
        stopStream();
    } else {
        sendMessage();
    }
});

// Patch setStreamingState to drive action button instead of old send/stop btns
const _origSetStreaming = setStreamingState;
setStreamingState = function(on) {
    isStreaming = on;
    setActionBtn(on ? 'stop' : 'send');
    updateSendBtnState();
};
// updateSendBtnState still references sendBtn — patch to use actionBtn
const _origUpdateSend = updateSendBtnState;
updateSendBtnState = function() {
    const empty = (!messageInput.value.trim() && !pendingImages.length && !pendingFiles.length);
    actionBtn.classList.toggle('disabled', empty && !isStreaming);
};

// ─── Settings popover — gear button removed, inputs kept hidden in DOM ───────
// Elements still exist (hidden) so all localStorage / API references work fine.

// ─── Attach menu (files vs folder) ─────────────────────────────────────────
attachBtn.addEventListener('click', e => {
    e.stopPropagation();
    attachMenuEl.classList.toggle('hidden');
});
document.addEventListener('click', () => attachMenuEl.classList.add('hidden'));
attachFilesBtn.addEventListener('click', () => { attachMenuEl.classList.add('hidden'); attachFileInput.click(); });
attachFolderBtn.addEventListener('click', () => { attachMenuEl.classList.add('hidden'); folderFileInput.click(); });
folderFileInput.addEventListener('change', () => {
    const files = Array.from(folderFileInput.files);
    if (!files.length) return;
    showUploadProgress(0, files.length);
    let done = 0;
    files.forEach(f => {
        dispatchFile(f);
        done++;
        showUploadProgress(done, files.length);
    });
    setTimeout(hideUploadProgress, 800);
    folderFileInput.value = '';
});

// ─── Upload progress bar ────────────────────────────────────────────────────
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

// Patch addImageFile and addTextFile to show progress for single files
const _origAddImageFile = addImageFile;
addImageFile = function(file) {
    showUploadProgress(0, 1);
    const reader = new FileReader();
    reader.addEventListener('progress', e => {
        if (e.lengthComputable) showUploadProgress(e.loaded, e.total);
    });
    reader.onload = e => {
        pendingImages.push({dataUri: e.target.result, name: file.name});
        renderAttachPreviews(); updateSendBtnState();
        hideUploadProgress();
    };
    reader.readAsDataURL(file);
};

const _origAddTextFile = addTextFile;
addTextFile = function(file) {
    showUploadProgress(0, 1);
    const reader = new FileReader();
    reader.addEventListener('progress', e => {
        if (e.lengthComputable) showUploadProgress(e.loaded, e.total);
    });
    reader.onload = e => {
        const content = e.target.result;
        if (content.length > 120000) {
            showToast(`"${file.name}" is too large (max ~120 KB)`, true);
            hideUploadProgress(); return;
        }
        pendingFiles.push({name: file.name, content, lang: langHint(file.name)});
        renderAttachPreviews(); updateSendBtnState();
        hideUploadProgress();
    };
    reader.readAsText(file);
};

// ─── Pin chats ──────────────────────────────────────────────────────────────
async function togglePinChat(chatId, e) {
    e.stopPropagation();
    const r = await fetch(`/chats/api/chats/${chatId}/pin`, {method: 'POST'});
    if (!r.ok) { showToast('Failed to pin/unpin chat', true); return; }
    const d = await r.json();
    // Update allChats cache
    const c = allChats.find(c => c.id === chatId);
    if (c) c.pinned = d.pinned;
    renderChatList(allChats, chatSearch.value.trim().toLowerCase());
    highlightActiveChat();
}

// Patch makeChatItem to add pin button and pinned indicator
const _origMakeChatItem = makeChatItem;
makeChatItem = function(chat) {
    const el = _origMakeChatItem(chat);
    if (chat.pinned) el.classList.add('pinned');

    // Pin button
    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin-chat-btn' + (chat.pinned ? ' pinned' : '');
    pinBtn.title = chat.pinned ? 'Unpin chat' : 'Pin chat';
    pinBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="${chat.pinned ? 'currentColor' : 'none'}"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/></svg>`;
    pinBtn.addEventListener('click', e => togglePinChat(chat.id, e));
    el.querySelector('.chat-actions').insertBefore(pinBtn, el.querySelector('.delete-chat-btn'));
    return el;
};

// ─── Regenerate button on last assistant message after refresh ───────────────
// Patch loadChat to flag the last assistant message
const _origLoadChatRegen = loadChat;
loadChat = async function(chatId) {
    await _origLoadChatRegen(chatId);
    // Add regenerate button to last assistant message
    const msgs = Array.from(chatContainer.querySelectorAll('.message.assistant'));
    if (msgs.length) {
        const lastAI = msgs[msgs.length - 1];
        if (!lastAI.querySelector('.regenerate-btn')) {
            const regenBtn = document.createElement('div');
            regenBtn.className = 'regenerate-btn';
            regenBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg> Regenerate`;
            regenBtn.addEventListener('click', () => regenerate());
            lastAI.appendChild(regenBtn);
        }
    }
};

// ─── Loading skeleton on chat open ──────────────────────────────────────────
const _origLoadChatSkeleton = loadChat;
loadChat = async function(chatId) {
    emptyState.style.display    = 'none';
    chatContainer.style.display = 'none';
    chatSkeleton.style.display  = 'block';
    await _origLoadChatSkeleton(chatId);
    chatSkeleton.style.display  = 'none';
};

// ─── Topbar title update when auto-title fires ───────────────────────────────
const _origAutoTitle = triggerAutoTitle;
triggerAutoTitle = async function(chatId) {
    await _origAutoTitle(chatId);
    // topbarTitle already patched in the existing override, but ensure it updates
    const c = allChats.find(c => c.id === chatId);
    if (c && c.title) {
        topbarTitle.textContent = c.title;
        document.title = `${c.title} — WilburtAI`;
    }
};

// ─── Page title with chat name ───────────────────────────────────────────────
const _origLoadChatTitle = loadChat;
loadChat = async function(chatId) {
    await _origLoadChatTitle(chatId);
    const c = allChats.find(c => c.id === chatId);
    if (c) document.title = `${c.title} — WilburtAI`;
};

const _origShowEmpty = showEmptyState;
showEmptyState = function() {
    _origShowEmpty();
    document.title = 'WilburtAI';
};

// ─── Auto-focus message input after response finishes ───────────────────────
const _origFinalizeStream = finalizeStream;
finalizeStream = function(stats, toolCalls, pruned) {
    _origFinalizeStream(stats, toolCalls, pruned);
    // Focus input (skip on mobile to avoid popping keyboard unexpectedly)
    if (!isMobile()) messageInput.focus();
};

// ─── Stop saves partial response ────────────────────────────────────────────
const _origStopStream = stopStream;
stopStream = function() {
    const partial = streamBuffer.trim();
    _origStopStream();
    if (partial && currentChatId) {
        fetch(`/api/chats/${currentChatId}/save-partial`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({content: partial}),
        }).then(() => loadChats()).catch(() => {});
    }
};

// ─── Completion sound (Web Audio API — no external files) ───────────────────
let soundEnabled = localStorage.getItem('wilburt_sound') !== 'false';

function playCompletionChime() {
    if (!soundEnabled) return;
    try {
        const ctx  = new (window.AudioContext || window.webkitAudioContext)();
        const t    = ctx.currentTime;
        // Two-note pleasant chime: E5 then G#5
        [[659.25, t, 0.08], [830.61, t + 0.12, 0.06]].forEach(([freq, when, dur]) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type      = 'sine';
            osc.frequency.setValueAtTime(freq, when);
            gain.gain.setValueAtTime(0, when);
            gain.gain.linearRampToValueAtTime(0.18, when + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, when + dur + 0.3);
            osc.start(when); osc.stop(when + dur + 0.35);
        });
        setTimeout(() => ctx.close(), 1000);
    } catch {}
}

// Patch finalizeStream to play chime
const _origFinalizeChime = finalizeStream;
finalizeStream = function(stats, toolCalls, pruned) {
    _origFinalizeChime(stats, toolCalls, pruned);
    playCompletionChime();
};

// ─── Typing speed indicator ─────────────────────────────────────────────────
let streamTokenTimes = [];
function recordTokenTime() {
    const now = Date.now();
    streamTokenTimes.push(now);
    // Keep last 10 timestamps
    if (streamTokenTimes.length > 10) streamTokenTimes.shift();
    if (streamTokenTimes.length < 2) return;
    const elapsed = (streamTokenTimes[streamTokenTimes.length-1] - streamTokenTimes[0]) / 1000;
    const tps = (streamTokenTimes.length - 1) / elapsed;
    // Map tps to animation duration: fast (>10 tok/s) → 0.5s, slow (<1 tok/s) → 2s
    const dur = Math.max(0.4, Math.min(2.0, 2.0 - (tps / 10) * 1.6));
    if (activeStreamingBubble) {
        const th = activeStreamingBubble.querySelector('.thinking');
        if (th) th.style.animationDuration = dur + 's';
    }
}

// Patch socket stream_token handler to record timing
const _origSocketInit = initSocket;
initSocket = function() {
    _origSocketInit();
    // Wrap stream_token to also record timing
    socket.on('stream_token', () => recordTokenTime());
};

// Reset on new stream
const _origBeginStream = beginStreamUI;
beginStreamUI = function() {
    streamTokenTimes = [];
    _origBeginStream();
};


// ═══════════════════════════════════════════════════════════════════════════
// BATCH 4 — Memory, FTS search, WS heartbeat, UI polish
// ═══════════════════════════════════════════════════════════════════════════

// ─── DOM refs ────────────────────────────────────────────────────────────────
const connStatusDot      = document.getElementById('connStatus');
const memoryToggle       = document.getElementById('memoryToggle');
const memoryBody         = document.getElementById('memoryBody')?.querySelector('.section-body') ||
                           document.querySelector('#memorySection .section-body');
const memoryTextarea     = document.getElementById('memoryTextarea');
const memorySaveBtn      = document.getElementById('memorySaveBtn');
const searchResultsPanel = document.getElementById('searchResultsPanel');

// ─── 1. Connection status indicator ─────────────────────────────────────────
function setConnStatus(state) {
    // state: 'connected' | 'disconnected' | 'reconnecting'
    if (!connStatusDot) return;
    connStatusDot.className = state === 'connected' ? '' :
                              state === 'reconnecting' ? 'reconnecting' : 'disconnected';
    connStatusDot.title = state === 'connected'    ? 'Connected' :
                          state === 'reconnecting' ? 'Reconnecting…' : 'Disconnected';
}

// Patch patchSocketReconnect to also update the dot
const _origPatchReconnect = patchSocketReconnect;
patchSocketReconnect = function() {
    _origPatchReconnect();
    socket.on('connect',            () => setConnStatus('connected'));
    socket.on('disconnect',         () => setConnStatus('disconnected'));
    socket.on('reconnect',          () => setConnStatus('connected'));
    socket.on('reconnect_attempt',  () => setConnStatus('reconnecting'));
    socket.on('reconnect_failed',   () => setConnStatus('disconnected'));
};

// ─── 2. WebSocket heartbeat (keeps connection alive through idle) ─────────────
let heartbeatInterval = null;
function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
        if (socket && socket.connected) {
            socket.emit('ping_heartbeat');
        }
    }, 25000); // every 25s
}
function stopHeartbeat() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

// Start heartbeat after socket init
const _origInitSocketB4 = initSocket;
initSocket = function() {
    _origInitSocketB4();
    socket.on('connect', startHeartbeat);
    socket.on('disconnect', stopHeartbeat);
};

// ─── 3. Persistent user memory ──────────────────────────────────────────────
async function loadMemory() {
    if (!memoryTextarea) return;
    try {
        const r = await fetch('/api/memory');
        const d = await r.json();
        memoryTextarea.value = d.content || '';
    } catch {}
}

if (memorySaveBtn) {
    memorySaveBtn.addEventListener('click', async () => {
        const content = memoryTextarea.value.trim();
        const r = await fetch('/api/memory', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({content}),
        });
        if (r.ok) showToast('Memory saved ✓');
        else      showToast('Failed to save memory', true);
    });
}

// Memory panel collapse toggle
if (memoryToggle) {
    const bodyEl = document.querySelector('#memorySection .section-body');
    let collapsed = localStorage.getItem('wilburt_memory_collapsed') === '1';
    if (collapsed && bodyEl) bodyEl.classList.add('collapsed');
    if (collapsed) document.getElementById('memorySection')?.classList.add('section-collapsed');

    memoryToggle.addEventListener('click', () => {
        collapsed = !collapsed;
        localStorage.setItem('wilburt_memory_collapsed', collapsed ? '1' : '0');
        bodyEl?.classList.toggle('collapsed', collapsed);
        document.getElementById('memorySection')?.classList.toggle('section-collapsed', collapsed);
    });
}

// ─── 4. Full-text search across all chats ───────────────────────────────────
let ftsDebounce = null;
let isShowingFTS = false;

function showFTSResults(results) {
    if (!searchResultsPanel) return;
    if (!results || results.length === 0) {
        searchResultsPanel.innerHTML = '<div class="search-no-results">No messages found</div>';
        searchResultsPanel.classList.remove('hidden');
        return;
    }
    searchResultsPanel.innerHTML = results.map(r => `
        <div class="search-result-item" data-chat-id="${r.chat_id}">
            <div class="search-result-title">${escapeHtml(r.title)}</div>
            <div class="search-result-snippet">${r.snippet}</div>
        </div>
    `).join('');
    searchResultsPanel.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', () => {
            loadChat(el.dataset.chatId);
            hideFTSResults();
            chatSearch.value = '';
        });
    });
    searchResultsPanel.classList.remove('hidden');
    isShowingFTS = true;
}

function hideFTSResults() {
    if (searchResultsPanel) searchResultsPanel.classList.add('hidden');
    isShowingFTS = false;
}

function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Patch chatSearch input to do FTS when query is long enough
const _origChatSearchInput = chatSearch.oninput;
chatSearch.addEventListener('input', () => {
    const q = chatSearch.value.trim();

    if (q.length < 2) {
        hideFTSResults();
        clearTimeout(ftsDebounce);
        return;
    }

    // Short queries: filter by title (existing behaviour)
    // Longer queries or if user types Enter: also search FTS
    clearTimeout(ftsDebounce);
    ftsDebounce = setTimeout(async () => {
        if (chatSearch.value.trim().length < 2) return;
        try {
            const r = await fetch(`/chats/api/search?q=${encodeURIComponent(chatSearch.value.trim())}`);
            const d = await r.json();
            if (d.results && d.results.length > 0) {
                showFTSResults(d.results);
            } else {
                hideFTSResults();
            }
        } catch {}
    }, 400);
});

// Close FTS panel on outside click
document.addEventListener('click', e => {
    if (searchResultsPanel && !searchResultsPanel.contains(e.target) && e.target !== chatSearch) {
        hideFTSResults();
    }
});

// Escape closes FTS
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isShowingFTS) { hideFTSResults(); chatSearch.value = ''; }
});

// Rebuild FTS index after each completed stream
const _origFinalizeB4 = finalizeStream;
finalizeStream = function(stats, toolCalls, pruned) {
    _origFinalizeB4(stats, toolCalls, pruned);
    // Async index rebuild — fire and forget
    fetch('/chats/api/fts-index', {method: 'POST'}).catch(() => {});
};

// ─── 5. Fix: rebuild FTS on page load ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    fetch('/chats/api/fts-index', {method: 'POST'}).catch(() => {});
    loadMemory();
    setConnStatus('connected');

});

// ═══════════════════════════════════════════════════════════════════════════
// ANIMATIONS — Send/Receive effects & micro-interactions
// ═══════════════════════════════════════════════════════════════════════════

// ── Send button ripple + input "launch" effect ────────────────────────────
const _actionBtn = document.getElementById('actionBtn');
if (_actionBtn) {
    _actionBtn.addEventListener('click', () => {
        // Ripple burst on the button
        _actionBtn.classList.add('btn-sending');
        setTimeout(() => _actionBtn.classList.remove('btn-sending'), 400);
    });
}

// Patch doStreamRequest to animate the input clearing
const _origDoStream = doStreamRequest;
doStreamRequest = function(message, isRegenerate=false, images=[]) {
    // Flash the input wrapper on send
    const iw = document.getElementById('inputWrapper');
    if (iw && !isRegenerate) {
        iw.classList.add('input-sent');
        setTimeout(() => iw.classList.remove('input-sent'), 350);
    }
    _origDoStream(message, isRegenerate, images);
};

// ── Response "materialise" — bubble fades up token by token ──────────────
// Patch beginStreamUI to add the streaming-entrance class
const _origBeginUI = beginStreamUI;
beginStreamUI = function() {
    _origBeginUI();
    if (activeStreamingWrapper) {
        activeStreamingWrapper.classList.add('stream-entering');
    }
};

// Patch finalizeStream to add completion animation
const _origFinalizeAnims = finalizeStream;
finalizeStream = function(stats, toolCalls, pruned) {
    const wrapper = activeStreamingWrapper;
    _origFinalizeAnims(stats, toolCalls, pruned);
    // Find the wrapper that just got finalized (activeStreamingWrapper is now null)
    const last = chatContainer.querySelector('.message.assistant:last-of-type');
    if (last) {
        last.classList.remove('stream-entering');
        last.classList.add('stream-complete');
        setTimeout(() => last.classList.remove('stream-complete'), 600);
    }
};

// ── Thinking dots animation ───────────────────────────────────────────────
// Replace static "Thinking…" with animated dots
const _origBeginUIThink = beginStreamUI;
beginStreamUI = function() {
    _origBeginUIThink();
    if (activeStreamingBubble) {
        activeStreamingBubble.innerHTML =
            '<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>';
    }
};
