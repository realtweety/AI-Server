# app/routes/__init__.py
"""
WilburtAI Micro Server - Routes Package
"""

from .auth import auth_bp
from .chats import chats_bp
from .llm import llm_bp

__all__ = ['auth_bp', 'chats_bp', 'llm_bp']
