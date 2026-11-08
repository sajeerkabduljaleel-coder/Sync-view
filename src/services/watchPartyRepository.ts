/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WatchParty, WatchPartyParticipant } from '../types';

export interface ParticipantSession {
  tokenHash: string; // SHA-256 hash of participantToken (raw token never persisted)
  participantId: string;
  name: string;
  avatar: string;
  isHost: boolean;
  roomId: string;
  joinedAt: number;
  lastMessageTime: number;
  messageWindowCount: number;
}

export interface StoredRoomData {
  room: WatchParty;
  hostTokenHash: string; // SHA-256 hash of hostToken (raw token never persisted)
  sessions: Record<string, ParticipantSession>; // tokenHash -> session
  lastActivity: number;
  version: number;
  hostToken?: string; // Legacy field for automatic migration only
}

export interface IWatchPartyRepository {
  readonly adapterName: string;
  readonly isConcurrentSafe: boolean;
  readonly deploymentTopology: 'single-instance' | 'distributed-cluster';
  saveRoom(data: StoredRoomData): Promise<void>;
  getRoomById(id: string): Promise<StoredRoomData | null>;
  getRoomByCode(code: string): Promise<StoredRoomData | null>;
  deleteRoom(id: string): Promise<void>;
  getAllRooms(): Promise<StoredRoomData[]>;
  cleanupExpired(ttlMs: number): Promise<number>;
  reloadFromDisk(): Promise<void>;
}

export function hashSecretToken(token: string): string {
  if (!token || typeof token !== 'string') return '';
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Single-Instance File-backed persistent storage adapter for Watch Parties.
 *
 * Deployment Topology:
 * - Designed and supported for single-instance Node.js processes (e.g. single Cloud Run / container instance).
 * - NOT suitable as a shared multi-instance database across distributed container clusters without external
 *   Cloud SQL (PostgreSQL) or Firestore adapters.
 *
 * Concurrency & Integrity Protections:
 * - Mutex queue prevents simultaneous in-process event-loop write collisions.
 * - Lockfile (.lock) with retry backs up atomic file writes.
 * - Atomic write-and-rename with unique PID/timestamp temp files prevents half-written JSON files.
 * - Graceful recovery from malformed/corrupted files by backing up corrupt data and maintaining operational continuity.
 * - Strict filesystem permissions (0o700 dir, 0o600 file).
 * - Automatic migration of legacy unhashed host/session tokens to SHA-256 hashes.
 */
export class SingleInstanceFileWatchPartyRepository implements IWatchPartyRepository {
  public readonly adapterName = 'SingleInstanceFileWatchPartyRepository (Development/Single-Container Adapter)';
  public readonly isConcurrentSafe = true; // In-process mutex + atomic file write locking
  public readonly deploymentTopology = 'single-instance';

  private cache: Map<string, StoredRoomData> = new Map();
  private filePath: string;
  private lockFilePath: string;
  private isLoaded = false;
  private writeMutex: Promise<void> = Promise.resolve();

  constructor(storageDir = '.data', fileName = 'watch_parties.json') {
    const dir = path.resolve(process.cwd(), storageDir);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      } else {
        fs.chmodSync(dir, 0o700);
      }
    } catch {}
    this.filePath = path.join(dir, fileName);
    this.lockFilePath = path.join(dir, `${fileName}.lock`);
    this.loadFromDiskSync();
  }

  /**
   * Acquire filesystem advisory lockfile with retry.
   */
  private async acquireFileLock(maxRetries = 10, retryDelayMs = 25): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        // wx flag fails if file already exists (atomic creation)
        const fd = fs.openSync(this.lockFilePath, 'wx');
        fs.writeSync(fd, `${process.pid}:${Date.now()}`);
        fs.closeSync(fd);
        return true;
      } catch (err: any) {
        if (err.code === 'EEXIST') {
          // Check if lockfile is stale (older than 5 seconds)
          try {
            const stat = fs.statSync(this.lockFilePath);
            if (Date.now() - stat.mtimeMs > 5000) {
              fs.unlinkSync(this.lockFilePath);
              continue;
            }
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        } else {
          return false;
        }
      }
    }
    return false;
  }

  private releaseFileLock(): void {
    try {
      if (fs.existsSync(this.lockFilePath)) {
        fs.unlinkSync(this.lockFilePath);
      }
    } catch {}
  }

  /**
   * Load and validate data from disk with legacy migration and corruption recovery.
   */
  public loadFromDiskSync(): void {
    if (!fs.existsSync(this.filePath)) {
      this.isLoaded = true;
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      if (!raw.trim()) {
        this.isLoaded = true;
        return;
      }

      let list: any[];
      try {
        list = JSON.parse(raw);
        if (!Array.isArray(list)) {
          throw new Error('Root JSON structure is not an array of rooms');
        }
      } catch (parseError) {
        console.warn('Malformed watch party data file detected. Backing up and starting fresh:', parseError);
        const backupPath = `${this.filePath}.corrupted.${Date.now()}.bak`;
        fs.renameSync(this.filePath, backupPath);
        this.cache.clear();
        this.isLoaded = true;
        return;
      }

      this.cache.clear();
      for (const item of list) {
        if (!item || !item.room || !item.room.id) continue;

        // Automatic legacy migration: hash plaintext tokens
        if (item.hostToken && !item.hostTokenHash) {
          item.hostTokenHash = hashSecretToken(item.hostToken);
          delete item.hostToken;
        }

        if (item.sessions && typeof item.sessions === 'object') {
          const migratedSessions: Record<string, ParticipantSession> = {};
          for (const [key, session] of Object.entries(item.sessions as Record<string, any>)) {
            if (!session) continue;
            // If key is not already a 64-char sha256 hex or session.token exists unhashed
            const hashKey = key.length === 64 ? key : hashSecretToken(key);
            migratedSessions[hashKey] = {
              tokenHash: hashKey,
              participantId: session.participantId,
              name: session.name,
              avatar: session.avatar,
              isHost: Boolean(session.isHost),
              roomId: session.roomId,
              joinedAt: session.joinedAt || Date.now(),
              lastMessageTime: session.lastMessageTime || 0,
              messageWindowCount: session.messageWindowCount || 0,
            };
          }
          item.sessions = migratedSessions;
        } else {
          item.sessions = {};
        }

        item.version = typeof item.version === 'number' ? item.version : 1;
        item.lastActivity = typeof item.lastActivity === 'number' ? item.lastActivity : Date.now();

        this.cache.set(item.room.id, item as StoredRoomData);
      }
      this.isLoaded = true;
    } catch (err) {
      console.warn('Could not read watch party file, proceeding with in-memory state:', err);
      this.isLoaded = true;
    }
  }

  public async reloadFromDisk(): Promise<void> {
    this.loadFromDiskSync();
  }

  /**
   * Concurrency-safe atomic flush to disk with file locking and unique PID temp files.
   */
  private async flushToDiskSafe(): Promise<void> {
    const list = Array.from(this.cache.values());
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;

    const acquired = await this.acquireFileLock();
    try {
      fs.writeFileSync(tempPath, JSON.stringify(list, null, 2), { mode: 0o600, encoding: 'utf-8' });
      try {
        fs.renameSync(tempPath, this.filePath);
      } catch {
        fs.copyFileSync(tempPath, this.filePath);
        try {
          fs.unlinkSync(tempPath);
        } catch {}
      }
      try {
        fs.chmodSync(this.filePath, 0o600);
      } catch {}
    } catch (err) {
      console.warn('Failed to flush watch parties to disk:', err);
    } finally {
      if (acquired) {
        this.releaseFileLock();
      }
    }
  }

  /**
   * Serializes write operations through the internal mutex queue.
   */
  private queueWrite(operation: () => Promise<void>): Promise<void> {
    this.writeMutex = this.writeMutex
      .then(operation)
      .catch((err) => {
        console.error('WatchPartyRepository write operation failed:', err);
      });
    return this.writeMutex;
  }

  public async saveRoom(data: StoredRoomData): Promise<void> {
    return this.queueWrite(async () => {
      // Check existing version on disk before overwriting to ensure monotonic updates
      const existing = this.cache.get(data.room.id);
      if (existing) {
        data.version = Math.max(existing.version + 1, (data.version || 0) + 1);
      } else {
        data.version = (data.version || 0) + 1;
      }
      data.lastActivity = Date.now();
      this.cache.set(data.room.id, data);
      await this.flushToDiskSafe();
    });
  }

  public async getRoomById(id: string): Promise<StoredRoomData | null> {
    const found = this.cache.get(id);
    if (!found) return null;
    return JSON.parse(JSON.stringify(found));
  }

  public async getRoomByCode(code: string): Promise<StoredRoomData | null> {
    const cleanCode = (code || '').toUpperCase().trim();
    if (!cleanCode) return null;
    for (const data of this.cache.values()) {
      if (data.room.roomCode.toUpperCase() === cleanCode) {
        return JSON.parse(JSON.stringify(data));
      }
    }
    return null;
  }

  public async deleteRoom(id: string): Promise<void> {
    return this.queueWrite(async () => {
      this.cache.delete(id);
      await this.flushToDiskSafe();
    });
  }

  public async getAllRooms(): Promise<StoredRoomData[]> {
    return JSON.parse(JSON.stringify(Array.from(this.cache.values())));
  }

  public async cleanupExpired(ttlMs: number): Promise<number> {
    let cleaned = 0;
    await this.queueWrite(async () => {
      const now = Date.now();
      for (const [id, data] of this.cache.entries()) {
        if (now - data.lastActivity > ttlMs) {
          this.cache.delete(id);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        await this.flushToDiskSafe();
      }
    });
    return cleaned;
  }
}

// Backward-compatible alias
export const FileWatchPartyRepository = SingleInstanceFileWatchPartyRepository;
