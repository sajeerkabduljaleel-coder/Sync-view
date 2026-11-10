/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from 'express';
import { parseGoogleDriveUrl } from '../services/mediaResolver';

/**
 * Resolves a Google Drive file ID to its direct download URL,
 * following redirects and handling confirmation tokens for large files (>100MB).
 */
async function resolveGoogleDriveStreamUrl(fileId: string): Promise<{
  playableUrl?: string;
  isPrivate?: boolean;
  isHtml?: boolean;
  headers?: Record<string, string>;
  error?: string;
}> {
  const initialUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  try {
    // 1. Initial request with manual redirect handling to capture cookies and headers
    const res = await fetch(initialUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const status = res.status;
    const location = res.headers.get('location');

    // If redirected to Google Accounts login, the file is private
    if (location && location.includes('accounts.google.com')) {
      return {
        isPrivate: true,
        error:
          'The Google Drive file is private or requires login. Link sharing must be set to "Anyone with the link can view".',
      };
    }

    // Direct redirect to CDN (googleusercontent.com)
    if (status >= 300 && status < 400 && location) {
      return { playableUrl: location };
    }

    // If HTTP 200, check content type
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const htmlText = await res.text();

      // Check if it's the virus scan confirmation page for files >100MB
      const confirmMatch = htmlText.match(/href="(\/uc\?export=download[^"]+confirm=([^"&]+)[^"]*)"/i);
      const confirmTokenMatch =
        confirmMatch?.[2] ||
        htmlText.match(/confirm=([a-zA-Z0-9_-]+)/i)?.[1] ||
        htmlText.match(/name="confirm"\s+value="([^"]+)"/i)?.[1];

      if (confirmTokenMatch) {
        // Collect cookies
        const setCookie = res.headers.get('set-cookie') || '';
        const secondUrl = `https://drive.google.com/uc?export=download&confirm=${confirmTokenMatch}&id=${fileId}`;
        const secondRes = await fetch(secondUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            Cookie: setCookie,
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });

        const secondLocation = secondRes.headers.get('location');
        if (secondLocation) {
          if (secondLocation.includes('accounts.google.com')) {
            return {
              isPrivate: true,
              error: 'File requires Google login. Set sharing to "Anyone with the link can view".',
            };
          }
          return { playableUrl: secondLocation };
        }
      }

      // Check for private error page
      if (htmlText.includes('You need access') || htmlText.includes('Sign in') || htmlText.includes('accounts.google.com')) {
        return {
          isPrivate: true,
          error: 'The Google Drive file is private. Set link sharing to "Anyone with the link can view".',
        };
      }

      return {
        isHtml: true,
        error: 'Google Drive returned an HTML page instead of video media.',
      };
    }

    // Direct content
    if (contentType.startsWith('video/') || contentType.startsWith('audio/') || contentType.includes('octet-stream')) {
      return { playableUrl: initialUrl };
    }

    return { playableUrl: initialUrl };
  } catch (err: any) {
    return {
      error: err?.message || 'Failed to resolve Google Drive link',
    };
  }
}

/**
 * GET /api/media/stream
 * Streaming proxy that supports HTTP 206 Partial Content (Range requests)
 * for seeking and playback in HTML5 video elements.
 */
export async function handleMediaStream(req: Request, res: Response) {
  let targetUrl = '';
  const driveIdParam = req.query.driveId as string;
  const rawUrlParam = req.query.url as string;

  if (driveIdParam && /^[a-zA-Z0-9_-]{15,}$/.test(driveIdParam.trim())) {
    const resolved = await resolveGoogleDriveStreamUrl(driveIdParam.trim());
    if (resolved.isPrivate) {
      return res.status(403).json({
        error: resolved.error,
        code: 'GOOGLE_DRIVE_PRIVATE',
        humanMessage:
          'This Google Drive video is private. Open Google Drive, click Share, and select "Anyone with the link can view".',
      });
    }
    if (!resolved.playableUrl) {
      return res.status(400).json({
        error: resolved.error || 'Could not resolve Google Drive media stream',
        code: 'GOOGLE_DRIVE_UNRESOLVED',
        humanMessage:
          'Google Drive did not provide a streamable video response. Ensure the file is shared publicly as "Anyone with the link can view".',
      });
    }
    targetUrl = resolved.playableUrl;
  } else if (rawUrlParam) {
    const driveInfo = parseGoogleDriveUrl(rawUrlParam);
    if (driveInfo.isGoogleDrive && driveInfo.fileId) {
      const resolved = await resolveGoogleDriveStreamUrl(driveInfo.fileId);
      if (resolved.isPrivate) {
        return res.status(403).json({
          error: resolved.error,
          code: 'GOOGLE_DRIVE_PRIVATE',
        });
      }
      if (!resolved.playableUrl) {
        return res.status(400).json({
          error: resolved.error || 'Could not resolve Google Drive media stream',
        });
      }
      targetUrl = resolved.playableUrl;
    } else {
      if (!/^https?:\/\//i.test(rawUrlParam.trim())) {
        return res.status(400).json({ error: 'Invalid URL. Must begin with http:// or https://' });
      }
      targetUrl = rawUrlParam.trim();
    }
  } else {
    return res.status(400).json({ error: 'Missing driveId or url parameter.' });
  }

  // Forward range header if present for standard seeking
  const requestHeaders: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  if (req.headers.range) {
    requestHeaders['Range'] = req.headers.range as string;
  }

  const abortController = new AbortController();
  req.on('close', () => {
    abortController.abort();
  });

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: 'GET',
      headers: requestHeaders,
      signal: abortController.signal,
    });

    const status = upstreamRes.status;
    const contentType = upstreamRes.headers.get('content-type') || 'video/mp4';

    // If upstream returns HTML instead of media, don't pipe corrupt bytes to <video>
    if (contentType.includes('text/html') && status !== 206) {
      return res.status(415).json({
        error: 'Upstream returned an HTML webpage instead of a playable video stream.',
        code: 'NOT_A_MEDIA_STREAM',
      });
    }

    // Set streaming headers
    res.status(status);
    res.setHeader('Content-Type', contentType.includes('text/') ? 'video/mp4' : contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    if (!upstreamRes.body) {
      return res.end();
    }

    // Stream response chunks using ReadableStream reader
    const reader = upstreamRes.body.getReader();
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            break;
          }
          if (!res.write(value)) {
            await new Promise<void>((resolve) => res.once('drain', resolve));
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          res.end();
        }
      }
    };

    pump();
  } catch (err: any) {
    if (err?.name === 'AbortError') return;
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to stream media from remote host: ' + err.message });
    }
  }
}

/**
 * GET /api/media/inspect
 * Lightweight endpoint that tests a URL without downloading the whole media.
 */
export async function handleMediaInspect(req: Request, res: Response) {
  const urlParam = req.query.url as string;
  const driveIdParam = req.query.driveId as string;

  if (!urlParam && !driveIdParam) {
    return res.status(400).json({ ok: false, error: 'url or driveId query parameter is required.' });
  }

  let fileId: string | undefined = driveIdParam || undefined;
  let isGoogleDrive = Boolean(fileId);

  if (urlParam) {
    const driveInfo = parseGoogleDriveUrl(urlParam);
    if (driveInfo.isGoogleDrive) {
      isGoogleDrive = true;
      fileId = driveInfo.fileId || undefined;
    }
  }

  if (isGoogleDrive && fileId) {
    const resolved = await resolveGoogleDriveStreamUrl(fileId);
    if (resolved.isPrivate) {
      return res.json({
        ok: false,
        status: 403,
        isGoogleDrive: true,
        driveFileId: fileId,
        errorReason: 'GOOGLE_DRIVE_PRIVATE',
        humanMessage:
          'Google Drive file is private or requires authorization. Set General Access to "Anyone with the link can view".',
      });
    }
    if (resolved.isHtml) {
      return res.json({
        ok: false,
        status: 415,
        isGoogleDrive: true,
        driveFileId: fileId,
        errorReason: 'HTML_NOT_MEDIA',
        humanMessage:
          'Google Drive returned an HTML page. Ensure the file is shared publicly as "Anyone with the link can view".',
      });
    }
    return res.json({
      ok: true,
      status: 200,
      isGoogleDrive: true,
      driveFileId: fileId,
      isMedia: true,
      humanMessage: 'Google Drive file is public and streamable.',
    });
  }

  // Generic URL inspection
  const targetUrl = urlParam || '';
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ ok: false, error: 'URL must begin with http:// or https://' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-1024',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const status = upstream.status;
    const contentType = upstream.headers.get('content-type') || '';
    const contentLength = upstream.headers.get('content-length')
      ? parseInt(upstream.headers.get('content-length')!, 10)
      : undefined;

    const isMedia =
      contentType.startsWith('video/') ||
      contentType.startsWith('audio/') ||
      contentType.includes('octet-stream');
    const isHtml = contentType.includes('text/html');

    if (isHtml) {
      return res.json({
        ok: false,
        status,
        contentType,
        isMedia: false,
        isHtml: true,
        errorReason: 'HTML_NOT_MEDIA',
        humanMessage: 'Target URL returned an HTML web page instead of a direct video stream.',
      });
    }

    if (status >= 400) {
      return res.json({
        ok: false,
        status,
        contentType,
        isMedia,
        errorReason: status === 403 || status === 401 ? 'ACCESS_DENIED' : 'HTTP_ERROR',
        humanMessage: `Remote server returned HTTP ${status}.`,
      });
    }

    return res.json({
      ok: true,
      status,
      contentType,
      contentLength,
      isMedia,
      isHtml: false,
      humanMessage: 'Direct playable media stream verified.',
    });
  } catch (err: any) {
    return res.json({
      ok: false,
      status: 0,
      errorReason: 'NETWORK_TIMEOUT',
      humanMessage: 'Could not connect to media server: ' + (err?.message || 'Request timed out'),
    });
  }
}
