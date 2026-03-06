# app/tools/registry.py
"""
WilburtAI — Tool registry
  TOOL_DEFINITIONS  — OpenAI-format tool specs sent to the model
  execute_tool()    — Dispatcher that runs the appropriate tool function
"""

import json
import logging

from app.tools.web_tools import web_search, visit_webpage, fetch_image, get_video_transcript

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tool definitions (OpenAI / LM Studio format)
# ---------------------------------------------------------------------------

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "Search the internet for current information. Use this whenever you need "
                "up-to-date facts, news, prices, people, places, or anything else you are "
                "unsure about or that may have changed recently. Returns titles, URLs, and "
                "short snippets. Follow up with visit_webpage to read the full content of "
                "any result."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query, as you would type it into a search engine."
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Number of results to return (default 6, max 10).",
                        "default": 6
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "visit_webpage",
            "description": (
                "Fetch and read the full text content of any webpage or URL. Use this to "
                "read articles, documentation, product pages, news stories, or any website "
                "in full after finding it via web_search. Do NOT use this for image URLs — "
                "use fetch_image instead."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The full URL (including https://) to fetch."
                    }
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_image",
            "description": (
                "Download and view an image from a URL. The image will be added to the "
                "conversation so you can see and describe it. Use this when the user asks "
                "you to look at, analyse, or describe an image from the web, or when a "
                "web_search result points to an image you need to examine. Works with "
                "JPEG, PNG, GIF, and WebP."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Direct URL to the image file (e.g. https://example.com/photo.jpg)."
                    }
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_video_transcript",
            "description": (
                "Retrieve the transcript or subtitles of a video. Works best with YouTube "
                "URLs (returns timestamped transcript). For other video pages it falls back "
                "to reading the page text. Use this when a user asks about, references, or "
                "wants you to watch/summarise a video."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL of the video (YouTube links preferred)."
                    }
                },
                "required": ["url"]
            }
        }
    },
]

# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------

_TOOL_MAP = {
    'web_search':          web_search,
    'visit_webpage':       visit_webpage,
    'fetch_image':         fetch_image,
    'get_video_transcript': get_video_transcript,
}

def execute_tool(name: str, arguments: dict) -> dict:
    """
    Run a tool by name with the given arguments.
    Always returns a dict with at least:
      'type'    — 'text' | 'image'
      'content' — string result (text tools)
      'summary' — short human-readable description of what happened
    Image tools additionally include 'data' (base64) and 'mime_type'.
    """
    fn = _TOOL_MAP.get(name)
    if fn is None:
        logger.warning(f'execute_tool: unknown tool "{name}"')
        return {
            'type': 'text',
            'content': f'Unknown tool: {name}',
            'summary': 'Unknown tool',
        }

    try:
        return fn(**arguments)
    except TypeError as e:
        # Bad arguments from model
        logger.warning(f'execute_tool({name}) bad args {arguments}: {e}')
        return {
            'type': 'text',
            'content': f'Tool call failed — invalid arguments: {e}',
            'summary': 'Invalid arguments',
        }
    except Exception as e:
        logger.exception(f'execute_tool({name}) unexpected error')
        return {
            'type': 'text',
            'content': f'Tool error: {e}',
            'summary': 'Tool error',
        }
