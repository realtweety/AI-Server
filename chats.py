# app/routes/chats.py
"""
WilburtAI Micro Server - Chat Management Routes
"""

from flask import Blueprint, render_template, request, jsonify
from flask_login import login_required, current_user
from app.models.chat import Chat
from app.utils.validators import validate_chat_id
from app import db
import json
import uuid

chats_bp = Blueprint('chats', __name__)


@chats_bp.route('/')
@login_required
def chat_list():
    """Main chat list page."""
    return render_template('index.html')


@chats_bp.route('/api/chats', methods=['GET'])
@login_required
def get_chats():
    """Get all chats for the current user."""
    chats = Chat.query.filter_by(user_id=current_user.id).order_by(Chat.updated_at.desc()).all()

    chat_list = []
    for chat in chats:
        chat_dict = chat.to_dict()
        try:
            history = json.loads(chat.history)
            if history:
                last = history[-1]
                prefix = "You" if last['role'] == 'user' else "AI"
                chat_dict['preview'] = f"{prefix}: {last['content'][:60]}…"
            else:
                chat_dict['preview'] = "No messages yet"
        except Exception:
            chat_dict['preview'] = "Error loading preview"

        chat_list.append(chat_dict)

    return jsonify(chat_list)


@chats_bp.route('/api/chats', methods=['POST'])
@login_required
def create_chat():
    """Create a new chat."""
    chat_id = str(uuid.uuid4())

    new_chat = Chat(
        id=chat_id,
        user_id=current_user.id,
        title="New Chat",
        history=json.dumps([])
    )

    db.session.add(new_chat)
    db.session.commit()

    return jsonify({'chat_id': chat_id})


@chats_bp.route('/api/chats/<chat_id>', methods=['GET'])
@login_required
def load_chat(chat_id):
    """Load a specific chat."""
    # FIX: Validate chat_id before using it in a query to prevent injection/traversal
    if not validate_chat_id(chat_id):
        return jsonify({'error': 'Invalid chat ID'}), 400

    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()

    try:
        history = json.loads(chat.history)
    except (json.JSONDecodeError, TypeError):
        history = []

    return jsonify({'history': history})


@chats_bp.route('/api/chats/<chat_id>', methods=['PUT'])
@login_required
def update_chat_title(chat_id):
    """Update chat title."""
    # FIX: Validate chat_id
    if not validate_chat_id(chat_id):
        return jsonify({'error': 'Invalid chat ID'}), 400

    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()

    data = request.get_json()
    if not data or 'title' not in data:
        return jsonify({'error': 'Title is required'}), 400

    # Trim and cap the title to match what the model/DB expects
    chat.title = str(data['title']).strip()[:200]
    db.session.commit()

    return jsonify({'status': 'success'})


@chats_bp.route('/api/chats/<chat_id>', methods=['DELETE'])
@login_required
def delete_chat(chat_id):
    """Delete a chat."""
    # FIX: Validate chat_id
    if not validate_chat_id(chat_id):
        return jsonify({'error': 'Invalid chat ID'}), 400

    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()

    db.session.delete(chat)
    db.session.commit()

    return jsonify({'status': 'deleted'})
