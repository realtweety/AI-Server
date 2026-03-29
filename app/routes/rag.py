# app/routes/rag.py
"""
WilburtAI — RAG (Retrieval Augmented Generation) Routes

Upload flow:
  POST /api/rag/upload          — receive file, chunk, embed, store
  GET  /api/rag/documents       — list user's documents
  DELETE /api/rag/documents/<id>— delete a document + its chunks

Retrieval is called internally from llm.py during chat streaming.
"""

import json
import math
import uuid
import logging
import requests

from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from app.models.chat import Document, Chunk
from app import db
from config.settings import Config

rag_bp = Blueprint('rag', __name__)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Text utilities
# ---------------------------------------------------------------------------

def chunk_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Split *text* into overlapping windows of roughly *chunk_size* chars."""
    chunks, start = [], 0
    while start < len(text):
        end = start + chunk_size
        # Try to break on a sentence boundary within the last 100 chars
        window = text[start:end]
        if end < len(text):
            boundary = max(window.rfind('. '), window.rfind('\n'))
            if boundary > chunk_size // 2:
                end = start + boundary + 1
        chunks.append(text[start:end].strip())
        start = end - overlap
    return [c for c in chunks if c]


def extract_text(file_obj, filename: str) -> str | None:
    """Return plain text from a .txt, .md, or .pdf file object."""
    ext = filename.rsplit('.', 1)[-1].lower()
    if ext in ('txt', 'md'):
        return file_obj.read().decode('utf-8', errors='ignore')
    if ext == 'pdf':
        try:
            from pypdf import PdfReader
            reader = PdfReader(file_obj)
            pages  = [page.extract_text() or '' for page in reader.pages]
            return '\n\n'.join(pages)
        except ImportError:
            logger.warning('pypdf not installed — PDF support unavailable')
            return None
    return None


# ---------------------------------------------------------------------------
# Embedding helpers
# ---------------------------------------------------------------------------

def get_embeddings(texts: list[str], model: str) -> list[list[float]] | None:
    """
    Call LM Studio's /v1/embeddings endpoint.
    Returns a list of float vectors, one per input text.
    Returns None on failure.
    """
    try:
        resp = requests.post(
            f"{Config.LM_BASE_URL}/v1/embeddings",
            json={'input': texts, 'model': model},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()['data']
        # Sort by index in case they come back out of order
        data.sort(key=lambda x: x['index'])
        return [d['embedding'] for d in data]
    except Exception as e:
        logger.warning(f'Embedding request failed: {e}')
        return None


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot    = sum(x * y for x, y in zip(a, b))
    mag_a  = math.sqrt(sum(x ** 2 for x in a))
    mag_b  = math.sqrt(sum(x ** 2 for x in b))
    return dot / (mag_a * mag_b) if mag_a and mag_b else 0.0


# ---------------------------------------------------------------------------
# Public retrieval helper (called from llm.py)
# ---------------------------------------------------------------------------

def retrieve_context(user_id: int, query: str, embedding_model: str, top_k: int = 4) -> str | None:
    """
    Embed *query*, find the top-k most similar chunks belonging to *user_id*,
    and return them as a formatted context string.
    Returns None if no documents exist or embedding fails.
    """
    chunks = (Chunk.query
              .join(Document)
              .filter(Document.user_id == user_id, Chunk.embedding.isnot(None))
              .all())
    if not chunks:
        return None

    query_embs = get_embeddings([query], embedding_model)
    if not query_embs:
        # Fall back to keyword match (first chunk containing any query word)
        words  = set(query.lower().split())
        scored = [(sum(1 for w in words if w in c.text.lower()), c) for c in chunks]
        scored.sort(key=lambda x: x[0], reverse=True)
        top    = [c.text for _, c in scored[:top_k] if _]
    else:
        query_emb = query_embs[0]
        scored    = []
        for chunk in chunks:
            try:
                emb   = json.loads(chunk.embedding)
                score = cosine_similarity(query_emb, emb)
                scored.append((score, chunk.text))
            except Exception:
                pass
        scored.sort(key=lambda x: x[0], reverse=True)
        top = [text for _, text in scored[:top_k]]

    if not top:
        return None

    return (
        "The following excerpts from uploaded documents may be relevant to the user's message. "
        "Use them to inform your answer where applicable:\n\n"
        + "\n\n---\n\n".join(top)
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@rag_bp.route('/upload', methods=['POST'])
@login_required
def upload_document():
    file           = request.files.get('file')
    embedding_model= request.form.get('embedding_model', '').strip()

    if not file or not file.filename:
        return jsonify({'error': 'No file provided'}), 400
    if not embedding_model:
        return jsonify({'error': 'embedding_model is required'}), 400

    text = extract_text(file, file.filename)
    if text is None:
        return jsonify({'error': 'Unsupported file type or extraction failed. Supported: .txt .md .pdf'}), 422

    text = text.strip()
    if not text:
        return jsonify({'error': 'File appears to be empty after extraction'}), 422

    chunk_size = current_app.config.get('RAG_CHUNK_SIZE', 500)
    overlap    = current_app.config.get('RAG_CHUNK_OVERLAP', 60)
    raw_chunks = chunk_text(text, chunk_size, overlap)

    if not raw_chunks:
        return jsonify({'error': 'No content could be extracted from the file'}), 422

    # Create document record
    doc = Document(
        id         = str(uuid.uuid4()),
        user_id    = current_user.id,
        filename   = file.filename,
        char_count = len(text),
        chunk_count= len(raw_chunks),
    )
    db.session.add(doc)
    db.session.flush()   # get doc.id without committing yet

    # Embed in batches of 20 to avoid huge requests
    embeddings   = []
    batch_size   = 20
    embed_failed = False
    for i in range(0, len(raw_chunks), batch_size):
        batch = raw_chunks[i:i + batch_size]
        embs  = get_embeddings(batch, embedding_model)
        if embs is None:
            embed_failed = True
            embeddings.extend([None] * len(batch))
        else:
            embeddings.extend(embs)

    for idx, (chunk_text_val, emb) in enumerate(zip(raw_chunks, embeddings)):
        chunk = Chunk(
            document_id = doc.id,
            chunk_index = idx,
            text        = chunk_text_val,
            embedding   = json.dumps(emb) if emb is not None else None,
        )
        db.session.add(chunk)

    db.session.commit()

    return jsonify({
        'document': doc.to_dict(),
        'embedded': not embed_failed,
        'warning':  'Embedding failed — keyword fallback will be used' if embed_failed else None,
    })


@rag_bp.route('/documents', methods=['GET'])
@login_required
def list_documents():
    docs = (Document.query
            .filter_by(user_id=current_user.id)
            .order_by(Document.created_at.desc())
            .all())
    return jsonify([d.to_dict() for d in docs])


@rag_bp.route('/documents/<doc_id>', methods=['DELETE'])
@login_required
def delete_document(doc_id):
    doc = Document.query.filter_by(id=doc_id, user_id=current_user.id).first_or_404()
    db.session.delete(doc)
    db.session.commit()
    return jsonify({'status': 'deleted'})

@rag_bp.route('/extract', methods=['POST'])
@login_required
def extract_file_text():
    """
    Lightweight endpoint: extract plain text from an uploaded file for
    inline context injection (not RAG storage — just one-shot use).
    Supports PDF; all other text types are handled client-side.
    """
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({'error': 'No file provided'}), 400
    text = extract_text(file, file.filename)
    if text is None:
        return jsonify({'error': 'Could not extract text from this file type'}), 422
    return jsonify({'text': text.strip(), 'filename': file.filename})
