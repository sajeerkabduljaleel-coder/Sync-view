/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type AnchorType = 'linear' | 'pause' | 'skip' | 'intro' | 'outro';

export interface SyncAnchor {
  id: string;
  sourceTime: number; // in seconds
  reactionTime: number; // in seconds
  type: AnchorType;
  label?: string;
  notes?: string;
}

export interface SyncMapping {
  id: string;
  reactionId: string;
  sourceId: string;
  anchors: SyncAnchor[];
  introDuration: number; // seconds before source starts
  outroDuration?: number;
  driftTolerance: number; // in seconds, default 0.1s
  microRateAdjustment: number; // e.g. 0.05 (speeds up to 1.05 or slows to 0.95)
}

export type DriftStatus =
  | 'synced'
  | 'adjusting'
  | 'drifting'
  | 'buffering'
  | 'intro'
  | 'break'
  | 'paused';

export interface DriftMetrics {
  currentDrift: number; // in seconds (positive = reaction is ahead of target)
  targetTime: number;
  actualTime: number;
  status: DriftStatus;
  playbackRate: number;
  lastCorrectionTime: number;
  correctionCount: number;
}

export interface VideoSource {
  id: string;
  title: string;
  creator: string;
  duration: number; // seconds
  url: string;
  thumbnail: string;
  category: 'Movies & TV' | 'Gaming' | 'Music' | 'Tech' | 'Sports' | 'Anime';
  description: string;
  releaseYear?: number;
  isLocalFile?: boolean;
  fileName?: string;
  fileSize?: number;
}

export interface ReactionChapter {
  id: string;
  title: string;
  sourceTimestamp: number;
  reactionTimestamp: number;
  description?: string;
}

export interface ReactionHighlight {
  id: string;
  title: string;
  type: 'laugh' | 'shock' | 'breakdown' | 'quote' | 'hype';
  sourceTimestamp: number;
  reactionTimestamp: number;
}

export interface ReactionNote {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  sourceTimestamp: number;
  reactionTimestamp: number;
  text: string;
  isPublic: boolean;
  createdAt: number;
}

export interface ReactionVideo {
  id: string;
  sourceId: string;
  creator: string;
  channelName: string;
  avatar: string;
  title: string;
  duration: number;
  introDuration: number;
  url: string;
  thumbnail: string;
  anchors: SyncAnchor[];
  chapters: ReactionChapter[];
  highlights: ReactionHighlight[];
  notes: ReactionNote[];
  views: number;
  likes: number;
  isPublished: boolean;
  createdAt: number;
  isLocalFile?: boolean;
  fileName?: string;
  fileSize?: number;
}

export type TheatreLayout =
  | 'side-by-side'
  | 'source-focus'
  | 'reactor-focus'
  | 'grid'
  | 'pip';

export interface ExtraReactor {
  reaction: ReactionVideo;
  muted: boolean;
  volume: number;
  status: DriftStatus;
  metrics?: DriftMetrics;
}

export interface WatchPartyParticipant {
  id: string;
  name: string;
  avatar: string;
  isHost: boolean;
  joinedAt: number;
  status: 'watching' | 'buffering' | 'idle';
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  avatar: string;
  text: string;
  timestamp: number;
  isHost: boolean;
}

export interface EmojiReaction {
  id: string;
  emoji: string;
  senderName: string;
  timestamp: number;
}

export interface WatchParty {
  id: string;
  title: string;
  roomCode: string;
  hostId: string;
  hostName: string;
  sourceVideo: VideoSource;
  primaryReaction: ReactionVideo;
  additionalReactions: ReactionVideo[];
  playbackState: {
    isPlaying: boolean;
    sourceTime: number;
    playbackRate: number;
    seq: number;
    serverTimestamp: number;
  };
  participants: WatchPartyParticipant[];
  chatMessages: ChatMessage[];
  notes: ReactionNote[];
  isLocked: boolean;
  createdAt: number;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: 'viewer' | 'reactor' | 'admin';
  avatar: string;
  channelName?: string;
  savedReactions: string[]; // reaction ids
  recentHistory: { reactionId: string; watchedAt: number }[];
  drafts: ReactionVideo[];
}
