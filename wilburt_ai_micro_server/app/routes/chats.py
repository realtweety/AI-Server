# app/routes/chats.py
import re
import os
import json
import uuid
from datetime import datetime, timezone
from flask import Blueprint, render_template, request, jsonify, current_app
from flask_login import login_required, current_user
from app.models.chat import Chat
from app.utils.validators import validate_chat_id
from app import db

chats_bp = Blueprint('chats', __name__)


@chats_bp.route('/')
@login_required
def chat_list():
    return render_template('index.html')


@chats_bp.route('/api/chats', methods=['GET'])
@login_required
def get_chats():
    chats = Chat.query.filter_by(user_id=current_user.id).order_by(Chat.pinned.desc(), Chat.updated_at.desc()).all()
    result = []
    for chat in chats:
        d = chat.to_dict()
        try:
            history = json.loads(chat.history)
            visible = [m for m in history if m['role'] != 'system']
            if visible:
                last        = visible[-1]
                raw_content = last['content']
                if isinstance(raw_content, list):
                    text_parts  = [p.get('text', '') for p in raw_content if p.get('type') == 'text']
                    raw_content = ' '.join(text_parts)
                raw_content = re.sub(r'<think>[\s\S]*?</think>', '', raw_content).strip()
                raw_content = re.sub(r'\[THINK\][\s\S]*?\[/THINK\]', '', raw_content, flags=re.IGNORECASE).strip()
                prefix       = 'You' if last['role'] == 'user' else 'AI'
                d['preview'] = f"{prefix}: {raw_content[:60]}..."
            else:
                d['preview'] = 'No messages yet'
        except Exception:
            d['preview'] = 'Error loading preview'
        result.append(d)
    return jsonify(result)


@chats_bp.route('/api/chats', methods=['POST'])
@login_required
def create_chat():
    chat_id  = str(uuid.uuid4())
    new_chat = Chat(
        id=chat_id, user_id=current_user.id,
        title='New Chat', history=json.dumps([]),
        system_prompt='',
    )
    db.session.add(new_chat)
    db.session.commit()
    return jsonify({'chat_id': chat_id})


@chats_bp.route('/api/chats/<chat_id>', methods=['GET'])
@login_required
def load_chat(chat_id):
    if not validate_chat_id(chat_id):
        return jsonify({'error': 'Invalid chat ID'}), 400
    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()
    try:
        history = json.loads(chat.history)
    except (json.JSONDecodeError, TypeError):
        history = []
    return jsonify({
        'history':       history,
        'system_prompt': chat.system_prompt or '',
    })


@chats_bp.route('/api/chats/<chat_id>', methods=['PUT'])
@login_required
def update_chat(chat_id):
    if not validate_chat_id(chat_id):
        return jsonify({'error': 'Invalid chat ID'}), 400
    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()
    data = request.get_json() or {}
    if 'title' in data:
        chat.title = str(data['title']).strip()[:200]
    if 'system_prompt' in data:
        chat.system_prompt = str(data['system_prompt'])
    chat.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    return jsonify({'status': 'success'})


@chats_bp.route('/api/chats/<chat_id>', methods=['DELETE'])
@login_required
def delete_chat(chat_id):
    if not validate_chat_id(chat_id):
        return jsonify({'error': 'Invalid chat ID'}), 400
    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()
    db.session.delete(chat)
    db.session.commit()
    return jsonify({'status': 'deleted'})


@chats_bp.route('/api/chats/<chat_id>/pop', methods=['POST'])
@login_required
def pop_last_message(chat_id):
    if not validate_chat_id(chat_id):
        return jsonify({'error': 'Invalid chat ID'}), 400
    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()
    try:
        history = json.loads(chat.history)
    except (json.JSONDecodeError, TypeError):
        history = []
    if history and history[-1]['role'] == 'assistant':
        history.pop()
        chat.history    = json.dumps(history)
        chat.updated_at = datetime.now(timezone.utc)
        db.session.commit()
        return jsonify({'status': 'ok'})
    return jsonify({'status': 'nothing_to_pop'})


@chats_bp.route('/api/chats/<chat_id>/pin', methods=['POST'])
@login_required
def pin_chat(chat_id):
    if not validate_chat_id(chat_id):
        return jsonify({'error': 'Invalid chat ID'}), 400
    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()
    chat.pinned     = not chat.pinned
    chat.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    return jsonify({'pinned': chat.pinned})


@chats_bp.route('/api/chats/<chat_id>/truncate', methods=['POST'])
@login_required
def truncate_history(chat_id):
    if not validate_chat_id(chat_id):
        return jsonify({'error': 'Invalid chat ID'}), 400
    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()
    data = request.get_json() or {}
    from_index = data.get('from_index')
    if from_index is None or not isinstance(from_index, int) or from_index < 0:
        return jsonify({'error': 'from_index must be a non-negative integer'}), 400
    try:
        history = json.loads(chat.history)
    except (json.JSONDecodeError, TypeError):
        history = []
    chat.history    = json.dumps(history[:from_index])
    chat.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    return jsonify({'status': 'ok', 'new_length': from_index})


@chats_bp.route('/api/search', methods=['GET'])
@login_required
def full_text_search():
    """FTS5 search across all of the current user's chat messages."""
    q = request.args.get('q', '').strip()
    if not q or len(q) < 2:
        return jsonify({'results': []})

    import sqlite3 as _sqlite3
    import json as _json

    db_path = _resolve_db_path()
    results = []
    try:
        with _sqlite3.connect(db_path) as conn:
            chats = conn.execute(
                'SELECT id FROM chat WHERE user_id=?', (current_user.id,)
            ).fetchall()
            chat_ids = [r[0] for r in chats]
            if not chat_ids:
                return jsonify({'results': []})

            placeholders = ','.join('?' * len(chat_ids))
            rows = conn.execute(f"""
                SELECT f.chat_id, f.role, snippet(chat_fts, 2, '<mark>', '</mark>', '...', 20)
                FROM chat_fts f
                WHERE chat_fts MATCH ? AND f.chat_id IN ({placeholders})
                ORDER BY rank
                LIMIT 30
            """, [q] + chat_ids).fetchall()

            title_map = dict(conn.execute(
                f"SELECT id, title FROM chat WHERE id IN ({placeholders})", chat_ids
            ).fetchall())

            seen = set()
            for chat_id, role, snippet in rows:
                if chat_id not in seen:
                    seen.add(chat_id)
                    results.append({
                        'chat_id': chat_id,
                        'title':   title_map.get(chat_id, 'Untitled'),
                        'snippet': snippet,
                        'role':    role,
                    })
    except Exception as e:
        current_app.logger.warning(f'FTS search error: {e}')
        return jsonify({'results': [], 'error': str(e)})

    return jsonify({'results': results})


@chats_bp.route('/api/fts-index', methods=['POST'])
@login_required
def rebuild_fts_index():
    """Rebuild the FTS index for the current user."""
    import sqlite3 as _sqlite3
    import json as _json

    db_path = _resolve_db_path()
    try:
        with _sqlite3.connect(db_path) as conn:
            chats = conn.execute(
                'SELECT id, history FROM chat WHERE user_id=?', (current_user.id,)
            ).fetchall()
            for chat_id, history_json in chats:
                try:
                    messages = _json.loads(history_json or '[]')
                except Exception:
                    continue
                conn.execute('DELETE FROM chat_fts WHERE chat_id=?', (chat_id,))
                for msg in messages:
                    role    = msg.get('role', '')
                    content = msg.get('content', '')
                    if isinstance(content, list):
                        content = ' '.join(p.get('text', '') for p in content if isinstance(p, dict))
                    if content:
                        conn.execute(
                            'INSERT INTO chat_fts(chat_id, role, content) VALUES (?,?,?)',
                            (chat_id, role, content)
                        )
            conn.commit()
    except Exception as e:
        current_app.logger.warning(f'FTS rebuild error: {e}')
        return jsonify({'status': 'error', 'detail': str(e)}), 500

    return jsonify({'status': 'ok'})


def _resolve_db_path():
    """Resolve the SQLite database path reliably regardless of CWD."""
    from app import db as _db
    # SQLAlchemy engine knows the exact path it's connected to
    db_url = str(_db.engine.url)
    path = db_url.replace('sqlite:///', '').replace('sqlite://', '')
    if not os.path.isabs(path):
        # Relative — resolve against the project root (two levels up from this file)
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        path = os.path.join(project_root, path)
    return os.path.abspath(path)
