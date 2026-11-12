/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from 'express';
import { parseGoogleDriveUrl } from '../services/mediaResolver';
import {
  safeFetch,
  validateDestinationUrl,
  mediaProxyRateLimiter,
} from './ssrfValidator';

/**
 * Valid media content-type prefixes and mime types accepted by HTML5 video.
 */
const VALID_MEDIA_PREFIXES = ['video/', 'audio/'];
const VALID_MEDIA_MIMES = new Set([
  'application/octet-stream',
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
  'application/dash+xml',
]);

export function isPlayableMediaContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const clean = contentType.toLowerCase().split(';')[0].trim();
  if (VALID_MEDIA_PREFIXES.some((prefix) => clean.startsWith(prefix))) {
    return true;
  }
  return VALID_MEDIA_MIMES.has(clean);
}

/**
 * Reads up to maxBytes from a response body stream as text,
 * preventing unbounded buffering of huge payloads.
 */
async function readBoundedText(res: Response | any, maxBytes = 65536): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalBytes += value.length;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    const toCopy = Math.min(chunk.length, totalBytes - offset);
    combined.set(chunk.subarray(0, toCopy), offset);
    offset += toCopy;
    if (offset >= totalBytes) break;
  }

  return new TextDecoder('utf-8').decode(combined);
}

/**
 * Resolves a Google Drive file ID to its direct download URL,
 * following redirects and handling confirmation tokens for large files (>100MB),
 * while strictly validating all redirect hops against SSRF.
 */
async function resolveGoogleDriveStreamUrl(
  fileId: string,
  clientSignal?: AbortSignal
): Promise<{
  playableUrl?: string;
  isPrivate?: boolean;
  isHtml?: boolean;
  isNotFound?: boolean;
  isQuotaExceeded?: boolean;
  error?: string;
}> {
  const initialUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  try {
    const { response: res, finalUrl } = await safeFetch(initialUrl, {
      method: 'GET',
      maxRedirects: 5,
      timeoutMs: 8000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: clientSignal,
    });

    const status = res.status;
    const location = res.headers.get('location');

    // 1. Check for private file login redirects
    if (
      (location && location.includes('accounts.google.com')) ||
      finalUrl.includes('accounts.google.com')
    ) {
      return {
        isPrivate: true,
        error:
          'This Google Drive file is private. Set link sharing to "Anyone with the link can view".',
      };
    }

    if (status === 404) {
      return {
        isNotFound: true,
        error: 'Google Drive file was not found (HTTP 404). Check the file ID.',
      };
    }

    if (status === 403 || status === 429) {
      return {
        isQuotaExceeded: true,
        error: 'Google Drive download quota exceeded or access forbidden.',
      };
    }

    // 2. Direct redirect to CDN (googleusercontent.com)
    if (status >= 300 && status < 400 && location) {
      return { playableUrl: location };
    }

    const contentType = res.headers.get('content-type') || '';

    // 3. Handle HTML response (could be virus scan warning or private error)
    if (contentType.includes('text/html')) {
      const htmlText = await readBoundedText(res, 65536);

      // Check if it's the virus scan confirmation page for files >100MB
      const confirmMatch = htmlText.match(/href="(\/uc\?export=download[^"]+confirm=([^"&]+)[^"]*)"/i);
      const confirmTokenMatch =
        confirmMatch?.[2] ||
        htmlText.match(/confirm=([a-zA-Z0-9_-]+)/i)?.[1] ||
        htmlText.match(/name="confirm"\s+value="([^"]+)"/i)?.[1];

      if (confirmTokenMatch) {
        const setCookie = res.headers.get('set-cookie') || '';
        const secondUrl = `https://drive.google.com/uc?export=download&confirm=${confirmTokenMatch}&id=${fileId}`;

        const { response: secondRes, finalUrl: secondFinalUrl } = await safeFetch(secondUrl, {
          method: 'GET',
          maxRedirects: 5,
          timeoutMs: 8000,
          headers: {
            Cookie: setCookie,
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          signal: clientSignal,
        });

        const secondLocation = secondRes.headers.get('location');
        if (
          (secondLocation && secondLocation.includes('accounts.google.com')) ||
          secondFinalUrl.includes('accounts.google.com')
        ) {
          return {
            isPrivate: true,
            error: 'File requires Google login. Set sharing to "Anyone with the link can view".',
          };
        }

        if (secondLocation) {
          return { playableUrl: secondLocation };
        }
        return { playableUrl: secondFinalUrl };
      }

      // Check for access denied or sign-in in HTML body
      if (
        htmlText.includes('You need access') ||
        htmlText.includes('Sign in') ||
        htmlText.includes('ServiceLogin') ||
        htmlText.includes('accounts.google.com')
      ) {
        return {
          isPrivate: true,
          error: 'This Google Drive file is private. Set link sharing to "Anyone with the link can view".',
        };
      }

      return {
        isHtml: true,
        error: 'Google Drive returned an HTML page instead of video media.',
      };
    }

    // 4. Direct media stream
    if (isPlayableMediaContentType(contentType)) {
      return { playableUrl: finalUrl };
    }

    return { playableUrl: finalUrl };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    return {
      error: 'Failed to resolve Google Drive link: ' + (err?.message || 'Network error'),
    };
  }
}

/**
 * GET /api/media/stream
 * Streaming proxy that supports HTTP 206 Partial Content (Range requests)
 * for seeking and playback in HTML5 video elements.
 * Strictly enforces SSRF prevention, response lifecycle aborts, and accurate content-types.
 */
export async function handleMediaStream(req: Request, res: Response) {
  // Rate limiting check
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (!mediaProxyRateLimiter.isAllowed(clientIp)) {
    return res.status(429).json({
      error: 'Rate limit exceeded. Too many media requests.',
      code: 'RATE_LIMIT_EXCEEDED',
    });
  }

  let targetUrl = '';
  const driveIdParam = req.query.driveId as string;
  const rawUrlParam = req.query.url as string;

  // Dedicated abort controller for upstream fetching
  const abortController = new AbortController();

  // FIX: Monitor response lifecycle, NOT incoming request's close event
  // Abort upstream ONLY when outgoing response closes prematurely (client disconnects)
  const onResponseClose = () => {
    if (!res.writableEnded) {
      abortController.abort(new Error('Client disconnected prematurely'));
    }
  };
  res.once('close', onResponseClose);

  try {
    if (driveIdParam && /^[a-zA-Z0-9_-]{15,}$/.test(driveIdParam.trim())) {
      const resolved = await resolveGoogleDriveStreamUrl(
        driveIdParam.trim(),
        abortController.signal
      );
      if (resolved.isPrivate) {
        res.removeListener('close', onResponseClose);
        return res.status(403).json({
          error: resolved.error,
          code: 'GOOGLE_DRIVE_PRIVATE',
          humanMessage:
            'This Google Drive video is private. Open Google Drive, click Share, and select "Anyone with the link can view".',
        });
      }
      if (resolved.isNotFound) {
        res.removeListener('close', onResponseClose);
        return res.status(404).json({
          error: resolved.error,
          code: 'GOOGLE_DRIVE_NOT_FOUND',
        });
      }
      if (!resolved.playableUrl) {
        res.removeListener('close', onResponseClose);
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
        const resolved = await resolveGoogleDriveStreamUrl(
          driveInfo.fileId,
          abortController.signal
        );
        if (resolved.isPrivate) {
          res.removeListener('close', onResponseClose);
          return res.status(403).json({
            error: resolved.error,
            code: 'GOOGLE_DRIVE_PRIVATE',
          });
        }
        if (!resolved.playableUrl) {
          res.removeListener('close', onResponseClose);
          return res.status(400).json({
            error: resolved.error || 'Could not resolve Google Drive media stream',
          });
        }
        targetUrl = resolved.playableUrl;
      } else {
        // SSRF Check on raw external URL
        const validation = await validateDestinationUrl(rawUrlParam.trim());
        if (!validation.valid) {
          res.removeListener('close', onResponseClose);
          return res.status(403).json({
            error: 'Access denied: ' + validation.error,
            code: 'SSRF_BLOCKED',
          });
        }
        targetUrl = rawUrlParam.trim();
      }
    } else {
      res.removeListener('close', onResponseClose);
      return res.status(400).json({ error: 'Missing driveId or url parameter.' });
    }

    // Prepare upstream headers
    const requestHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    // Forward Range header if present (validate RFC 7233 format strictly: bytes=0-1024, bytes=1024-, bytes=-500)
    if (req.headers.range && typeof req.headers.range === 'string') {
      const rangeVal = req.headers.range.trim();
      if (/^bytes=(\d+-\d*|\d*-\d+)$/.test(rangeVal)) {
        requestHeaders['Range'] = rangeVal;
      }
    }

    // Safe fetch with SSRF verification on every redirect hop
    const { response: upstreamRes } = await safeFetch(targetUrl, {
      method: 'GET',
      headers: requestHeaders,
      maxRedirects: 5,
      timeoutMs: 10000,
      signal: abortController.signal,
    });

    const status = upstreamRes.status;
    const rawContentType = upstreamRes.headers.get('content-type') || '';
    const cleanContentType = rawContentType.split(';')[0].trim().toLowerCase();

    // Preserve upstream error status codes (403, 404, 416)
    if (status === 404) {
      res.removeListener('close', onResponseClose);
      return res.status(404).json({ error: 'Media stream not found (HTTP 404).' });
    }
    if (status === 403 || status === 401) {
      res.removeListener('close', onResponseClose);
      return res.status(403).json({ error: 'Access denied by remote media host.' });
    }
    if (status === 416) {
      res.removeListener('close', onResponseClose);
      const contentRange = upstreamRes.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);
      return res.status(416).json({ error: 'Requested range not satisfiable.' });
    }

    // Validate that upstream content is actually media
    // CRITICAL: Do NOT default unknown content types to video/mp4 and do NOT relabel HTML as video!
    if (cleanContentType.includes('text/html')) {
      res.removeListener('close', onResponseClose);
      return res.status(415).json({
        error: 'Upstream returned an HTML webpage instead of a playable video stream.',
        code: 'NOT_A_MEDIA_STREAM',
      });
    }

    if (!isPlayableMediaContentType(cleanContentType) && status !== 206) {
      res.removeListener('close', onResponseClose);
      return res.status(415).json({
        error: `Unsupported media content-type "${cleanContentType}". Direct video streams required.`,
        code: 'UNSUPPORTED_MEDIA_TYPE',
      });
    }

    // Set streaming headers accurately from upstream
    res.status(status);
    res.setHeader('Content-Type', cleanContentType || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const etag = upstreamRes.headers.get('etag');
    if (etag) res.setHeader('ETag', etag);

    const lastModified = upstreamRes.headers.get('last-modified');
    if (lastModified) res.setHeader('Last-Modified', lastModified);

    if (!upstreamRes.body) {
      res.removeListener('close', onResponseClose);
      return res.end();
    }

    // Stream response chunks with proper backpressure and lifecycle teardown
    const reader = upstreamRes.body.getReader();
    let isStreamDone = false;

    const cleanup = () => {
      isStreamDone = true;
      res.removeListener('close', onResponseClose);
      reader.cancel().catch(() => {});
    };

    try {
      while (!isStreamDone) {
        if (res.writableEnded || res.destroyed || abortController.signal.aborted) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          isStreamDone = true;
          if (!res.writableEnded && !res.destroyed) {
            res.end();
          }
          break;
        }

        if (res.writableEnded || res.destroyed) {
          break;
        }

        // Apply backpressure
        const canWriteMore = res.write(value);
        if (!canWriteMore && !res.writableEnded && !res.destroyed) {
          await new Promise<void>((resolve) => {
            const onDrain = () => {
              res.removeListener('close', onDrainClose);
              resolve();
            };
            const onDrainClose = () => {
              res.removeListener('drain', onDrain);
              resolve();
            };
            res.once('drain', onDrain);
            res.once('close', onDrainClose);
          });
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError' && !res.writableEnded && !res.destroyed) {
        res.end();
      }
    } finally {
      cleanup();
    }
  } catch (err: any) {
    res.removeListener('close', onResponseClose);
    if (err?.name === 'AbortError') return;

    if (!res.headersSent) {
      const isSsrf = err?.message?.includes('SSRF Blocked');
      res.status(isSsrf ? 403 : 502).json({
        error: isSsrf
          ? 'Destination address or provider is restricted.'
          : 'Failed to stream media from remote host.',
        code: isSsrf ? 'SSRF_BLOCKED' : 'UPSTREAM_FETCH_FAILED',
      });
    }
  }
}

/**
 * GET /api/media/inspect
 * Lightweight endpoint that tests a URL without downloading the whole media.
 * Uses identical SSRF, provider, and destination security rules as handleMediaStream.
 */
export async function handleMediaInspect(req: Request, res: Response) {
  // Rate limiting check
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (!mediaProxyRateLimiter.isAllowed(clientIp)) {
    return res.status(429).json({
      ok: false,
      status: 429,
      errorReason: 'RATE_LIMIT_EXCEEDED',
      humanMessage: 'Rate limit exceeded. Too many media inspections.',
    });
  }

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

  // 1. Google Drive Inspection
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
    if (resolved.isNotFound) {
      return res.json({
        ok: false,
        status: 404,
        isGoogleDrive: true,
        driveFileId: fileId,
        errorReason: 'NOT_FOUND',
        humanMessage: 'Google Drive file was not found (HTTP 404).',
      });
    }
    if (resolved.isQuotaExceeded) {
      return res.json({
        ok: false,
        status: 429,
        isGoogleDrive: true,
        driveFileId: fileId,
        errorReason: 'QUOTA_EXCEEDED',
        humanMessage: 'Google Drive download quota exceeded for this file.',
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

  // 2. Generic URL Inspection with strict SSRF validation
  const targetUrl = urlParam || '';

  // SSRF Destination Check
  const validation = await validateDestinationUrl(targetUrl);
  if (!validation.valid) {
    return res.status(403).json({
      ok: false,
      status: 403,
      errorReason: 'UNSUPPORTED_PROVIDER',
      humanMessage: 'Destination address or provider is restricted: ' + validation.error,
    });
  }

  try {
    // Lightweight range request to inspect headers without downloading full payload
    const { response: upstream } = await safeFetch(targetUrl, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-1024',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      maxRedirects: 5,
      timeoutMs: 6000,
    });

    const status = upstream.status;
    const rawContentType = upstream.headers.get('content-type') || '';
    const cleanContentType = rawContentType.split(';')[0].trim().toLowerCase();
    const contentLength = upstream.headers.get('content-length')
      ? parseInt(upstream.headers.get('content-length')!, 10)
      : undefined;

    const isMedia = isPlayableMediaContentType(cleanContentType);
    const isHtml = cleanContentType.includes('text/html');

    if (isHtml) {
      return res.json({
        ok: false,
        status,
        contentType: cleanContentType,
        isMedia: false,
        isHtml: true,
        errorReason: 'HTML_NOT_MEDIA',
        humanMessage: 'Target URL returned an HTML web page instead of a direct video stream.',
      });
    }

    if (status === 401 || status === 403) {
      return res.json({
        ok: false,
        status,
        contentType: cleanContentType,
        isMedia: false,
        errorReason: 'ACCESS_DENIED',
        humanMessage: 'Access denied: Authentication or permissions required by remote host.',
      });
    }

    if (status === 404) {
      return res.json({
        ok: false,
        status,
        contentType: cleanContentType,
        isMedia: false,
        errorReason: 'NOT_FOUND',
        humanMessage: 'Remote media file was not found (HTTP 404).',
      });
    }

    if (!isMedia && status !== 206) {
      return res.json({
        ok: false,
        status,
        contentType: cleanContentType,
        isMedia: false,
        errorReason: 'UNSUPPORTED_MEDIA_FORMAT',
        humanMessage: `Unsupported content-type "${cleanContentType}". Stream must be a direct video/audio file.`,
      });
    }

    return res.json({
      ok: true,
      status,
      contentType: cleanContentType,
      contentLength,
      isMedia: true,
      isHtml: false,
      humanMessage: 'Direct playable media stream verified.',
    });
  } catch (err: any) {
    const isTimeout =
      err?.name === 'AbortError' ||
      err?.message?.includes('timed out') ||
      err?.message?.includes('timeout');

    return res.json({
      ok: false,
      status: isTimeout ? 504 : 0,
      errorReason: isTimeout ? 'NETWORK_TIMEOUT' : 'NETWORK_ERROR',
      humanMessage: isTimeout
        ? 'Connection to remote media host timed out.'
        : 'Could not connect to media server: ' + (err?.message || 'Network error'),
    });
  }
}
