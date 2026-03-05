# app/models/chat.py
"""
WilburtAI — Database Models
Migrations handled automatically by run.py.
"""
import uuid
from datetime import datetime
from app import db
from flask_login import UserMixin


class User(db.Model, UserMixin):
    id            = db.Column(db.Integer,     primary_key=True)
    username      = db.Column(db.String(80),  unique=True, nullable=False)
    email         = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin      = db.Column(db.Boolean,     nullable=False, default=False)
    created_at    = db.Column(db.DateTime,    default=datetime.utcnow)
    chats         = db.relationship('Chat',     backref='user', lazy=True, cascade='all, delete-orphan')
    documents     = db.relationship('Document', backref='user', lazy=True, cascade='all, delete-orphan')


class Chat(db.Model):
    id            = db.Column(db.String(36),  primary_key=True)
    user_id       = db.Column(db.Integer,     db.ForeignKey('user.id'), nullable=False)
    title         = db.Column(db.String(200), nullable=False, default='New Chat')
    created_at    = db.Column(db.DateTime,    default=datetime.utcnow)
    updated_at    = db.Column(db.DateTime,    default=datetime.utcnow)
    history       = db.Column(db.Text,        nullable=False)
    system_prompt = db.Column(db.Text,        nullable=True, default='')
    pinned        = db.Column(db.Boolean,     nullable=False, default=False)

    def to_dict(self):
        return {
            'id':            self.id,
            'title':         self.title,
            'system_prompt': self.system_prompt or '',
            'created_at':    self.created_at.isoformat(),
            'updated_at':    self.updated_at.isoformat(),
            'pinned':        bool(self.pinned),
        }


class Message(db.Model):
    id         = db.Column(db.Integer,    primary_key=True)
    chat_id    = db.Column(db.String(36), db.ForeignKey('chat.id'), nullable=False)
    role       = db.Column(db.String(20), nullable=False)
    content    = db.Column(db.Text,       nullable=False)
    created_at = db.Column(db.DateTime,   default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id, 'chat_id': self.chat_id,
            'role': self.role, 'content': self.content,
            'created_at': self.created_at.isoformat(),
        }


# ---------------------------------------------------------------------------
# RAG models
# ---------------------------------------------------------------------------

class Document(db.Model):
    """A file uploaded by a user for RAG retrieval."""
    id         = db.Column(db.String(36),  primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = db.Column(db.Integer,     db.ForeignKey('user.id'), nullable=False)
    filename   = db.Column(db.String(255), nullable=False)
    char_count = db.Column(db.Integer,     nullable=False, default=0)
    chunk_count= db.Column(db.Integer,     nullable=False, default=0)
    created_at = db.Column(db.DateTime,    default=datetime.utcnow)
    chunks     = db.relationship('Chunk',  backref='document', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id':          self.id,
            'filename':    self.filename,
            'char_count':  self.char_count,
            'chunk_count': self.chunk_count,
            'created_at':  self.created_at.isoformat(),
        }


class Chunk(db.Model):
    """One chunk of a Document, optionally carrying its embedding vector."""
    id          = db.Column(db.Integer,    primary_key=True)
    document_id = db.Column(db.String(36), db.ForeignKey('document.id'), nullable=False)
    chunk_index = db.Column(db.Integer,    nullable=False)
    text        = db.Column(db.Text,       nullable=False)
    # Embedding stored as a compact JSON float array — e.g. "[0.12, -0.04, ...]"
    embedding   = db.Column(db.Text,       nullable=True)

class UserMemory(db.Model):
    """Persistent per-user memory injected into every system prompt."""
    __tablename__ = 'user_memory'
    id         = db.Column(db.Integer,     primary_key=True)
    user_id    = db.Column(db.Integer,     db.ForeignKey('user.id', ondelete='CASCADE'), unique=True)
    content    = db.Column(db.Text,        nullable=False, default='')
    updated_at = db.Column(db.DateTime,    default=datetime.utcnow)
    user       = db.relationship('User',   backref=db.backref('memory', uselist=False, cascade='all,delete-orphan'))
