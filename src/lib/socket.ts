// src/lib/socket.ts
import { io, Socket } from 'socket.io-client';

let _socket: Socket | null = null;

export function getSocket(): Socket {
  if (!_socket) {
    _socket = io({
      transports: ['websocket'],
      upgrade: false,
      // In dev the Vite proxy handles routing to Flask.
      // In prod we connect to the same origin.
    });
  }
  return _socket;
}

export function destroySocket() {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

// Event payload types
export interface StreamTokenPayload   { token: string; word_count: number }
export interface StreamDonePayload    { stats: StreamStats; tool_calls: ToolCall[]; pruned: boolean }
export interface StreamErrorPayload   { error: string }
export interface StreamToolPayload    { phase: 'start' | 'result'; names?: string[]; name?: string; summary?: string; round: number }

export interface StreamStats {
  tokens: number;
  elapsed_ms: number;
  tokens_per_sec: number;
  word_count: number;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface StartStreamPayload {
  message: string;
  model: string;
  chat_id: string;
  temperature: number;
  max_tokens: number;
  regenerate: boolean;
  images: string[];
  use_rag: boolean;
  embedding_model: string;
  use_web_tools: boolean;
}
