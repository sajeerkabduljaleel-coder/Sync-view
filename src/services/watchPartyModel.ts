/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { WatchParty, WatchPartyParticipant, ChatMessage, ReactionNote, VideoSource, ReactionVideo } from '../types';
import {
  IWatchPartyRepository,
  SingleInstanceFileWatchPartyRepository,
  StoredRoomData,
  ParticipantSession,
  hashSecretToken,
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

export function escapeHtml(str: string): string {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

export class WatchPartyManager {
  private repository: IWatchPartyRepository;
  private readonly roomTtlMs = 1000 * 60 * 60 * 24; // 24 hours
  private readonly participantTimeoutMs: number;

  constructor(
    repository?: IWatchPartyRepository,
    options?: { participantTimeoutMs?: number }
  ) {
    this.repository = repository || new SingleInstanceFileWatchPartyRepository();
    this.participantTimeoutMs =
      typeof options?.participantTimeoutMs === 'number' && options.participantTimeoutMs > 0
        ? options.participantTimeoutMs
        : 15000;
  }

  private applyPresenceToRoom(data: StoredRoomData, now = Date.now()): void {
    const sessionsByParticipantId = new Map<string, ParticipantSession>();
    for (const session of Object.values(data.sessions || {})) {
      sessionsByParticipantId.set(session.participantId, session);
    }

    for (const p of data.room.participants) {
      const session = sessionsByParticipantId.get(p.id);
      if (!session) {
        p.status = 'disconnected';
        continue;
      }
      const lastSeen = typeof session.lastSeenAt === 'number' ? session.lastSeenAt : session.joinedAt;
      if (session.explicitlyLeft || now - lastSeen > this.participantTimeoutMs) {
        p.status = 'disconnected';
      } else {
        p.status = 'watching';
      }
      p.isHost = p.id === data.room.hostId;
    }
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

  public hashToken(token: string): string {
    return hashSecretToken(token);
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
   * Tokens are hashed with SHA-256 before storage; raw tokens are never persisted.
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
    const hostTokenHash = this.hashToken(hostToken);
    const participantTokenHash = this.hashToken(participantToken);
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
      tokenHash: participantTokenHash,
      participantId: hostId,
      name: hostParticipant.name,
      avatar: hostParticipant.avatar,
      isHost: true,
      roomId,
      joinedAt: now,
      lastSeenAt: now,
      explicitlyLeft: false,
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
      hostTokenHash,
      sessions: {
        [participantTokenHash]: hostSession,
      },
      lastActivity: now,
      version: 1,
    };

    await this.repository.saveRoom(storedData);
    return { room: this.toPublicRoomDTO(room), hostToken, participantToken };
  }

  /**
   * Fetches room state, sanitized using an explicit field allowlist to guarantee no tokens or hashes leak.
   * When participantToken is provided, refreshes that participant's presence heartbeat.
   */
  public async getRoom(idOrCode: string, participantToken?: string): Promise<WatchParty | null> {
    const data = await this.findRoomData(idOrCode);
    if (!data) return null;

    const now = Date.now();
    if (participantToken) {
      const tokenHash = this.hashToken(participantToken);
      const session = data.sessions[tokenHash] || data.sessions[participantToken];
      if (session) {
        const wasDisconnected =
          session.explicitlyLeft ||
          now - (typeof session.lastSeenAt === 'number' ? session.lastSeenAt : session.joinedAt) >
            this.participantTimeoutMs;
        session.lastSeenAt = now;
        session.explicitlyLeft = false;
        const p = data.room.participants.find((item) => item.id === session.participantId);
        if (p) p.status = 'watching';
        if (wasDisconnected || now - data.lastActivity >= 1500) {
          data.lastActivity = now;
          await this.repository.saveRoom(data);
        }
      }
    }

    this.applyPresenceToRoom(data, now);
    return this.toPublicRoomDTO(data.room);
  }

  /**
   * Join an existing room.
   * If existingToken is valid, reconnects the existing participant without duplicating them.
   */
  public async joinRoom(
    idOrCode: string,
    participantName: string,
    existingToken?: string
  ): Promise<{ room: WatchParty; participantId: string; participantToken: string; isHost: boolean } | null> {
    const data = await this.findRoomData(idOrCode);
    if (!data) return null;

    const now = Date.now();

    // Reconnection check using hashed token lookup
    if (existingToken) {
      const existingHash = this.hashToken(existingToken);
      const existingSession = data.sessions[existingHash] || data.sessions[existingToken];
      if (existingSession) {
        existingSession.lastSeenAt = now;
        existingSession.explicitlyLeft = false;
        const existingParticipant = data.room.participants.find(
          (p) => p.id === existingSession.participantId
        );
        if (existingParticipant) {
          existingParticipant.status = 'watching';
        } else {
          data.room.participants.push({
            id: existingSession.participantId,
            name: existingSession.name,
            avatar: existingSession.avatar,
            isHost: data.room.hostId === existingSession.participantId,
            joinedAt: existingSession.joinedAt,
            status: 'watching',
          });
        }
        this.applyPresenceToRoom(data, now);
        data.lastActivity = now;
        await this.repository.saveRoom(data);
        return {
          room: this.toPublicRoomDTO(data.room),
          participantId: existingSession.participantId,
          participantToken: existingToken,
          isHost: data.room.hostId === existingSession.participantId,
        };
      }
    }

    const safeName = (participantName || 'Guest Viewer').trim().slice(0, 30);
    const participantId = `viewer-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const participantToken = this.generateSecureToken();
    const participantTokenHash = this.hashToken(participantToken);

    const participant: WatchPartyParticipant = {
      id: participantId,
      name: safeName,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${participantId}`,
      isHost: false,
      joinedAt: now,
      status: 'watching',
    };

    const session: ParticipantSession = {
      tokenHash: participantTokenHash,
      participantId,
      name: safeName,
      avatar: participant.avatar,
      isHost: false,
      roomId: data.room.id,
      joinedAt: now,
      lastSeenAt: now,
      explicitlyLeft: false,
      lastMessageTime: 0,
      messageWindowCount: 0,
    };

    // Deduplicate participant list by ID
    data.room.participants = data.room.participants.filter((p) => p.id !== participantId);
    data.room.participants.push(participant);
    data.sessions[participantTokenHash] = session;
    this.applyPresenceToRoom(data, now);
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
      room: this.toPublicRoomDTO(data.room),
      participantId,
      participantToken,
      isHost: false,
    };
  }

  /**
   * Explicitly marks a participant as disconnected when they exit the Watch Party.
   */
  public async leaveRoom(
    idOrCode: string,
    participantToken: string
  ): Promise<{ success: boolean; error?: string }> {
    const data = await this.findRoomData(idOrCode);
    if (!data) return { success: false, error: 'Room not found' };

    const tokenHash = this.hashToken(participantToken);
    const session = data.sessions[tokenHash] || data.sessions[participantToken];
    if (!session) {
      return { success: false, error: 'Unauthorized: valid participant session required' };
    }

    const now = Date.now();
    session.explicitlyLeft = true;
    const p = data.room.participants.find((item) => item.id === session.participantId);
    if (p) {
      p.status = 'disconnected';
    }

    data.room.chatMessages.push({
      id: `msg-${now}-${crypto.randomBytes(2).toString('hex')}`,
      senderId: 'system',
      senderName: 'SyncView Bot',
      avatar: '',
      text: `${session.name} left the party.`,
      timestamp: now,
      isHost: false,
    });
    if (data.room.chatMessages.length > 200) {
      data.room.chatMessages.shift();
    }

    this.applyPresenceToRoom(data, now);
    data.lastActivity = now;
    await this.repository.saveRoom(data);
    return { success: true };
  }

  /**
   * Safely claims host credentials for a verified room member when either:
   * 1. The caller is already the designated host (e.g. completing an explicit host reassignment), OR
   * 2. The current host is disconnected (left explicitly or timed out).
   * Rejects any takeover attempt while an active host is connected.
   */
  public async claimHost(
    idOrCode: string,
    participantToken: string
  ): Promise<{ success: boolean; hostToken?: string; room?: WatchParty; error?: string }> {
    const data = await this.findRoomData(idOrCode);
    if (!data) return { success: false, error: 'Room not found' };

    const tokenHash = this.hashToken(participantToken);
    const session = data.sessions[tokenHash] || data.sessions[participantToken];
    if (!session) {
      return { success: false, error: 'Unauthorized: valid participant session required' };
    }

    const now = Date.now();
    session.lastSeenAt = now;
    session.explicitlyLeft = false;
    this.applyPresenceToRoom(data, now);

    const isAlreadyDesignatedHost = data.room.hostId === session.participantId;
    const currentHostParticipant = data.room.participants.find((p) => p.id === data.room.hostId);
    const isCurrentHostDisconnected =
      !currentHostParticipant || currentHostParticipant.status === 'disconnected';

    if (!isAlreadyDesignatedHost && !isCurrentHostDisconnected) {
      return {
        success: false,
        error: 'Cannot claim host controls while the current host is still connected.',
      };
    }

    for (const s of Object.values(data.sessions)) {
      s.isHost = s.participantId === session.participantId;
    }
    data.room.participants.forEach((p) => {
      p.isHost = p.id === session.participantId;
      if (p.id === session.participantId) {
        p.status = 'watching';
      }
    });

    const newHostToken = this.generateSecureToken();
    data.hostTokenHash = this.hashToken(newHostToken);
    delete data.hostToken;
    data.room.hostId = session.participantId;
    data.room.hostName = session.name;
    data.lastActivity = now;

    if (!isAlreadyDesignatedHost) {
      data.room.chatMessages.push({
        id: `msg-${now}-${crypto.randomBytes(2).toString('hex')}`,
        senderId: 'system',
        senderName: 'SyncView Bot',
        avatar: '',
        text: `${session.name} took over as Watch Party host.`,
        timestamp: now,
        isHost: false,
      });
      if (data.room.chatMessages.length > 200) {
        data.room.chatMessages.shift();
      }
    }

    await this.repository.saveRoom(data);
    return {
      success: true,
      hostToken: newHostToken,
      room: this.toPublicRoomDTO(data.room),
    };
  }

  public async isAuthorizedHost(idOrCode: string, token: string): Promise<boolean> {
    if (!token) return false;
    const data = await this.findRoomData(idOrCode);
    if (!data) return false;

    const tokenHash = this.hashToken(token);
    if (data.hostTokenHash) {
      return this.safeCompare(data.hostTokenHash, tokenHash);
    }
    // Backward-compat for legacy unhashed records during migration
    if (data.hostToken) {
      return this.safeCompare(data.hostToken, token);
    }
    return false;
  }

  public async getParticipantSession(idOrCode: string, token: string): Promise<ParticipantSession | null> {
    if (!token) return null;
    const data = await this.findRoomData(idOrCode);
    if (!data) return null;

    const tokenHash = this.hashToken(token);
    return data.sessions[tokenHash] || data.sessions[token] || null;
  }

  /**
   * Applies authoritative playback command (Host ONLY).
   * Monotonically increments sequence numbers and records server timestamps.
   */
  public async executeHostCommand(
    idOrCode: string,
    token: string,
    cmd: PlaybackCommand
  ): Promise<{ success: boolean; state?: WatchParty['playbackState']; error?: string; conflict?: boolean }> {
    const data = await this.findRoomData(idOrCode);
    if (!data) return { success: false, error: 'Room not found' };

    const isHost = await this.isAuthorizedHost(idOrCode, token);
    if (!isHost) {
      return { success: false, error: 'Unauthorized: valid host credentials required' };
    }

    const now = Date.now();
    const current = data.room.playbackState;

    if (
      typeof cmd.expectedSeq === 'number' &&
      Number.isFinite(cmd.expectedSeq) &&
      cmd.expectedSeq < current.seq
    ) {
      return {
        success: false,
        conflict: true,
        state: current,
        error: `Out-of-order command rejected (expectedSeq ${cmd.expectedSeq} < current seq ${current.seq})`,
      };
    }

    const VALID_COMMANDS = new Set(['play', 'pause', 'seek', 'rate', 'change_media']);
    if (!VALID_COMMANDS.has(cmd.command)) {
      return { success: false, error: `Invalid playback command type: ${cmd.command}` };
    }

    let newIsPlaying = current.isPlaying;
    let newSourceTime = current.sourceTime;
    let newRate = current.playbackRate;

    switch (cmd.command) {
      case 'play':
        newIsPlaying = true;
        if (typeof cmd.sourceTime === 'number' && Number.isFinite(cmd.sourceTime) && cmd.sourceTime >= 0) {
          newSourceTime = Math.min(86400, cmd.sourceTime);
        }
        break;
      case 'pause':
        newIsPlaying = false;
        if (typeof cmd.sourceTime === 'number' && Number.isFinite(cmd.sourceTime) && cmd.sourceTime >= 0) {
          newSourceTime = Math.min(86400, cmd.sourceTime);
        }
        break;
      case 'seek':
        if (typeof cmd.sourceTime !== 'number' || !Number.isFinite(cmd.sourceTime) || cmd.sourceTime < 0 || cmd.sourceTime > 86400) {
          return { success: false, error: 'Invalid seek timestamp: must be finite number between 0 and 86400' };
        }
        newSourceTime = cmd.sourceTime;
        break;
      case 'rate':
        if (typeof cmd.playbackRate !== 'number' || !Number.isFinite(cmd.playbackRate) || cmd.playbackRate < 0.25 || cmd.playbackRate > 3.0) {
          return { success: false, error: 'Invalid playback rate: must be between 0.25 and 3.0' };
        }
        newRate = cmd.playbackRate;
        break;
    }

    const nextSeq = current.seq + 1;

    // Refresh host session presence
    for (const session of Object.values(data.sessions || {})) {
      if (session.participantId === data.room.hostId) {
        session.lastSeenAt = now;
        session.explicitlyLeft = false;
      }
    }

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

    const tokenHash = this.hashToken(participantToken);
    const session = data.sessions[tokenHash] || data.sessions[participantToken];
    if (!session) {
      return { success: false, error: 'Unauthorized: valid participant session required to post messages' };
    }

    const rawText = typeof text === 'string' ? text.trim() : '';
    if (!rawText) {
      return { success: false, error: 'Message cannot be empty' };
    }
    const cleanText = escapeHtml(rawText.slice(0, 500));

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
    session.lastSeenAt = now;
    session.explicitlyLeft = false;

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

    const tokenHash = this.hashToken(participantToken);
    const session = data.sessions[tokenHash] || data.sessions[participantToken];
    if (!session) {
      return { success: false, error: 'Unauthorized: valid participant session required to add notes' };
    }

    if (data.room.notes.length >= 100) {
      return { success: false, error: 'Room note limit reached (maximum 100 notes per room)' };
    }

    const rawText = typeof text === 'string' ? text.trim() : '';
    if (!rawText) {
      return { success: false, error: 'Note text cannot be empty' };
    }
    const cleanText = escapeHtml(rawText.slice(0, 280));

    // Validate timestamps
    if (typeof sourceTime !== 'number' || !Number.isFinite(sourceTime) || sourceTime < 0 || sourceTime > 86400) {
      return { success: false, error: 'Invalid source timestamp: must be finite number between 0 and 86400' };
    }
    if (typeof reactionTime !== 'number' || !Number.isFinite(reactionTime) || reactionTime < 0 || reactionTime > 86400) {
      return { success: false, error: 'Invalid reaction timestamp: must be finite number between 0 and 86400' };
    }

    const now = Date.now();
    session.lastSeenAt = now;
    session.explicitlyLeft = false;
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
    const isHost = hostToken ? await this.isAuthorizedHost(idOrCode, hostToken) : false;
    const session = participantToken ? await this.getParticipantSession(idOrCode, participantToken) : null;
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

    const isHost = await this.isAuthorizedHost(idOrCode, currentHostToken);
    if (!isHost) {
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
    data.hostTokenHash = this.hashToken(newHostToken);
    delete data.hostToken; // Remove any legacy plaintext field
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

  public async getAllRooms(): Promise<WatchParty[]> {
    const records = await this.repository.getAllRooms();
    const now = Date.now();
    return records.map((r) => {
      this.applyPresenceToRoom(r, now);
      return this.toPublicRoomDTO(r.room);
    });
  }

  public async findRoomData(idOrCode: string): Promise<StoredRoomData | null> {
    let data = await this.repository.getRoomById(idOrCode);
    if (!data) {
      data = await this.repository.getRoomByCode(idOrCode);
    }
    return data;
  }

  /**
   * Explicit allowlist DTO projection.
   * Guarantees that internal credential hashes, session records, or server metadata never leak.
   */
  public toPublicRoomDTO(room: WatchParty): WatchParty {
    return {
      id: room.id,
      title: room.title,
      roomCode: room.roomCode,
      hostId: room.hostId,
      hostName: room.hostName,
      sourceVideo: {
        id: room.sourceVideo.id,
        title: room.sourceVideo.title,
        creator: room.sourceVideo.creator,
        duration: room.sourceVideo.duration,
        url: room.sourceVideo.url,
        thumbnail: room.sourceVideo.thumbnail,
        category: room.sourceVideo.category,
        description: room.sourceVideo.description,
        releaseYear: room.sourceVideo.releaseYear,
      },
      primaryReaction: {
        id: room.primaryReaction.id,
        sourceId: room.primaryReaction.sourceId,
        creator: room.primaryReaction.creator,
        channelName: room.primaryReaction.channelName,
        avatar: room.primaryReaction.avatar,
        title: room.primaryReaction.title,
        duration: room.primaryReaction.duration,
        introDuration: room.primaryReaction.introDuration,
        url: room.primaryReaction.url,
        thumbnail: room.primaryReaction.thumbnail,
        anchors: (room.primaryReaction.anchors || []).map((a) => ({ ...a })),
        chapters: (room.primaryReaction.chapters || []).map((c) => ({ ...c })),
        highlights: (room.primaryReaction.highlights || []).map((h) => ({ ...h })),
        notes: (room.primaryReaction.notes || []).map((n) => ({ ...n })),
        views: room.primaryReaction.views ?? 0,
        likes: room.primaryReaction.likes ?? 0,
        isPublished: room.primaryReaction.isPublished ?? true,
        createdAt: room.primaryReaction.createdAt ?? room.createdAt,
      },
      additionalReactions: (room.additionalReactions || []).map((r) => ({
        id: r.id,
        sourceId: r.sourceId,
        creator: r.creator,
        channelName: r.channelName,
        avatar: r.avatar,
        title: r.title,
        duration: r.duration,
        introDuration: r.introDuration,
        url: r.url,
        thumbnail: r.thumbnail,
        anchors: (r.anchors || []).map((a) => ({ ...a })),
        chapters: (r.chapters || []).map((c) => ({ ...c })),
        highlights: (r.highlights || []).map((h) => ({ ...h })),
        notes: (r.notes || []).map((n) => ({ ...n })),
        views: r.views ?? 0,
        likes: r.likes ?? 0,
        isPublished: r.isPublished ?? true,
        createdAt: r.createdAt ?? room.createdAt,
      })),
      playbackState: {
        isPlaying: Boolean(room.playbackState.isPlaying),
        sourceTime: Number(room.playbackState.sourceTime) || 0,
        playbackRate: Number(room.playbackState.playbackRate) || 1.0,
        seq: Number(room.playbackState.seq) || 1,
        serverTimestamp: Number(room.playbackState.serverTimestamp) || Date.now(),
      },
      participants: (room.participants || []).map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isHost: Boolean(p.isHost),
        joinedAt: p.joinedAt,
        status: p.status,
      })),
      chatMessages: (room.chatMessages || []).map((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderName: m.senderName,
        avatar: m.avatar,
        text: m.text,
        timestamp: m.timestamp,
        isHost: Boolean(m.isHost),
      })),
      notes: (room.notes || []).map((n) => ({
        id: n.id,
        userId: n.userId,
        userName: n.userName,
        userAvatar: n.userAvatar,
        sourceTimestamp: n.sourceTimestamp,
        reactionTimestamp: n.reactionTimestamp,
        text: n.text,
        isPublic: Boolean(n.isPublic),
        createdAt: n.createdAt,
      })),
      isLocked: Boolean(room.isLocked),
      createdAt: room.createdAt,
    };
  }
}
