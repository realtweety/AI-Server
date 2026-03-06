# config/settings.py
import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Core
    SECRET_KEY  = os.environ.get('SECRET_KEY') or 'wilburt-ai-secret-change-in-production'
    APP_NAME    = 'WilburtAI Micro Server'

    # Database
    SQLALCHEMY_DATABASE_URI      = os.environ.get('DATABASE_URL') or 'sqlite:///wilburt_ai.db'
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Session persistence (filesystem backend)
    SESSION_TYPE             = 'filesystem'
    SESSION_FILE_DIR         = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'flask_sessions')
    SESSION_PERMANENT        = True
    PERMANENT_SESSION_LIFETIME = timedelta(days=30)
    SESSION_COOKIE_SECURE    = False   # set True in production with real HTTPS
    SESSION_COOKIE_HTTPONLY  = True
    SESSION_COOKIE_SAMESITE  = 'Lax'

    # LM Studio
    LM_BASE_URL = os.environ.get('LM_BASE_URL') or 'http://localhost:1234'

    # File uploads
    MAX_CONTENT_LENGTH = 32 * 1024 * 1024   # 32 MB

    # Input limits

    # RAG
    RAG_CHUNK_SIZE    = 500
    RAG_CHUNK_OVERLAP = 60
    RAG_TOP_K         = 4

    # Context window (used for pruning warning)
    CONTEXT_WINDOW_DEFAULT = 4096
