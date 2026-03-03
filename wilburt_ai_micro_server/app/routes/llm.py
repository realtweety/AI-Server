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
import time
from datetime import datetime
from config.settings import Config

llm_bp = Blueprint('llm', __name__)
logger = logging.getLogger(__name__)


@llm_bp.route('/models', methods=['GET'])
@login_required
def get_models():
    try:
        response = requests.get(f"{Config.LM_BASE_URL}/v1/models", timeout=5)
        response.raise_for_status()
        models = [m['id'] for m in response.json()['data']]
        return jsonify({'models': models})
    except Exception as e:
        logger.error(f"Error fetching models: {e}")
        return jsonify({'error': 'Could not fetch models from LM Studio'}), 503


@llm_bp.route('/models/unload', methods=['POST'])
@login_required
def unload_model():
    data     = request.get_json()
    model_id = data.get('model_id') if data else None
    if not model_id:
        return jsonify({'error': 'model_id is required'}), 400
    try:
        response = requests.post(
            f"{Config.LM_BASE_URL}/api/v0/models/unload",
            json={'identifier': model_id},
            timeout=10,
        )
        if response.status_code == 200:
            return jsonify({'status': 'unloaded', 'model': model_id})
        return jsonify({'error': f'LM Studio returned {response.status_code}', 'detail': response.text}), response.status_code
    except Exception as e:
        logger.error(f"Error unloading model: {e}")
        return jsonify({'error': str(e)}), 503


@llm_bp.route('/chats/<chat_id>/generate-title', methods=['POST'])
@login_required
def generate_title_route(chat_id):
    """
    Ask the LLM to produce a short title for a chat based on its first exchange.
    Called after the first assistant response is saved.
    """
    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()
    try:
        history = json.loads(chat.history)
    except (json.JSONDecodeError, TypeError):
        return jsonify({'error': 'No history'}), 400

    # Only use the first user+assistant pair so the prompt stays tiny
    first_pair = [m for m in history if m['role'] in ('user', 'assistant')][:2]
    if not first_pair:
        return jsonify({'error': 'Not enough history'}), 400

    data    = request.get_json() or {}
    model   = data.get('model') or (history[0].get('model') if history else None)
    if not model:
        return jsonify({'error': 'model is required'}), 400

    # Build a simple one-shot prompt — works with any chat model
    # Strip image content from messages before sending to title generator
    def text_only(msg):
        content = msg['content']
        if isinstance(content, list):
            # Extract just the text parts
            text = ' '.join(p.get('text', '') for p in content if p.get('type') == 'text')
            return {'role': msg['role'], 'content': text}
        return msg

    title_messages = [text_only(m) for m in first_pair] + [{
        'role':    'user',
        'content': (
            'Based on the conversation above, write a short (4-6 word) title that captures '
            'the topic. Reply with ONLY the title text, no quotes, no punctuation at the end.'
        )
    }]

    try:
        response = requests.post(
            f"{Config.LM_BASE_URL}/v1/chat/completions",
            json={'model': model, 'messages': title_messages, 'max_tokens': 20, 'stream': False},
            timeout=15,
        )
        response.raise_for_status()
        raw_title = response.json()['choices'][0]['message']['content'].strip()
        # Clean up any quotes the model might add anyway
        title = raw_title.strip('"\'').strip()[:80] or generate_title(first_pair[0]['content'])
        chat.title      = title
        chat.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify({'title': title})
    except Exception as e:
        logger.error(f"Error generating title: {e}")
        return jsonify({'error': str(e)}), 503


@llm_bp.route('/chat_stream', methods=['POST'])
@login_required
def chat_stream():
    data = request.get_json()
    if not data or not data.get('message') or not data.get('model'):
        return jsonify({'error': "Missing 'message' or 'model'"}), 400

    chat_id = data.get('chat_id')
    if not chat_id:
        return jsonify({'error': "Missing 'chat_id'"}), 400

    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()

    try:
        history = json.loads(chat.history)
    except (json.JSONDecodeError, TypeError):
        history = []

    is_regenerate = bool(data.get('regenerate', False))

    # Build the user message — may include images
    images = data.get('images', [])  # list of base64 data-URIs
    if images:
        # Vision format: content is an array of parts
        content_parts = [{'type': 'text', 'text': data['message']}]
        for img_data_uri in images:
            # data_uri = "data:image/jpeg;base64,<b64>"
            if ',' in img_data_uri:
                media_type = img_data_uri.split(';')[0].split(':')[1]
                b64        = img_data_uri.split(',', 1)[1]
            else:
                media_type = 'image/jpeg'
                b64        = img_data_uri
            content_parts.append({
                'type':      'image_url',
                'image_url': {'url': f"data:{media_type};base64,{b64}"},
            })
        user_msg = {'role': 'user', 'content': content_parts}
    else:
        user_msg = {'role': 'user', 'content': data['message']}

    if is_regenerate:
        new_history = history
    else:
        new_history = history + [user_msg]
        if len(new_history) == 1:
            chat.title = generate_title(data['message'])
        db.session.commit()

    messages = []
    if chat.system_prompt and chat.system_prompt.strip():
        messages.append({'role': 'system', 'content': chat.system_prompt.strip()})
    messages.extend(new_history)

    temperature = float(data.get('temperature', 0.7))
    max_tokens  = int(data.get('max_tokens', -1))

    snapshot = {
        'model':       data['model'],
        'messages':    messages,
        'new_history': new_history,
        'chat_id':     chat_id,
        'user_id':     current_user.id,
        'temperature': max(0.0, min(2.0, temperature)),
        'max_tokens':  max_tokens,
        'lm_base_url': Config.LM_BASE_URL,
        'is_first':    len(new_history) == 1 and not is_regenerate,
        'title':       chat.title,
    }

    app = current_app._get_current_object()

    def generate():
        assistant_reply  = ''
        first_token_time = None
        token_count      = 0

        try:
            payload = {
                'model':       snapshot['model'],
                'messages':    snapshot['messages'],
                'stream':      True,
                'temperature': snapshot['temperature'],
            }
            if snapshot['max_tokens'] and snapshot['max_tokens'] > 0:
                payload['max_tokens'] = snapshot['max_tokens']

            lm_response = requests.post(
                f"{snapshot['lm_base_url']}/v1/chat/completions",
                json=payload, stream=True, timeout=60,
            )

            if lm_response.status_code != 200:
                yield f"data: {json.dumps({'error': f'LLM returned status {lm_response.status_code}'})}\n\n"
                return

            for line in lm_response.iter_lines():
                if not line:
                    continue
                try:
                    decoded   = line.decode('utf-8', errors='ignore')
                    if not decoded.startswith('data: '):
                        continue
                    data_line = decoded[6:]
                    if data_line.strip() == '[DONE]':
                        break
                    chunk   = json.loads(data_line)
                    content = chunk['choices'][0]['delta'].get('content', '')
                    if content:
                        if first_token_time is None:
                            first_token_time = time.time()
                        assistant_reply += content
                        token_count += max(1, len(content) // 4)
                    yield f"data: {json.dumps(chunk)}\n\n"
                except (json.JSONDecodeError, KeyError):
                    continue
                except Exception:
                    logger.exception('Unexpected error processing LM Studio line')
                    continue

        except requests.RequestException as exc:
            logger.exception('Network error calling LM Studio')
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            return
        except Exception:
            logger.exception('Unexpected error in generator')
            yield f"data: {json.dumps({'error': 'Internal server error'})}\n\n"
            return

        elapsed_ms     = int((time.time() - first_token_time) * 1000) if first_token_time else 0
        tokens_per_sec = round(token_count / (elapsed_ms / 1000), 1) if elapsed_ms > 100 else 0

        yield f"data: {json.dumps({'done': True, 'stats': {'tokens': token_count, 'elapsed_ms': elapsed_ms, 'tokens_per_sec': tokens_per_sec}})}\n\n"

        if assistant_reply.strip():
            final_history = snapshot['new_history'] + [
                {'role': 'assistant', 'content': assistant_reply}
            ]
            try:
                with app.app_context():
                    record = Chat.query.filter_by(
                        id=snapshot['chat_id'], user_id=snapshot['user_id'],
                    ).first()
                    if record:
                        record.history    = json.dumps(final_history)
                        record.updated_at = datetime.utcnow()
                        if snapshot['is_first']:
                            record.title = snapshot['title']
                        db.session.commit()
            except Exception:
                logger.exception('Error saving chat history')

    return Response(generate(), mimetype='application/x-ndjson')
