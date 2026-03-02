// app/static/script.js - WilburtAI Micro Server Frontend Logic
let currentChatId = null;
let lastUserMessage = "";

// DOM Elements
const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const modelSelect = document.getElementById('modelSelect');
const sendBtn = document.getElementById('sendBtn');
const newChatBtn = document.getElementById('newChatBtn');
const chatList = document.getElementById('chatList');

// ---------------------------------------------------------------------------
// Markdown rendering
// Configure marked.js once at startup:
//   - gfm: GitHub Flavoured Markdown (tables, fenced code blocks, strikethrough)
//   - breaks: treat single newlines as <br> (friendlier for chat)
// All output is passed through DOMPurify before being set as innerHTML so we
// retain XSS safety even though we're now rendering HTML.
// ---------------------------------------------------------------------------
marked.setOptions({
    gfm: true,
    breaks: true,
});

function renderMarkdown(text) {
    const rawHtml = marked.parse(text);
    return DOMPurify.sanitize(rawHtml);
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

            chatElement.appendChild(titleEl);
            chatElement.appendChild(previewEl);
            chatElement.addEventListener('click', () => loadChat(chat.id));
            chatList.appendChild(chatElement);
        });
    } catch (error) {
        console.error('Failed to load chats:', error);
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

/**
 * Render a completed message (user or assistant) into the chat container.
 * User messages: always plain text.
 * Assistant messages: rendered as sanitized markdown HTML.
 */
function addMessageToUI(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'bubble';

    if (role === 'assistant') {
        bubbleDiv.classList.add('markdown');
        // Safe: DOMPurify sanitizes marked.js output before it touches the DOM
        bubbleDiv.innerHTML = renderMarkdown(content);

        const copyBtn = document.createElement('div');
        copyBtn.className = 'copy-btn';
        copyBtn.title = 'Copy to clipboard';
        copyBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
        `;
        // Copy raw markdown text, not the rendered HTML
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(content.trim()).catch(console.error);
        });
        messageDiv.appendChild(copyBtn);
    } else {
        bubbleDiv.textContent = content;
    }

    messageDiv.appendChild(bubbleDiv);
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

/** Non-conversation system messages (errors, hints). */
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
    const model = modelSelect.value;

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

    // Create a streaming bubble. Updated live as chunks arrive, with markdown
    // re-rendered on every chunk so formatting appears in real time.
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

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        outer: while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const lines = decoder.decode(value).split('\n');

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;

                const dataStr = line.substring(6);
                let parsed;
                try {
                    parsed = JSON.parse(dataStr);
                } catch {
                    continue;
                }

                if (parsed.error) {
                    streamingBubble.classList.remove('thinking', 'markdown');
                    streamingBubble.style.color = '#f87171';
                    streamingBubble.textContent = `Error: ${parsed.error}`;
                    return;
                }

                if (parsed.done) {
                    break outer;
                }

                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                    fullResponse += delta;
                    if (!streamStarted) {
                        streamingBubble.classList.remove('thinking');
                        streamStarted = true;
                    }
                    // Re-render markdown on each chunk. DOMPurify keeps this safe.
                    streamingBubble.innerHTML = renderMarkdown(fullResponse);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
            }
        }

        // Replace the live streaming element with a permanent, properly structured message
        streamingWrapper.remove();
        if (fullResponse) {
            addMessageToUI('assistant', fullResponse);
        }

        // Refresh sidebar title/preview
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
