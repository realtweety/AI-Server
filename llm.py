# app/routes/llm.py
"""
WilburtAI Micro Server - LLM Interaction Routes
"""

from flask import Blueprint, request, jsonify, Response, current_app
from flask_login import login_required, current_user
from app.models.chat import Chat
from app import db
from app.utils.helpers import generate_title
import json
import requests
import logging
from datetime import datetime
from config.settings import Config

llm_bp = Blueprint('llm', __name__)
logger = logging.getLogger(__name__)


@llm_bp.route('/models', methods=['GET'])
@login_required
def get_models():
    """Get available models from LM Studio."""
    try:
        response = requests.get(f"{Config.LM_BASE_URL}/v1/models", timeout=5)
        response.raise_for_status()
        models = [m["id"] for m in response.json()["data"]]
        return jsonify({"models": models})
    except Exception as e:
        logger.error(f"Error fetching models: {e}")
        return jsonify({"error": "Could not fetch models from LM Studio"}), 503


@llm_bp.route('/chat_stream', methods=['POST'])
@login_required
def chat_stream():
    """Stream LLM responses back to the client."""
    data = request.get_json()

    if not data or not data.get('message') or not data.get('model'):
        return jsonify({"error": "Missing 'message' or 'model'"}), 400

    chat_id = data.get('chat_id')
    if not chat_id:
        return jsonify({"error": "Missing 'chat_id'"}), 400

    # Load and validate chat ownership before entering the generator
    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()

    try:
        history = json.loads(chat.history)
    except (json.JSONDecodeError, TypeError):
        history = []

    # Append user message and update title if this is the first message
    history.append({"role": "user", "content": data['message']})
    if len(history) == 1:
        # FIX: Use the shared helper instead of duplicating the regex logic inline
        chat.title = generate_title(data['message'])

    # Snapshot everything the generator needs so it doesn't rely on the
    # request context (which may not be available inside a lazy generator).
    snapshot = {
        "model": data["model"],
        "history": history,
        "chat_id": chat_id,
        "user_id": current_user.id,
        "lm_base_url": Config.LM_BASE_URL,
    }

    # FIX: Capture the real app object now, while we're in the request context,
    # so the generator can push its own app context for DB access.
    app = current_app._get_current_object()

    def generate():
        assistant_reply = ""

        try:
            lm_response = requests.post(
                f"{snapshot['lm_base_url']}/v1/chat/completions",
                json={
                    "model": snapshot["model"],
                    "messages": snapshot["history"],
                    "stream": True,
                },
                stream=True,
                timeout=60,
            )

            if lm_response.status_code != 200:
                yield f"data: {json.dumps({'error': f'LLM returned status {lm_response.status_code}'})}\n\n"
                return

            for line in lm_response.iter_lines():
                if not line:
                    continue
                try:
                    decoded = line.decode('utf-8', errors='ignore')
                    if not decoded.startswith("data: "):
                        continue

                    data_line = decoded[6:]

                    if data_line.strip() == "[DONE]":
                        # Signal the frontend that streaming is complete
                        yield f"data: {json.dumps({'done': True})}\n\n"
                        break

                    chunk = json.loads(data_line)
                    delta = chunk["choices"][0]["delta"]
                    content = delta.get("content", "")
                    assistant_reply += content
                    yield f"data: {json.dumps(chunk)}\n\n"

                except (json.JSONDecodeError, KeyError):
                    continue
                except Exception:
                    logger.exception("Unexpected error processing LM Studio line")
                    continue

        except requests.RequestException as exc:
            logger.exception("Network error calling LM Studio")
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            return
        except Exception:
            logger.exception("Unexpected error in chat_stream generator")
            yield f"data: {json.dumps({'error': 'Internal server error'})}\n\n"
            return

        # Persist the completed conversation.
        # FIX: Save whenever we have a reply — not gated on saw_stop — so partial
        # responses and models that skip finish_reason=stop are still persisted.
        # FIX: Push an explicit app context so DB access works safely inside the
        # generator, which runs outside the original request context.
        if assistant_reply.strip():
            final_history = snapshot["history"] + [
                {"role": "assistant", "content": assistant_reply}
            ]
            try:
                with app.app_context():
                    chat_record = Chat.query.filter_by(
                        id=snapshot["chat_id"],
                        user_id=snapshot["user_id"]
                    ).first()
                    if chat_record:
                        chat_record.history = json.dumps(final_history)
                        # FIX: datetime.utcnow() — db.func.now() is a SQL clause
                        # object and cannot be assigned to a Python model attribute
                        chat_record.updated_at = datetime.utcnow()
                        # Also persist any title change that was set before the generator ran
                        if len(snapshot["history"]) == 1:
                            chat_record.title = generate_title(
                                snapshot["history"][0]["content"]
                            )
                        db.session.commit()
            except Exception:
                logger.exception("Error saving chat history to database")

    return Response(generate(), mimetype="application/x-ndjson")
