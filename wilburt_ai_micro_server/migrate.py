"""
Run this once from your project root to add missing columns:
    python migrate.py
"""
import sqlite3, os, glob

# Find the DB wherever it might be
candidates = [
    'wilburt_ai.db',
    'instance/wilburt_ai.db',
    os.path.join('app', 'wilburt_ai.db'),
]
# Also search recursively just in case
candidates += glob.glob('**/*.db', recursive=True)

db_path = None
for c in candidates:
    if os.path.exists(c):
        db_path = c
        break

if not db_path:
    print("ERROR: Could not find wilburt_ai.db — make sure you run this from your project root.")
    exit(1)

print(f"Found database: {db_path}")

def add_col(conn, table, column, col_type):
    try:
        conn.execute(f'ALTER TABLE {table} ADD COLUMN {column} {col_type}')
        conn.commit()
        print(f"  ✓ Added {table}.{column}")
    except Exception as e:
        if 'duplicate column' in str(e).lower() or 'already exists' in str(e).lower():
            print(f"  — {table}.{column} already exists, skipping")
        else:
            print(f"  ✗ {table}.{column}: {e}")

with sqlite3.connect(db_path) as conn:
    add_col(conn, 'user', 'is_admin',   'INTEGER DEFAULT 0')
    add_col(conn, 'chat', 'pinned',     'INTEGER DEFAULT 0')
    add_col(conn, 'chat', 'system_prompt', 'TEXT DEFAULT ""')

    # Auto-promote first registered user to admin
    conn.execute('UPDATE user SET is_admin=1 WHERE id=(SELECT MIN(id) FROM user)')
    conn.commit()
    print("  ✓ First user promoted to admin")

    # User memory table
    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS user_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL REFERENCES user(id) ON DELETE CASCADE,
            content TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""")
        conn.commit()
        print("  ✓ user_memory table ready")
    except Exception as e:
        print(f"  — user_memory: {e}")

    # FTS5 virtual table
    try:
        conn.execute("""CREATE VIRTUAL TABLE IF NOT EXISTS chat_fts
            USING fts5(chat_id, role, content, tokenize='porter unicode61')
        """)
        conn.commit()
        print("  ✓ chat_fts FTS5 table ready")
    except Exception as e:
        print(f"  — chat_fts: {e}")

print("\nMigration complete. Restart your server now.")
