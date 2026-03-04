# app/routes/llm.py
"""
WilburtAI — LLM routes + WebSocket streaming handler
"""
import json, logging, time, requests
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from flask_socketio import emit, disconnect
from app import db, socketio
from app.models.chat import Chat
from app.routes.rag import retrieve_context
from app.utils.helpers import generate_title
from config.settings import Config

llm_bp = Blueprint('llm', __name__)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Friendly error-message table
# ---------------------------------------------------------------------------
ERROR_MAP = {
    400: "Bad request — LM Studio rejected the parameters.",
    404: "Model not found. Make sure the selected model is loaded in LM Studio.",
    422: "Unprocessable request — possibly the context is too long for this model.",
    429: "LM Studio is rate-limiting requests. Wait a moment and try again.",
    500: "LM Studio returned an internal error.",
    503: "LM Studio is unavailable or the model is still loading.",
}

def friendly_error(exc=None, status_code=None, raw_body=None):
    if status_code and status_code in ERROR_MAP:
        base = ERROR_MAP[status_code]
    elif exc:
        msg = str(exc).lower()
        if 'connection refused' in msg or 'newconnectionerror' in msg:
            base = "Cannot connect to LM Studio — is it running on port 1234?"
        elif 'timeout' in msg:
            base = "LM Studio timed out. The model may be overloaded."
        elif 'context' in msg or 'length' in msg:
            base = "The conversation exceeded the model's context window."
        else:
            base = f"Network error: {str(exc)}"
    else:
        base = "An unknown error occurred."
    if raw_body:
        try:
            detail = json.loads(raw_body).get('error', {})
            if isinstance(detail, dict): detail = detail.get('message', '')
            if detail: base += f" Detail: {detail}"
        except Exception: pass
    return base

# ---------------------------------------------------------------------------
# REST helpers
# ---------------------------------------------------------------------------
@llm_bp.route('/models', methods=['GET'])
@login_required
def get_models():
    try:
        r = requests.get(f"{Config.LM_BASE_URL}/v1/models", timeout=5)
        r.raise_for_status()
        models = [m['id'] for m in r.json().get('data', [])]
        return jsonify({'models': models})
    except Exception as e:
        return jsonify({'error': friendly_error(exc=e), 'models': []}), 503


@llm_bp.route('/model-context', methods=['GET'])
@login_required
def model_context():
    """Return context length for a loaded model from LM Studio."""
    model_id = request.args.get('model', '').strip()
    try:
        r = requests.get(f"{Config.LM_BASE_URL}/api/v0/models", timeout=5)
        if r.status_code == 200:
            for m in r.json().get('data', []):
                if m.get('id') == model_id or not model_id:
                    ctx = (m.get('context_length') or
                           m.get('max_context_length') or
                           m.get('n_ctx') or 4096)
                    return jsonify({'context_length': ctx, 'model': m.get('id')})
        # Fallback: try /v1/models
        r2 = requests.get(f"{Config.LM_BASE_URL}/v1/models", timeout=5)
        if r2.status_code == 200:
            data = r2.json().get('data', [])
            for m in data:
                if m.get('id') == model_id or not model_id:
                    return jsonify({'context_length': 4096, 'model': m.get('id')})
    except Exception as e:
        logger.warning(f"model-context fetch failed: {e}")
    return jsonify({'context_length': 4096, 'model': model_id})

@llm_bp.route('/models/unload', methods=['POST'])
@login_required
def unload_model():
    data = request.get_json() or {}
    model_id = data.get('model_id')
    if not model_id:
        return jsonify({'error': 'model_id is required'}), 400
    try:
        r = requests.post(f"{Config.LM_BASE_URL}/api/v0/models/unload",
                          json={'identifier': model_id}, timeout=10)
        if r.status_code == 200:
            return jsonify({'status': 'unloaded', 'model': model_id})
        return jsonify({'error': friendly_error(status_code=r.status_code, raw_body=r.text)}), r.status_code
    except Exception as e:
        return jsonify({'error': friendly_error(exc=e)}), 503

@llm_bp.route('/chats/<chat_id>/generate-title', methods=['POST'])
@login_required
def generate_title_route(chat_id):
    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()
    try:
        history = json.loads(chat.history)
    except Exception:
        return jsonify({'error': 'No history'}), 400
    first_pair = [m for m in history if m['role'] in ('user','assistant')][:2]
    if not first_pair:
        return jsonify({'error': 'Not enough history'}), 400
    data  = request.get_json() or {}
    model = data.get('model')
    if not model:
        return jsonify({'error': 'model is required'}), 400
    def text_only(m):
        c = m['content']
        if isinstance(c, list): c = ' '.join(p.get('text','') for p in c if p.get('type')=='text')
        return {'role': m['role'], 'content': c}
    msgs = [text_only(m) for m in first_pair] + [{'role':'user','content':
        'Write a short (4-6 word) title for this conversation. Reply with ONLY the title, no quotes.'}]
    try:
        r = requests.post(f"{Config.LM_BASE_URL}/v1/chat/completions",
                          json={'model':model,'messages':msgs,'max_tokens':20,'stream':False}, timeout=15)
        r.raise_for_status()
        title = r.json()['choices'][0]['message']['content'].strip().strip('"\'')[:80]
        chat.title = title or generate_title(first_pair[0]['content'])
        chat.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify({'title': chat.title})
    except Exception as e:
        return jsonify({'error': friendly_error(exc=e)}), 503

# ---------------------------------------------------------------------------
# Context-window pruning helper
# ---------------------------------------------------------------------------
def maybe_prune(messages, context_limit, keep_system=True):
    """
    Estimate token usage (~4 chars per token).
    If we're over context_limit, remove oldest non-system turns in pairs
    until we fit, then emit a context-pruned warning event.
    Returns (pruned_messages, was_pruned).
    """
    def est(msgs): return sum(len(str(m.get('content',''))) for m in msgs) // 4

    system = [m for m in messages if m['role'] == 'system']
    convo  = [m for m in messages if m['role'] != 'system']
    pruned = False
    while est(system + convo) > context_limit and len(convo) > 2:
        convo  = convo[2:]   # drop oldest user+assistant pair
        pruned = True
    return system + convo, pruned


@llm_bp.route('/chats/<chat_id>/save-partial', methods=['POST'])
@login_required
def save_partial(chat_id):
    """Save a partial (stopped) assistant response to history."""
    from app.models.chat import Chat as ChatModel
    chat = ChatModel.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()
    data    = request.get_json() or {}
    content = (data.get('content') or '').strip()
    if not content:
        return jsonify({'status': 'nothing_to_save'})
    try:
        history = json.loads(chat.history)
    except Exception:
        history = []
    history.append({'role': 'assistant', 'content': content})
    chat.history    = json.dumps(history)
    chat.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'status': 'saved'})


# ---------------------------------------------------------------------------
# WebSocket streaming handler
# ---------------------------------------------------------------------------
@socketio.on('start_stream')
def handle_start_stream(data):
    """
    Client emits 'start_stream' with:
      { message, model, chat_id, temperature, max_tokens,
        regenerate, images, use_rag, embedding_model }
    Server emits back:
      'stream_token'   { token, word_count }
      'stream_done'    { stats, tool_calls, pruned }
      'stream_error'   { error }
    """
    from flask_login import current_user as cu
    if not cu.is_authenticated:
        emit('stream_error', {'error': 'Not authenticated'}); return

    message         = (data.get('message') or '').strip()
    model           = (data.get('model')   or '').strip()
    chat_id         = (data.get('chat_id') or '').strip()
    temperature     = float(data.get('temperature', 0.7))
    max_tokens      = int(data.get('max_tokens', -1))
    is_regenerate   = bool(data.get('regenerate', False))
    images          = data.get('images', [])
    use_rag         = bool(data.get('use_rag', False))
    embedding_model = (data.get('embedding_model') or model).strip()
    context_limit   = current_app.config.get('CONTEXT_WINDOW_DEFAULT', 4096)

    if not model:
        emit('stream_error', {'error': 'No model selected.'}); return
    if not chat_id:
        emit('stream_error', {'error': 'No chat_id provided.'}); return
    if not message and not images:
        emit('stream_error', {'error': 'Cannot send an empty message.'}); return

    chat = Chat.query.filter_by(id=chat_id, user_id=cu.id).first()
    if not chat:
        emit('stream_error', {'error': 'Chat not found.'}); return

    try:
        history = json.loads(chat.history)
    except Exception:
        history = []

    # Build user message
    if images:
        content_parts = [{'type':'text','text': message or ' '}]
        for uri in images:
            if ',' in uri:
                mt  = uri.split(';')[0].split(':')[1]
                b64 = uri.split(',',1)[1]
            else:
                mt, b64 = 'image/jpeg', uri
            content_parts.append({'type':'image_url','image_url':{'url':f'data:{mt};base64,{b64}'}})
        user_msg = {'role':'user','content': content_parts}
    else:
        user_msg = {'role':'user','content': message}

    new_history = history if is_regenerate else history + [user_msg]
    is_first    = len(new_history) == 1 and not is_regenerate

    # RAG injection
    rag_snippet = None
    if use_rag and message:
        try:
            rag_snippet = retrieve_context(cu.id, message, embedding_model,
                                           top_k=current_app.config.get('RAG_TOP_K', 4))
        except Exception as re:
            logger.warning(f'RAG retrieval failed: {re}')

    # Assemble messages list — inject memory first
    from app.models.chat import UserMemory
    messages = []
    mem_obj   = UserMemory.query.filter_by(user_id=cu.id).first()
    sys_parts = []
    if chat.system_prompt and chat.system_prompt.strip():
        sys_parts.append(chat.system_prompt.strip())
    if mem_obj and mem_obj.content.strip():
        sys_parts.append(f'[User Memory]\n{mem_obj.content.strip()}')
    if sys_parts:
        messages.append({'role': 'system', 'content': '\n\n'.join(sys_parts)})
    if rag_snippet:
        messages.append({'role':'system','content': rag_snippet})
    messages.extend(new_history)

    # Context-window pruning
    messages, was_pruned = maybe_prune(messages, context_limit)

    # Save user message & initial title before streaming
    if not is_regenerate:
        chat.history    = json.dumps(new_history)
        chat.updated_at = datetime.utcnow()
        if is_first:
            chat.title = generate_title(message)
        db.session.commit()

    # ---------------------------------------------------------------------------
    # Streaming loop with one retry on transient failure
    # ---------------------------------------------------------------------------
    assistant_reply = ''
    tool_calls_map  = {}
    token_count     = 0
    word_count      = 0
    start_time      = None

    def do_stream(attempt=0):
        nonlocal assistant_reply, tool_calls_map, token_count, word_count, start_time
        payload = {
            'model':       model,
            'messages':    messages,
            'stream':      True,
            'temperature': max(0.0, min(2.0, temperature)),
        }
        if max_tokens > 0:
            payload['max_tokens'] = max_tokens

        try:
            lm_resp = requests.post(
                f"{Config.LM_BASE_URL}/v1/chat/completions",
                json=payload, stream=True, timeout=90,
            )
            if lm_resp.status_code != 200:
                err = friendly_error(status_code=lm_resp.status_code, raw_body=lm_resp.text)
                if attempt == 0 and lm_resp.status_code >= 500:
                    logger.warning(f'Stream attempt 0 failed ({lm_resp.status_code}), retrying…')
                    time.sleep(1.5)
                    return do_stream(attempt=1)
                emit('stream_error', {'error': err}); return False

            for raw_line in lm_resp.iter_lines():
                if not raw_line: continue
                try:
                    line = raw_line.decode('utf-8', errors='ignore')
                    if not line.startswith('data: '): continue
                    payload_str = line[6:]
                    if payload_str.strip() == '[DONE]': break
                    chunk = json.loads(payload_str)
                    delta = chunk['choices'][0].get('delta', {})

                    # Accumulate tool calls
                    for tc in (delta.get('tool_calls') or []):
                        idx = tc.get('index', 0)
                        if idx not in tool_calls_map:
                            tool_calls_map[idx] = {'id':'','type':'function','function':{'name':'','arguments':''}}
                        if tc.get('id'): tool_calls_map[idx]['id'] = tc['id']
                        fn = tc.get('function', {})
                        if fn.get('name'):      tool_calls_map[idx]['function']['name']      += fn['name']
                        if fn.get('arguments'): tool_calls_map[idx]['function']['arguments'] += fn['arguments']

                    token = delta.get('content', '')
                    if token:
                        if start_time is None: start_time = time.time()
                        assistant_reply += token
                        token_count     += max(1, len(token)//4)
                        word_count       = len(assistant_reply.split())
                        emit('stream_token', {'token': token, 'word_count': word_count})

                except (json.JSONDecodeError, KeyError): continue

            return True   # success

        except requests.exceptions.RequestException as e:
            if attempt == 0:
                logger.warning(f'Stream attempt 0 network error: {e}, retrying…')
                time.sleep(1.5)
                return do_stream(attempt=1)
            emit('stream_error', {'error': friendly_error(exc=e)}); return False

    success = do_stream()
    if not success: return

    elapsed_ms     = int((time.time() - start_time) * 1000) if start_time else 0
    tokens_per_sec = round(token_count / (elapsed_ms/1000), 1) if elapsed_ms > 100 else 0
    tool_calls     = [tool_calls_map[k] for k in sorted(tool_calls_map)]

    emit('stream_done', {
        'stats': {'tokens': token_count, 'elapsed_ms': elapsed_ms, 'tokens_per_sec': tokens_per_sec,
                  'word_count': word_count},
        'tool_calls': tool_calls,
        'pruned':     was_pruned,
    })

    # Persist completed response
    if assistant_reply.strip() or tool_calls:
        final_history = new_history + [{'role':'assistant','content': assistant_reply}]
        try:
            chat.history    = json.dumps(final_history)
            chat.updated_at = datetime.utcnow()
            db.session.commit()
        except Exception:
            logger.exception('Failed to save chat history')

@socketio.on('stop_stream')
def handle_stop_stream(_data):
    pass   # client closes; the generator will hit a broken-pipe and exit naturally

