# app/services/lm_service.py
"""
WilburtAI Micro Server - LLM Service Layer

NOTE: This service class is currently unused. All LM Studio calls are made
directly in app/routes/llm.py. This file is kept as a placeholder for a
future refactor that centralises LM Studio communication here.
"""

import requests
import json
import logging
from config.settings import Config

logger = logging.getLogger(__name__)

class LMService:
    """Business logic for LLM interactions."""
    
    @staticmethod
    def get_available_models():
        """Get available models from LM Studio."""
        try:
            response = requests.get(f"{Config.LM_BASE_URL}/v1/models", timeout=5)
            response.raise_for_status()
            
            models_data = response.json()
            models = [model["id"] for model in models_data["data"]]
            
            return models
        except Exception as e:
            logger.error(f"Error fetching models: {e}")
            raise Exception("Could not fetch models from LM Studio")
    
    @staticmethod
    def stream_chat_completion(model, messages):
        """Stream chat completion from LM Studio."""
        try:
            response = requests.post(
                f"{Config.LM_BASE_URL}/v1/chat/completions",
                json={
                    "model": model,
                    "messages": messages,
                    "stream": True,
                },
                stream=True,
                timeout=60,
            )
            
            if response.status_code != 200:
                raise Exception(f"LLM Error: {response.status_code}")
            
            response.raise_for_status()
            return response
            
        except requests.RequestException as e:
            logger.error(f"Error calling LM Studio: {e}")
            raise Exception(f"Failed to connect to LLM: {str(e)}")
