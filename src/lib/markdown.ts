// src/lib/markdown.ts
import { marked, Renderer } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

// ── Custom renderer ──────────────────────────────────────────────────────────

const renderer = new Renderer();

renderer.code = (code: string, lang?: string) => {
  const validLang = lang && hljs.getLanguage(lang) ? lang : undefined;
  const highlighted = validLang
    ? hljs.highlight(code, { language: validLang }).value
    : hljs.highlightAuto(code).value;
  const escaped = code.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<div class="code-block" data-raw="${escaped}">
    <div class="code-block-header">
      <span class="code-lang-label">${validLang ?? 'code'}</span>
    </div>
    <pre><code class="hljs">${highlighted}</code></pre>
  </div>`;
};

marked.use({ renderer, gfm: true, breaks: true });

// ── Exports ───────────────────────────────────────────────────────────────────

export function renderMarkdown(text: string): string {
  const html = marked.parse(text) as string;
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['details', 'summary'],
    ADD_ATTR: ['data-raw'],
  });
}

export interface ParsedThought {
  thought: string;
  response: string;
  done: boolean;
}

export function separateThought(text: string): ParsedThought {
  const m =
    text.match(/^<think>([\s\S]*?)<\/think>([\s\S]*)$/) ||
    text.match(/^\[THINK\]([\s\S]*?)\[\/THINK\]([\s\S]*)$/i);
  if (m) return { thought: m[1].trim(), response: m[2].trimStart(), done: true };
  if (text.startsWith('<think>'))          return { thought: text.slice(7),  response: '', done: false };
  if (/^\[THINK\]/i.test(text))            return { thought: text.slice(7),  response: '', done: false };
  return { thought: '', response: text, done: true };
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatTimestamp(date: Date): string {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - msgDay.getTime()) / 86_400_000);
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 0) return timeStr;
  if (diffDays === 1) return `Yesterday ${timeStr}`;
  if (diffDays < 7)  return `${date.toLocaleDateString([], { weekday: 'short' })} ${timeStr}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;
}
