// app/static/script.js - WilburtAI Micro Server Frontend Logic
let currentChatId = null;
let lastUserMessage = "";

// DOM Elements
const chatContainer = document.getElementById('chatContainer');
const messageInput  = document.getElementById('messageInput');
const modelSelect   = document.getElementById('modelSelect');
const sendBtn       = document.getElementById('sendBtn');
const newChatBtn    = document.getElementById('newChatBtn');
const chatList      = document.getElementById('chatList');

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------
marked.setOptions({ gfm: true, breaks: true });

function renderMarkdown(text) {
    return DOMPurify.sanitize(marked.parse(text));
}

// ---------------------------------------------------------------------------
// Clipboard helper
// navigator.clipboard requires HTTPS or localhost. If the app is accessed over
// a local network IP the browser silently refuses it, so we fall back to the
// older execCommand approach and give the user visual feedback either way.
// ---------------------------------------------------------------------------
function copyToClipboard(text, btn) {
    const succeed = () => {
        const original = btn.innerHTML;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => { btn.innerHTML = original; }, 1500);
    };
    const fail = () => console.error('Copy failed');

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(succeed).catch(() => execCopy(text, succeed, fail));
    } else {
        execCopy(text, succeed, fail);
    }
}

function execCopy(text, onSuccess, onFail) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
        document.execCommand('copy') ? onSuccess() : onFail();
    } catch {
        onFail();
    }
    document.body.removeChild(ta);
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadModels();
        await loadChats();
        sendBtn.addEventListener('click', sendMessage);
        newChatBtn.addEventListener('click', createNewChat);
    } catch (error) {
        console.error('Failed to initialize:', error);
    }
});

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------
async function loadModels() {
    try {
        const response = await fetch('/api/models');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        modelSelect.innerHTML = '';
        data.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            modelSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Failed to load models:', error);
        showSystemMessage('Error: Could not load models from LM Studio. Is it running?');
    }
}

// ---------------------------------------------------------------------------
// Chat list
// ---------------------------------------------------------------------------
async function loadChats() {
    try {
        const response = await fetch('/chats/api/chats');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const chats = await response.json();

        chatList.innerHTML = '';

        chats.forEach(chat => {
            const chatElement = document.createElement('div');
            chatElement.className = 'chat-item';
            chatElement.dataset.chatId = chat.id;

            const titleEl = document.createElement('div');
            titleEl.className = 'chat-title';
            titleEl.textContent = chat.title;

            const previewEl = document.createElement('div');
            previewEl.className = 'chat-preview';
            previewEl.textContent = chat.preview || '';

            // Delete button — only visible on hover via CSS
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-chat-btn';
            deleteBtn.title = 'Delete chat';
            deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                <path d="M10 11v6M14 11v6"></path>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;
            deleteBtn.addEventListener('click', (e) => {
                // Stop the click from also loading the chat
                e.stopPropagation();
                deleteChat(chat.id);
            });

            chatElement.appendChild(titleEl);
            chatElement.appendChild(previewEl);
            chatElement.appendChild(deleteBtn);
            chatElement.addEventListener('click', () => loadChat(chat.id));
            chatList.appendChild(chatElement);
        });
    } catch (error) {
        console.error('Failed to load chats:', error);
    }
}

async function deleteChat(chatId) {
    if (!confirm('Delete this chat? This cannot be undone.')) return;

    try {
        const response = await fetch(`/chats/api/chats/${chatId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        // If the deleted chat was open, clear the main panel
        if (currentChatId === chatId) {
            currentChatId = null;
            chatContainer.innerHTML = '';
        }

        await loadChats();
    } catch (error) {
        console.error('Failed to delete chat:', error);
    }
}

async function createNewChat() {
    try {
        const response = await fetch('/chats/api/chats', { method: 'POST' });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        currentChatId = data.chat_id;
        chatContainer.innerHTML = '';
        await loadChats();

        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.toggle('active', item.dataset.chatId === currentChatId);
        });

        if (!modelSelect.value) modelSelect.selectedIndex = 0;
    } catch (error) {
        console.error('Failed to create new chat:', error);
    }
}

async function loadChat(chatId) {
    try {
        const response = await fetch(`/chats/api/chats/${chatId}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        currentChatId = chatId;
        chatContainer.innerHTML = '';

        if (data.history && data.history.length > 0) {
            data.history.forEach(msg => addMessageToUI(msg.role, msg.content));
        }

        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.toggle('active', item.dataset.chatId === chatId);
        });
    } catch (error) {
        console.error('Failed to load chat:', error);
    }
}

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------
function addMessageToUI(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'bubble';

    if (role === 'assistant') {
        bubbleDiv.classList.add('markdown');
        bubbleDiv.innerHTML = renderMarkdown(content);

        const copyBtn = document.createElement('div');
        copyBtn.className = 'copy-btn';
        copyBtn.title = 'Copy to clipboard';
        copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        copyBtn.addEventListener('click', () => copyToClipboard(content.trim(), copyBtn));
        messageDiv.appendChild(copyBtn);
    } else {
        bubbleDiv.textContent = content;
    }

    messageDiv.appendChild(bubbleDiv);
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function showSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message assistant';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.style.color = '#f87171';
    bubble.textContent = text;
    div.appendChild(bubble);
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ---------------------------------------------------------------------------
// Sending messages & streaming
// ---------------------------------------------------------------------------
async function sendMessage() {
    const message = messageInput.value.trim();
    const model   = modelSelect.value;

    if (!currentChatId) {
        showSystemMessage('Please create a new chat first using the "+ New Chat" button.');
        return;
    }
    if (!message) return;
    if (!model) {
        showSystemMessage('No model selected. Is LM Studio running with a model loaded?');
        return;
    }

    addMessageToUI('user', message);
    messageInput.value = '';
    lastUserMessage = message;

    const streamingWrapper = document.createElement('div');
    streamingWrapper.className = 'message assistant';

    const streamingBubble = document.createElement('div');
    streamingBubble.className = 'bubble markdown thinking';
    streamingBubble.textContent = 'Thinking\u2026';

    streamingWrapper.appendChild(streamingBubble);
    chatContainer.appendChild(streamingWrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    let fullResponse = '';
    let streamStarted = false;

    try {
        const response = await fetch('/api/chat_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, model, chat_id: currentChatId })
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();

        outer: while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            for (const line of decoder.decode(value).split('\n')) {
                if (!line.startsWith('data: ')) continue;

                let parsed;
                try { parsed = JSON.parse(line.substring(6)); }
                catch { continue; }

                if (parsed.error) {
                    streamingBubble.classList.remove('thinking', 'markdown');
                    streamingBubble.style.color = '#f87171';
                    streamingBubble.textContent = `Error: ${parsed.error}`;
                    return;
                }
                if (parsed.done) break outer;

                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                    fullResponse += delta;
                    if (!streamStarted) {
                        streamingBubble.classList.remove('thinking');
                        streamStarted = true;
                    }
                    streamingBubble.innerHTML = renderMarkdown(fullResponse);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
            }
        }

        streamingWrapper.remove();
        if (fullResponse) addMessageToUI('assistant', fullResponse);

        await loadChats();
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.toggle('active', item.dataset.chatId === currentChatId);
        });

    } catch (error) {
        console.error('Error sending message:', error);
        streamingBubble.classList.remove('thinking');
        streamingBubble.style.color = '#f87171';
        streamingBubble.textContent = 'Error: Could not get a response. Check the console for details.';
    }
}
