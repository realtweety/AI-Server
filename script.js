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
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
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
        // Show error in UI
        chatContainer.innerHTML = '<div class="message assistant"><div class="bubble">Error: Could not load models</div></div>';
    }
}

async function loadChats() {
    try {
        const response = await fetch('/chats/api/chats');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const chats = await response.json();
        
        chatList.innerHTML = '';
        
        chats.forEach(chat => {
            const chatElement = document.createElement('div');
            chatElement.className = 'chat-item';
            chatElement.dataset.chatId = chat.id;
            
            chatElement.innerHTML = `
                <div class="chat-title">${chat.title}</div>
                <div class="chat-preview">${chat.preview || ''}</div>
            `;
            
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
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        currentChatId = data.chat_id;
        chatContainer.innerHTML = '';
        await loadChats();
        
        // Auto-select first model if none selected
        if (!modelSelect.value) {
            modelSelect.selectedIndex = 0;
        }
    } catch (error) {
        console.error('Failed to create new chat:', error);
    }
}

async function loadChat(chatId) {
    try {
        const response = await fetch(`/chats/api/chats/${chatId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        currentChatId = chatId;
        chatContainer.innerHTML = '';
        
        // Add messages to chat
        if (data.history && data.history.length > 0) {
            data.history.forEach(msg => {
                addMessageToUI(msg.role, msg.content);
            });
        }
        
        // Update active chat in sidebar
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.chatId === chatId) {
                item.classList.add('active');
            }
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
    
    if (role === 'assistant') {
        // Render markdown or plain text
        bubbleDiv.textContent = content;
        
        // Add copy button
        const copyBtn = document.createElement('div');
        copyBtn.className = 'copy-btn';
        copyBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
        `;
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(content.trim());
        });
        
        messageDiv.appendChild(copyBtn);
    } else {
        bubbleDiv.textContent = content;
    }
    
    messageDiv.appendChild(bubbleDiv);
    chatContainer.appendChild(messageDiv);
    
    // Scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

async function sendMessage() {
    const message = messageInput.value.trim();
    const model = modelSelect.value;
    
    if (!message || !model || !currentChatId) return;
    
    // Add user message to UI immediately
    addMessageToUI('user', message);
    messageInput.value = '';
    lastUserMessage = message;
    
    // Show thinking indicator
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'message assistant';
    thinkingDiv.innerHTML = '<div class="bubble thinking">Thinking...</div>';
    chatContainer.appendChild(thinkingDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    
    try {
        const response = await fetch('/api/chat_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                model: model,
                chat_id: currentChatId
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // Process streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.substring(6);
                    try {
                        const data = JSON.parse(dataStr);
                        
                        if (data.error) {
                            // Handle error
                            thinkingDiv.innerHTML = '<div class="bubble">Error: ' + data.error + '</div>';
                            break;
                        }
                        
                        if (data.done) {
                            // Remove thinking indicator
                            thinkingDiv.remove();
                            break;
                        }
                        
                        // Process streaming chunks
                        const delta = data.choices?.[0]?.delta?.content || '';
                        fullResponse += delta;
                        
                        // Update UI with new content
                        if (thinkingDiv && thinkingDiv.querySelector('.thinking')) {
                            thinkingDiv.innerHTML = `<div class="bubble">${fullResponse}</div>`;
                            chatContainer.scrollTop = chatContainer.scrollHeight;
                        }
                    } catch (e) {
                        console.error('Error parsing chunk:', e);
                    }
                }
            }
        }
        
        // Remove thinking indicator and show final response
        if (thinkingDiv.parentNode) {
            thinkingDiv.remove();
        }
        
    } catch (error) {
        console.error('Error sending message:', error);
        if (thinkingDiv.parentNode) {
            thinkingDiv.innerHTML = '<div class="bubble">Error: Could not get response</div>';
        }
    }
}
