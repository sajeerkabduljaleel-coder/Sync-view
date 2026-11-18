/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import net from 'net';
import dns from 'dns';
import http from 'http';
import https from 'https';
import { Readable } from 'stream';

export interface DestinationValidationResult {
  valid: boolean;
  error?: string;
  url?: URL;
  resolvedIps?: string[];
}

/**
/**
 * Expands any valid IPv6 literal (compressed ::, uppercase, leading zeros, or embedded dotted IPv4)
 * into its 8 canonical 16-bit integer groups. Returns null if invalid or scoped with zone ID.
 */
function parseIpv6Words(ip: string): number[] | null {
  if (!ip || ip.includes('%')) return null;

  let working = ip.toLowerCase();

  // Convert trailing embedded IPv4 (e.g. ::ffff:127.0.0.1 or 0:0:0:0:0:ffff:10.0.0.1) into two hex words
  const lastColon = working.lastIndexOf(':');
  if (lastColon !== -1 && working.slice(lastColon + 1).includes('.')) {
    const v4Str = working.slice(lastColon + 1);
    if (!net.isIPv4(v4Str)) return null;
    const octets = v4Str.split('.').map((o) => parseInt(o, 10));
    const w1 = ((octets[0] << 8) | octets[1]).toString(16);
    const w2 = ((octets[2] << 8) | octets[3]).toString(16);
    working = working.slice(0, lastColon + 1) + `${w1}:${w2}`;
  }

  const doubleColonParts = working.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseGroups = (seg: string): number[] | null => {
    if (!seg) return [];
    const parts = seg.split(':');
    const out: number[] = [];
    for (const p of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
      out.push(parseInt(p, 16));
    }
    return out;
  };

  if (doubleColonParts.length === 2) {
    const left = parseGroups(doubleColonParts[0]);
    const right = parseGroups(doubleColonParts[1]);
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    return [...left, ...new Array(missing).fill(0), ...right];
  }

  const words = parseGroups(working);
  if (!words || words.length !== 8) return null;
  return words;
}

function wordsToIpv4(wHigh: number, wLow: number): string {
  return `${(wHigh >> 8) & 0xff}.${wHigh & 0xff}.${(wLow >> 8) & 0xff}.${wLow & 0xff}`;
}

/**
 * Checks whether an IPv4 or IPv6 address is in a private, loopback, link-local,
 * cloud metadata, multicast, NAT64, Teredo, 6to4, or reserved range.
 */
export function isDisallowedIp(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return true;

  let trimmed = ip.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    trimmed = trimmed.slice(1, -1);
  }

  // IPv4 Evaluation
  if (net.isIPv4(trimmed)) {
    const parts = trimmed.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [a, b, c, d] = parts;
    const num = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 127) return true; // 127.0.0.0/8 Loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 Link-local & IMDS
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
    if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
    if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 6to4 relay
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 Benchmark
    if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
    if (a >= 224 && a <= 239) return true; // 224.0.0.0/4 Multicast
    if (a >= 240) return true; // 240.0.0.0/4 Reserved & Broadcast
    if (num === 0xffffffff) return true;

    return false;
  }

  // Canonical IPv6 Evaluation (eliminates case, zero-compression, and expanded form bypasses)
  if (net.isIPv6(trimmed)) {
    const w = parseIpv6Words(trimmed);
    if (!w) return true;

    const allZeroPrefix5 = w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0;

    // :: (Unspecified) and ::1 (Loopback)
    if (allZeroPrefix5 && w[5] === 0 && w[6] === 0 && (w[7] === 0 || w[7] === 1)) {
      return true;
    }

    // ::ffff:0:0/96 (IPv4-mapped IPv6, any case/expansion)
    if (allZeroPrefix5 && w[5] === 0xffff) {
      return isDisallowedIp(wordsToIpv4(w[6], w[7]));
    }

    // ::/96 (IPv4-compatible IPv6, deprecated)
    if (allZeroPrefix5 && w[5] === 0) {
      return isDisallowedIp(wordsToIpv4(w[6], w[7]));
    }

    // ::ffff:0:0:0/96 (IPv4-translated SIIT)
    if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0xffff && w[5] === 0) {
      return isDisallowedIp(wordsToIpv4(w[6], w[7]));
    }

    // 64:ff9b::/96 (NAT64 well-known) and 64:ff9b:1::/48 (NAT64 local)
    if (w[0] === 0x0064 && w[1] === 0xff9b) {
      if (w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0) {
        return isDisallowedIp(wordsToIpv4(w[6], w[7]));
      }
      if (w[2] === 0x0001) return true;
    }

    // fe80::/10 (Link-local) & fec0::/10 (Deprecated site-local)
    if ((w[0] & 0xffc0) === 0xfe80) return true;
    if ((w[0] & 0xffc0) === 0xfec0) return true;

    // fc00::/7 (Unique Local Address, includes AWS IMDS IPv6 fd00:ec2::254)
    if ((w[0] & 0xfe00) === 0xfc00) return true;

    // ff00::/8 (Multicast)
    if ((w[0] & 0xff00) === 0xff00) return true;

    // 2002::/16 (6to4 relay) - check embedded IPv4
    if (w[0] === 0x2002) {
      return isDisallowedIp(wordsToIpv4(w[1], w[2]));
    }

    // 2001::/32 (Teredo tunnel), 2001:db8::/32 (Docs), 2001:2::/48 (Benchmark), 2001:10::/28 & 2001:20::/28
    if (w[0] === 0x2001) {
      if (w[1] === 0x0000 || w[1] === 0x0db8 || w[1] === 0x0002) return true;
      if ((w[1] & 0xfff0) === 0x0010 || (w[1] & 0xfff0) === 0x0020) return true;
    }

    // 100::/64 (Discard prefix)
    if (w[0] === 0x0100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return true;

    return false;
  }

  // Reject anything that is not a recognized valid IP literal
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
 * Socket-level DNS lookup callback used by http.Agent and https.Agent to eliminate
 * the validation-to-connection gap and prevent DNS rebinding attacks.
 * Invoked immediately by the TCP/TLS connection layer before socket connect.
 */
export function ssrfGuardedLookup(
  hostname: string,
  options: any,
  callback: (err: Error | null, address?: any, family?: number) => void
): void {
  let cleanHost = hostname;
  if (cleanHost.startsWith('[') && cleanHost.endsWith(']')) {
    cleanHost = cleanHost.slice(1, -1);
  }

  // 1. Direct IP check
  const directFamily = net.isIP(cleanHost);
  if (directFamily) {
    if (isDisallowedIp(cleanHost)) {
      return callback(new Error('SSRF Blocked: Destination IP is disallowed'));
    }
    if (options && options.all) {
      return callback(null, [{ address: cleanHost, family: directFamily }]);
    }
    return callback(null, cleanHost, directFamily);
  }

  // 2. Obfuscated format check
  if (containsObfuscatedIpFormat(cleanHost)) {
    return callback(new Error('SSRF Blocked: Obfuscated IP format'));
  }

  // 3. Resolve all addresses at connect time (verbatim to preserve raw IPv4/IPv6 values)
  dns.lookup(cleanHost, { ...options, all: true, verbatim: true } as any, (err: any, addresses: any) => {
    if (err) return callback(err);
    if (!addresses || addresses.length === 0) {
      return callback(new Error('DNS resolution returned no addresses'));
    }

    // 4. If ANY address is disallowed, reject the ENTIRE result (prevents mixed DNS rebinding)
    const validated: Array<{ address: string; family: number }> = [];
    for (const entry of addresses) {
      const ip = typeof entry === 'string' ? entry : entry.address;
      const family = (typeof entry === 'object' && entry.family) || net.isIP(ip) || 4;
      if (!ip || isDisallowedIp(ip)) {
        return callback(
          new Error('SSRF Blocked: Prohibited destination IP in DNS result')
        );
      }
      validated.push({ address: ip, family });
    }

    // 5. Pass only validated addresses directly to the socket connection
    if (options && options.all) {
      callback(null, validated);
    } else {
      const first = validated[0];
      callback(null, first.address, first.family);
    }
  });
}

/**
 * Dedicated, connection-time SSRF-guarded HTTP and HTTPS agents.
 * - keepAlive: false prevents reusing stale sockets across DNS TTL boundaries
 * - autoSelectFamily: false ensures only the explicitly validated address is dialed
 * - lookup: ssrfGuardedLookup enforces IP validation at connect time (preserving TLS SNI & hostname check)
 */
export const ssrfHttpsAgent = new https.Agent({
  keepAlive: false,
  maxSockets: 50,
  timeout: 10000,
  autoSelectFamily: false,
  lookup: ssrfGuardedLookup,
} as https.AgentOptions & { autoSelectFamily?: boolean });

export const ssrfHttpAgent = new http.Agent({
  keepAlive: false,
  maxSockets: 50,
  timeout: 10000,
  autoSelectFamily: false,
  lookup: ssrfGuardedLookup,
} as http.AgentOptions & { autoSelectFamily?: boolean });

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
 * Performs a single HTTP/HTTPS request using connection-level SSRF agents
 * and verifies socket.remoteAddress on connect as defense-in-depth.
 */
function makeGuardedRequest(
  urlStr: string,
  options: SafeFetchOptions
): Promise<{ res: http.IncomingMessage; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? ssrfHttpsAgent : ssrfHttpAgent;

    const req = client.request(
      urlStr,
      {
        method: options.method || 'GET',
        headers: options.headers || {},
        agent,
        autoSelectFamily: false,
        signal: options.signal,
      } as https.RequestOptions & { autoSelectFamily?: boolean },
      (res) => {
        const remoteIp = res.socket?.remoteAddress;
        if (remoteIp && isDisallowedIp(remoteIp)) {
          res.destroy();
          reject(new Error('SSRF Blocked: Upstream connected to a prohibited IP range'));
          return;
        }
        resolve({ res, finalUrl: urlStr });
      }
    );

    req.on('socket', (socket) => {
      const verifyRemoteAddress = () => {
        if (socket.remoteAddress && isDisallowedIp(socket.remoteAddress)) {
          socket.destroy(new Error('SSRF Blocked: Upstream socket resolved to a prohibited IP range'));
        }
      };
      if (socket.remoteAddress) {
        verifyRemoteAddress();
      } else {
        socket.once('connect', verifyRemoteAddress);
      }
    });

    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => {
        req.destroy(new Error('Connection timed out'));
      });
    }

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

/**
 * Fetches an external media resource while strictly validating every hop (including redirects)
 * against SSRF, private IP, redirect loops, and cloud metadata restrictions.
 * Enforces connection-level DNS validation to eliminate DNS rebinding race conditions.
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
    // 1. Pre-flight URL and syntax validation
    const validation = await validateDestinationUrl(currentUrl);
    if (!validation.valid) {
      throw new Error(`SSRF Blocked: ${validation.error}`);
    }

    try {
      const { res } = await makeGuardedRequest(currentUrl, {
        method: options.method || 'GET',
        headers: options.headers || {},
        signal: options.signal,
        timeoutMs,
      });

      const status = res.statusCode || 200;

      // Handle redirect status codes
      if (status >= 300 && status < 400) {
        const location = res.headers.location;
        if (!location) {
          const webRes = new Response(Readable.toWeb(res) as any, {
            status,
            statusText: res.statusMessage || 'Redirect',
            headers: res.headers as any,
          });
          return { response: webRes, finalUrl: currentUrl };
        }

        // Consume remaining response stream to release socket
        res.resume();

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

      // Convert IncomingMessage to a WHATWG Web Response
      const webRes = new Response(Readable.toWeb(res) as any, {
        status,
        statusText: res.statusMessage || 'OK',
        headers: res.headers as any,
      });

      return { response: webRes, finalUrl: currentUrl };
    } catch (err: any) {
      throw err;
    }
  }

  throw new Error('Maximum redirect limit exceeded.');
}
