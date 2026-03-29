# app/routes/__init__.py
"""
WilburtAI Micro Server - Routes Package
"""

from .auth   import auth_bp
from .chats  import chats_bp
from .llm    import llm_bp
from .admin  import admin_bp
from .memory import memory_bp
from .rag    import rag_bp

__all__ = ['auth_bp', 'chats_bp', 'llm_bp', 'admin_bp', 'memory_bp', 'rag_bp']
