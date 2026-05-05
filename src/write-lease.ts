/**
 * Write Lease — prevent parallel agents from mutating overlapping file scopes.
 */

import path from 'node:path';
import type { ActorId } from './brain-types.js';

export interface WriteLease {
  id: string;
  taskId: string;
  holder: ActorId;
  fileScopes: string[];
  acquiredAt: string;
  expiresAt: string;
}

export interface LeaseRequest {
  taskId: string;
  holder: ActorId;
  fileScopes: string[];
  ttlMs?: number;
}

export class WriteLeaseManager {
  private readonly leases = new Map<string, WriteLease>();
  private nextId = 1;

  acquire(req: LeaseRequest, now = new Date()): WriteLease {
    if (req.fileScopes.length === 0) {
      throw new Error('write lease requires at least one file scope');
    }
    const normalizedScopes = req.fileScopes.map(normalizeScope);
    const conflict = this.findConflict(normalizedScopes, now);
    if (conflict) {
      throw new Error(`write lease conflict with ${conflict.id} (${conflict.holder})`);
    }

    const ttlMs = req.ttlMs ?? 15 * 60_000;
    const lease: WriteLease = {
      id: `lease-${this.nextId++}`,
      taskId: req.taskId,
      holder: req.holder,
      fileScopes: normalizedScopes,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    this.leases.set(lease.id, lease);
    return lease;
  }

  release(leaseId: string): boolean {
    return this.leases.delete(leaseId);
  }

  active(now = new Date()): WriteLease[] {
    this.pruneExpired(now);
    return [...this.leases.values()];
  }

  conflicts(fileScopes: string[], now = new Date()): WriteLease | null {
    return this.findConflict(fileScopes.map(normalizeScope), now);
  }

  private findConflict(fileScopes: string[], now: Date): WriteLease | null {
    this.pruneExpired(now);
    for (const lease of this.leases.values()) {
      if (scopesOverlap(fileScopes, lease.fileScopes)) return lease;
    }
    return null;
  }

  private pruneExpired(now: Date): void {
    const nowMs = now.getTime();
    for (const [id, lease] of this.leases) {
      if (new Date(lease.expiresAt).getTime() <= nowMs) {
        this.leases.delete(id);
      }
    }
  }
}

export function scopesOverlap(a: string[], b: string[]): boolean {
  return a.some(left => b.some(right => scopeOverlaps(left, right)));
}

function scopeOverlaps(a: string, b: string): boolean {
  if (a === b) return true;
  const relAB = path.relative(a, b);
  if (relAB && !relAB.startsWith('..') && !path.isAbsolute(relAB)) return true;
  const relBA = path.relative(b, a);
  return Boolean(relBA && !relBA.startsWith('..') && !path.isAbsolute(relBA));
}

function normalizeScope(scope: string): string {
  const trimmed = scope.trim();
  if (!trimmed) throw new Error('empty write scope');
  return path.normalize(trimmed);
}
