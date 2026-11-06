/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { WatchParty, WatchPartyParticipant, ChatMessage, ReactionNote, VideoSource, ReactionVideo } from '../types';
import {
  IWatchPartyRepository,
  FileWatchPartyRepository,
  StoredRoomData,
  ParticipantSession,
} from './watchPartyRepository';

export interface PlaybackCommand {
  command: 'play' | 'pause' | 'seek' | 'rate' | 'change_media';
  sourceTime: number;
  playbackRate?: number;
  sourceId?: string;
  reactionId?: string;
  clientTimestamp?: number;
  expectedSeq?: number;
}

export class WatchPartyManager {
  private repository: IWatchPartyRepository;
  private readonly roomTtlMs = 1000 * 60 * 60 * 24; // 24 hours

  constructor(repository?: IWatchPartyRepository) {
    this.repository = repository || new FileWatchPartyRepository();
  }

  public generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  public generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Constant-time string equality check to mitigate timing attacks.
   */
  public safeCompare(a?: string | null, b?: string | null): boolean {
    if (!a || !b) return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /**
   * Creates a new watch party.
   * Host credentials and participant tokens are created server-side.
   */
  public async createRoom(params: {
    title: string;
    hostName: string;
    sourceVideo: VideoSource;
    primaryReaction: ReactionVideo;
    additionalReactions?: ReactionVideo[];
  }): Promise<{ room: WatchParty; hostToken: string; participantToken: string }> {
    const roomId = `room-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const roomCode = this.generateRoomCode();
    const hostToken = this.generateSecureToken();
    const participantToken = this.generateSecureToken();
    const hostId = `host-${Date.now()}`;
    const now = Date.now();

    const hostParticipant: WatchPartyParticipant = {
      id: hostId,
      name: (params.hostName || 'Host').trim().slice(0, 30),
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
      isHost: true,
      joinedAt: now,
      status: 'watching',
    };

    const hostSession: ParticipantSession = {
      token: participantToken,
      participantId: hostId,
      name: hostParticipant.name,
      avatar: hostParticipant.avatar,
      isHost: true,
      roomId,
      joinedAt: now,
      lastMessageTime: 0,
      messageWindowCount: 0,
    };

    const room: WatchParty = {
      id: roomId,
      title: (params.title || 'Synchronized Watch Party').trim().slice(0, 80),
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

    const storedData: StoredRoomData = {
      room,
      hostToken,
      sessions: {
        [participantToken]: hostSession,
      },
      lastActivity: now,
    };

    await this.repository.saveRoom(storedData);
    return { room: this.sanitizeRoom(room), hostToken, participantToken };
  }

  /**
   * Fetches room state, sanitized to ensure host tokens and session tokens are NEVER leaked.
   */
  public async getRoom(idOrCode: string): Promise<WatchParty | null> {
    const data = await this.findRoomData(idOrCode);
    if (!data) return null;
    return this.sanitizeRoom(data.room);
  }

  /**
   * Join an existing room.
   * If existingToken is valid, reconnects the existing participant without duplicating them.
   */
  public async joinRoom(
    idOrCode: string,
    participantName: string,
    existingToken?: string
  ): Promise<{ room: WatchParty; participantId: string; participantToken: string } | null> {
    const data = await this.findRoomData(idOrCode);
    if (!data) return null;

    const now = Date.now();

    // Reconnection check
    if (existingToken && data.sessions[existingToken]) {
      const existingSession = data.sessions[existingToken];
      data.lastActivity = now;
      await this.repository.saveRoom(data);
      return {
        room: this.sanitizeRoom(data.room),
        participantId: existingSession.participantId,
        participantToken: existingToken,
      };
    }

    const safeName = (participantName || 'Guest Viewer').trim().slice(0, 30);
    const participantId = `viewer-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const participantToken = this.generateSecureToken();

    const participant: WatchPartyParticipant = {
      id: participantId,
      name: safeName,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${participantId}`,
      isHost: false,
      joinedAt: now,
      status: 'watching',
    };

    const session: ParticipantSession = {
      token: participantToken,
      participantId,
      name: safeName,
      avatar: participant.avatar,
      isHost: false,
      roomId: data.room.id,
      joinedAt: now,
      lastMessageTime: 0,
      messageWindowCount: 0,
    };

    // Deduplicate participant list by ID
    data.room.participants = data.room.participants.filter((p) => p.id !== participantId);
    data.room.participants.push(participant);
    data.sessions[participantToken] = session;
    data.lastActivity = now;

    data.room.chatMessages.push({
      id: `msg-${now}`,
      senderId: 'system',
      senderName: 'SyncView Bot',
      avatar: '',
      text: `${safeName} joined the party.`,
      timestamp: now,
      isHost: false,
    });

    await this.repository.saveRoom(data);

    return {
      room: this.sanitizeRoom(data.room),
      participantId,
      participantToken,
    };
  }

  public async isAuthorizedHost(idOrCode: string, token: string): Promise<boolean> {
    const data = await this.findRoomData(idOrCode);
    if (!data || !token) return false;
    return this.safeCompare(data.hostToken, token);
  }

  /**
   * Applies authoritative playback command (Host ONLY).
   * Monotonically increments sequence numbers and records server timestamps.
   */
  public async executeHostCommand(
    idOrCode: string,
    token: string,
    cmd: PlaybackCommand
  ): Promise<{ success: boolean; state?: WatchParty['playbackState']; error?: string }> {
    const data = await this.findRoomData(idOrCode);
    if (!data) return { success: false, error: 'Room not found' };

    if (!this.safeCompare(data.hostToken, token)) {
      return { success: false, error: 'Unauthorized: valid host credentials required' };
    }

    const now = Date.now();
    const current = data.room.playbackState;

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

    const nextSeq = current.seq + 1;

    data.room.playbackState = {
      isPlaying: newIsPlaying,
      sourceTime: Math.max(0, newSourceTime),
      playbackRate: newRate,
      seq: nextSeq,
      serverTimestamp: now,
    };
    data.lastActivity = now;

    await this.repository.saveRoom(data);

    return {
      success: true,
      state: data.room.playbackState,
    };
  }

  /**
   * Adds chat message with server-derived identity, rate-limiting, and content sanitization.
   * Client-supplied senderId and senderName are REJECTED to prevent identity spoofing.
   */
  public async addChatMessage(
    idOrCode: string,
    participantToken: string,
    text: string
  ): Promise<{ success: boolean; message?: ChatMessage; error?: string }> {
    const data = await this.findRoomData(idOrCode);
    if (!data) return { success: false, error: 'Room not found' };

    const session = data.sessions[participantToken];
    if (!session) {
      return { success: false, error: 'Unauthorized: valid participant session required to post messages' };
    }

    const cleanText = (text || '').trim().slice(0, 500);
    if (!cleanText) {
      return { success: false, error: 'Message cannot be empty' };
    }

    const now = Date.now();

    // Sliding window rate limit: max 5 messages per 3000ms, min 250ms interval
    if (now - session.lastMessageTime < 250) {
      return { success: false, error: 'Please slow down; message sent too quickly' };
    }

    if (now - session.lastMessageTime > 3000) {
      session.messageWindowCount = 1;
    } else {
      session.messageWindowCount++;
      if (session.messageWindowCount > 5) {
        return { success: false, error: 'Rate limit exceeded: maximum 5 messages per 3 seconds' };
      }
    }
    session.lastMessageTime = now;

    // Sender identity is strictly derived from server session!
    const msg: ChatMessage = {
      id: `msg-${now}-${crypto.randomBytes(2).toString('hex')}`,
      senderId: session.participantId,
      senderName: session.name,
      avatar: session.avatar,
      text: cleanText,
      timestamp: now,
      isHost: session.isHost,
    };

    data.room.chatMessages.push(msg);
    if (data.room.chatMessages.length > 200) {
      data.room.chatMessages.shift();
    }
    data.lastActivity = now;

    await this.repository.saveRoom(data);
    return { success: true, message: msg };
  }

  /**
   * Adds timestamped note with server-derived user identity.
   */
  public async addNote(
    idOrCode: string,
    participantToken: string,
    sourceTime: number,
    reactionTime: number,
    text: string
  ): Promise<{ success: boolean; note?: ReactionNote; error?: string }> {
    const data = await this.findRoomData(idOrCode);
    if (!data) return { success: false, error: 'Room not found' };

    const session = data.sessions[participantToken];
    if (!session) {
      return { success: false, error: 'Unauthorized: valid participant session required to add notes' };
    }

    if (data.room.notes.length >= 100) {
      return { success: false, error: 'Room note limit reached (maximum 100 notes per room)' };
    }

    const cleanText = (text || '').trim().slice(0, 280);
    if (!cleanText) {
      return { success: false, error: 'Note text cannot be empty' };
    }

    const now = Date.now();
    const note: ReactionNote = {
      id: `note-${now}-${crypto.randomBytes(3).toString('hex')}`,
      userId: session.participantId, // Derived from server session
      userName: session.name,
      sourceTimestamp: Math.max(0, sourceTime),
      reactionTimestamp: Math.max(0, reactionTime),
      text: cleanText,
      isPublic: true,
      createdAt: now,
    };

    data.room.notes.push(note);
    data.lastActivity = now;

    await this.repository.saveRoom(data);
    return { success: true, note };
  }

  /**
   * Deletes note with ownership or host verification.
   * Only the note creator (via participantToken) or the room host (via hostToken) can delete.
   */
  public async deleteNote(
    idOrCode: string,
    noteId: string,
    participantToken?: string,
    hostToken?: string
  ): Promise<{ success: boolean; error?: string }> {
    const data = await this.findRoomData(idOrCode);
    if (!data) return { success: false, error: 'Room not found' };

    const noteIdx = data.room.notes.findIndex((n) => n.id === noteId);
    if (noteIdx === -1) return { success: false, error: 'Note not found' };

    const note = data.room.notes[noteIdx];
    const isHost = this.safeCompare(data.hostToken, hostToken);
    const session = participantToken ? data.sessions[participantToken] : null;
    const isAuthor = session ? session.participantId === note.userId : false;

    if (!isAuthor && !isHost) {
      return { success: false, error: 'Unauthorized: only the author or the host can delete this note' };
    }

    data.room.notes.splice(noteIdx, 1);
    data.lastActivity = Date.now();

    await this.repository.saveRoom(data);
    return { success: true };
  }

  /**
   * Secure host reassignment. Old host issues new hostToken to target participant.
   */
  public async reassignHost(
    idOrCode: string,
    currentHostToken: string,
    targetParticipantId: string
  ): Promise<{ success: boolean; newHostToken?: string; error?: string }> {
    const data = await this.findRoomData(idOrCode);
    if (!data) return { success: false, error: 'Room not found' };

    if (!this.safeCompare(data.hostToken, currentHostToken)) {
      return { success: false, error: 'Unauthorized: current host credentials required' };
    }

    const targetParticipant = data.room.participants.find((p) => p.id === targetParticipantId);
    if (!targetParticipant) {
      return { success: false, error: 'Target participant not found in room' };
    }

    // Update sessions and participants
    for (const session of Object.values(data.sessions)) {
      session.isHost = session.participantId === targetParticipantId;
    }
    data.room.participants.forEach((p) => {
      p.isHost = p.id === targetParticipantId;
    });

    const newHostToken = this.generateSecureToken();
    data.hostToken = newHostToken;
    data.room.hostId = targetParticipant.id;
    data.room.hostName = targetParticipant.name;
    data.lastActivity = Date.now();

    await this.repository.saveRoom(data);
    return { success: true, newHostToken };
  }

  public estimateCurrentSourceTime(playbackState: WatchParty['playbackState']): number {
    if (!playbackState.isPlaying) {
      return playbackState.sourceTime;
    }
    const elapsedSeconds = (Date.now() - playbackState.serverTimestamp) / 1000;
    return playbackState.sourceTime + elapsedSeconds * playbackState.playbackRate;
  }

  private async findRoomData(idOrCode: string): Promise<StoredRoomData | null> {
    let data = await this.repository.getRoomById(idOrCode);
    if (!data) {
      data = await this.repository.getRoomByCode(idOrCode);
    }
    return data;
  }

  private sanitizeRoom(room: WatchParty): WatchParty {
    return JSON.parse(JSON.stringify(room));
  }
}
