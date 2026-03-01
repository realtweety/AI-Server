# app/routes/llm.py - WilburtAI Micro Server LLM Routes (Fixed)
"""
WilburtAI Micro Server - LLM Interaction Routes
"""

from flask import Blueprint, request, jsonify, Response, g
from flask_login import login_required, current_user
from app.models.chat import Chat
from app import db
import json
import requests
import uuid
import logging
from config.settings import Config

llm_bp = Blueprint('llm', __name__)

# Configure logging
logger = logging.getLogger(__name__)

@llm_bp.route('/models', methods=['GET'])
@login_required
def get_models():
    """Get available models from LM Studio."""
    try:
        response = requests.get(f"{Config.LM_BASE_URL}/v1/models", timeout=5)
        response.raise_for_status()
        
        models_data = response.json()
        models = [model["id"] for model in models_data["data"]]
        
        return jsonify({"models": models})
    except Exception as e:
        logger.error(f"Error fetching models: {e}")
        return jsonify({"error": "Could not fetch models"}), 503

@llm_bp.route('/chat_stream', methods=['POST'])
@login_required
def chat_stream():
    """Stream LLM responses."""
    try:
        data = request.get_json()
        
        if not data.get('message') or not data.get('model'):
            return jsonify({"error": "Missing 'message' or 'model'"}), 400
        
        chat_id = data.get('chat_id')
        if not chat_id:
            return jsonify({"error": "Missing 'chat_id'"}), 400
        
        # Load chat
        chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()
        
        # Get current history
        try:
            history = json.loads(chat.history)
        except:
            history = []
        
        # Add new user message
        user_message = {"role": "user", "content": data['message']}
        history.append(user_message)
        
        # Update chat title if this is the first message
        if len(history) == 1:
            # Generate title from first message
            import re
            title = data['message'].strip().split('\n')[0][:40]
            title = re.sub(r'[\\/*?:"<>|]', '', title)
            chat.title = title if title else "New Chat"
        
        def generate():
            """Yield streaming response chunks."""
            try:
                # Make request to LM Studio using Config instead of request.environ
                response = requests.post(
                    f"{Config.LM_BASE_URL}/v1/chat/completions",
                    json={
                        "model": data["model"],
                        "messages": history,
                        "stream": True,
                    },
                    stream=True,
                    timeout=60,
                )
                
                if response.status_code != 200:
                    yield f"data: {json.dumps({'error': f'LLM Error: {response.status_code}'})}\n\n"
                    return
                
                response.raise_for_status()
                
                assistant_reply = ""
                saw_stop = False
                
                for line in response.iter_lines():
                    if not line:
                        continue
                    try:
                        decoded = line.decode('utf-8', errors='ignore')
                        if decoded.startswith("data: "):
                            data_line = decoded[6:]
                            
                            # Handle [DONE] marker
                            if data_line.strip() == "[DONE]":
                                logger.debug("Received [DONE] marker")
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
                                logger.warning(f"Failed to parse chunk: {decoded[:100]}... Error: {e}")
                                continue
                    except Exception as e:
                        logger.exception("Error processing line from LM Studio")
                        continue
                
                # Append the final assistant message to history and persist - FIXED CONTEXT ISSUE
                if assistant_reply.strip() and saw_stop:
                    assistant_message = {"role": "assistant", "content": assistant_reply}
                    history.append(assistant_message)
                    
                    # Update chat with new history - FIX: Use app context properly
                    try:
                        # This is the key fix - update the chat object directly in the same session
                        chat.history = json.dumps(history)
                        chat.updated_at = db.func.now()
                        
                        # Commit within proper context (this might not be needed, but let's try)
                        db.session.commit()
                        
                    except Exception as e:
                        logger.error(f"Error committing to database: {e}")
                        # Don't fail the entire response for DB commit failure
                        pass
                    
            except requests.RequestException as exc:
                logger.exception("Error while calling LM-Studio")
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            except Exception as e:
                logger.exception("Unexpected error in chat_stream")
                yield f"data: {json.dumps({'error': 'Internal server error'})}\n\n"

        return Response(generate(), mimetype="application/x-ndjson")

    except Exception as e:
        logger.exception("Error in chat_stream")
        return jsonify({"error": str(e)}), 500
