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

// Initialize the app
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadModels();
        await loadChats();

        // Set up event listeners
        sendBtn.addEventListener('click', sendMessage);
        newChatBtn.addEventListener('click', createNewChat);
    } catch (error) {
        console.error('Failed to initialize:', error);
    }
});

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

            // Use textContent to avoid XSS from chat titles
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

        // Highlight the new chat in the sidebar
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

function addMessageToUI(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'bubble';
    // FIX: Always use textContent, never innerHTML with user/LLM content (XSS prevention)
    bubbleDiv.textContent = content;

    if (role === 'assistant') {
        const copyBtn = document.createElement('div');
        copyBtn.className = 'copy-btn';
        copyBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
        `;
        copyBtn.title = 'Copy to clipboard';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(content.trim()).catch(console.error);
        });
        messageDiv.appendChild(copyBtn);
    }

    messageDiv.appendChild(bubbleDiv);
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Shows a non-conversation system message (errors, hints, etc.)
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

async function sendMessage() {
    const message = messageInput.value.trim();
    const model = modelSelect.value;

    // FIX: Give the user actionable feedback instead of silently returning
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

    // Create a dedicated streaming bubble so we can update it in-place
    // FIX: We keep a reference to the bubble element and use textContent throughout,
    //      then promote it to a permanent message when done — avoiding both the
    //      "response gets deleted" bug and the innerHTML XSS risk.
    const streamingWrapper = document.createElement('div');
    streamingWrapper.className = 'message assistant';

    const streamingBubble = document.createElement('div');
    streamingBubble.className = 'bubble thinking';
    streamingBubble.textContent = 'Thinking…';

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
                    streamingBubble.classList.remove('thinking');
                    streamingBubble.style.color = '#f87171';
                    streamingBubble.textContent = `Error: ${parsed.error}`;
                    return; // leave the error bubble visible
                }

                if (parsed.done) {
                    break outer;
                }

                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                    fullResponse += delta;
                    if (!streamStarted) {
                        // Switch out of "thinking" style once real content arrives
                        streamingBubble.classList.remove('thinking');
                        streamStarted = true;
                    }
                    // FIX: textContent — safe against XSS from LLM output
                    streamingBubble.textContent = fullResponse;
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
            }
        }

        // FIX: Replace the temporary streaming element with a proper permanent message
        // so the copy button and correct styling are applied, and the content is NOT lost.
        streamingWrapper.remove();
        if (fullResponse) {
            addMessageToUI('assistant', fullResponse);
        }

        // Refresh sidebar so the chat title/preview update
        await loadChats();
        // Re-highlight active chat (loadChats rebuilds the list)
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
