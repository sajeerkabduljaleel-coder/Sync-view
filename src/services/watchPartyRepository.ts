/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { WatchParty, WatchPartyParticipant } from '../types';

export interface ParticipantSession {
  token: string;
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
  hostToken: string;
  sessions: Record<string, ParticipantSession>; // token -> session
  lastActivity: number;
}

export interface IWatchPartyRepository {
  saveRoom(data: StoredRoomData): Promise<void>;
  getRoomById(id: string): Promise<StoredRoomData | null>;
  getRoomByCode(code: string): Promise<StoredRoomData | null>;
  deleteRoom(id: string): Promise<void>;
  getAllRooms(): Promise<StoredRoomData[]>;
  cleanupExpired(ttlMs: number): Promise<number>;
}

/**
 * File-backed persistent storage for Watch Parties with in-memory caching.
 * Recovers room state across server restarts and writes safely to disk.
 */
export class FileWatchPartyRepository implements IWatchPartyRepository {
  private cache: Map<string, StoredRoomData> = new Map();
  private filePath: string;
  private isLoaded = false;

  constructor(storageDir = '.data', fileName = 'watch_parties.json') {
    const dir = path.resolve(process.cwd(), storageDir);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch {}
    this.filePath = path.join(dir, fileName);
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (this.isLoaded) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: StoredRoomData[] = JSON.parse(raw);
        for (const item of list) {
          if (item && item.room && item.room.id) {
            this.cache.set(item.room.id, item);
          }
        }
      }
    } catch (err) {
      console.warn('Could not read persistent watch party file, using memory cache:', err);
    }
    this.isLoaded = true;
  }

  private flushToDisk(): void {
    try {
      const list = Array.from(this.cache.values());
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(list, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.warn('Failed to flush watch parties to disk:', err);
    }
  }

  public async saveRoom(data: StoredRoomData): Promise<void> {
    this.cache.set(data.room.id, data);
    this.flushToDisk();
  }

  public async getRoomById(id: string): Promise<StoredRoomData | null> {
    return this.cache.get(id) || null;
  }

  public async getRoomByCode(code: string): Promise<StoredRoomData | null> {
    const cleanCode = code.toUpperCase().trim();
    for (const data of this.cache.values()) {
      if (data.room.roomCode.toUpperCase() === cleanCode) {
        return data;
      }
    }
    return null;
  }

  public async deleteRoom(id: string): Promise<void> {
    this.cache.delete(id);
    this.flushToDisk();
  }

  public async getAllRooms(): Promise<StoredRoomData[]> {
    return Array.from(this.cache.values());
  }

  public async cleanupExpired(ttlMs: number): Promise<number> {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, data] of this.cache.entries()) {
      if (now - data.lastActivity > ttlMs) {
        this.cache.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.flushToDisk();
    }
    return cleaned;
  }
}
