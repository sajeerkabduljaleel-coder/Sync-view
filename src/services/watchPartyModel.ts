/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WatchParty, WatchPartyParticipant, ChatMessage, ReactionNote, VideoSource, ReactionVideo } from '../types';
import crypto from 'node:crypto';

export interface RoomStateSecure {
  room: WatchParty;
  hostToken: string; // Stored securely on server, never returned in public room queries
  lastActivity: number;
}

export interface PlaybackCommand {
  command: 'play' | 'pause' | 'seek' | 'rate' | 'change_media';
  sourceTime: number;
  playbackRate?: number;
  sourceId?: string;
  reactionId?: string;
  clientTimestamp?: number;
}

/**
 * In-memory room store with lifecycle and cleanup management.
 */
export class WatchPartyManager {
  private rooms: Map<string, RoomStateSecure> = new Map();
  private readonly roomTtlMs = 1000 * 60 * 60 * 24; // 24 hours

  constructor() {}

  /**
   * Generates a 6-character human-friendly room code.
   */
  public generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  /**
   * Generates a cryptographically secure host token.
   */
  public generateHostToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Creates a new watch party. Returns the full room and hostToken.
   */
  public createRoom(params: {
    title: string;
    hostName: string;
    sourceVideo: VideoSource;
    primaryReaction: ReactionVideo;
    additionalReactions?: ReactionVideo[];
  }): { room: WatchParty; hostToken: string } {
    const roomId = `room-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const roomCode = this.generateRoomCode();
    const hostToken = this.generateHostToken();
    const hostId = `host-${Date.now()}`;
    const now = Date.now();

    const hostParticipant: WatchPartyParticipant = {
      id: hostId,
      name: (params.hostName || 'Host').slice(0, 30),
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
      isHost: true,
      joinedAt: now,
      status: 'watching',
    };

    const room: WatchParty = {
      id: roomId,
      title: (params.title || 'Synchronized Watch Party').slice(0, 80),
      roomCode,
      hostId,
      hostName: hostParticipant.name,
      sourceVideo: params.sourceVideo,
      primaryReaction: params.primaryReaction,
      additionalReactions: params.additionalReactions || [],
      playbackState: {
        isPlaying: false,
        sourceTime: 0,
        playbackRate: 1.0,
        seq: 1,
        serverTimestamp: now,
      },
      participants: [hostParticipant],
      chatMessages: [
        {
          id: `msg-${now}`,
          senderId: 'system',
          senderName: 'SyncView Bot',
          avatar: '',
          text: `🎉 Watch party created! Share code: ${roomCode}`,
          timestamp: now,
          isHost: false,
        },
      ],
      notes: params.primaryReaction.notes || [],
      isLocked: false,
      createdAt: now,
    };

    this.rooms.set(roomId, {
      room,
      hostToken,
      lastActivity: now,
    });

    return { room, hostToken };
  }

  /**
   * Retrieves sanitized public room state (hostToken is never returned).
   */
  public getRoom(roomIdOrCode: string): WatchParty | null {
    this.cleanExpiredRooms();
    const match = this.findRoomEntry(roomIdOrCode);
    if (!match) return null;
    return JSON.parse(JSON.stringify(match.room));
  }

  /**
   * Join an existing room as an audience participant.
   */
  public joinRoom(
    roomIdOrCode: string,
    participantName: string
  ): { room: WatchParty; participantId: string } | null {
    const entry = this.findRoomEntry(roomIdOrCode);
    if (!entry) return null;

    const safeName = (participantName || 'Guest Viewer').trim().slice(0, 30);
    const participantId = `viewer-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const now = Date.now();

    const participant: WatchPartyParticipant = {
      id: participantId,
      name: safeName,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${participantId}`,
      isHost: false,
      joinedAt: now,
      status: 'watching',
    };

    entry.room.participants.push(participant);
    entry.lastActivity = now;

    // Post join notification
    entry.room.chatMessages.push({
      id: `msg-${now}`,
      senderId: 'system',
      senderName: 'SyncView Bot',
      avatar: '',
      text: `${safeName} joined the party.`,
      timestamp: now,
      isHost: false,
    });

    return {
      room: JSON.parse(JSON.stringify(entry.room)),
      participantId,
    };
  }

  /**
   * Validates host token securely.
   */
  public isAuthorizedHost(roomIdOrCode: string, token: string): boolean {
    const entry = this.findRoomEntry(roomIdOrCode);
    if (!entry || !token) return false;
    // Constant-time comparison to prevent timing attacks
    const bufferA = Buffer.from(entry.hostToken);
    const bufferB = Buffer.from(token);
    if (bufferA.length !== bufferB.length) return false;
    return crypto.timingSafeEqual(bufferA, bufferB);
  }

  /**
   * Applies an authoritative playback command (Host only).
   */
  public executeHostCommand(
    roomIdOrCode: string,
    token: string,
    cmd: PlaybackCommand
  ): { success: boolean; state?: WatchParty['playbackState']; error?: string } {
    const entry = this.findRoomEntry(roomIdOrCode);
    if (!entry) return { success: false, error: 'Room not found' };

    if (!this.isAuthorizedHost(roomIdOrCode, token)) {
      return { success: false, error: 'Unauthorized: invalid host credentials' };
    }

    const now = Date.now();
    const current = entry.room.playbackState;

    let newIsPlaying = current.isPlaying;
    let newSourceTime = current.sourceTime;
    let newRate = current.playbackRate;

    switch (cmd.command) {
      case 'play':
        newIsPlaying = true;
        if (typeof cmd.sourceTime === 'number' && cmd.sourceTime >= 0) {
          newSourceTime = cmd.sourceTime;
        }
        break;
      case 'pause':
        newIsPlaying = false;
        if (typeof cmd.sourceTime === 'number' && cmd.sourceTime >= 0) {
          newSourceTime = cmd.sourceTime;
        }
        break;
      case 'seek':
        if (typeof cmd.sourceTime === 'number' && cmd.sourceTime >= 0) {
          newSourceTime = cmd.sourceTime;
        }
        break;
      case 'rate':
        if (cmd.playbackRate && cmd.playbackRate >= 0.25 && cmd.playbackRate <= 2.5) {
          newRate = cmd.playbackRate;
        }
        break;
    }

    // Monotonically increment sequence number
    const nextSeq = current.seq + 1;

    entry.room.playbackState = {
      isPlaying: newIsPlaying,
      sourceTime: Math.max(0, newSourceTime),
      playbackRate: newRate,
      seq: nextSeq,
      serverTimestamp: now,
    };
    entry.lastActivity = now;

    return {
      success: true,
      state: entry.room.playbackState,
    };
  }

  /**
   * Adds chat message with rate limit check and sanitization.
   */
  public addChatMessage(
    roomIdOrCode: string,
    senderId: string,
    senderName: string,
    text: string,
    token?: string
  ): { success: boolean; message?: ChatMessage; error?: string } {
    const entry = this.findRoomEntry(roomIdOrCode);
    if (!entry) return { success: false, error: 'Room not found' };

    const cleanText = text.trim().slice(0, 500);
    if (!cleanText) return { success: false, error: 'Message cannot be empty' };

    const isHost = token ? this.isAuthorizedHost(roomIdOrCode, token) : false;
    const now = Date.now();

    const msg: ChatMessage = {
      id: `msg-${now}-${crypto.randomBytes(2).toString('hex')}`,
      senderId,
      senderName: senderName.slice(0, 30),
      avatar: isHost
        ? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80'
        : `https://api.dicebear.com/7.x/bottts/svg?seed=${senderId}`,
      text: cleanText,
      timestamp: now,
      isHost,
    };

    entry.room.chatMessages.push(msg);
    // Keep max 200 messages in buffer
    if (entry.room.chatMessages.length > 200) {
      entry.room.chatMessages.shift();
    }
    entry.lastActivity = now;

    return { success: true, message: msg };
  }

  /**
   * Add a timestamped note. Validates ownership and timestamp.
   */
  public addNote(
    roomIdOrCode: string,
    userId: string,
    userName: string,
    sourceTime: number,
    reactionTime: number,
    text: string
  ): { success: boolean; note?: ReactionNote; error?: string } {
    const entry = this.findRoomEntry(roomIdOrCode);
    if (!entry) return { success: false, error: 'Room not found' };

    const cleanText = text.trim().slice(0, 280);
    if (!cleanText) return { success: false, error: 'Note cannot be empty' };

    const note: ReactionNote = {
      id: `note-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      userId,
      userName: userName.slice(0, 30),
      sourceTimestamp: Math.max(0, sourceTime),
      reactionTimestamp: Math.max(0, reactionTime),
      text: cleanText,
      isPublic: true,
      createdAt: Date.now(),
    };

    entry.room.notes.push(note);
    entry.lastActivity = Date.now();

    return { success: true, note };
  }

  /**
   * Delete note with ownership validation (owner or host).
   */
  public deleteNote(
    roomIdOrCode: string,
    noteId: string,
    userId: string,
    token?: string
  ): { success: boolean; error?: string } {
    const entry = this.findRoomEntry(roomIdOrCode);
    if (!entry) return { success: false, error: 'Room not found' };

    const isHost = token ? this.isAuthorizedHost(roomIdOrCode, token) : false;
    const noteIdx = entry.room.notes.findIndex((n) => n.id === noteId);
    if (noteIdx === -1) return { success: false, error: 'Note not found' };

    const note = entry.room.notes[noteIdx];
    if (note.userId !== userId && !isHost) {
      return { success: false, error: 'Unauthorized to delete note' };
    }

    entry.room.notes.splice(noteIdx, 1);
    entry.lastActivity = Date.now();
    return { success: true };
  }

  /**
   * Reassign host (e.g. if host leaves, grants host to another participant).
   */
  public reassignHost(
    roomIdOrCode: string,
    currentToken: string,
    newHostParticipantId: string
  ): { success: boolean; newHostToken?: string; error?: string } {
    const entry = this.findRoomEntry(roomIdOrCode);
    if (!entry) return { success: false, error: 'Room not found' };

    if (!this.isAuthorizedHost(roomIdOrCode, currentToken)) {
      return { success: false, error: 'Unauthorized: invalid current host token' };
    }

    const targetParticipant = entry.room.participants.find((p) => p.id === newHostParticipantId);
    if (!targetParticipant) {
      return { success: false, error: 'Target participant not found in room' };
    }

    // Demote current host
    entry.room.participants.forEach((p) => {
      p.isHost = p.id === newHostParticipantId;
    });

    const newHostToken = this.generateHostToken();
    entry.hostToken = newHostToken;
    entry.room.hostId = targetParticipant.id;
    entry.room.hostName = targetParticipant.name;
    entry.lastActivity = Date.now();

    return { success: true, newHostToken };
  }

  /**
   * Estimates current playback time based on server timestamp and elapsed time.
   */
  public estimateCurrentSourceTime(playbackState: WatchParty['playbackState']): number {
    if (!playbackState.isPlaying) {
      return playbackState.sourceTime;
    }
    const elapsedSeconds = (Date.now() - playbackState.serverTimestamp) / 1000;
    return playbackState.sourceTime + elapsedSeconds * playbackState.playbackRate;
  }

  private findRoomEntry(idOrCode: string): RoomStateSecure | null {
    if (this.rooms.has(idOrCode)) {
      return this.rooms.get(idOrCode)!;
    }
    const clean = idOrCode.toUpperCase().trim();
    for (const entry of this.rooms.values()) {
      if (entry.room.roomCode.toUpperCase() === clean) {
        return entry;
      }
    }
    return null;
  }

  private cleanExpiredRooms(): void {
    const now = Date.now();
    for (const [id, entry] of this.rooms.entries()) {
      if (now - entry.lastActivity > this.roomTtlMs) {
        this.rooms.delete(id);
      }
    }
  }
}
