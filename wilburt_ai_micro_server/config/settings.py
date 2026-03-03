# config/settings.py - WilburtAI Micro Server Configuration
"""
WilburtAI Micro Server - Configuration Settings
"""

import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    """Base configuration class."""
    
    # App settings
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'wilburt-ai-secret-key-change-in-production'
    APP_NAME = 'WilburtAI Micro Server'
    
    # Database settings
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or 'sqlite:///wilburt_ai.db'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # LM Studio settings
    LM_BASE_URL = os.environ.get('LM_BASE_URL') or 'http://localhost:1234'
    
    # Security settings
    SESSION_COOKIE_SECURE = False  # Set to True in production with HTTPS
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
