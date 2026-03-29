# app/services/chat_service.py
"""
WilburtAI Micro Server - Chat Service Layer

NOTE: This service class is currently unused. Chat DB operations are handled
directly in app/routes/chats.py. This file is kept as a placeholder for a
future refactor that moves business logic out of the route layer.
"""

import json
import uuid
from datetime import datetime, timezone          # Fix: timezone was missing
from app.models.chat import Chat
from app import db


class ChatService:
    """Business logic for chat operations."""

    @staticmethod
    def create_new_chat(user_id):
        chat_id = str(uuid.uuid4())
        new_chat = Chat(
            id=chat_id,
            user_id=user_id,
            title="New Chat",
            history=json.dumps([])
        )
        db.session.add(new_chat)
        db.session.commit()
        return new_chat

    @staticmethod
    def load_chat(chat_id, user_id):
        return Chat.query.filter_by(id=chat_id, user_id=user_id).first()

    @staticmethod
    def update_chat_title(chat_id, user_id, title):
        chat = Chat.query.filter_by(id=chat_id, user_id=user_id).first()
        if chat:
            chat.title = title
            db.session.commit()
            return True
        return False

    @staticmethod
    def delete_chat(chat_id, user_id):
        chat = Chat.query.filter_by(id=chat_id, user_id=user_id).first()
        if chat:
            db.session.delete(chat)
            db.session.commit()
            return True
        return False

    @staticmethod
    def get_user_chats(user_id):
        return Chat.query.filter_by(user_id=user_id).order_by(Chat.updated_at.desc()).all()

    @staticmethod
    def update_chat_history(chat_id, user_id, history):
        chat = Chat.query.filter_by(id=chat_id, user_id=user_id).first()
        if chat:
            chat.history    = json.dumps(history)
            chat.updated_at = datetime.now(timezone.utc)   # Fix: timezone now imported
            db.session.commit()
            return True
        return False
