# app/routes/memory.py
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from app.models.chat import UserMemory
from app import db
from datetime import datetime, timezone

memory_bp = Blueprint('memory', __name__)

@memory_bp.route('/api/memory', methods=['GET'])
@login_required
def get_memory():
    mem = UserMemory.query.filter_by(user_id=current_user.id).first()
    return jsonify({'content': mem.content if mem else ''})

@memory_bp.route('/api/memory', methods=['POST'])
@login_required
def save_memory():
    content = (request.get_json() or {}).get('content', '').strip()
    mem = UserMemory.query.filter_by(user_id=current_user.id).first()
    if mem:
        mem.content    = content
        mem.updated_at = datetime.now(timezone.utc)
    else:
        mem = UserMemory(user_id=current_user.id, content=content)
        db.session.add(mem)
    db.session.commit()
    return jsonify({'status': 'saved'})
