# app/__init__.py - Clean Working Version
"""
WilburtAI Micro Server - Modern Flask Implementation
"""

import os
from flask import Flask, redirect
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from config.settings import Config

# Initialize extensions
db = SQLAlchemy()
login_manager = LoginManager()

def create_app(config_class=Config):
    """Application factory for creating WilburtAI Micro Server instances."""
    
    app = Flask(__name__, template_folder='templates', static_folder='static')
    app.config.from_object(config_class)

    # Root route (so "/" works)
    @app.route('/')
    def home():
        return redirect('/auth/')

    # Initialize extensions
    db.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = 'auth.login'
    login_manager.login_message_category = 'info'

    from app.models import User

    @login_manager.user_loader
    def load_user(user_id):
        return User.query.get(int(user_id))
    
    # Register blueprints - import here to avoid circular imports
    from app.routes.auth import auth_bp
    from app.routes.chats import chats_bp
    from app.routes.llm import llm_bp
    
    app.register_blueprint(auth_bp, url_prefix='/auth')
    app.register_blueprint(chats_bp, url_prefix='/chats')
    app.register_blueprint(llm_bp, url_prefix='/api')
    
    return app