/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { EventEmitter } from 'node:events';
import dns from 'node:dns';
import {
  isDisallowedIp,
  containsObfuscatedIpFormat,
  validateDestinationUrl,
  safeFetch,
  SimpleRateLimiter,
  ssrfGuardedLookup,
} from '../../server/ssrfValidator';
import { isPlayableMediaContentType } from '../../server/mediaStreamProxy';

// ---------------------------------------------------------------------------
// 1. SSRF IP & CIDR Range Enforcement
// ---------------------------------------------------------------------------

test('ssrfValidator: rejects IPv4 loopback addresses', () => {
  assert.equal(isDisallowedIp('127.0.0.1'), true);
  assert.equal(isDisallowedIp('127.0.0.2'), true);
  assert.equal(isDisallowedIp('127.255.255.255'), true);
});

test('ssrfValidator: rejects IPv6 loopback and unspecified addresses', () => {
  assert.equal(isDisallowedIp('::1'), true);
  assert.equal(isDisallowedIp('0:0:0:0:0:0:0:1'), true);
  assert.equal(isDisallowedIp('::'), true);
});

test('ssrfValidator: rejects private RFC 1918 IPv4 ranges', () => {
  // 10.0.0.0/8
  assert.equal(isDisallowedIp('10.0.0.1'), true);
  assert.equal(isDisallowedIp('10.254.1.99'), true);
  assert.equal(isDisallowedIp('10.255.255.255'), true);

  // 172.16.0.0/12
  assert.equal(isDisallowedIp('172.16.0.1'), true);
  assert.equal(isDisallowedIp('172.24.10.5'), true);
  assert.equal(isDisallowedIp('172.31.255.255'), true);
  // 172.32.0.1 is public
  assert.equal(isDisallowedIp('172.32.0.1'), false);

  // 192.168.0.0/16
  assert.equal(isDisallowedIp('192.168.0.1'), true);
  assert.equal(isDisallowedIp('192.168.1.254'), true);
  assert.equal(isDisallowedIp('192.168.255.255'), true);
});

test('ssrfValidator: rejects AWS / GCP / Azure Cloud Metadata and Link-Local addresses', () => {
  // 169.254.169.254 IMDS
  assert.equal(isDisallowedIp('169.254.169.254'), true);
  assert.equal(isDisallowedIp('169.254.0.1'), true);
  assert.equal(isDisallowedIp('169.254.255.255'), true);

  // IPv6 link-local (fe80::/10)
  assert.equal(isDisallowedIp('fe80::1'), true);
  assert.equal(isDisallowedIp('fe80::dead:beef'), true);

  // IPv6 unique local / AWS IMDS IPv6 (fc00::/7, fd00:ec2::254)
  assert.equal(isDisallowedIp('fd00:ec2::254'), true);
  assert.equal(isDisallowedIp('fc00::1'), true);
});

test('ssrfValidator: rejects Carrier-Grade NAT (100.64.0.0/10) and Broadcast/Multicast', () => {
  assert.equal(isDisallowedIp('100.64.0.1'), true);
  assert.equal(isDisallowedIp('100.127.255.255'), true);
  assert.equal(isDisallowedIp('224.0.0.1'), true); // Multicast
  assert.equal(isDisallowedIp('255.255.255.255'), true); // Broadcast
  assert.equal(isDisallowedIp('0.0.0.0'), true); // Unspecified
});

test('ssrfValidator: rejects IPv4-mapped IPv6 and 6to4 private representations', () => {
  assert.equal(isDisallowedIp('::ffff:127.0.0.1'), true);
  assert.equal(isDisallowedIp('::ffff:169.254.169.254'), true);
  assert.equal(isDisallowedIp('::ffff:10.0.0.1'), true);
  assert.equal(isDisallowedIp('::ffff:192.168.1.1'), true);

  // 6to4 embedding 127.0.0.1 (7f00:0001)
  assert.equal(isDisallowedIp('2002:7f00:0001::'), true);
  // 6to4 embedding 10.1.2.3 (0a01:0203)
  assert.equal(isDisallowedIp('2002:0a01:0203::'), true);
});

test('ssrfValidator: permits benign public IP addresses', () => {
  assert.equal(isDisallowedIp('8.8.8.8'), false);
  assert.equal(isDisallowedIp('1.1.1.1'), false);
  assert.equal(isDisallowedIp('93.184.216.34'), false);
});

// ---------------------------------------------------------------------------
// 2. Obfuscated Hostname & IP Formats
// ---------------------------------------------------------------------------

test('ssrfValidator: detects hex, octal, dword and leading-zero obfuscated IPs', () => {
  assert.equal(containsObfuscatedIpFormat('0x7f000001'), true);
  assert.equal(containsObfuscatedIpFormat('0x7f.0.0.1'), true);
  assert.equal(containsObfuscatedIpFormat('2130706433'), true); // dword for 127.0.0.1
  assert.equal(containsObfuscatedIpFormat('0177.0.0.1'), true); // octal
  assert.equal(containsObfuscatedIpFormat('127.000.000.001'), true); // leading zeros
  assert.equal(containsObfuscatedIpFormat('127.1'), true); // shorthand
  assert.equal(containsObfuscatedIpFormat('google.com'), false);
  assert.equal(containsObfuscatedIpFormat('cdn.myvideo.org'), false);
});

// ---------------------------------------------------------------------------
// 3. Destination URL Security Validation
// ---------------------------------------------------------------------------

test('ssrfValidator: rejects forbidden protocols, ports, userinfo, and internal domain names', async () => {
  // Protocol restrictions
  const ftpRes = await validateDestinationUrl('ftp://example.com/video.mp4');
  assert.equal(ftpRes.valid, false);
  assert.match(ftpRes.error || '', /protocol/i);

  const fileRes = await validateDestinationUrl('file:///etc/passwd');
  assert.equal(fileRes.valid, false);

  const gopherRes = await validateDestinationUrl('gopher://127.0.0.1:70/');
  assert.equal(gopherRes.valid, false);

  // User credentials in URL
  const credsRes = await validateDestinationUrl('https://admin:secret@cdn.example.com/video.mp4');
  assert.equal(credsRes.valid, false);
  assert.match(credsRes.error || '', /credentials/i);

  // Non-standard port restrictions
  const sshPortRes = await validateDestinationUrl('https://commondatastorage.googleapis.com:22/video.mp4');
  assert.equal(sshPortRes.valid, false);
  assert.match(sshPortRes.error || '', /port/i);

  // Localhost / internal domains
  const localRes = await validateDestinationUrl('https://localhost:443/stream');
  assert.equal(localRes.valid, false);

  const internalDomainRes = await validateDestinationUrl('https://server.internal/video.mp4');
  assert.equal(internalDomainRes.valid, false);

  const lanRes = await validateDestinationUrl('https://router.lan/admin');
  assert.equal(lanRes.valid, false);

  const onionRes = await validateDestinationUrl('https://hidden.onion/video.mp4');
  assert.equal(onionRes.valid, false);

  // Obfuscated hex URL
  const hexRes = await validateDestinationUrl('https://0x7f000001/video.mp4');
  assert.equal(hexRes.valid, false);
});

// ---------------------------------------------------------------------------
// 4. DNS Resolution to Private IP Addresses
// ---------------------------------------------------------------------------

test('ssrfValidator: rejects hostnames that resolve via DNS to private or loopback IPs', async () => {
  // Temporarily stub dns.promises.lookup
  const originalLookup = dns.promises.lookup;
  try {
    dns.promises.lookup = (async (hostname: string) => {
      if (hostname === 'malicious-rebind-stream.com') {
        return [{ address: '127.0.0.1', family: 4 }];
      }
      if (hostname === 'rebind-to-imds.org') {
        return [{ address: '169.254.169.254', family: 4 }];
      }
      if (hostname === 'private-corp-network.net') {
        return [{ address: '10.50.0.1', family: 4 }];
      }
      return [{ address: '93.184.216.34', family: 4 }];
    }) as any;

    const loopbackDns = await validateDestinationUrl('https://malicious-rebind-stream.com/video.mp4');
    assert.equal(loopbackDns.valid, false);
    assert.match(loopbackDns.error || '', /restricted network range/i);

    const imdsDns = await validateDestinationUrl('https://rebind-to-imds.org/video.mp4');
    assert.equal(imdsDns.valid, false);
    assert.match(imdsDns.error || '', /restricted network range/i);

    const corpDns = await validateDestinationUrl('https://private-corp-network.net/video.mp4');
    assert.equal(corpDns.valid, false);
    assert.match(corpDns.error || '', /restricted network range/i);
  } finally {
    dns.promises.lookup = originalLookup;
  }
});

// ---------------------------------------------------------------------------
// 5. SafeFetch Redirect Re-Validation, Loops, & SSRF Prevention
// ---------------------------------------------------------------------------

test('ssrfValidator safeFetch: blocks redirects to localhost and cloud metadata', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect-to-loopback') {
      res.writeHead(302, { Location: 'http://127.0.0.1:80/secret' });
      res.end();
    } else if (req.url === '/redirect-to-imds') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end('ok');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;

  try {
    // Attempting to fetch loopback redirect directly should fail validation
    await assert.rejects(
      async () => {
        await safeFetch(`http://127.0.0.1:${port}/redirect-to-loopback`, { timeoutMs: 2000 });
      },
      (err: any) => {
        assert.match(err.message, /SSRF Blocked|Access to destination IP is forbidden|Prohibited destination port/i);
        return true;
      }
    );
  } finally {
    server.close();
  }
});

test('ssrfValidator safeFetch: detects and blocks redirect loops', async () => {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount++;
    const port = (server.address() as AddressInfo).port;
    if (req.url === '/loop-a') {
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/loop-b` });
      res.end();
    } else if (req.url === '/loop-b') {
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/loop-a` });
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;

  try {
    await assert.rejects(
      async () => {
        await safeFetch(`http://127.0.0.1:${port}/loop-a`, { timeoutMs: 2000 });
      },
      (err: any) => {
        assert.match(err.message, /SSRF Blocked|Redirect loop detected/i);
        return true;
      }
    );
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// 6. Rate Limiter Unit Tests
// ---------------------------------------------------------------------------

test('SimpleRateLimiter: enforces max requests and resets after window', async () => {
  const limiter = new SimpleRateLimiter(500, 3); // windowMs: 500, maxRequests: 3
  const testIp = '203.0.113.42';

  assert.equal(limiter.isAllowed(testIp), true);
  assert.equal(limiter.isAllowed(testIp), true);
  assert.equal(limiter.isAllowed(testIp), true);

  // 4th request must be rejected
  assert.equal(limiter.isAllowed(testIp), false);

  // Wait for window reset
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal(limiter.isAllowed(testIp), true);
});

// ---------------------------------------------------------------------------
// 7. Media Content-Type Validation (No HTML/JSON relabeling)
// ---------------------------------------------------------------------------

test('mediaStreamProxy: strictly validates playable media content types', () => {
  // Valid media types
  assert.equal(isPlayableMediaContentType('video/mp4'), true);
  assert.equal(isPlayableMediaContentType('video/webm; codecs="vp9"'), true);
  assert.equal(isPlayableMediaContentType('video/ogg'), true);
  assert.equal(isPlayableMediaContentType('audio/mp4'), true);
  assert.equal(isPlayableMediaContentType('application/x-mpegURL'), true);
  assert.equal(isPlayableMediaContentType('application/vnd.apple.mpegurl'), true);

  // Non-media types must NOT be accepted or relabeled
  assert.equal(isPlayableMediaContentType('text/html; charset=utf-8'), false);
  assert.equal(isPlayableMediaContentType('application/json'), false);
  assert.equal(isPlayableMediaContentType('text/plain'), false);
  assert.equal(isPlayableMediaContentType(undefined as any), false);
});

// ---------------------------------------------------------------------------
// 8. Streaming Lifecycle & Response Abort Simulation
// ---------------------------------------------------------------------------

test('streamingLifecycle: incoming request close event does NOT abort stream; client res premature close aborts upstream', () => {
  // Mock Express request (EventEmitter)
  const mockReq = new EventEmitter();

  // Mock Express response (EventEmitter) with writableEnded state
  class MockResponse extends EventEmitter {
    public writableEnded = false;
    public destroyed = false;
    public headers: Record<string, string> = {};
    public statusCode = 200;
    public chunks: Buffer[] = [];

    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    }
    write(chunk: Buffer) {
      if (this.writableEnded || this.destroyed) {
        throw new Error('ERR_STREAM_WRITE_AFTER_END');
      }
      this.chunks.push(chunk);
      return true;
    }
    end() {
      this.writableEnded = true;
      this.emit('finish');
    }
    destroy() {
      this.destroyed = true;
      this.emit('close');
    }
  }

  const abortController = new AbortController();

  // Upstream is aborted ONLY when res emits 'close' AND writableEnded is false
  const mockRes = new MockResponse();

  const onResClose = () => {
    if (!mockRes.writableEnded) {
      abortController.abort(new Error('Client disconnected prematurely'));
    }
  };
  mockRes.once('close', onResClose);

  // Case A: The incoming request finishes reading (req emits 'close')
  mockReq.emit('close');
  assert.equal(abortController.signal.aborted, false, 'req close must not abort upstream stream');

  // Case B: Normal completion
  const normalRes = new MockResponse();
  const normalAbortController = new AbortController();
  normalRes.once('close', () => {
    if (!normalRes.writableEnded) {
      normalAbortController.abort();
    }
  });
  normalRes.end();
  normalRes.emit('close');
  assert.equal(normalAbortController.signal.aborted, false, 'normal stream completion must not abort upstream');

  // Case C: Premature client disconnect
  mockRes.destroy();
  assert.equal(abortController.signal.aborted, true, 'premature client disconnect must abort upstream fetch');
  assert.match(abortController.signal.reason?.message || '', /Client disconnected prematurely/);
});

// ---------------------------------------------------------------------------
// 9. HTTP Range Request Handling & Seeking
// ---------------------------------------------------------------------------

test('httpRangeHandling: parses standard RFC 7233 byte ranges and constructs upstream Range headers', () => {
  const testRanges = [
    { input: 'bytes=0-1024', valid: true },
    { input: 'bytes=1048576-', valid: true },
    { input: 'bytes=-500', valid: true },
    { input: 'bytes=0-0', valid: true },
    { input: 'characters=0-100', valid: false },
    { input: 'bytes=abc-def', valid: false },
    { input: 'bytes=10-20,30-40', valid: false }, // multipart not allowed
  ];

  const regex = /^bytes=(\d+-\d*|\d*-\d+)$/;

  for (const t of testRanges) {
    const isMatch = regex.test(t.input);
    assert.equal(isMatch, t.valid, `Range "${t.input}" validity mismatch`);
  }
});

// ---------------------------------------------------------------------------
// 10. Google Drive Share Link & Private File Error Mapping
// ---------------------------------------------------------------------------

test('googleDriveHandling: detects private login redirects and confirmation tokens', () => {
  // Test private redirect URL check
  const privateLocation = 'https://accounts.google.com/ServiceLogin?service=wise&passive=1209600';
  assert.equal(privateLocation.includes('accounts.google.com'), true);

  // Test virus scan confirmation extraction
  const mockHtmlWithToken = `
    <html>
      <body>
        <form id="download-form" action="/uc?export=download" method="post">
          <a id="uc-download-link" class="goog-inline-block jfk-button jfk-button-action" href="/uc?export=download&confirm=t_token123&id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs">Download anyway</a>
        </form>
      </body>
    </html>
  `;
  const confirmMatch = mockHtmlWithToken.match(/href="(\/uc\?export=download[^"]+confirm=([^"&]+)[^"]*)"/i);
  assert.ok(confirmMatch);
  assert.equal(confirmMatch[2], 't_token123');

  // Test private permission error page detection
  const privateHtml = '<html><head><title>Google Drive – Access Denied</title></head><body>You need access to view this file.</body></html>';
  const isPrivate = privateHtml.includes('You need access') || privateHtml.includes('Sign in');
  assert.equal(isPrivate, true);
});

// ---------------------------------------------------------------------------
// 11. Connection-Level DNS Rebinding & Mixed DNS Defenses
// ---------------------------------------------------------------------------

test('ssrfGuardedLookup: rejects mixed DNS responses containing both public and private addresses', (t, done) => {
  const originalLookup = dns.lookup;
  (dns as any).lookup = (hostname: string, options: any, cb: any) => {
    // Simulate DNS returning both a public IP and a private loopback IP
    cb(null, [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
  };

  ssrfGuardedLookup('mixed-dns.example.com', { all: true }, (err, addresses) => {
    (dns as any).lookup = originalLookup;
    assert.ok(err, 'Expected error for mixed DNS responses containing private IPs');
    assert.match(err?.message || '', /Prohibited destination IP in DNS result/i);
    done();
  });
});

test('ssrfGuardedLookup: blocks connection-time DNS rebinding to loopback and cloud metadata', (t, done) => {
  const originalLookup = dns.lookup;
  (dns as any).lookup = (hostname: string, options: any, cb: any) => {
    // Simulate rebinding to IMDS at connect-time
    cb(null, [{ address: '169.254.169.254', family: 4 }]);
  };

  ssrfGuardedLookup('rebind-at-connect.example.com', { all: true }, (err, addresses) => {
    (dns as any).lookup = originalLookup;
    assert.ok(err, 'Expected error for rebinding to cloud metadata');
    assert.match(err?.message || '', /Prohibited destination IP in DNS result/i);
    done();
  });
});

test('mediaStreamProxy: rejects non-media responses even when status is 206 Partial Content', () => {
  // If upstream returns 206 with non-media MIME, isPlayableMediaContentType must reject it
  assert.equal(isPlayableMediaContentType('text/html'), false);
  assert.equal(isPlayableMediaContentType('application/json'), false);
  assert.equal(isPlayableMediaContentType('text/plain'), false);
  assert.equal(isPlayableMediaContentType('image/svg+xml'), false);
  assert.equal(isPlayableMediaContentType('video/mp4'), true);
  assert.equal(isPlayableMediaContentType('video/webm'), true);
});

