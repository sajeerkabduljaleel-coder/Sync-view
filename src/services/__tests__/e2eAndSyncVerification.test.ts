/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.SYNCVIEW_DISABLE_AUTO_LISTEN = '1';
process.env.NODE_ENV = 'test';

import { WatchPartyManager } from '../watchPartyModel';
import { SingleInstanceFileWatchPartyRepository } from '../watchPartyRepository';
import { SessionSyncController } from '../SessionSyncController';
import { mapSourceToReaction, mapReactionToSource } from '../syncEngine';
import {
  MANUAL_ONLY_CAPABILITIES,
  MediaPlayerAdapter,
  PlayerErrorInfo,
} from '../mediaProviders/types';
import { SyncAnchor } from '../../types';

let createSyncViewApp: typeof import('../../../server')['createSyncViewApp'];

// =====================================================================
// Simulated Realistic MediaPlayerAdapter for Deterministic Sync Profiling
// =====================================================================
class CalibratedMockAdapter implements MediaPlayerAdapter {
  public readonly id: string;
  public readonly provider: MediaPlayerAdapter['provider'];
  public readonly playbackMode: MediaPlayerAdapter['playbackMode'];
  public readonly syncCapability: MediaPlayerAdapter['syncCapability'];
  public readonly capabilities: MediaPlayerAdapter['capabilities'];

  public currentTime: number = 0;
  public duration: number | null;
  public paused: boolean = true;
  public playbackRate: number = 1.0;
  public muted: boolean = false;
  public volume: number = 1.0;
  public readyState: number = 4;
  public buffering: boolean = false;
  public error: PlayerErrorInfo | null = null;
  public seekHistory: number[] = [];

  constructor(
    id: string,
    opts?: {
      duration?: number | null;
      provider?: MediaPlayerAdapter['provider'];
      syncCapability?: MediaPlayerAdapter['syncCapability'];
      canReadTime?: boolean;
      canControlRate?: boolean;
      supportsContinuousRate?: boolean;
      readyState?: number;
    }
  ) {
    this.id = id;
    this.provider = opts?.provider ?? 'native';
    this.playbackMode =
      this.provider === 'google_drive'
        ? 'embedded'
        : this.provider === 'patreon'
        ? 'external'
        : this.provider === 'youtube'
        ? 'embedded'
        : 'native';
    this.syncCapability =
      opts?.syncCapability ??
      (this.playbackMode === 'native' || this.provider === 'youtube'
        ? 'full_sync'
        : 'manual_sync');
    this.duration = opts?.duration === undefined ? 300 : opts.duration;
    this.readyState = opts?.readyState ?? 4;

    const canControl = this.syncCapability === 'full_sync';
    this.capabilities = {
      canPlay: canControl,
      canPause: canControl,
      canSeek: canControl,
      canReadTime: opts?.canReadTime ?? canControl,
      canReadDuration: opts?.canReadTime ?? canControl,
      canControlRate: opts?.canControlRate ?? canControl,
      supportsContinuousRate: opts?.supportsContinuousRate ?? (this.provider !== 'youtube' && canControl),
      canControlVolume: true,
    };
  }

  public advance(dtSeconds: number, jitterFactor = 1.0): void {
    if (this.paused || this.buffering || this.error) return;
    this.currentTime += dtSeconds * this.playbackRate * jitterFactor;
    if (this.duration !== null && this.currentTime > this.duration) {
      this.currentTime = this.duration;
      this.paused = true;
    }
  }

  public async play(): Promise<boolean> {
    if (!this.capabilities.canPlay || this.error) return false;
    this.paused = false;
    return true;
  }

  public pause(): boolean {
    if (!this.capabilities.canPause) return false;
    this.paused = true;
    return true;
  }

  public seekTo(seconds: number): boolean {
    if (!this.capabilities.canSeek || this.error) return false;
    const clamped =
      this.duration !== null ? Math.min(Math.max(0, seconds), this.duration) : Math.max(0, seconds);
    this.currentTime = clamped;
    this.seekHistory.push(clamped);
    return true;
  }

  public getCurrentTime(): number | null {
    return this.capabilities.canReadTime ? this.currentTime : null;
  }

  public getDuration(): number | null {
    return this.capabilities.canReadDuration ? this.duration : null;
  }

  public isPaused(): boolean | null {
    return this.paused;
  }

  public getPlaybackRate(): number | null {
    return this.playbackRate;
  }

  public setPlaybackRate(rate: number): boolean {
    if (!this.capabilities.canControlRate) return false;
    this.playbackRate = rate;
    return true;
  }

  public getVolume(): number | null {
    return this.volume;
  }

  public setVolume(v: number): boolean {
    this.volume = Math.max(0, Math.min(1, v));
    return true;
  }

  public isMuted(): boolean | null {
    return this.muted;
  }

  public setMuted(m: boolean): boolean {
    this.muted = m;
    return true;
  }

  public getReadyState(): number {
    return this.readyState;
  }

  public isBuffering(): boolean {
    return this.buffering;
  }

  public getError(): PlayerErrorInfo | null {
    return this.error;
  }

  public getSyncDiagnostics() {
    return null;
  }

  public destroy(): void {}
}

// =====================================================================
// PART 1: Watch Party & Backend E2E HTTP Integration Suite
// =====================================================================
let tmpDir = '';
let server: http.Server;
let baseUrl = '';

before(async () => {
  const srvMod = await import('../../../server');
  createSyncViewApp = srvMod.createSyncViewApp;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncview-e2e-'));
  const repo = new SingleInstanceFileWatchPartyRepository(tmpDir, 'parties.json');
  const manager = new WatchPartyManager(repo);
  const app = createSyncViewApp(manager);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('E2E HTTP: health & non-production auth disclosure endpoints respond cleanly', async () => {
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.status, 'healthy');
  assert.equal(health.isProductionAuth, false);

  const authStatusRes = await fetch(`${baseUrl}/api/auth/status`);
  assert.equal(authStatusRes.status, 200);
  const authStatus = await authStatusRes.json();
  assert.equal(authStatus.isProductionReady, false);
  assert.ok(Array.isArray(authStatus.missingConfiguration));
  assert.ok(authStatus.missingConfiguration.length > 0);
});

test('E2E HTTP: custom Watch Party creation rejects blob:/XSS URLs and supports custom streams + disk persistence', async () => {
  // 1. Reject blob: local files
  const blobRes = await fetch(`${baseUrl}/api/parties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Local Blob Test',
      hostName: 'Host',
      source: {
        id: 'local-src',
        title: 'Local Movie',
        url: 'blob:http://localhost:3000/1234-5678',
      },
      reaction: {
        id: 'local-rx',
        sourceId: 'local-src',
        creator: 'Host',
        title: 'Local Reaction',
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      },
    }),
  });
  assert.equal(blobRes.status, 400);
  const blobErr = await blobRes.json();
  assert.match(blobErr.error, /local device files/i);

  // 2. Reject javascript: XSS scheme
  const xssRes = await fetch(`${baseUrl}/api/parties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'XSS Attempt',
      hostName: 'Attacker',
      source: {
        id: 'xss-src',
        title: 'Bad',
        url: 'javascript:alert(1)',
      },
      reaction: {
        id: 'xss-rx',
        sourceId: 'xss-src',
        creator: 'Bad',
        title: 'Bad Rx',
        url: 'https://example.com/rx.mp4',
      },
    }),
  });
  assert.equal(xssRes.status, 400);

  // 3. Create valid Watch Party using direct custom streams (Google Drive proxy + HTTPS source)
  const createRes = await fetch(`${baseUrl}/api/parties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '<script>Custom</script> Watch Party',
      hostName: 'Alice',
      source: {
        id: 'custom-src-1',
        title: 'Custom Trailer',
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        duration: 596,
      },
      reaction: {
        id: 'custom-rx-1',
        sourceId: 'custom-src-1',
        creator: 'BobReacts',
        title: 'Bob Reaction',
        url: '/api/media/stream?url=https%3A%2F%2Fdrive.google.com%2Ffile%2Fd%2F1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs%2Fview',
        introDuration: 12,
        anchors: [
          { id: 'a1', sourceTime: 0, reactionTime: 12, type: 'intro' },
        ],
      },
    }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.ok(created.room?.roomCode);
  assert.ok(created.hostToken);
  assert.ok(created.participantToken);
  assert.ok(!created.room.title.includes('<script>'), 'Title must be sanitized');

  const roomCode = created.room.roomCode;
  const hostToken = created.hostToken;
  const hostParticipantToken = created.participantToken;

  // 4. Verify GET /api/parties lists the new room without leaking tokens
  const listRes = await fetch(`${baseUrl}/api/parties`);
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  const listed = list.find((r: any) => r.roomCode === roomCode);
  assert.ok(listed);
  assert.equal(listed.hostToken, undefined);
  assert.equal(listed.hostTokenHash, undefined);

  // 5. Invalid room join returns 404
  const badJoinRes = await fetch(`${baseUrl}/api/parties/ZZZZZZ/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantName: 'Charlie' }),
  });
  assert.equal(badJoinRes.status, 404);

  // 6. Valid guest join & reconnect deduplication via x-participant-token
  const guestJoin1 = await fetch(`${baseUrl}/api/parties/${roomCode}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantName: 'Charlie' }),
  });
  assert.equal(guestJoin1.status, 200);
  const guestData1 = await guestJoin1.json();
  const guestToken = guestData1.participantToken;
  assert.ok(guestToken);
  assert.equal(guestData1.room.participants.length, 2);

  const guestReconnect = await fetch(`${baseUrl}/api/parties/${roomCode}/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-participant-token': guestToken,
    },
    body: JSON.stringify({ participantName: 'Charlie Reconnected' }),
  });
  assert.equal(guestReconnect.status, 200);
  const guestData2 = await guestReconnect.json();
  assert.equal(guestData2.participantToken, guestToken);
  assert.equal(guestData2.room.participants.length, 2, 'Reconnect must not duplicate participant');

  // 7. Authorization checks on playback commands
  const noHeaderCmd = await fetch(`${baseUrl}/api/parties/${roomCode}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'play', sourceTime: 10, hostToken }),
  });
  assert.equal(noHeaderCmd.status, 401, 'Body-only hostToken must be rejected');

  const guestCmd = await fetch(`${baseUrl}/api/parties/${roomCode}/command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-host-token': guestToken,
    },
    body: JSON.stringify({ command: 'play', sourceTime: 10 }),
  });
  assert.equal(guestCmd.status, 403, 'Guest participant token cannot trigger host playback');

  const hostPlay = await fetch(`${baseUrl}/api/parties/${roomCode}/command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-host-token': hostToken,
    },
    body: JSON.stringify({ command: 'play', sourceTime: 15 }),
  });
  assert.equal(hostPlay.status, 200);
  const playPayload = await hostPlay.json();
  assert.equal(playPayload.playbackState.isPlaying, true);
  assert.equal(playPayload.playbackState.sourceTime, 15);
  assert.equal(playPayload.playbackState.seq, 2);

  // 8. Notes & Chat: server identity + author/host deletion check
  const hostNoteRes = await fetch(`${baseUrl}/api/parties/${roomCode}/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-participant-token': hostParticipantToken,
    },
    body: JSON.stringify({ sourceTime: 15, reactionTime: 27, text: 'Host timestamp note' }),
  });
  assert.equal(hostNoteRes.status, 201);
  const hostNote = await hostNoteRes.json();

  const guestDeleteHostNote = await fetch(`${baseUrl}/api/parties/${roomCode}/notes/${hostNote.id}`, {
    method: 'DELETE',
    headers: { 'x-participant-token': guestToken },
  });
  assert.equal(guestDeleteHostNote.status, 403, 'Non-author non-host cannot delete host note');

  const guestNoteRes = await fetch(`${baseUrl}/api/parties/${roomCode}/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-participant-token': guestToken,
    },
    body: JSON.stringify({ sourceTime: 20, reactionTime: 32, text: 'Guest note' }),
  });
  assert.equal(guestNoteRes.status, 201);
  const guestNote = await guestNoteRes.json();

  const guestChatRes = await fetch(`${baseUrl}/api/parties/${roomCode}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-participant-token': guestToken,
    },
    body: JSON.stringify({ text: '<b>Hello party!</b>', senderName: 'Spoofed' }),
  });
  assert.equal(guestChatRes.status, 201);
  const guestChat = await guestChatRes.json();
  assert.equal(guestChat.senderName, 'Charlie');
  assert.ok(!guestChat.text.includes('<b>'));

  // Host reassigns ownership to guest
  const guestParticipant = guestData1.room.participants.find((p: any) => !p.isHost);
  assert.ok(guestParticipant);
  const reassignRes = await fetch(`${baseUrl}/api/parties/${roomCode}/reassign-host`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-host-token': hostToken,
    },
    body: JSON.stringify({ targetParticipantId: guestParticipant.id }),
  });
  assert.equal(reassignRes.status, 200);
  const reassignData = await reassignRes.json();
  const newHostToken = reassignData.newHostToken;
  assert.ok(newHostToken);

  // Old hostToken must now fail
  const oldHostSeek = await fetch(`${baseUrl}/api/parties/${roomCode}/command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-host-token': hostToken,
    },
    body: JSON.stringify({ command: 'seek', sourceTime: 40 }),
  });
  assert.equal(oldHostSeek.status, 403);

  // New hostToken succeeds and can delete old host's note
  const newHostSeek = await fetch(`${baseUrl}/api/parties/${roomCode}/command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-host-token': newHostToken,
    },
    body: JSON.stringify({ command: 'seek', sourceTime: 42 }),
  });
  assert.equal(newHostSeek.status, 200);

  const newHostDeleteNote = await fetch(`${baseUrl}/api/parties/${roomCode}/notes/${guestNote.id}`, {
    method: 'DELETE',
    headers: { 'x-host-token': newHostToken },
  });
  assert.equal(newHostDeleteNote.status, 200);

  // 9. Disk persistence & no plaintext token verification
  const persistedFile = fs.readFileSync(path.join(tmpDir, 'parties.json'), 'utf8');
  assert.ok(!persistedFile.includes(hostToken), 'Raw old host token must never hit disk');
  assert.ok(!persistedFile.includes(newHostToken), 'Raw new host token must never hit disk');
  assert.ok(!persistedFile.includes(guestToken), 'Raw participant token must never hit disk');

  // Re-instantiate repository from disk to confirm reload works across server restarts
  const reloadedRepo = new SingleInstanceFileWatchPartyRepository(tmpDir, 'parties.json');
  const reloadedManager = new WatchPartyManager(reloadedRepo);
  const reloadedRoom = await reloadedManager.getRoom(roomCode);
  assert.ok(reloadedRoom);
  assert.equal(reloadedRoom.playbackState.sourceTime, 42);
  assert.equal(reloadedRoom.hostId, guestParticipant.id);
  const isNewHostValid = await reloadedManager.isAuthorizedHost(roomCode, newHostToken);
  assert.equal(isNewHostValid, true);

  // Spin up fresh Express instance backed by the reloaded disk repository (full HTTP restart test)
  const restartedApp = createSyncViewApp(reloadedManager);
  const restartedServer = await new Promise<http.Server>((resolve) => {
    const s = restartedApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const rPort = (restartedServer.address() as AddressInfo).port;
    const rBase = `http://127.0.0.1:${rPort}`;
    const getRestarted = await fetch(`${rBase}/api/parties/${roomCode}`);
    assert.equal(getRestarted.status, 200);
    const restartedBody = await getRestarted.json();
    assert.equal(restartedBody.room.playbackState.sourceTime, 42);
    assert.equal(restartedBody.room.notes.length, 1);

    const postRestartHostPause = await fetch(`${rBase}/api/parties/${roomCode}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-host-token': newHostToken,
      },
      body: JSON.stringify({ command: 'pause', sourceTime: 45 }),
    });
    assert.equal(postRestartHostPause.status, 200);
    const pauseData = await postRestartHostPause.json();
    assert.equal(pauseData.playbackState.isPlaying, false);
    assert.equal(pauseData.playbackState.sourceTime, 45);
  } finally {
    await new Promise<void>((resolve) => restartedServer.close(() => resolve()));
  }
});

test('E2E HTTP: /api/media/stream and /api/media/inspect enforce SSRF blocks, parameter validation, and RFC 7233 ranges', async () => {
  const missingRes = await fetch(`${baseUrl}/api/media/stream`);
  assert.equal(missingRes.status, 400);

  const ssrfLocal = await fetch(`${baseUrl}/api/media/stream?url=${encodeURIComponent('http://127.0.0.1:80/secret.mp4')}`);
  assert.equal(ssrfLocal.status, 403);
  const ssrfLocalJson = await ssrfLocal.json();
  assert.equal(ssrfLocalJson.code, 'SSRF_BLOCKED');

  const ssrfImds = await fetch(`${baseUrl}/api/media/inspect?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`);
  assert.equal(ssrfImds.status, 403);
  const ssrfImdsJson = await ssrfImds.json();
  assert.equal(ssrfImdsJson.ok, false);

  const badRange = await fetch(`${baseUrl}/api/media/stream?url=${encodeURIComponent('https://example.com/video.mp4')}`, {
    headers: { Range: 'bytes=500-100' },
  });
  assert.equal(badRange.status, 416);
});

// =====================================================================
// PART 2: Synchronisation Calibration & Runtime Telemetry Benchmark Suite
// =====================================================================
test('Sync Calibration: piecewise anchors, pauses, seeks, buffering recovery, shorter reactions, 6-stream load, and provider switching', async (t) => {
  const controller = new SessionSyncController();

  // Scenario A: Multi-anchor intro + pause + skip + linear playback accuracy
  const complexAnchors: SyncAnchor[] = [
    { id: 'intro', sourceTime: 0, reactionTime: 14, type: 'intro', label: '14s intro' },
    { id: 'p1', sourceTime: 40, reactionTime: 54, type: 'pause', label: 'Pause start' },
    { id: 'p2', sourceTime: 40, reactionTime: 69, type: 'pause', label: '15s commentary pause' },
    { id: 'lin1', sourceTime: 100, reactionTime: 129, type: 'linear', label: 'Steady section' },
    { id: 'skip1', sourceTime: 120, reactionTime: 139, type: 'skip', label: 'Reactor trimmed 10s' },
  ];

  assert.equal(mapSourceToReaction(0, complexAnchors), 14);
  assert.equal(mapSourceToReaction(40, complexAnchors), 54);
  assert.equal(mapSourceToReaction(40.1, complexAnchors), 69.1);
  assert.equal(mapReactionToSource(60, complexAnchors), 40);
  assert.equal(mapSourceToReaction(110, complexAnchors), 134);

  // Scenario B: Simulated active playback with initial 1.2s desync + drift convergence
  const src = new CalibratedMockAdapter('source-player', { duration: 240 });
  const rxPrimary = new CalibratedMockAdapter('rx-1', { duration: 300 });
  rxPrimary.currentTime = 15.2; // 1.2s ahead of 14s intro offset -> forces immediate pre-align / drift correction

  controller.setActiveReaction('rx-1');
  controller.setReactionAnchors('rx-1', complexAnchors);
  controller.registerSourceAdapter(src);
  controller.registerReactionAdapter('rx-1', rxPrimary);

  await controller.play();
  assert.equal(controller.getState().isPlaying, true);

  let maxDriftSec = 0;
  let steadyDriftSec = 0;
  for (let tick = 0; tick < 80; tick++) {
    src.advance(0.1);
    rxPrimary.advance(0.1);
    controller.evaluateSyncCycle();
    const st = controller.getState();
    const absDrift = Math.abs(st.primaryMetrics.currentDrift);
    if (tick >= 5 && absDrift > maxDriftSec) maxDriftSec = absDrift;
    if (tick >= 30) steadyDriftSec = Math.max(steadyDriftSec, absDrift);
  }
  assert.ok(steadyDriftSec < 0.05, `Expected steady drift < 50ms, got ${(steadyDriftSec * 1000).toFixed(1)}ms`);

  // Scenario C: Seek forward (110s) and backward (10s) + pause/resume
  controller.seekToSourceTime(110);
  assert.equal(src.currentTime, 110);
  assert.equal(rxPrimary.currentTime, 134);
  controller.seekToSourceTime(10);
  assert.equal(src.currentTime, 10);
  assert.equal(rxPrimary.currentTime, 24);
  controller.pause();
  assert.equal(src.paused, true);
  assert.equal(rxPrimary.paused, true);

  // Scenario D: Buffering stall recovery (2.5s freeze -> stall -> rate resets 1.0 -> recovery)
  await controller.play();
  rxPrimary.buffering = true;
  rxPrimary.currentTime = rxPrimary.currentTime + 0.35; // gentle drift first to enter 'adjusting' state
  controller.evaluateSyncCycle();
  assert.equal(controller.getState().isBuffering, true);
  assert.equal(controller.getState().primaryMetrics.playbackRate, 1.0, 'Rate must reset to 1.0 when buffering');

  // Hold reaction paused while source advances 2.5s during stall
  for (let i = 0; i < 25; i++) {
    src.advance(0.1);
    controller.evaluateSyncCycle();
  }
  const hardSeeksBeforeRecovery = controller.getState().primaryMetrics.correctionCount;
  rxPrimary.buffering = false;
  controller.evaluateSyncCycle();
  const immediateRecoveryState = controller.getState();
  assert.ok(
    immediateRecoveryState.primaryMetrics.correctionCount > hardSeeksBeforeRecovery,
    'Hard seek correction should fire on buffering recovery when drift exceeds threshold'
  );
  // Evaluate one cycle after seek settles to measure post-recovery steady drift
  controller.evaluateSyncCycle();
  const postRecoveryState = controller.getState();
  const recoveryDriftMs = Math.abs(postRecoveryState.primaryMetrics.currentDrift) * 1000;
  assert.ok(
    recoveryDriftMs < 50,
    `Drift should return near 0ms immediately after recovery hard seek (got ${recoveryDriftMs.toFixed(1)}ms)`
  );

  // Scenario E: Shorter reaction duration clamping (no runaway hard-seek loop when reaction finishes early)
  const rxShort = new CalibratedMockAdapter('rx-short', { duration: 90 });
  controller.registerReactionAdapter('rx-short', rxShort);
  controller.setReactionAnchors('rx-short', [{ id: 's-intro', sourceTime: 0, reactionTime: 10, type: 'intro' }]);
  controller.setActiveReaction('rx-short');
  controller.seekToSourceTime(120); // target would be 130s, clamped to 90s duration
  assert.equal(rxShort.currentTime, 90, 'seekToSourceTime must clamp seek within shorter reaction duration');
  controller.evaluateSyncCycle();
  const initialCorrections = controller.getState().primaryMetrics.correctionCount;
  for (let i = 0; i < 20; i++) {
    src.advance(0.1);
    controller.evaluateSyncCycle();
  }
  const endShortState = controller.getState();
  assert.equal(endShortState.primaryMetrics.targetTime, 90, 'Shorter reaction target must clamp to 90s');
  assert.equal(endShortState.primaryMetrics.status, 'synced', 'Finished shorter reaction should report clamped synced state');
  assert.equal(
    endShortState.primaryMetrics.correctionCount,
    initialCorrections,
    'Must not trigger infinite hard-seek loop past shorter reaction end'
  );

  // Scenario F: 6-stream multi-reactor load (1 source + 5 reactions) + primary swap + audio focus ducking
  const rxIds = ['rx-1', 'rx-2', 'rx-3', 'rx-4', 'rx-5'];
  const adapters = rxIds.map((id, idx) => {
    const ad = new CalibratedMockAdapter(id, {
      duration: 300,
      provider: idx === 2 ? 'youtube' : 'native',
      supportsContinuousRate: idx === 2 ? false : true,
    });
    controller.registerReactionAdapter(id, ad);
    controller.setReactionAnchors(id, [{ id: `a-${id}`, sourceTime: 0, reactionTime: idx * 5, type: 'intro' }]);
    return ad;
  });

  t.diagnostic(
    `Measured Sync Telemetry -> maxDriftMs=${(maxDriftSec * 1000).toFixed(1)}, steadyDriftMs=${(
      steadyDriftSec * 1000
    ).toFixed(1)}, postBufferingRecoveryDriftMs=${recoveryDriftMs.toFixed(1)}, shortReactionExtraSeeks=${
      endShortState.primaryMetrics.correctionCount - initialCorrections
    }`
  );
  controller.setActiveReaction('rx-1');
  controller.seekToSourceTime(25);
  await controller.play();
  for (let i = 0; i < 15; i++) {
    src.advance(0.1);
    adapters.forEach((a) => a.advance(0.1));
    controller.evaluateSyncCycle();
  }
  // Verify audio focus & swapping active reaction preserves playback time & playing state
  controller.setAudioFocus('rx-3');
  assert.equal(src.volume, 0.25);
  assert.equal(adapters[2].muted, false);
  assert.equal(adapters[0].muted, true);

  const timeBeforeSwap = controller.getSourceTime();
  controller.setActiveReaction('rx-3');
  assert.equal(controller.getState().isPlaying, true);
  assert.ok(Math.abs(controller.getSourceTime() - timeBeforeSwap) < 0.05);

  // Scenario G: Mixed provider fallback — manual source (Drive preview) + auto reaction (Native)
  const manualController = new SessionSyncController();
  const manualSrc = new CalibratedMockAdapter('source-player', {
    provider: 'google_drive',
    syncCapability: 'manual_sync',
    canReadTime: false,
    canControlRate: false,
    duration: null,
  });
  const autoRx = new CalibratedMockAdapter('rx-auto', { duration: 200 });
  manualController.setActiveReaction('rx-auto');
  manualController.setReactionAnchors('rx-auto', [{ id: 'a1', sourceTime: 0, reactionTime: 15, type: 'intro' }]);
  manualController.registerSourceAdapter(manualSrc);
  manualController.registerReactionAdapter('rx-auto', autoRx);

  manualController.seekToSourceTime(10);
  await manualController.play();
  assert.equal(manualController.getState().isPlaying, true);
  assert.equal(manualController.getState().sessionCapability.capability, 'manual_sync');
  assert.equal(manualController.getState().sessionCapability.isAutomaticSyncAvailable, false);
  assert.equal(autoRx.currentTime, 25);

  controller.destroy();
  manualController.destroy();
});

test('Capability Enforcement: source buffering holds without seek loops, manual players receive zero commands, errors isolate cleanly, and audio focus respects capabilities', async () => {
  // 1. Source buffering stall must NOT cause runaway correction seek loops
  const bufController = new SessionSyncController();
  const src = new CalibratedMockAdapter('source-player', { duration: 300 });
  const rx = new CalibratedMockAdapter('rx-1', { duration: 300 });
  bufController.setActiveReaction('rx-1');
  bufController.setReactionAnchors('rx-1', [{ id: 'a1', sourceTime: 0, reactionTime: 10, type: 'intro' }]);
  bufController.registerSourceAdapter(src);
  bufController.registerReactionAdapter('rx-1', rx);

  await bufController.play();
  src.advance(5);
  rx.advance(5);
  bufController.evaluateSyncCycle();
  const seeksBeforeSourceStall = bufController.getState().primaryMetrics.correctionCount;

  // Source stalls/buffers for 3 seconds
  src.buffering = true;
  for (let i = 0; i < 30; i++) {
    rx.advance(0.1);
    bufController.evaluateSyncCycle();
  }
  assert.equal(bufController.getState().isBuffering, true);
  assert.equal(rx.paused, true, 'Controllable reaction should pause cleanly while source buffers');
  assert.equal(
    bufController.getState().primaryMetrics.correctionCount,
    seeksBeforeSourceStall,
    'Must not trigger correction seek loops while source is buffering'
  );

  // Source recovers -> reaction resumes cleanly in sync
  src.buffering = false;
  bufController.evaluateSyncCycle();
  assert.equal(rx.paused, false);
  assert.ok(Math.abs(rx.currentTime - (src.currentTime + 10)) < 0.6);

  // 2. Manual-only adapter must NEVER receive play/pause/seek/rate/volume commands
  const commandCalls: string[] = [];
  const strictManualRx: MediaPlayerAdapter = {
    id: 'rx-manual',
    provider: 'patreon',
    playbackMode: 'external',
    syncCapability: 'manual_sync',
    capabilities: MANUAL_ONLY_CAPABILITIES,
    getCurrentTime: () => null,
    getDuration: () => null,
    isPaused: () => null,
    isBuffering: () => false,
    getReadyState: () => 0,
    getError: () => null,
    getPlaybackRate: () => null,
    isMuted: () => null,
    getVolume: () => null,
    play: async () => {
      commandCalls.push('play');
      return false;
    },
    pause: () => {
      commandCalls.push('pause');
      return false;
    },
    seekTo: () => {
      commandCalls.push('seekTo');
      return false;
    },
    setPlaybackRate: () => {
      commandCalls.push('setPlaybackRate');
      return false;
    },
    setMuted: () => {
      commandCalls.push('setMuted');
      return false;
    },
    setVolume: () => {
      commandCalls.push('setVolume');
      return false;
    },
  };

  bufController.registerReactionAdapter('rx-manual', strictManualRx);
  bufController.setReactionAnchors('rx-manual', [{ id: 'am', sourceTime: 0, reactionTime: 20, type: 'intro' }]);
  bufController.seekToSourceTime(30);
  await bufController.play();
  bufController.stepReactionOffset('rx-manual', 0.2);
  bufController.setAudioFocus('rx-manual'); // audio focus targeting manual player must still duck source without touching manual controls
  for (let i = 0; i < 10; i++) {
    src.advance(0.1);
    rx.advance(0.1);
    bufController.evaluateSyncCycle();
  }
  bufController.pause();

  assert.deepEqual(commandCalls, [], 'Manual-sync adapter must never receive any playback or volume commands');
  assert.equal(src.volume, 0.25, 'Controllable source must duck cleanly when audio focus targets manual external reaction');
  const manualTarget = bufController.getState().manualTargetTimes['rx-manual'];
  assert.ok(manualTarget !== undefined && Math.abs(manualTarget - 51) < 1e-9, `Expected manual target ~51, got ${manualTarget}`);

  // 3. Extra reactor failure must NOT disrupt active healthy primary reaction
  const brokenExtra = new CalibratedMockAdapter('rx-broken', { duration: 200 });
  brokenExtra.error = { message: 'Network 403', code: 4 };
  bufController.registerReactionAdapter('rx-broken', brokenExtra);
  await bufController.play();
  src.advance(1);
  rx.advance(1);
  bufController.evaluateSyncCycle();

  const stAfterErr = bufController.getState();
  assert.equal(stAfterErr.hasPlayerErrors, true);
  assert.ok(stAfterErr.unhealthyPlayerIds.includes('rx-broken'));
  assert.equal(stAfterErr.extraReactorMetrics['rx-broken'].status, 'error');
  assert.notEqual(stAfterErr.primaryStatus, 'error', 'Primary healthy reaction must remain unaffected by extra reactor error');

  bufController.destroy();
});
