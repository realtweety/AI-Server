# app/__init__.py
import os
from flask import Flask, redirect
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_socketio import SocketIO
from flask_session import Session
from config.settings import Config

db            = SQLAlchemy()
login_manager = LoginManager()
socketio      = SocketIO()
sess          = Session()

def create_app(config_class=Config):
    app = Flask(__name__, template_folder='templates', static_folder='static')
    app.config.from_object(config_class)

    # Ensure session directory exists
    os.makedirs(app.config['SESSION_FILE_DIR'], exist_ok=True)

    @app.route('/')
    def home():
        return redirect('/auth/')

    db.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = 'auth.login'
    login_manager.login_message_category = 'info'
    sess.init_app(app)

    socketio.init_app(
        app,
        async_mode='threading',
        cors_allowed_origins='*',
        manage_session=False,
    )

    from app.models import User

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    from app.routes.auth   import auth_bp
    from app.routes.admin  import admin_bp
    from app.routes.memory import memory_bp
    from app.routes.chats  import chats_bp
    from app.routes.llm    import llm_bp
    from app.routes.rag    import rag_bp

    app.register_blueprint(auth_bp,   url_prefix='/auth')
    app.register_blueprint(admin_bp,  url_prefix='/admin')
    app.register_blueprint(memory_bp)
    app.register_blueprint(chats_bp,  url_prefix='/chats')
    app.register_blueprint(llm_bp,    url_prefix='/api')
    app.register_blueprint(rag_bp,    url_prefix='/api/rag')

    return app
