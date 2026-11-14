/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MediaProviderType,
  MediaProviderInfo,
  PlaybackMode,
  SyncCapability,
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
  const shortMatch = trimmed.match(/^https?:\/\/(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})(?:[?&/].*)?$/i);
  if (shortMatch && shortMatch[1]) {
    return shortMatch[1];
  }

  // Handle youtube.com (watch, embed, shorts)
  const isYouTubeDomain = /^https?:\/\/(?:[a-zA-Z0-9-]+\.)?youtube(?:-nocookie)?\.com(?:\/|$)/i.test(trimmed);
  if (isYouTubeDomain) {
    // Check /watch?v=
    try {
      const parsed = new URL(trimmed);
      const vParam = parsed.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
        return vParam;
      }
    } catch {}

    // Check /embed/VIDEO_ID or /shorts/VIDEO_ID
    const pathMatch = trimmed.match(/\/(?:embed|shorts|v)\/([a-zA-Z0-9_-]{11})(?:[?&/].*)?$/i);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1];
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Patreon URL Matching
// ---------------------------------------------------------------------------

export function isPatreonUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return /^https?:\/\/(?:www\.)?patreon\.com(?:\/|$)/i.test(url.trim());
}

// ---------------------------------------------------------------------------
// Provider Detection & Factory
// ---------------------------------------------------------------------------

/**
 * Detects the media provider and declares its actual synchronisation capabilities,
 * playback mode, and authentication requirements without pretending unsupported features exist.
 */
export function detectMediaProvider(rawUrl: string, isLocalFile = false): MediaProviderInfo {
  const trimmed = (rawUrl || '').trim();

  // 1. Local Uploaded Video File
  if (isLocalFile || trimmed.startsWith('blob:')) {
    return {
      provider: 'native',
      name: 'Local Video File',
      playbackMode: 'native',
      syncCapability: 'full_sync',
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
      rawUrl: trimmed,
      normalizedUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${youtubeVideoId}?enablejsapi=1&origin=${encodeURIComponent(
        origin
      )}&rel=0&modestbranding=1`,
      videoId: youtubeVideoId,
      badgeText: 'YouTube player — automatic synchronisation available.',
      description: 'Using official YouTube IFrame Player API for synchronized multi-timeline playback.',
      restrictions: [
        'Embedding must be permitted by the video uploader.',
        'Age-restricted or private videos require sign-in on YouTube.',
      ],
    };
  }

  // 3. Google Drive Media Link
  const driveInfo = parseGoogleDriveUrl(trimmed);
  if (driveInfo.isGoogleDrive && driveInfo.fileId) {
    const fileId = driveInfo.fileId;
    return {
      provider: 'google_drive',
      name: 'Google Drive',
      playbackMode: 'embedded',
      syncCapability: 'full_sync',
      rawUrl: trimmed,
      normalizedUrl: `https://drive.google.com/file/d/${fileId}/view`,
      embedUrl: `https://drive.google.com/file/d/${fileId}/preview`,
      fileId,
      badgeText: 'Google Drive — verify sharing permissions.',
      description:
        'Streams through secure proxy if shared publicly, or embedded via Google Drive preview.',
      authRequirement: 'Set Google Drive sharing to "Anyone with the link can view".',
      restrictions: [
        'Private files require Google account authorization.',
        'Preview iframe embeds do not expose JavaScript playback controls.',
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
    rawUrl: trimmed,
    normalizedUrl: trimmed,
    badgeText: isDirectMediaExtension
      ? 'Direct stream — automatic synchronisation active.'
      : 'External media stream — verifying compatibility.',
    description: 'HTML5 native player streaming with full drift correction and seeking support.',
  };
}

/**
 * Computes session-wide synchronisation capability based on the least capable player in the session.
 */
export function computeSessionSyncCapability(
  capabilities: SyncCapability[]
): {
  capability: SyncCapability;
  isAutomaticSyncAvailable: boolean;
  guidanceText: string;
} {
  if (capabilities.length === 0 || capabilities.every((c) => c === 'full_sync')) {
    return {
      capability: 'full_sync',
      isAutomaticSyncAvailable: true,
      guidanceText: 'Full automatic synchronisation active across all streams.',
    };
  }

  if (capabilities.some((c) => c === 'manual_sync')) {
    return {
      capability: 'manual_sync',
      isAutomaticSyncAvailable: false,
      guidanceText:
        'Manual synchronisation mode: An external player (e.g. Patreon) is active. Use timeline cues to align playback.',
    };
  }

  return {
    capability: 'partial_sync',
    isAutomaticSyncAvailable: false,
    guidanceText: 'Partial synchronisation mode: Some automatic playback operations are restricted.',
  };
}
