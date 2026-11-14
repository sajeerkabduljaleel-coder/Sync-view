/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type MediaProviderType = 'native' | 'youtube' | 'google_drive' | 'patreon' | 'unknown';

export type PlaybackMode = 'native' | 'embedded' | 'external';

export type SyncCapability = 'full_sync' | 'partial_sync' | 'manual_sync';

export interface MediaProviderInfo {
  provider: MediaProviderType;
  name: string;
  playbackMode: PlaybackMode;
  syncCapability: SyncCapability;
  rawUrl: string;
  normalizedUrl: string;
  embedUrl?: string;
  externalUrl?: string;
  videoId?: string;
  fileId?: string;
  badgeText: string;
  description: string;
  authRequirement?: string;
  restrictions?: string[];
  isDirectStream?: boolean;
}

/**
 * Unified media player element interface required by SessionSyncController.
 * HTMLVideoElement natively satisfies this interface.
 * External player adapters (e.g. YouTube IFrame Player API, Google Drive, Patreon)
 * implement this contract to enable multi-timeline synchronization.
 */
export interface MediaPlayerElement {
  currentTime: number;
  duration: number;
  paused: boolean;
  error: any | null;
  readyState: number;
  playbackRate: number;
  muted: boolean;
  volume: number;
  play(): Promise<void> | void;
  pause(): void;
  requestPictureInPicture?(): Promise<any>;
}

export interface PlayerCapabilitiesReport {
  playerId: string;
  provider: MediaProviderType;
  playbackMode: PlaybackMode;
  syncCapability: SyncCapability;
  canSeek: boolean;
  canControlRate: boolean;
  canMute: boolean;
  isReady: boolean;
  hasError: boolean;
  errorMessage?: string;
}
