/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MANUAL_ONLY_CAPABILITIES,
  MediaProviderInfo,
  NATIVE_CAPABILITIES,
  SyncCapability,
  YOUTUBE_CAPABILITIES,
} from './types';
import { parseGoogleDriveUrl } from '../mediaResolver';

// ---------------------------------------------------------------------------
// YouTube URL Matching & Extraction
// ---------------------------------------------------------------------------

/**
 * Extracts YouTube 11-character video ID from various YouTube URL formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 * - https://m.youtube.com/watch?v=VIDEO_ID
 */
export function extractYouTubeVideoId(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();

  // Handle youtu.be/VIDEO_ID
  const shortMatch = trimmed.match(/^https?:\/\/(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})(?:[?&/#].*)?$/i);
  if (shortMatch && shortMatch[1]) {
    return shortMatch[1];
  }

  // Handle youtube.com (watch, embed, shorts, live)
  const isYouTubeDomain = /^https?:\/\/(?:[a-zA-Z0-9-]+\.)?youtube(?:-nocookie)?\.com(?:\/|$)/i.test(trimmed);
  if (isYouTubeDomain) {
    try {
      const parsed = new URL(trimmed);
      const vParam = parsed.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
        return vParam;
      }
      const pathMatch = parsed.pathname.match(/^\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})(?:\/|$)/i);
      if (pathMatch && pathMatch[1]) {
        return pathMatch[1];
      }
    } catch {
      const pathMatch = trimmed.match(/\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})(?:[?&/#].*)?$/i);
      if (pathMatch && pathMatch[1]) {
        return pathMatch[1];
      }
    }
  }

  return null;
}

export function isYouTubeHostUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return /^https?:\/\/(?:(?:[a-zA-Z0-9-]+\.)?youtube(?:-nocookie)?\.com|(?:www\.)?youtu\.be)(?:\/|$)/i.test(
    url.trim()
  );
}

// ---------------------------------------------------------------------------
// Patreon URL Matching
// ---------------------------------------------------------------------------

export function isPatreonUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return /^https?:\/\/(?:www\.)?patreon\.com(?:\/|$)/i.test(url.trim());
}

// ---------------------------------------------------------------------------
// Internal Proxy Google Drive URL Detection
// ---------------------------------------------------------------------------

export function extractProxyDriveId(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  const match = trimmed.match(/^(?:https?:\/\/[^/]+)?\/api\/media\/stream\?(?:.*&)?driveId=([a-zA-Z0-9_-]{15,})(?:&|$)/i);
  return match?.[1] || null;
}

// ---------------------------------------------------------------------------
// Provider Detection & Factory
// ---------------------------------------------------------------------------

export interface DetectMediaProviderOptions {
  drivePlaybackMode?: 'native' | 'embedded';
}

/**
 * Detects the media provider and declares its actual synchronisation capabilities,
 * playback mode, and authentication requirements without pretending unsupported features exist.
 */
export function detectMediaProvider(
  rawUrl: string,
  isLocalFile = false,
  options: DetectMediaProviderOptions = {}
): MediaProviderInfo {
  const trimmed = (rawUrl || '').trim();

  // 1. Local Uploaded Video File
  if (isLocalFile || trimmed.startsWith('blob:')) {
    return {
      provider: 'native',
      name: 'Local Video File',
      playbackMode: 'native',
      syncCapability: 'full_sync',
      capabilities: NATIVE_CAPABILITIES,
      rawUrl: trimmed,
      normalizedUrl: trimmed,
      badgeText: 'Local file — automatic synchronisation active.',
      description: 'Playing directly in browser from your local file with full frame-accurate sync.',
    };
  }

  // 2. YouTube Video
  const youtubeVideoId = extractYouTubeVideoId(trimmed);
  if (youtubeVideoId) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return {
      provider: 'youtube',
      name: 'YouTube',
      playbackMode: 'embedded',
      syncCapability: 'full_sync',
      capabilities: YOUTUBE_CAPABILITIES,
      rawUrl: trimmed,
      normalizedUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${youtubeVideoId}?enablejsapi=1&origin=${encodeURIComponent(
        origin
      )}&rel=0&modestbranding=1`,
      videoId: youtubeVideoId,
      badgeText: 'YouTube player — automatic synchronisation (play, seek & discrete rates).',
      description: 'Using official YouTube IFrame Player API for synchronized multi-timeline playback.',
      restrictions: [
        'Embedding must be permitted by the video uploader.',
        'Playback rates use discrete YouTube steps (large drift corrects by seeking).',
        'Age-restricted or private videos require sign-in on YouTube.',
      ],
    };
  }

  // 3. Google Drive Proxy Stream URL (/api/media/stream?driveId=...) or raw Drive link
  const proxyDriveId = extractProxyDriveId(trimmed);
  const driveInfo = parseGoogleDriveUrl(trimmed);
  const resolvedDriveId = proxyDriveId || driveInfo.fileId;

  if (proxyDriveId || (driveInfo.isGoogleDrive && resolvedDriveId)) {
    const fileId = resolvedDriveId!;
    const useNativeProxy =
      options.drivePlaybackMode === 'native' ||
      (Boolean(proxyDriveId) && options.drivePlaybackMode !== 'embedded');

    if (useNativeProxy) {
      return {
        provider: 'google_drive',
        name: 'Google Drive Stream',
        playbackMode: 'native',
        syncCapability: 'full_sync',
        capabilities: NATIVE_CAPABILITIES,
        rawUrl: trimmed,
        normalizedUrl: `https://drive.google.com/file/d/${fileId}/view`,
        embedUrl: `https://drive.google.com/file/d/${fileId}/preview`,
        fileId,
        isDirectStream: true,
        badgeText: 'Google Drive direct stream — automatic synchronisation active.',
        description:
          'Streaming public Google Drive video through verified HTTP Range proxy with full playback controls.',
        authRequirement: 'Set Google Drive sharing to "Anyone with the link can view".',
        restrictions: [
          'Requires public "Anyone with the link can view" permissions.',
          'Preview iframe fallback does not expose automatic play, seek, or time controls.',
        ],
      };
    }

    return {
      provider: 'google_drive',
      name: 'Google Drive Preview',
      playbackMode: 'embedded',
      syncCapability: 'manual_sync',
      capabilities: MANUAL_ONLY_CAPABILITIES,
      rawUrl: trimmed,
      normalizedUrl: `https://drive.google.com/file/d/${fileId}/view`,
      embedUrl: `https://drive.google.com/file/d/${fileId}/preview`,
      fileId,
      isDirectStream: false,
      badgeText: 'Google Drive preview — restricted controls; manual synchronisation.',
      description:
        'Embedded Google Drive preview cannot expose programmatic time, seek, or play controls across origins.',
      authRequirement: 'Set Google Drive sharing to "Anyone with the link can view" for direct stream sync.',
      restrictions: [
        'Embedded Google Drive preview does not expose play, pause, seek, or timestamps.',
        'Use direct public sharing for proxy playback or coordinate using timeline cues.',
      ],
    };
  }

  // 4. Patreon Post / Creator Link
  if (isPatreonUrl(trimmed)) {
    return {
      provider: 'patreon',
      name: 'Patreon',
      playbackMode: 'external',
      syncCapability: 'manual_sync',
      capabilities: MANUAL_ONLY_CAPABILITIES,
      rawUrl: trimmed,
      normalizedUrl: trimmed,
      externalUrl: trimmed,
      badgeText: 'Patreon — external playback required; manual synchronisation available.',
      description:
        'Patreon content requires creator membership. Open in external window while SyncView provides timeline cues.',
      authRequirement: 'Valid Patreon creator membership and active browser login required.',
      restrictions: [
        'Patreon prohibits third-party embedding behind patron paywalls.',
        'Automatic drift correction is unavailable; use timeline cue markers.',
      ],
    };
  }

  // 5. Direct Media Stream (MP4, WebM, HLS, etc.)
  const isDirectMediaExtension = /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(trimmed);
  return {
    provider: 'native',
    name: 'Direct Media Stream',
    playbackMode: 'native',
    syncCapability: 'full_sync',
    capabilities: NATIVE_CAPABILITIES,
    rawUrl: trimmed,
    normalizedUrl: trimmed,
    badgeText: isDirectMediaExtension
      ? 'Direct stream — automatic synchronisation active.'
      : 'External media stream — verifying compatibility.',
    description: 'HTML5 native player streaming with full drift correction and seeking support.',
  };
}

/**
 * Computes session-wide synchronisation capability based on the least capable active player
 * and surfaces whether any active player is currently in an error state.
 */
export function computeSessionSyncCapability(
  capabilities: SyncCapability[],
  errorPlayerIds: string[] = []
): {
  capability: SyncCapability;
  isAutomaticSyncAvailable: boolean;
  hasErrors: boolean;
  guidanceText: string;
} {
  const hasErrors = errorPlayerIds.length > 0;

  if (capabilities.some((c) => c === 'manual_sync')) {
    return {
      capability: 'manual_sync',
      isAutomaticSyncAvailable: false,
      hasErrors,
      guidanceText: hasErrors
        ? 'Manual synchronisation active and at least one stream reported a playback error.'
        : 'Manual synchronisation mode: At least one player has restricted or external controls. Use timeline cues to align playback.',
    };
  }

  if (capabilities.some((c) => c === 'partial_sync')) {
    return {
      capability: 'partial_sync',
      isAutomaticSyncAvailable: false,
      hasErrors,
      guidanceText: hasErrors
        ? 'Partial synchronisation active and at least one stream reported a playback error.'
        : 'Partial synchronisation mode: Some automatic playback operations are restricted.',
    };
  }

  if (hasErrors) {
    return {
      capability: 'full_sync',
      isAutomaticSyncAvailable: false,
      hasErrors: true,
      guidanceText:
        'A stream reported a playback error. Healthy streams remain controllable, while failed streams are excluded from automatic sync.',
    };
  }

  return {
    capability: 'full_sync',
    isAutomaticSyncAvailable: true,
    hasErrors: false,
    guidanceText: 'Full automatic synchronisation active across all streams.',
  };
}
