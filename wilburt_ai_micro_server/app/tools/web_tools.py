# app/tools/web_tools.py
"""
WilburtAI — Web tool implementations
  web_search         — DuckDuckGo full-text search
  visit_webpage      — Fetch & clean a web page's text
  fetch_image        — Download an image as base64 for vision models
  get_video_transcript — Pull a YouTube transcript (or fall back to page text)
"""

import base64
import logging
import re

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/124.0 Safari/537.36'
    )
}

# ---------------------------------------------------------------------------
# Web search
# ---------------------------------------------------------------------------

def web_search(query: str, max_results: int = 6) -> dict:
    """Search the web via DuckDuckGo and return top results."""
    import time
    from duckduckgo_search import DDGS
    from duckduckgo_search.exceptions import RatelimitException, DuckDuckGoSearchException

    raw = None
    last_err = None
    # Retry up to 3 times with exponential backoff on rate-limit hits
    for attempt in range(3):
        try:
            with DDGS() as ddgs:
                raw = list(ddgs.text(query, max_results=max_results))
            break
        except RatelimitException as e:
            last_err = e
            wait = 2 ** attempt   # 1 s, 2 s, 4 s
            logger.warning(f'DDG rate-limited (attempt {attempt + 1}), waiting {wait}s…')
            time.sleep(wait)
        except DuckDuckGoSearchException as e:
            last_err = e
            logger.warning(f'DDG search error (attempt {attempt + 1}): {e}')
            time.sleep(1)
        except Exception as e:
            last_err = e
            logger.warning(f'web_search unexpected error: {e}')
            break

    if raw is None:
        return {
            'type': 'text',
            'content': (
                f'Search failed after retries: {last_err}\n\n'
                'This is usually a temporary DuckDuckGo rate-limit. '
                'Try again in a few seconds.'
            ),
            'summary': 'Search failed (rate-limited)',
        }

    if not raw:
        return {
            'type': 'text',
            'content': f'No results found for: {query}',
            'summary': 'No results found',
        }

    lines = []
    for i, r in enumerate(raw, 1):
        lines.append(f"[{i}] {r.get('title', 'Untitled')}")
        lines.append(f"    URL: {r.get('href', '')}")
        lines.append(f"    {r.get('body', '')[:300]}")
        lines.append('')

    content = '\n'.join(lines)
    return {
        'type': 'text',
        'content': content,
        'summary': f'{len(raw)} results for "{query}"',
    }


# ---------------------------------------------------------------------------
# Webpage fetcher
# ---------------------------------------------------------------------------

def visit_webpage(url: str, max_chars: int = 10_000) -> dict:
    """Fetch a URL and return its cleaned text content."""
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=15, allow_redirects=True)
        resp.raise_for_status()

        ct = resp.headers.get('Content-Type', '')
        if 'text/html' not in ct and 'text/' not in ct:
            return {
                'type': 'text',
                'content': f'URL returned non-text content ({ct}). Use fetch_image for images.',
                'summary': 'Non-text content',
            }

        soup = BeautifulSoup(resp.text, 'html.parser')

        # Strip boilerplate tags
        for tag in soup(['script', 'style', 'nav', 'footer', 'header',
                         'aside', 'noscript', 'iframe', 'form', 'button']):
            tag.decompose()

        # Prefer <main> / <article> if available
        body = soup.find('main') or soup.find('article') or soup.find('body') or soup

        text = body.get_text(separator='\n', strip=True)
        # Collapse excessive blank lines
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = text[:max_chars]

        title = soup.title.string.strip() if soup.title else url

        return {
            'type': 'text',
            'content': f'# {title}\nURL: {url}\n\n{text}',
            'summary': f'Fetched "{title}" ({len(text)} chars)',
        }

    except Exception as e:
        logger.warning(f'visit_webpage error ({url}): {e}')
        return {
            'type': 'text',
            'content': f'Could not fetch {url}: {e}',
            'summary': 'Fetch failed',
        }


# ---------------------------------------------------------------------------
# Image fetcher (vision)
# ---------------------------------------------------------------------------

MAX_IMAGE_BYTES = 4 * 1024 * 1024   # 4 MB — keeps base64 payload sane

def fetch_image(url: str) -> dict:
    """Download an image and return it as base64 for vision models."""
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=20, stream=True)
        resp.raise_for_status()

        ct = resp.headers.get('Content-Type', 'image/jpeg').split(';')[0].strip()
        if not ct.startswith('image/'):
            return {
                'type': 'text',
                'content': f'URL does not appear to be an image (Content-Type: {ct}). Try visit_webpage instead.',
                'summary': 'Not an image',
            }

        data = b''
        for chunk in resp.iter_content(chunk_size=65536):
            data += chunk
            if len(data) > MAX_IMAGE_BYTES:
                return {
                    'type': 'text',
                    'content': 'Image is too large to send to the model (> 4 MB).',
                    'summary': 'Image too large',
                }

        b64 = base64.b64encode(data).decode()
        size_kb = len(data) // 1024

        return {
            'type': 'image',
            'data': b64,
            'mime_type': ct,
            'url': url,
            'summary': f'Image fetched ({size_kb} KB, {ct})',
        }

    except Exception as e:
        logger.warning(f'fetch_image error ({url}): {e}')
        return {
            'type': 'text',
            'content': f'Could not fetch image from {url}: {e}',
            'summary': 'Image fetch failed',
        }


# ---------------------------------------------------------------------------
# Video / transcript
# ---------------------------------------------------------------------------

_YT_PATTERN = re.compile(
    r'(?:youtube\.com/watch\?.*v=|youtu\.be/|youtube\.com/shorts/)([A-Za-z0-9_-]{11})'
)

def get_video_transcript(url: str) -> dict:
    """
    For YouTube URLs: return the auto-generated transcript.
    For anything else: fall back to visiting the page as text.
    """
    m = _YT_PATTERN.search(url)
    if not m:
        # Not YouTube — just fetch the page
        result = visit_webpage(url)
        result['summary'] = 'Fetched video page (no transcript available)'
        return result

    video_id = m.group(1)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

        try:
            entries = YouTubeTranscriptApi.get_transcript(video_id)
        except NoTranscriptFound:
            # Try any available language
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            entries = transcript_list.find_transcript(
                transcript_list._manually_created_transcripts or
                list(transcript_list._generated_transcripts.keys())[:1]
            ).fetch()

        # Build a readable transcript with timestamps
        lines = []
        for e in entries:
            ts = int(e['start'])
            mins, secs = divmod(ts, 60)
            lines.append(f'[{mins:02d}:{secs:02d}] {e["text"]}')

        text = '\n'.join(lines)
        return {
            'type': 'text',
            'content': f'YouTube Transcript ({video_id}):\n\n{text[:12000]}',
            'summary': f'Transcript retrieved ({len(lines)} segments)',
        }

    except (ImportError, Exception) as e:
        logger.warning(f'get_video_transcript error ({url}): {e}')
        # Fall back to scraping the page
        result = visit_webpage(f'https://www.youtube.com/watch?v={video_id}')
        result['summary'] = f'Transcript unavailable, fetched page instead: {e}'
        return result
