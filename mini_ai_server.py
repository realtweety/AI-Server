import os
import json
import uuid
import re
import logging
from pathlib import Path
from typing import Generator

from flask import Flask, request, jsonify, render_template_string, Response
import requests

# Load environment variables from .env file
from dotenv import load_dotenv  # type: ignore
load_dotenv()

# ------------------------------------------------------------
# 1️⃣  Configuration & constants
# ------------------------------------------------------------
# ── Initialize Flask app ──
app = Flask(__name__)
# ── LM‑Studio endpoint (can be overridden with env‑var) ──
LM_BASE = os.getenv("LM_BASE_URL", "http://localhost:1234")   # <-- UPDATED

# ── Chat storage directory (Path objects are safer) ──
CHAT_DIR = Path("chats")
CHAT_DIR.mkdir(parents=True, exist_ok=True)               # <-- NEW

# ── Logging setup (writes to console; replace with file if you wish) ──
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ------------------------------------------------------------
# 3️⃣  Utility helpers
# ------------------------------------------------------------
def _safe_chat_id(chat_id: str) -> str:
    """
    Validate that a chat identifier cannot be used for a directory‑traversal attack.
    Only alphanumerics, dashes, underscores are allowed.
    """
    if ".." in chat_id or "/" in chat_id or "\\" in chat_id:
        raise ValueError("Invalid chat id")
    return chat_id


def save_chat(chat_id: str, data: dict):
    """Write the whole chat object to disk."""
    with open(CHAT_DIR / f"{chat_id}.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_chat(chat_id: str) -> dict | list | None:
    """Load a chat file; returns None if the file does not exist."""
    path = CHAT_DIR / f"{chat_id}.json"
    if not path.is_file():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def generate_title(message: str) -> str:
    """Create a short, safe title from the first user line."""
    title = message.strip().split("\n")[0][:40]
    title = re.sub(r'[\\/*?:"<>|]', "", title)
    return title if title else "New Chat"

# ------------------------------------------------------------
# 4️⃣  Front‑end (HTML template) – unchanged except for a tiny fix
# ------------------------------------------------------------
HTML = """ 
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Wilburt AI</title>
<style>
.copy-btn, .retry-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    cursor: pointer;
    color: #aaa;
    transition: color 0.2s ease;
}

.copy-btn:hover, .retry-btn:hover {
    color: #fff;
}

#sendBtn svg {
    stroke: white;
    transition: stroke 0.2s ease;
}

#sendBtn:hover svg {
    stroke: #2d7dff;
}

body {
    margin: 0;
    display: flex;
    height: 100vh;
    font-family: system-ui;
    background: #202123;
    color: white;
}

#sidebar {
    width: 260px;
    background: #171717;
    padding: 10px;
    overflow-y: auto;
}

.chat-item {
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.chat-item:hover {
    background: #2a2a2a;
}

.delete-btn {
    color: red;
    cursor: pointer;
}

#main {
    flex: 1;
    display: flex;
    flex-direction: column;
}

#chat {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
}

.message {
    margin-bottom: 20px;
    max-width: 800px;
    white-space: pre-wrap;
}

.user { text-align: right; }
.assistant { text-align: left; }

.bubble {
    display: inline-block;
    padding: 12px 16px;
    border-radius: 12px;
    position: relative;
}

.user .bubble { background: #2d7dff; }
.assistant .bubble { background: #2f2f2f; }

.copy-btn, .retry-btn {
    font-size: 12px;
    margin-top: 5px;
    cursor: pointer;
    color: #aaa;
}

#inputArea {
    display: flex;
    padding: 15px;
    background: #171717;
    gap: 10px;
}

textarea {
    flex: 1;
    background: #2a2a2a;
    color: white;
    border: none;
    padding: 12px;
    border-radius: 8px;
    resize: none;
}

button, select {
    background: #2d7dff;
    border: none;
    color: white;
    padding: 10px 14px;
    border-radius: 6px;
    cursor: pointer;
}

.thinking {
    font-style: italic;
    color: #aaa;
    animation: pulse 1s infinite;
}

@keyframes pulse {
    0% {opacity: 0.4;}
    50% {opacity: 1;}
    100% {opacity: 0.4;}
}

/* New CSS for better UX */
.chat-preview {
    font-size: 0.8em;
    color: #aaa;
    margin-top: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.chat-item .timestamp {
    font-size: 0.7em;
    color: #666;
    margin-left: 8px;
}

/* Responsive design */
@media (max-width: 768px) {
    #sidebar { display: none; }
}
</style>
</head>
<body>

<div id="sidebar">
    <button onclick="newChat()">+ New Chat</button>
    <button onclick="clearChat()">Clear Current Chat</button>
    <hr>
    <div id="chatList"></div>
</div>

<div id="main">
    <div id="chat"></div>

    <div id="inputArea">
        <select id="modelSelect"></select>
        <textarea id="input" placeholder="Message..." onkeypress="if(event.key==='Enter' && !event.shiftKey) { sendMessage(); event.preventDefault(); }"></textarea>
        <button onclick="sendMessage()" id="sendBtn">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
    </svg>
</button>
    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@2.4.0/dist/purify.min.js"></script>

<script>

let currentChat = null;
let lastUserMessage = "";

async function loadModels() {
    let res = await fetch("/models");
    let data = await res.json();
    let select = document.getElementById("modelSelect");
    select.innerHTML = "";
    data.models.forEach(m => {
        let option = document.createElement("option");
        option.value = m;
        option.text = m;
        select.appendChild(option);
    });
}

async function loadChats() {
    let res = await fetch("/list_chats");
    let chats = await res.json();
    let list = document.getElementById("chatList");
    list.innerHTML = "";
    chats.forEach(c => {
        let div = document.createElement("div");
        div.className = "chat-item";

        let span = document.createElement("span");
        span.onclick = () => loadChat(c.id);
        
        // Add click to rename title
        span.ondblclick = () => editTitle(c.id, c.title);

        let titleSpan = document.createElement("span");
        titleSpan.innerText = c.title;
        
        let previewDiv = document.createElement("div");
        previewDiv.className = "chat-preview";
        previewDiv.innerText = c.preview || "";
        
        // Add timestamp if available
        let timeSpan = document.createElement("span");
        timeSpan.className = "timestamp";
        timeSpan.innerText = c.mtime ? `(${c.mtime})` : "";
        
        span.appendChild(titleSpan);
        span.appendChild(previewDiv);
        span.appendChild(timeSpan);

        let del = document.createElement("span");
        del.innerText = "🗑";
        del.className = "delete-btn";
        del.onclick = () => deleteChat(c.id);

        div.appendChild(span);
        div.appendChild(del);
        list.appendChild(div);
    });
}

async function newChat() {
    let res = await fetch("/new_chat", {method: "POST"});
    let data = await res.json();
    currentChat = data.chat_id;
    document.getElementById("chat").innerHTML = "";
    loadChats();
}

async function clearChat() {
    if (!currentChat) return;
    await fetch(`/delete_chat/${currentChat}`, {method: "DELETE"});
    document.getElementById("chat").innerHTML = "";
    loadChats();
}

async function deleteChat(id) {
    await fetch("/delete_chat/" + id, {method: "DELETE"});
    if (id === currentChat) {
        document.getElementById("chat").innerHTML = "";
    }
    loadChats();
}

async function editTitle(id, currentTitle) {
    const newTitle = prompt("Edit title:", currentTitle);
    if (!newTitle || newTitle === currentTitle) return;

    await fetch(`/rename_chat/${id}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({title: newTitle})
    });
    
    loadChats(); // Reload sidebar
}

async function loadChat(id) {
    currentChat = id;
    let res = await fetch("/load_chat/" + id);
    let data = await res.json();
    document.getElementById("chat").innerHTML = "";
    data.history.forEach(msg => addMessage(msg.role, msg.content));
}

function addMessage(role, text) {
    let div = document.createElement("div");
    div.className = "message " + role;

    let bubble = document.createElement("div");
    bubble.className = "bubble";

    if (role === "assistant") {
        // Sanitize and render markdown
        const clean = DOMPurify.sanitize(marked.parse(text));
        bubble.innerHTML = clean;
    } else {
        bubble.innerText = text;
    }

    if (role === "assistant") {
        // Copy button
        let copy = document.createElement("div");
        copy.className = "copy-btn";
        copy.innerHTML = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
</svg>
`;
        copy.onclick = () => navigator.clipboard.writeText(text.trim());

        // Regenerate / retry button
        let retry = document.createElement("div");
        retry.className = "retry-btn";
        retry.innerHTML = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <path d="M23 4v6h-6"></path>
    <path d="M1 20v-6h6"></path>
    <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path>
    <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"></path>
</svg>
`;
        retry.onclick = () => {
            // Remove the current assistant bubble and resend the last user message
            const bubbles = document.querySelectorAll('.message.assistant .bubble');
            if (bubbles.length) bubbles[bubbles.length-1].remove();
            sendMessage(true);
        };

        div.appendChild(copy);
        div.appendChild(retry);
    }

    div.appendChild(bubble);
    document.getElementById("chat").appendChild(div);
    document.getElementById("chat").scrollTop =
    document.getElementById("chat").scrollHeight;
}

async function sendMessage(isRetry=false) {

    let inputBox = document.getElementById("input");
    let input = isRetry ? lastUserMessage : inputBox.value;
    let model = document.getElementById("modelSelect").value;

    if (!input.trim()) return;

    // Check if model is selected
    if (!model) {
        alert("Please select a model.");
        return;
    }

    console.log('Sending message:', {message: input, model: model, chat_id: currentChat});  // Log the payload

    if (!isRetry) {
        addMessage("user", input);
        inputBox.value = "";
        lastUserMessage = input;
    }

    let thinkingDiv = document.createElement("div");
    thinkingDiv.className = "message assistant";
    thinkingDiv.innerHTML = "<div class='bubble thinking'>Thinking...</div>";
    document.getElementById("chat").appendChild(thinkingDiv);
    document.getElementById("chat").scrollTop = 999999;

    const response = await fetch("/chat_stream", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({message: input, model: model, chat_id: currentChat})
    });

    // Rest of the function...
}

loadModels();
loadChats();

</script>
</body>
</html>
"""

# ------------------------------------------------------------
# 5️⃣  Flask routes
# ------------------------------------------------------------

@app.route("/")
def index():
    return render_template_string(HTML)


@app.route("/models")
def models():
    """Fetch the list of available models from LM‑Studio."""
    try:
        r = requests.get(f"{LM_BASE}/v1/models", timeout=5)
        r.raise_for_status()
        logger.info("Successfully fetched models from LM Studio")
        return jsonify({"models": [m["id"] for m in r.json()["data"]]})
    except requests.RequestException as exc:
        logger.exception("Failed to fetch models from LM‑Studio")
        return jsonify({"error": f"Could not fetch models: {exc}"}), 503


@app.route("/new_chat", methods=["POST"])
def new_chat():
    """Create a brand-new chat and persist its metadata."""
    try:
        chat_id = str(uuid.uuid4())
        save_chat(chat_id, {"title": "New Chat", "history": []})
        logger.info(f"Created new chat with ID: {chat_id}")
        return jsonify({"chat_id": chat_id}), 201
    except Exception as e:
        logger.exception("Failed to create new chat")
        return jsonify({"error": "Could not create new chat"}), 500


@app.route("/list_chats")
def list_chats():
    """Return an array of all saved chats with their titles."""
    chats = []
    for file_path in CHAT_DIR.glob("*.json"):
        chat_id = file_path.stem
        data = json.loads(file_path.read_text(encoding="utf-8"))
        
        # Get last modified time
        import datetime
        mtime = datetime.datetime.fromtimestamp(file_path.stat().st_mtime).strftime('%Y-%m-%d %H:%M')
        
        # Title logic mirrors your original implementation
        if isinstance(data, dict):
            title = data.get("title", "New Chat")
            history = data.get("history", [])
        elif isinstance(data, list) and len(data) > 0:
            first_msg = data[0].get("content", "")
            title = generate_title(first_msg)
            history = data
        else:
            title = "New Chat"
            history = []

        # Get preview of last message
        preview = ""
        if history:
            last = history[-1]
            if last["role"] == "user":
                preview = f"You: {last['content'][:60]}"
            else:
                preview = f"AI: {last['content'][:60]}"

        chats.append({"id": chat_id, "title": title, "preview": preview, "mtime": mtime})
    logger.info(f"Listing {len(chats)} chats")
    return jsonify(chats)


@app.route("/load_chat/<chat_id>")
def load_chat_route(chat_id):
    """Return the message history for a given chat."""
    try:
        safe_id = _safe_chat_id(chat_id)
        data = load_chat(safe_id)

        if data is None:
            logger.info(f"Chat with ID {chat_id} not found")
            return jsonify({"error": "Chat not found"}), 404

        # Normalise to a list of messages
        if isinstance(data, dict):
            history = data.get("history", [])
        elif isinstance(data, list):
            history = data
        else:
            history = []

        logger.info(f"Loaded chat with ID {chat_id}")
        return jsonify({"history": history})
    except ValueError as ve:
        logger.exception("Invalid chat id")
        return jsonify({"error": "Invalid chat id"}), 400


@app.route("/delete_chat/<chat_id>", methods=["DELETE"])
def delete_chat(chat_id):
    """Delete a chat file after sanitising the identifier."""
    try:
        safe_id = _safe_chat_id(chat_id)
    except ValueError:
        return jsonify({"error": "Invalid chat id"}), 400

    path = CHAT_DIR / f"{safe_id}.json"
    if path.is_file():
        path.unlink()
        logger.info(f"Deleted chat with ID {chat_id}")
    else:
        logger.info(f"No chat file found for ID {chat_id}")

    return jsonify({"status": "deleted"})


@app.route("/rename_chat/<chat_id>", methods=["POST"])
def rename_chat(chat_id):
    """Rename a chat."""
    try:
        safe_id = _safe_chat_id(chat_id)
        data = load_chat(safe_id)
        if not data:
            return jsonify({"error": "Chat not found"}), 404

        new_title = request.json.get("title")
        if not new_title:
            return jsonify({"error": "Title is required"}), 400

        # Ensure data is a dict; if it's a list, convert it
        if isinstance(data, list):
            data = {"history": data, "title": "New Chat"}
        
        data["title"] = new_title.strip()[:100]  # Limit length
        save_chat(safe_id, data)
        logger.info(f"Renamed chat {chat_id} to '{new_title}'")
        return jsonify({"status": "renamed"})
    except Exception as e:
        logger.exception("Failed to rename chat")
        return jsonify({"error": "Could not rename chat"}), 500


@app.route("/chat_stream", methods=["POST"])
def chat_stream():
    """
    Stream the LM‑Studio completion endpoint back to the browser.
    Errors are now logged and returned as JSON instead of being silently ignored.
    """
    try:
        payload = request.get_json(force=True)
        logger.info(f"Received payload: {payload}")  # Log the payload
        if not payload.get("message") or not payload.get("model"):
            return jsonify({"error": "Missing 'message' or 'model'"}), 400

        chat_id = payload.get("chat_id")
        if not chat_id:
            return jsonify({"error": "Missing 'chat_id'"}), 400

        safe_id = _safe_chat_id(chat_id)
        data = load_chat(safe_id)
        if data is None:
            logger.info(f"Chat with ID {chat_id} not found")
            return jsonify({"error": "Chat not found"}), 404

        if isinstance(data, dict):
            history = data["history"]
        elif isinstance(data, list):
            history = data
            data = {}
        else:
            history = []
            data = {}

        history.append({"role": "user", "content": payload["message"]})

        # If this is the first user turn, set a title
        if len(history) == 1:
            data["title"] = generate_title(payload["message"])

        def generate():
            """Yield chunked JSON responses that the front-end can parse."""
            try:
                with requests.post(
                    f"{LM_BASE}/v1/chat/completions",
                    json={
                        "model": payload["model"],
                        "messages": history,
                        "stream": True,
                    },
                    stream=True,
                    timeout=60,
                ) as r:
                    if r.status_code != 200:
                        logger.error(f"LM Studio returned status code {r.status_code}")
                        yield f"data: {json.dumps({'error': f'LLM Error: {r.status_code}'})}\n\n"
                        return
                    
                    r.raise_for_status()
                    assistant_reply = ""
                    saw_stop = False

                    for line in r.iter_lines():
                        if not line:
                            continue
                        try:
                            decoded = line.decode('utf-8', errors='ignore')
                            if decoded.startswith("data: "):
                                data_line = decoded[6:]
                                
                                # Handle the special [DONE] marker or stop signal
                                if data_line.strip() == "[DONE]":
                                    logger.debug("Received [DONE] marker")
                                    # Send a final empty chunk to signal completion
                                    yield f"data: {json.dumps({'done': True})}\n\n"
                                    break
                                
                                try:
                                    chunk = json.loads(data_line)
                                    delta = chunk["choices"][0]["delta"]
                                    content = delta.get("content", "")
                                    assistant_reply += content
                                    
                                    # Forward the chunk as-is for streaming
                                    yield f"data: {json.dumps(chunk)}\n\n"
                                    
                                    # Check if this is the final chunk (stop reason)
                                    if (chunk.get("choices") and 
                                        len(chunk["choices"]) > 0 and
                                        chunk["choices"][0].get("finish_reason") == "stop"):
                                        logger.debug("Received stop signal from LLM")
                                        saw_stop = True
                                        
                                except (json.JSONDecodeError, KeyError) as e:
                                    # If we can't parse it, just skip this chunk
                                    logger.warning(f"Failed to parse chunk: {decoded[:100]}... Error: {e}")
                                    continue
                        except Exception as e:
                            logger.exception("Error processing line from LM Studio")
                            continue

                    # Append the final assistant message to history and persist
                    if assistant_reply.strip() and saw_stop:
                        history.append({"role": "assistant", "content": assistant_reply})
                        save_chat(safe_id, {"title": data["title"], "history": history})
                        
            except requests.RequestException as exc:
                logger.exception("Error while calling LM‑Studio")
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            except Exception as e:
                logger.exception("Unexpected error in chat_stream")
                yield f"data: {json.dumps({'error': 'Internal server error'})}\n\n"

        return Response(generate(), mimetype="application/x-ndjson")

    except Exception as e:
        logger.exception("Error in chat_stream")
        return jsonify({"error": str(e)}), 500


# ------------------------------------------------------------
# 6️⃣  Run the app
# ------------------------------------------------------------
if __name__ == "__main__":
    # Use the built-in server only for development. In production use gunicorn/uwsgi.
    app.run(host="0.0.0.0", port=5000)
