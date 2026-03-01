# app/routes/chats.py - Clean Working Version
"""
WilburtAI Micro Server - Chat Management Routes
"""

from flask import Blueprint, render_template, request, jsonify, redirect, url_for
from flask_login import login_required, current_user
from app.models.chat import Chat
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
        # Add preview of last message
        try:
            history = json.loads(chat.history)
            if history:
                last_message = history[-1]
                if last_message['role'] == 'user':
                    chat_dict['preview'] = f"You: {last_message['content'][:60]}..."
                else:
                    chat_dict['preview'] = f"AI: {last_message['content'][:60]}..."
            else:
                chat_dict['preview'] = "No messages yet"
        except:
            chat_dict['preview'] = "Error loading preview"
        
        chat_list.append(chat_dict)
    
    return jsonify(chat_list)

@chats_bp.route('/api/chats', methods=['POST'])
@login_required
def create_chat():
    """Create a new chat."""
    chat_id = str(uuid.uuid4())
    
    # Create new chat
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
    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()
    
    try:
        history = json.loads(chat.history)
    except:
        history = []
    
    return jsonify({'history': history})

@chats_bp.route('/api/chats/<chat_id>', methods=['PUT'])
@login_required
def update_chat_title(chat_id):
    """Update chat title."""
    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()
    
    data = request.get_json()
    if 'title' not in data:
        return jsonify({'error': 'Title is required'}), 400
    
    chat.title = data['title']
    db.session.commit()
    
    return jsonify({'status': 'success'})

@chats_bp.route('/api/chats/<chat_id>', methods=['DELETE'])
@login_required
def delete_chat(chat_id):
    """Delete a chat."""
    chat = Chat.query.filter_by(id=chat_id, user_id=current_user.id).first_or_404()
    
    db.session.delete(chat)
    db.session.commit()
    
    return jsonify({'status': 'deleted'})
