/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type MediaProviderType = 'native' | 'youtube' | 'google_drive' | 'patreon' | 'unknown';

export type PlaybackMode = 'native' | 'embedded' | 'external';

export type SyncCapability = 'full_sync' | 'partial_sync' | 'manual_sync';

export interface PlayerControlCapabilities {
  canPlay: boolean;
  canPause: boolean;
  canSeek: boolean;
  canReadTime: boolean;
  canReadDuration: boolean;
  canControlRate: boolean;
  supportsContinuousRate: boolean;
  canControlVolume: boolean;
}

export const NATIVE_CAPABILITIES: PlayerControlCapabilities = {
  canPlay: true,
  canPause: true,
  canSeek: true,
  canReadTime: true,
  canReadDuration: true,
  canControlRate: true,
  supportsContinuousRate: true,
  canControlVolume: true,
};

export const YOUTUBE_CAPABILITIES: PlayerControlCapabilities = {
  canPlay: true,
  canPause: true,
  canSeek: true,
  canReadTime: true,
  canReadDuration: true,
  canControlRate: true,
  supportsContinuousRate: false,
  canControlVolume: true,
};

export const MANUAL_ONLY_CAPABILITIES: PlayerControlCapabilities = {
  canPlay: false,
  canPause: false,
  canSeek: false,
  canReadTime: false,
  canReadDuration: false,
  canControlRate: false,
  supportsContinuousRate: false,
  canControlVolume: false,
};

export interface PlayerErrorInfo {
  message: string;
  code?: number | string;
}

export interface MediaProviderInfo {
  provider: MediaProviderType;
  name: string;
  playbackMode: PlaybackMode;
  syncCapability: SyncCapability;
  capabilities: PlayerControlCapabilities;
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
 * Legacy HTML5-shaped player element contract kept for compatibility with
 * direct HTMLVideoElement consumers. Prefer MediaPlayerAdapter for new code.
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

/**
 * Authoritative adapter contract consumed by SessionSyncController.
 * Players that lack control or telemetry MUST return null for unavailable state
 * and false for unsupported commands rather than fabricating playback metrics.
 */
export interface MediaPlayerAdapter {
  readonly id: string;
  readonly provider: MediaProviderType;
  readonly playbackMode: PlaybackMode;
  readonly syncCapability: SyncCapability;
  readonly capabilities: PlayerControlCapabilities;

  getCurrentTime(): number | null;
  getDuration(): number | null;
  isPaused(): boolean | null;
  isBuffering(): boolean;
  getReadyState(): number;
  getError(): PlayerErrorInfo | null;
  getPlaybackRate(): number | null;
  isMuted(): boolean | null;
  getVolume(): number | null;

  play(): Promise<boolean>;
  pause(): boolean;
  seekTo(seconds: number): boolean;
  setPlaybackRate(rate: number): boolean;
  setMuted(muted: boolean): boolean;
  setVolume(volume: number): boolean;
  requestPictureInPicture?(): Promise<any>;
}

export interface RegisteredPlayerStatus {
  playerId: string;
  role: 'source' | 'reaction';
  provider: MediaProviderType;
  playbackMode: PlaybackMode;
  syncCapability: SyncCapability;
  capabilities: PlayerControlCapabilities;
  isReady: boolean;
  isBuffering: boolean;
  hasError: boolean;
  errorMessage?: string;
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

export function isMediaPlayerAdapter(value: unknown): value is MediaPlayerAdapter {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'capabilities' in value &&
      typeof (value as MediaPlayerAdapter).getCurrentTime === 'function' &&
      typeof (value as MediaPlayerAdapter).seekTo === 'function'
  );
}

/**
 * Wraps a native HTMLVideoElement (or compatible mock) as a full-capability MediaPlayerAdapter.
 */
export function wrapHtmlVideoElementAsAdapter(
  id: string,
  el: MediaPlayerAdapter | MediaPlayerElement | HTMLVideoElement
): MediaPlayerAdapter {
  if (isMediaPlayerAdapter(el)) {
    return el;
  }

  return {
    id,
    provider: 'native',
    playbackMode: 'native',
    syncCapability: 'full_sync',
    capabilities: NATIVE_CAPABILITIES,
    getCurrentTime: () => {
      const t = el.currentTime;
      return typeof t === 'number' && Number.isFinite(t) ? t : null;
    },
    getDuration: () => {
      const d = el.duration;
      return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null;
    },
    isPaused: () => Boolean(el.paused),
    isBuffering: () => !el.error && el.readyState < 3 && !el.paused,
    getReadyState: () => (typeof el.readyState === 'number' ? el.readyState : 4),
    getError: () => {
      if (!el.error) return null;
      return {
        message: el.error.message || 'Media playback error',
        code: el.error.code,
      };
    },
    getPlaybackRate: () => {
      const r = el.playbackRate;
      return typeof r === 'number' && Number.isFinite(r) ? r : 1.0;
    },
    isMuted: () => Boolean(el.muted),
    getVolume: () => (typeof el.volume === 'number' ? el.volume : 1.0),
    play: async () => {
      if (el.error) return false;
      try {
        await Promise.resolve(el.play());
        return !el.paused;
      } catch {
        return false;
      }
    },
    pause: () => {
      try {
        el.pause();
        return true;
      } catch {
        return false;
      }
    },
    seekTo: (seconds: number) => {
      if (el.error || el.readyState < 1) return false;
      try {
        el.currentTime = Math.max(0, seconds);
        return true;
      } catch {
        return false;
      }
    },
    setPlaybackRate: (rate: number) => {
      if (el.error) return false;
      try {
        el.playbackRate = rate;
        return true;
      } catch {
        return false;
      }
    },
    setMuted: (muted: boolean) => {
      try {
        el.muted = muted;
        return true;
      } catch {
        return false;
      }
    },
    setVolume: (volume: number) => {
      try {
        el.volume = Math.max(0, Math.min(1, volume));
        return true;
      } catch {
        return false;
      }
    },
    requestPictureInPicture: el.requestPictureInPicture
      ? () => el.requestPictureInPicture!()
      : undefined,
  };
}
