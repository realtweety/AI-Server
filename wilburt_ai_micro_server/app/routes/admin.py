# app/routes/admin.py
"""
WilburtAI — Admin panel
The first user to register is automatically made admin.
Admins can create, delete, and manage other users.
"""
from flask import Blueprint, render_template, request, jsonify, redirect, url_for, flash
from flask_login import login_required, current_user
from werkzeug.security import generate_password_hash
from app.models.chat import User
from app import db
import re

admin_bp = Blueprint('admin', __name__)

def require_admin(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated

# ── Pages ────────────────────────────────────────────────────────────────────

@admin_bp.route('/')
@login_required
def admin_index():
    if not current_user.is_admin:
        flash('You do not have admin access.', 'error')
        return redirect(url_for('chats.chat_list'))
    users = User.query.order_by(User.created_at).all()
    return render_template('admin.html', users=users, current_user=current_user)

# ── API ──────────────────────────────────────────────────────────────────────

@admin_bp.route('/api/users', methods=['GET'])
@login_required
@require_admin
def list_users():
    users = User.query.order_by(User.created_at).all()
    return jsonify([{
        'id':         u.id,
        'username':   u.username,
        'email':      u.email,
        'is_admin':   u.is_admin,
        'created_at': u.created_at.isoformat(),
        'chat_count': len(u.chats),
    } for u in users])

@admin_bp.route('/api/users', methods=['POST'])
@login_required
@require_admin
def create_user():
    data     = request.get_json() or {}
    username = (data.get('username') or '').strip()
    email    = (data.get('email')    or '').strip().lower()
    password = (data.get('password') or '').strip()
    is_admin = bool(data.get('is_admin', False))

    if not username or not email or not password:
        return jsonify({'error': 'username, email, and password are all required'}), 400
    if len(username) < 3:
        return jsonify({'error': 'Username must be at least 3 characters'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    if not re.match(r'^[^@]+@[^@]+\.[^@]+$', email):
        return jsonify({'error': 'Invalid email address'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': f'Username "{username}" is already taken'}), 409
    if User.query.filter_by(email=email).first():
        return jsonify({'error': f'Email "{email}" is already registered'}), 409

    user = User(
        username      = username,
        email         = email,
        password_hash = generate_password_hash(password),
        is_admin      = is_admin,
    )
    db.session.add(user)
    db.session.commit()
    return jsonify({'status': 'created', 'id': user.id, 'username': user.username}), 201

@admin_bp.route('/api/users/<int:user_id>', methods=['DELETE'])
@login_required
@require_admin
def delete_user(user_id):
    if user_id == current_user.id:
        return jsonify({'error': 'You cannot delete your own account'}), 400
    user = User.query.get_or_404(user_id)
    db.session.delete(user)
    db.session.commit()
    return jsonify({'status': 'deleted'})

@admin_bp.route('/api/users/<int:user_id>/toggle-admin', methods=['POST'])
@login_required
@require_admin
def toggle_admin(user_id):
    if user_id == current_user.id:
        return jsonify({'error': 'You cannot change your own admin status'}), 400
    user = User.query.get_or_404(user_id)
    user.is_admin = not user.is_admin
    db.session.commit()
    return jsonify({'status': 'ok', 'is_admin': user.is_admin})

@admin_bp.route('/api/users/<int:user_id>/reset-password', methods=['POST'])
@login_required
@require_admin
def reset_password(user_id):
    data     = request.get_json() or {}
    password = (data.get('password') or '').strip()
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    user = User.query.get_or_404(user_id)
    user.password_hash = generate_password_hash(password)
    db.session.commit()
    return jsonify({'status': 'ok'})
