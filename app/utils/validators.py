# app/utils/validators.py
"""
WilburtAI Micro Server - Validation Utilities
"""

import re

def validate_chat_id(chat_id):
    """Validate chat ID for directory traversal attacks."""
    if not isinstance(chat_id, str):
        return False
    
    # Check for dangerous patterns
    if ".." in chat_id or "/" in chat_id or "\\" in chat_id:
        return False
    
    # Check length and allowed characters
    if len(chat_id) > 36 or not re.match(r'^[a-zA-Z0-9_-]+$', chat_id):
        return False
    
    return True

def validate_message_content(content):
    """Validate message content."""
    if not isinstance(content, str):
        return False
    
    if len(content.strip()) == 0:
        return False
    
    return True
