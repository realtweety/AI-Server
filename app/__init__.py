# app/__init__.py
"""
WilburtAI — Flask application factory
"""
import os
from flask import Flask, send_from_directory, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_socketio import SocketIO
from config.settings import Config

db           = SQLAlchemy()
login_manager = LoginManager()
socketio     = SocketIO()


def create_app():
    # static_folder points at the Vite build output
    dist_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'dist')
    app = Flask(__name__, static_folder=dist_dir, static_url_path='')
    app.config.from_object(Config)

    # ── Extensions ─────────────────────────────────────────────────────────
    db.init_app(app)

    try:
        from flask_session import Session
        os.makedirs(app.config.get('SESSION_FILE_DIR', 'flask_sessions'), exist_ok=True)
        Session(app)
    except ImportError:
        pass  # flask-session optional

    login_manager.init_app(app)
    login_manager.login_view = None   # Never redirect — always return JSON

    @login_manager.unauthorized_handler
    def unauthorized():
        return jsonify({'error': 'Authentication required', 'authenticated': False}), 401

    socketio.init_app(
        app,
        cors_allowed_origins='*',
        async_mode='threading',
        manage_session=False,
    )

    # ── User loader ─────────────────────────────────────────────────────────
    from app.models.chat import User

    @login_manager.user_loader
    def load_user(user_id):
        return User.query.get(int(user_id))

    # ── Blueprints ──────────────────────────────────────────────────────────
    from app.routes.auth   import auth_bp
    from app.routes.chats  import chats_bp
    from app.routes.llm    import llm_bp
    from app.routes.admin  import admin_bp
    from app.routes.memory import memory_bp
    from app.routes.rag    import rag_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(chats_bp, url_prefix='/chats')
    app.register_blueprint(llm_bp,   url_prefix='/api')
    app.register_blueprint(admin_bp, url_prefix='/admin')
    app.register_blueprint(memory_bp)
    app.register_blueprint(rag_bp,   url_prefix='/api/rag')

    # ── SPA catch-all ───────────────────────────────────────────────────────
    # Serve the React build for any route not matched by a blueprint.
    # During development this never fires (Vite serves everything).
    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve_spa(path):
        # Serve a real static file if it exists in dist/
        if path:
            full = os.path.join(dist_dir, path)
            if os.path.isfile(full):
                return send_from_directory(dist_dir, path)
        # Fallback — always send index.html so React Router handles routing
        index = os.path.join(dist_dir, 'index.html')
        if os.path.isfile(index):
            return send_from_directory(dist_dir, 'index.html')
        # Build hasn't run yet
        return jsonify({
            'message': 'Frontend not built. Run: npm install && npm run build'
        }), 200

    return app
