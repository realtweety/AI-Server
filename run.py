# run.py
"""
WilburtAI entry point.
- Generates self-signed TLS cert on first run (HTTPS)
- Auto-migrates DB (adds new columns if missing)
- Serves via Flask-SocketIO in threading mode (works on Python 3.12+)
"""
import os, ssl, logging, sqlite3
from app import create_app, socketio, db
from config.settings import Config

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Self-signed certificate generation
# ---------------------------------------------------------------------------
CERT_FILE = 'server.crt'
KEY_FILE  = 'server.key'

def ensure_ssl_cert():
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        return
    logger.info('Generating self-signed TLS certificate...')
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.backends import default_backend
        import datetime

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048, backend=default_backend())
        name = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, 'US'),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'WilburtAI'),
            x509.NameAttribute(NameOID.COMMON_NAME, 'localhost'),
        ])
        cert = (
            x509.CertificateBuilder()
            .subject_name(name).issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.utcnow())
            .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
            .add_extension(x509.SubjectAlternativeName([
                x509.DNSName('localhost'),
                x509.IPAddress(__import__('ipaddress').IPv4Address('127.0.0.1')),
            ]), critical=False)
            .sign(key, hashes.SHA256(), default_backend())
        )
        with open(KEY_FILE, 'wb') as f:
            f.write(key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption(),
            ))
        with open(CERT_FILE, 'wb') as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        logger.info('TLS cert written to server.crt / server.key')
    except Exception as e:
        logger.warning(f'Could not generate TLS cert: {e}. Falling back to HTTP.')

# ---------------------------------------------------------------------------
# DB migrations (additive only - safe to re-run every startup)
# ---------------------------------------------------------------------------
def _col(conn, table, column, col_type):
    """Add a column if it does not already exist."""
    try:
        conn.execute(f'ALTER TABLE {table} ADD COLUMN {column} {col_type}')
        conn.commit()
        logger.info(f'Migration: added {table}.{column}')
    except Exception:
        pass  # column already exists

def run_migrations(db_path):
    """Takes a resolved absolute path to the SQLite file. No app context needed."""
    if not os.path.exists(db_path):
        logger.warning(f'run_migrations: DB not found at {db_path!r}, skipping')
        return
    try:
        with sqlite3.connect(db_path) as conn:
            _col(conn, 'chat',     'system_prompt', 'TEXT DEFAULT ""')
            _col(conn, 'document', 'char_count',    'INTEGER DEFAULT 0')
            _col(conn, 'document', 'chunk_count',   'INTEGER DEFAULT 0')
            _col(conn, 'user',     'is_admin',      'INTEGER DEFAULT 0')
            _col(conn, 'chat',     'pinned',        'INTEGER DEFAULT 0')

            conn.execute('''CREATE TABLE IF NOT EXISTS user_memory (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER UNIQUE NOT NULL REFERENCES user(id) ON DELETE CASCADE,
                content    TEXT NOT NULL DEFAULT "",
                updated_at TEXT NOT NULL DEFAULT (datetime("now"))
            )''')

            conn.execute('''CREATE VIRTUAL TABLE IF NOT EXISTS chat_fts
                USING fts5(chat_id, role, content, tokenize="porter unicode61")
            ''')

            conn.execute('UPDATE user SET is_admin=1 WHERE id=(SELECT MIN(id) FROM user)')
            conn.commit()
            logger.info('Migrations complete.')
    except Exception as e:
        logger.error(f'Migration error: {e}')

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    ensure_ssl_cert()

    app = create_app()

    with app.app_context():
        db.create_all()
        # Resolve the DB path here, inside the single app context
        raw_uri = app.config.get('SQLALCHEMY_DATABASE_URI', '')
        db_path = raw_uri.replace('sqlite:///', '').replace('sqlite://', '')
        if db_path and not os.path.isabs(db_path):
            # Relative path — resolve against the project root (where run.py lives)
            db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), db_path)
        db_path = os.path.abspath(db_path) if db_path else ''

    # run_migrations called OUTSIDE app_context - no nesting, no conflict
    if db_path:
        run_migrations(db_path)

    use_https = os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE)
    proto     = 'https' if use_https else 'http'
    port      = int(os.environ.get('PORT', 5000))
    logger.info(f'Starting WilburtAI at {proto}://localhost:{port}')

    ssl_ctx = None
    if use_https:
        ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_ctx.load_cert_chain(CERT_FILE, KEY_FILE)

    socketio.run(
        app,
        host='0.0.0.0',
        port=port,
        ssl_context=ssl_ctx if use_https else None,
        debug=True,
    )
