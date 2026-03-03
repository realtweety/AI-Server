# app/models/chat.py
"""
WilburtAI Micro Server - Database Models
NOTE: If upgrading an existing DB, run:
  ALTER TABLE chat ADD COLUMN system_prompt TEXT DEFAULT '';
Or simply delete wilburt_ai.db and let it recreate.
"""

from datetime import datetime
from app import db
from flask_login import UserMixin


class User(db.Model, UserMixin):
    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(80), unique=True, nullable=False)
    email         = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    chats = db.relationship('Chat', backref='user', lazy=True, cascade='all, delete-orphan')


class Chat(db.Model):
    id            = db.Column(db.String(36), primary_key=True)
    user_id       = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title         = db.Column(db.String(200), nullable=False, default='New Chat')
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at    = db.Column(db.DateTime, default=datetime.utcnow)
    history       = db.Column(db.Text, nullable=False)
    # Stores the optional system prompt for this chat
    system_prompt = db.Column(db.Text, nullable=True, default='')

    def to_dict(self):
        return {
            'id':            self.id,
            'title':         self.title,
            'system_prompt': self.system_prompt or '',
            'created_at':    self.created_at.isoformat(),
            'updated_at':    self.updated_at.isoformat(),
        }

    def __repr__(self):
        return f'<Chat {self.title}>'


class Message(db.Model):
    id         = db.Column(db.Integer, primary_key=True)
    chat_id    = db.Column(db.String(36), db.ForeignKey('chat.id'), nullable=False)
    role       = db.Column(db.String(20), nullable=False)
    content    = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id':         self.id,
            'chat_id':    self.chat_id,
            'role':       self.role,
            'content':    self.content,
            'created_at': self.created_at.isoformat(),
        }
