# app/models/chat.py
"""
WilburtAI Micro Server - Database Models
Migration notes (handled automatically by run.py):
  - system_prompt TEXT DEFAULT ''
  - is_admin INTEGER DEFAULT 0
  - pinned INTEGER DEFAULT 0
  - char_count / chunk_count on document
"""

import json
from datetime import datetime, timezone
from app import db
from flask_login import UserMixin


def _now():
    return datetime.now(timezone.utc)


class User(db.Model, UserMixin):
    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(80), unique=True, nullable=False)
    email         = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin      = db.Column(db.Integer, nullable=False, default=0)
    created_at    = db.Column(db.DateTime, default=_now)
    chats         = db.relationship('Chat', backref='user', lazy=True, cascade='all, delete-orphan')


class Chat(db.Model):
    id            = db.Column(db.String(36), primary_key=True)
    user_id       = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title         = db.Column(db.String(200), nullable=False, default='New Chat')
    created_at    = db.Column(db.DateTime, default=_now)
    updated_at    = db.Column(db.DateTime, default=_now)
    history       = db.Column(db.Text, nullable=False)
    system_prompt = db.Column(db.Text, nullable=True, default='')
    pinned        = db.Column(db.Integer, nullable=False, default=0)

    def to_dict(self):
        return {
            'id':            self.id,
            'title':         self.title,
            'system_prompt': self.system_prompt or '',
            'pinned':        bool(self.pinned),
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
    created_at = db.Column(db.DateTime, default=_now)

    def to_dict(self):
        return {
            'id': self.id, 'chat_id': self.chat_id,
            'role': self.role, 'content': self.content,
            'created_at': self.created_at.isoformat(),
        }


class UserMemory(db.Model):
    __tablename__ = 'user_memory'
    id         = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'),
                           unique=True, nullable=False)
    content    = db.Column(db.Text, nullable=False, default='')
    updated_at = db.Column(db.DateTime, nullable=False, default=_now)


class Document(db.Model):
    __tablename__ = 'document'
    id          = db.Column(db.String(36), primary_key=True)
    user_id     = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'),
                            nullable=False)
    filename    = db.Column(db.String(255), nullable=False)
    char_count  = db.Column(db.Integer, default=0)
    chunk_count = db.Column(db.Integer, default=0)
    created_at  = db.Column(db.DateTime, default=_now)
    chunks      = db.relationship('Chunk', backref='document', lazy=True,
                                  cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id':          self.id,
            'filename':    self.filename,
            'char_count':  self.char_count,
            'chunk_count': self.chunk_count,
            'created_at':  self.created_at.isoformat(),
        }


class Chunk(db.Model):
    __tablename__ = 'chunk'
    id          = db.Column(db.Integer, primary_key=True, autoincrement=True)
    document_id = db.Column(db.String(36), db.ForeignKey('document.id', ondelete='CASCADE'),
                            nullable=False)
    chunk_index = db.Column(db.Integer, nullable=False)
    text        = db.Column(db.Text, nullable=False)
    embedding   = db.Column(db.Text, nullable=True)   # JSON-serialised float list
