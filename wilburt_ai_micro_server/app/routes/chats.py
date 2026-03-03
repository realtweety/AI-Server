# app/routes/chats.py
"""
WilburtAI Micro Server - Chat Management Routes
"""

from flask import Blueprint, render_template, request, jsonify
from flask_login import login_required, current_user
from app.models.chat import Chat
from app.utils.validators import validate_chat_id
from app import db
from datetime import datetime
import json
import uuid

chats_bp = Blueprint('chats', __name__)


@chats_bp.route('/')
@login_required
def chat_list():
    return render_template('index.html')


@chats_bp.route('/api/chats', methods=['GET'])
@login_required
def get_chats():
    chats = Chat.query.filter_by(user_id=current_user.id).order_by(Chat.updated_at.desc()).all()

    result = []
    for chat in chats:
        d = chat.to_dict()
        try:
            history = json.loads(chat.history)
            if history:
                # Skip system-role messages for preview
                visible = [m for m in history if m['role'] != 'system']
                if visible:
                    last   = visible[-1]
                    prefix = 'You' if last['role'] == 'user' else 'AI'
                    d['preview'] = f"{prefix}: {last['content'][:60]}…"
                else:
                    d['preview'] = 'No messages yet'
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
    chat.updated_at = datetime.utcnow()
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
        chat.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify({'status': 'ok'})
    return jsonify({'status': 'nothing_to_pop'})
