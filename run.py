# run.py - WilburtAI Micro Server Entry Point
"""
WilburtAI Micro Server - Main Application Runner
"""

import os
from app import create_app

# Create the Flask application
app = create_app()

if __name__ == '__main__':
    # Get port from environment variable or default to 5000
    port = int(os.environ.get('PORT', 5000))
    
    # Run the application
    app.run(
        host='0.0.0.0',
        port=port,
        debug=True  # Add this for better error messages
    )
