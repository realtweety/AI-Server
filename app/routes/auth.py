# app/routes/auth.py
"""
WilburtAI — Authentication API (JSON, no Jinja templates)
All routes return JSON so the React SPA can handle auth client-side.
"""
import re
from flask import Blueprint, request, jsonify
from flask_login import login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from app.models.chat import User
from app import db

auth_bp = Blueprint('auth', __name__)


def _user_payload(user):
    return {'id': user.id, 'username': user.username, 'is_admin': bool(user.is_admin)}


@auth_bp.route('/api/auth/status')
def auth_status():
    if current_user.is_authenticated:
        return jsonify({'authenticated': True, 'user': _user_payload(current_user)})
    return jsonify({'authenticated': False})


@auth_bp.route('/api/auth/login', methods=['POST'])
def api_login():
    data     = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '')
    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400
    user = User.query.filter_by(username=username).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Invalid username or password'}), 401
    login_user(user, remember=True)
    return jsonify({'success': True, 'user': _user_payload(user)})


@auth_bp.route('/api/auth/register', methods=['POST'])
def api_register():
    data     = request.get_json() or {}
    username = (data.get('username') or '').strip()
    email    = (data.get('email')    or '').strip().lower()
    password = (data.get('password') or '')
    if len(username) < 3:
        return jsonify({'error': 'Username must be at least 3 characters'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    if not re.match(r'^[^@]+@[^@]+\.[^@]+$', email):
        return jsonify({'error': 'Invalid email address'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already taken'}), 409
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already registered'}), 409
    user = User(username=username, email=email, password_hash=generate_password_hash(password))
    db.session.add(user)
    db.session.commit()
    login_user(user, remember=True)
    return jsonify({'success': True, 'user': _user_payload(user)}), 201


@auth_bp.route('/api/auth/logout', methods=['POST'])
@login_required
def api_logout():
    logout_user()
    return jsonify({'success': True})
