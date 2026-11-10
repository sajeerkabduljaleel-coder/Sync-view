/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GoogleDriveUrlInfo {
  isGoogleDrive: boolean;
  fileId: string | null;
  directDownloadUrl: string | null;
  proxyStreamUrl: string | null;
  error?: string;
}

export interface UrlValidationResult {
  isValid: boolean;
  isGoogleDrive: boolean;
  fileId?: string;
  warning?: string;
  error?: string;
}

export interface ClassifiedMediaError {
  code: number;
  codeName: string;
  title: string;
  summary: string;
  detail: string;
  isGoogleDrive: boolean;
  actionableSteps: string[];
}

/**
 * Validates whether a given string is a Google Drive media link and extracts the file ID.
 * Supports:
 * - https://drive.google.com/file/d/FILE_ID/view (with or without query parameters like ?usp=sharing)
 * - https://drive.google.com/open?id=FILE_ID
 * - https://drive.google.com/uc?id=FILE_ID&export=download
 * - https://drive.google.com/uc?export=download&id=FILE_ID
 * - https://docs.google.com/file/d/FILE_ID/...
 *
 * Strict validation: Does NOT match arbitrary Google URLs (e.g. google.com/search, youtube.com, maps.google.com).
 */
export function parseGoogleDriveUrl(rawUrl: string): GoogleDriveUrlInfo {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return {
      isGoogleDrive: false,
      fileId: null,
      directDownloadUrl: null,
      proxyStreamUrl: null,
    };
  }

  const trimmed = rawUrl.trim();

  // Quick check for domain
  const isDriveDomain =
    /^https?:\/\/(drive\.google\.com|docs\.google\.com)(\/|$)/i.test(trimmed);

  if (!isDriveDomain) {
    return {
      isGoogleDrive: false,
      fileId: null,
      directDownloadUrl: null,
      proxyStreamUrl: null,
    };
  }

  // Pattern 1: /file/d/<fileId>
  const fileDMatch = trimmed.match(
    /\/(?:file\/d|document\/d|presentation\/d|spreadsheets\/d)\/([a-zA-Z0-9_-]{15,})/i
  );
  if (fileDMatch && fileDMatch[1]) {
    const fileId = fileDMatch[1];
    return {
      isGoogleDrive: true,
      fileId,
      directDownloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
      proxyStreamUrl: `/api/media/stream?driveId=${fileId}`,
    };
  }

  // Pattern 2: open?id=<fileId> or uc?id=<fileId> or uc?export=download&id=<fileId>
  try {
    const parsed = new URL(trimmed);
    const idParam = parsed.searchParams.get('id');
    if (idParam && /^[a-zA-Z0-9_-]{15,}$/.test(idParam)) {
      return {
        isGoogleDrive: true,
        fileId: idParam,
        directDownloadUrl: `https://drive.google.com/uc?export=download&id=${idParam}`,
        proxyStreamUrl: `/api/media/stream?driveId=${idParam}`,
      };
    }
  } catch {
    // URL constructor failed
  }

  return {
    isGoogleDrive: true,
    fileId: null,
    directDownloadUrl: null,
    proxyStreamUrl: null,
    error: 'Google Drive URL detected, but could not extract a valid 15+ character file ID.',
  };
}

export function isGoogleDriveUrl(url: string): boolean {
  return parseGoogleDriveUrl(url).isGoogleDrive;
}

/**
 * Transforms user-provided media URLs into playable stream endpoints.
 * Direct media files (MP4, WebM, blob:, etc.) are returned unchanged.
 * Google Drive share URLs are converted to our backend media stream proxy
 * (/api/media/stream?driveId=...) which handles range requests (seeking),
 * redirection, and headers.
 */
export function resolvePlayableMediaUrl(rawUrl: string, useProxy = true): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();

  // Blob URLs from local file uploads or browser canvas streams
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  // Check if it's a Google Drive link
  const driveInfo = parseGoogleDriveUrl(trimmed);
  if (driveInfo.isGoogleDrive && driveInfo.fileId) {
    if (useProxy && driveInfo.proxyStreamUrl) {
      return driveInfo.proxyStreamUrl;
    }
    if (driveInfo.directDownloadUrl) {
      return driveInfo.directDownloadUrl;
    }
  }

  return trimmed;
}

/**
 * Validates a video URL before launching the Theatre or creating a reaction.
 */
export function validateUrlInput(rawUrl: string): UrlValidationResult {
  if (!rawUrl || !rawUrl.trim()) {
    return {
      isValid: false,
      isGoogleDrive: false,
      error: 'Please enter a video URL.',
    };
  }

  const trimmed = rawUrl.trim();

  // Allow blob: URLs for local file selection
  if (trimmed.startsWith('blob:')) {
    return {
      isValid: true,
      isGoogleDrive: false,
    };
  }

  // Validate protocol
  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      isValid: false,
      isGoogleDrive: false,
      error: 'URL must begin with http:// or https://',
    };
  }

  try {
    const parsed = new URL(trimmed);

    // Reject non-media platforms that cannot be played in HTML5 <video>
    if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) {
      return {
        isValid: false,
        isGoogleDrive: false,
        error:
          'YouTube links are web player pages, not direct video streams. Please provide a direct MP4/WebM URL or upload a local file.',
      };
    }

    if (parsed.hostname.includes('vimeo.com') && !parsed.pathname.includes('external')) {
      return {
        isValid: false,
        isGoogleDrive: false,
        error:
          'Vimeo webpage URLs are not direct video streams. Please provide a direct MP4 URL or local video file.',
      };
    }

    // Google Drive check
    const driveInfo = parseGoogleDriveUrl(trimmed);
    if (driveInfo.isGoogleDrive) {
      if (!driveInfo.fileId) {
        return {
          isValid: false,
          isGoogleDrive: true,
          error:
            'Malformed Google Drive URL. Use a link like https://drive.google.com/file/d/FILE_ID/view with a valid file ID.',
        };
      }

      return {
        isValid: true,
        isGoogleDrive: true,
        fileId: driveInfo.fileId,
        warning:
          'Google Drive file detected. Note: The file must be shared as "Anyone with the link can view" to allow playback.',
      };
    }

    return {
      isValid: true,
      isGoogleDrive: false,
    };
  } catch {
    return {
      isValid: false,
      isGoogleDrive: false,
      error: 'Invalid URL format.',
    };
  }
}

/**
 * Classifies an HTMLMediaElement error and maps it to user-friendly diagnostics
 * and actionable recovery steps.
 */
export function classifyMediaError(
  error: MediaError | null,
  srcUrl?: string,
  readyState?: number,
  networkState?: number
): ClassifiedMediaError {
  const isDrive = srcUrl ? isGoogleDriveUrl(srcUrl) : false;
  const code = error?.code || 4; // Default to MEDIA_ERR_SRC_NOT_SUPPORTED if null

  let codeName = 'MEDIA_ERR_SRC_NOT_SUPPORTED';
  let title = 'Video Stream Could Not Be Played';
  let summary = 'The media stream failed to load or the format is not supported.';
  let detail = error?.message || 'The browser encountered an error fetching or decoding the video.';
  const actionableSteps: string[] = [];

  switch (code) {
    case 1: // MEDIA_ERR_ABORTED
      codeName = 'MEDIA_ERR_ABORTED';
      title = 'Playback Aborted';
      summary = 'Video fetching was interrupted before completion.';
      detail = 'The request was aborted by the client or browser network manager.';
      actionableSteps.push('Click "Retry Video" to re-initialize playback.');
      break;

    case 2: // MEDIA_ERR_NETWORK
      codeName = 'MEDIA_ERR_NETWORK';
      title = 'Network Connection Error';
      summary = 'A network error occurred while downloading the video stream.';
      detail =
        'The connection was dropped or timed out. Network state: ' +
        (networkState === 3 ? 'NO_SOURCE' : 'NETWORK_LOADING');
      actionableSteps.push('Check your internet connection.');
      actionableSteps.push('Verify the hosting server is online and accepting connections.');
      actionableSteps.push('Click "Retry Video" to attempt reconnecting.');
      break;

    case 3: // MEDIA_ERR_DECODE
      codeName = 'MEDIA_ERR_DECODE';
      title = 'Video Decoding Error';
      summary = 'The video stream is corrupted or uses an unsupported codec.';
      detail = 'The browser video decoder encountered an unrecoverable decoding error.';
      actionableSteps.push('Ensure the video is encoded in standard H.264 (AVC) or VP8/VP9.');
      actionableSteps.push('Re-encode the file or try another media source.');
      break;

    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
    default:
      codeName = 'MEDIA_ERR_SRC_NOT_SUPPORTED';
      if (isDrive) {
        title = 'Google Drive Stream Inaccessible';
        summary =
          'Google Drive returned a non-media response (such as an HTML sign-in page or confirmation prompt).';
        detail =
          'The URL points to a Google Drive link that is either private, requires a Google account login, or returned an HTML virus scan confirmation page.';
        actionableSteps.push(
          'Open Google Drive > Share > Set General Access to "Anyone with the link can view".'
        );
        actionableSteps.push(
          'Ensure the file is not restricted to your organization workspace domain only.'
        );
        actionableSteps.push(
          'For files over 100MB, Google Drive requires virus scan confirmation; consider hosting on dedicated media storage or selecting the file locally.'
        );
        actionableSteps.push(
          'Alternatively, select the video directly as a "Local File" for instantaneous zero-latency playback.'
        );
      } else {
        title = 'Unsupported Stream Format or Invalid URL';
        summary = 'The server did not return a valid playable video stream.';
        detail =
          'The target URL may return an HTML web page rather than direct video bytes, or CORS headers blocked the browser from streaming.';
        actionableSteps.push(
          'Verify the URL points directly to an .mp4, .webm, or .m4v media file.'
        );
        actionableSteps.push(
          'Make sure the server supports HTTP Range requests (206 Partial Content) and CORS.'
        );
        actionableSteps.push('Use the "Local Video File" option to play the video directly from your device.');
      }
      break;
  }

  return {
    code,
    codeName,
    title,
    summary,
    detail,
    isGoogleDrive: isDrive,
    actionableSteps,
  };
}

/**
 * Lightweight preflight inspection for a media URL.
 * Calls backend /api/media/inspect to inspect headers, status, and content-type.
 */
export async function inspectMediaUrl(url: string): Promise<{
  ok: boolean;
  status: number;
  contentType?: string;
  isHtml?: boolean;
  isMedia?: boolean;
  isGoogleDrive?: boolean;
  driveFileId?: string;
  errorReason?: string;
  humanMessage: string;
}> {
  if (!url) {
    return {
      ok: false,
      status: 400,
      humanMessage: 'No URL provided.',
    };
  }

  if (url.startsWith('blob:')) {
    return {
      ok: true,
      status: 200,
      isMedia: true,
      humanMessage: 'Local file blob URL ready for playback.',
    };
  }

  try {
    const res = await fetch(`/api/media/inspect?url=${encodeURIComponent(url)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        ok: false,
        status: res.status,
        humanMessage: data.error || `Server returned HTTP ${res.status}`,
      };
    }
    return await res.json();
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      humanMessage: err?.message || 'Could not reach server inspection endpoint.',
    };
  }
}
