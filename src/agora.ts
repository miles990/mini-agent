/**
 * Agora Client — Thin HTTP wrapper for Agent Discussion Service
 *
 * Phase 1: Used by agora-inbox perception plugin helper + available for dispatcher integration
 * Phase 2: Wire into dispatcher for <kuro:agora> tag processing
 */

import { getLogger } from './logging.js';

const AGORA_URL = process.env['AGORA_URL'] || 'http://localhost:3004';
const AGORA_API_KEY = process.env['AGORA_API_KEY'] || '';

export interface AgoraMessage {
  id: string;
  discussionId: string;
  from: string;
  agentId: string;
  text: string;
  timestamp: string;
  mentions?: string[];
  replyTo?: string;
  references?: string[];
  type: 'message' | 'proposal' | 'consensus' | 'question' | 'human-input';
  metadata?: {
    phase?: 'diverge' | 'explore' | 'converge' | 'decide' | 'confirm';
    [key: string]: unknown;
  };
}

export interface AgoraDiscussion {
  id: string;
  topic: string;
  description: string;
  createdBy: string;
  createdAt: string;
  phase: 'diverge' | 'explore' | 'converge' | 'decide' | 'confirm' | 'archived';
  participants: string[];
  messageCount: number;
  forkedFrom?: string;
}

async function agoraFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const url = `${AGORA_URL}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AGORA_API_KEY,
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Agora ${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function listDiscussions(): Promise<AgoraDiscussion[]> {
  return agoraFetch<AgoraDiscussion[]>('/discussions');
}

export async function getDiscussion(id: string): Promise<AgoraDiscussion> {
  return agoraFetch<AgoraDiscussion>(`/discussions/${id}`);
}

export async function getMessages(
  discussionId: string,
  since?: string,
  limit = 50,
): Promise<AgoraMessage[]> {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  params.set('limit', String(limit));
  const qs = params.toString();
  return agoraFetch<AgoraMessage[]>(`/discussions/${discussionId}/messages${qs ? `?${qs}` : ''}`);
}

export async function postMessage(
  discussionId: string,
  text: string,
  opts?: {
    replyTo?: string;
    references?: string[];
    mentions?: string[];
    type?: AgoraMessage['type'];
    metadata?: AgoraMessage['metadata'];
  },
): Promise<AgoraMessage> {
  return agoraFetch<AgoraMessage>(`/discussions/${discussionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text, ...opts }),
  });
}

export async function joinDiscussion(discussionId: string): Promise<AgoraDiscussion> {
  return agoraFetch<AgoraDiscussion>(`/discussions/${discussionId}/join`, {
    method: 'POST',
  });
}

export async function createDiscussion(
  topic: string,
  description: string,
): Promise<AgoraDiscussion> {
  return agoraFetch<AgoraDiscussion>('/discussions', {
    method: 'POST',
    body: JSON.stringify({ topic, description }),
  });
}

/** Check if Agora server is reachable */
export async function isAgoraAvailable(): Promise<boolean> {
  if (!AGORA_API_KEY) return false;
  try {
    await listDiscussions();
    return true;
  } catch {
    return false;
  }
}
