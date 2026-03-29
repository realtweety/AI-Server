# app/utils/helpers.py
"""
WilburtAI Micro Server - Helper Utilities
"""

import re

def generate_title(message):
    """Create a short, safe title from the first user line."""
    if not message:
        return "New Chat"
    
    title = message.strip().split("\n")[0][:40]
    # Remove invalid characters for filenames
    title = re.sub(r'[\\/*?:"<>|]', "", title)
    return title if title else "New Chat"

def sanitize_filename(filename):
    """Sanitize filename to prevent directory traversal."""
    # Remove dangerous characters
    filename = re.sub(r'[\\/*?:"<>|]', "", filename)
    # Limit length
    filename = filename[:100]
    return filename

def format_timestamp(timestamp):
    """Format timestamp for display."""
    if timestamp:
        return timestamp.strftime('%Y-%m-%d %H:%M')
    return ""
