/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import net from 'net';
import dns from 'dns';

export interface DestinationValidationResult {
  valid: boolean;
  error?: string;
  url?: URL;
  resolvedIps?: string[];
}

/**
 * Checks whether an IPv4 or IPv6 address is in a private, loopback, link-local,
 * cloud metadata, multicast, or reserved range.
 */
export function isDisallowedIp(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return true;

  const trimmed = ip.trim();

  // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (trimmed.startsWith('::ffff:')) {
    const v4Part = trimmed.substring(7);
    if (net.isIPv4(v4Part)) {
      return isDisallowedIp(v4Part);
    }
    // Hex IPv4-mapped (e.g. ::ffff:7f00:0001)
    const hexParts = v4Part.split(':');
    if (hexParts.length === 2) {
      const p1 = parseInt(hexParts[0], 16);
      const p2 = parseInt(hexParts[1], 16);
      if (!isNaN(p1) && !isNaN(p2)) {
        const a = (p1 >> 8) & 0xff;
        const b = p1 & 0xff;
        const c = (p2 >> 8) & 0xff;
        const d = p2 & 0xff;
        return isDisallowedIp(`${a}.${b}.${c}.${d}`);
      }
    }
    return true;
  }

  // IPv4 Evaluation
  if (net.isIPv4(trimmed)) {
    const parts = trimmed.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [a, b, c, d] = parts;
    const num = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;

    // 10.0.0.0/8 (Private Class A)
    if (a === 10) return true;

    // 100.64.0.0/10 (Carrier-Grade NAT / Shared)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;

    // 169.254.0.0/16 (Link-Local, including Cloud Metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;

    // 172.16.0.0/12 (Private Class B: 172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (a === 192 && b === 0 && c === 0) return true;

    // 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 0 && c === 2) return true;

    // 192.88.99.0/24 (6to4 Relay Anycast)
    if (a === 192 && b === 88 && c === 99) return true;

    // 192.168.0.0/16 (Private Class C)
    if (a === 192 && b === 168) return true;

    // 198.18.0.0/15 (Network Benchmark Testing)
    if (a === 198 && (b === 18 || b === 19)) return true;

    // 198.51.100.0/24 (TEST-NET-2)
    if (a === 198 && b === 51 && c === 100) return true;

    // 203.0.113.0/24 (TEST-NET-3)
    if (a === 203 && b === 0 && c === 113) return true;

    // 224.0.0.0/4 (Multicast: 224.0.0.0 - 239.255.255.255)
    if (a >= 224 && a <= 239) return true;

    // 240.0.0.0/4 (Reserved for Future Use / Class E)
    if (a >= 240) return true;

    // 255.255.255.255 (Broadcast)
    if (num === 0xffffffff) return true;

    return false;
  }

  // IPv6 Evaluation
  if (net.isIPv6(trimmed)) {
    const lower = trimmed.toLowerCase();

    // ::1 (Loopback)
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;

    // :: (Unspecified)
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;

    // fe80::/10 (Link-local: fe80: - febf:)
    if (
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    ) {
      return true;
    }

    // fc00::/7 (Unique Local Address - ULA, private, including AWS IMDS IPv6 fd00:ec2::254)
    if (lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }

    // ff00::/8 (Multicast)
    if (lower.startsWith('ff')) return true;

    // 2001:db8::/32 (Documentation)
    if (lower.startsWith('2001:db8') || lower.startsWith('2001:0db8')) return true;

    // 100::/64 (Discard prefix)
    if (lower.startsWith('100:')) return true;

    // 2002::/16 (6to4 Relay) - validate embedded IPv4 address
    if (lower.startsWith('2002:')) {
      const hexMatch = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})/i);
      if (hexMatch) {
        const p1 = parseInt(hexMatch[1], 16);
        const p2 = parseInt(hexMatch[2], 16);
        if (!isNaN(p1) && !isNaN(p2)) {
          const a = (p1 >> 8) & 0xff;
          const b = p1 & 0xff;
          const c = (p2 >> 8) & 0xff;
          const d = p2 & 0xff;
          if (isDisallowedIp(`${a}.${b}.${c}.${d}`)) return true;
        }
      }
    }

    return false;
  }

  // If not valid IP format, treat as disallowed
  return true;
}

/**
 * Detects whether a hostname string contains unusual or obfuscated IP formats
 * (e.g. hex 0x7f000001, octal 0177.0.0.1, dword integer 2130706433, or leading zeros).
 */
export function containsObfuscatedIpFormat(hostname: string): boolean {
  if (!hostname) return true;
  const raw = hostname.toLowerCase();

  // Check for hex or octal prefixes
  if (/^0x[0-9a-f]+$/i.test(raw)) return true;
  if (/^0[0-7]+$/.test(raw)) return true;

  // Check for single dword integer IP (e.g. 2130706433 or 0)
  if (/^\d+$/.test(raw)) return true;

  // Check dot-separated parts for hex, octal, or leading zeros
  const parts = raw.split('.');
  if (parts.length >= 2 && parts.every((p) => /^[0-9a-fx]+$/i.test(p))) {
    for (const part of parts) {
      if (part.startsWith('0x') || part.startsWith('0X')) return true;
      if (part.length > 1 && part.startsWith('0')) return true; // Octal or leading zero
    }
  }

  // Check for shorthand IPv4 (e.g. 127.1 or 10.1)
  if (parts.length > 1 && parts.length < 4 && parts.every((p) => /^\d+$/.test(p))) {
    return true;
  }

  return false;
}

/**
 * Validates that a destination URL is strictly HTTP or HTTPS, targets an allowed port,
 * does not use obfuscated IP formats, and resolves exclusively to public, non-private IPs.
 */
export async function validateDestinationUrl(urlStr: string): Promise<DestinationValidationResult> {
  if (!urlStr || typeof urlStr !== 'string') {
    return { valid: false, error: 'Destination URL is required.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    return { valid: false, error: 'Invalid URL syntax.' };
  }

  // 1. Disallow user credentials embedded in URL (user:password@host)
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs containing user credentials are not permitted.' };
  }

  // 2. Protocol check: HTTPS strictly enforced, HTTP permitted in dev/test only
  const isHttps = parsed.protocol === 'https:';
  const isDevHttp =
    parsed.protocol === 'http:' &&
    (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development');

  if (!isHttps && !isDevHttp) {
    return {
      valid: false,
      error: `Unsupported protocol "${parsed.protocol}". Only HTTPS media URLs are permitted.`,
    };
  }

  // 3. Port check: only standard HTTP/HTTPS ports (80 or 443) or default
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    return {
      valid: false,
      error: `Non-standard port "${parsed.port}" is not permitted.`,
    };
  }

  // Strip brackets from IPv6 host if present
  let hostname = parsed.hostname;
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  if (!hostname) {
    return { valid: false, error: 'URL is missing a valid hostname.' };
  }

  const lowerHost = hostname.toLowerCase();

  // 4. Reject local host aliases and internal domain suffixes
  if (
    lowerHost === 'localhost' ||
    lowerHost.endsWith('.localhost') ||
    lowerHost.endsWith('.local') ||
    lowerHost.endsWith('.internal') ||
    lowerHost.endsWith('.lan') ||
    lowerHost.endsWith('.home') ||
    lowerHost.endsWith('.corp') ||
    lowerHost.endsWith('.intranet') ||
    lowerHost.endsWith('.onion') ||
    lowerHost.endsWith('.test') ||
    lowerHost.endsWith('.example') ||
    lowerHost.endsWith('.invalid')
  ) {
    return { valid: false, error: 'Requests to local or internal domains are not permitted.' };
  }

  // 5. Reject obfuscated IP representations
  if (containsObfuscatedIpFormat(hostname)) {
    return { valid: false, error: 'Obfuscated or unusual IP representations are not permitted.' };
  }

  // 6. If hostname is directly an IP address
  if (net.isIP(hostname)) {
    if (isDisallowedIp(hostname)) {
      return {
        valid: false,
        error: 'Requests to private, loopback, or cloud metadata IP addresses are not permitted.',
      };
    }
    return { valid: true, url: parsed, resolvedIps: [hostname] };
  }

  // 7. Perform DNS lookup with all addresses
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    if (!addresses || addresses.length === 0) {
      return { valid: false, error: 'The requested media hostname could not be resolved.' };
    }

    const resolvedIps = addresses.map((a) => a.address);

    for (const addr of resolvedIps) {
      if (isDisallowedIp(addr)) {
        return {
          valid: false,
          error: 'Resolved IP address belongs to a private, loopback, or restricted network range.',
        };
      }
    }

    return { valid: true, url: parsed, resolvedIps };
  } catch {
    return {
      valid: false,
      error: 'The requested media hostname could not be resolved.',
    };
  }
}

/**
 * In-memory sliding window rate limiter for media streaming & inspection requests.
 * Protects proxy endpoints from denial-of-service and brute-force scans.
 */
export class SimpleRateLimiter {
  private requests: Map<string, number[]> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs = 60000, maxRequests = 60) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    // Periodic cleanup of stale client keys every 2 minutes
    const timer = setInterval(() => this.cleanup(), 120000);
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  public isAllowed(key: string): boolean {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];
    const recent = timestamps.filter((t) => now - t < this.windowMs);

    if (recent.length >= this.maxRequests) {
      this.requests.set(key, recent);
      return false;
    }

    recent.push(now);
    this.requests.set(key, recent);
    return true;
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.requests.entries()) {
      const recent = timestamps.filter((t) => now - t < this.windowMs);
      if (recent.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, recent);
      }
    }
  }
}

export const mediaProxyRateLimiter = new SimpleRateLimiter(60000, 60);

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  maxRedirects?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SafeFetchResponse {
  response: Response;
  finalUrl: string;
}

/**
 * Fetches an external media resource while strictly validating every hop (including redirects)
 * against SSRF, private IP, redirect loops, and cloud metadata restrictions.
 */
export async function safeFetch(
  initialUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResponse> {
  const maxRedirects = options.maxRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 8000;
  let currentUrl = initialUrl;
  let redirectCount = 0;
  const visitedUrls = new Set<string>([initialUrl]);

  while (redirectCount <= maxRedirects) {
    // 1. Validate the current destination URL and resolved IPs before connecting
    const validation = await validateDestinationUrl(currentUrl);
    if (!validation.valid) {
      throw new Error(`SSRF Blocked: ${validation.error}`);
    }

    const abortController = new AbortController();
    const timeoutTimer = setTimeout(() => {
      abortController.abort(new Error('Connection timed out'));
    }, timeoutMs);

    // If caller provided an external signal, propagate it
    const externalSignal = options.signal;
    const onExternalAbort = () => abortController.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timeoutTimer);
        abortController.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    try {
      const res = await fetch(currentUrl, {
        method: options.method || 'GET',
        headers: options.headers || {},
        redirect: 'manual', // Strictly manual redirect handling to intercept and validate each hop
        signal: abortController.signal,
      });

      clearTimeout(timeoutTimer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }

      // Check for redirect status
      const status = res.status;
      if (status >= 300 && status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          return { response: res, finalUrl: currentUrl };
        }

        // Resolve relative redirects against current URL
        const nextUrl = new URL(location, currentUrl).toString();

        // Detect and reject redirect loops
        if (visitedUrls.has(nextUrl)) {
          throw new Error('Redirect loop detected.');
        }
        visitedUrls.add(nextUrl);

        redirectCount++;
        if (redirectCount > maxRedirects) {
          throw new Error('Too many redirects (max 5 exceeded).');
        }

        currentUrl = nextUrl;
        continue;
      }

      return { response: res, finalUrl: currentUrl };
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
      throw err;
    }
  }

  throw new Error('Maximum redirect limit exceeded.');
}
