# run.py - WilburtAI Micro Server Entry Point

import os
from app import create_app, db
from sqlalchemy import text

app = create_app()

def run_migrations():
    """
    Runs inside the app context using SQLAlchemy's own engine.
    Safe to call every startup — only adds columns that are missing.
    Add new schema changes here as _ensure_column() calls.
    """
    with db.engine.connect() as conn:
        _ensure_column(conn, 'chat', 'system_prompt', "TEXT DEFAULT ''")
        conn.commit()

def _ensure_column(conn, table, column, column_def):
    result   = conn.execute(text(f"PRAGMA table_info({table})"))
    existing = [row[1] for row in result]
    if column not in existing:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {column_def}"))
        print(f"[migration] Added column '{column}' to table '{table}'")

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        run_migrations()

    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
