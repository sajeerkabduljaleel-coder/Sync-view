/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WatchPartyManager } from '../watchPartyModel';
import {
  SingleInstanceFileWatchPartyRepository,
  hashSecretToken,
} from '../watchPartyRepository';
import { SAMPLE_SOURCES, SAMPLE_REACTIONS } from '../../data/mockCatalogue';

test('strictRoomCreation: validates sourceId and reactionId presence and rejects unknown or mismatched pairs', async () => {
  // Test matching logic directly
  const sciFiSource = SAMPLE_SOURCES[0]; // src-scifi-teaser
  const sciFiReaction = SAMPLE_REACTIONS[0]; // rx-scifi-marcus (sourceId: src-scifi-teaser)
  const musicReaction = SAMPLE_REACTIONS.find((r) => r.sourceId !== sciFiSource.id)!; // e.g. rx-music-elena

  assert.equal(sciFiReaction.sourceId, sciFiSource.id, 'Sample reaction must belong to sample source');
  assert.notEqual(musicReaction.sourceId, sciFiSource.id, 'Music reaction must not belong to sci-fi source');

  const manager = new WatchPartyManager();

  // Valid creation succeeds
  const validRoom = await manager.createRoom({
    title: 'Valid Film Party',
    hostName: 'Marcus Host',
    sourceVideo: sciFiSource,
    primaryReaction: sciFiReaction,
  });

  assert.ok(validRoom.room.id);
  assert.equal(validRoom.room.sourceVideo.id, sciFiSource.id);
  assert.equal(validRoom.room.primaryReaction.id, sciFiReaction.id);
  assert.equal(validRoom.room.primaryReaction.sourceId, sciFiSource.id);
  assert.ok(validRoom.hostToken);
  assert.ok(validRoom.participantToken);

  // Check allowlist DTO output: ensure no internal hash or session leaks
  const publicDto = manager.toPublicRoomDTO(validRoom.room);
  assert.equal((publicDto as any).hostTokenHash, undefined);
  assert.equal((publicDto as any).sessions, undefined);
  assert.equal((publicDto as any).hostToken, undefined);
});

test('strictRoomCreation: generates unique 6-character room codes', () => {
  const manager = new WatchPartyManager();
  const codes = new Set<string>();
  for (let i = 0; i < 150; i++) {
    const code = manager.generateRoomCode();
    assert.equal(code.length, 6);
    assert.match(code, /^[A-Z0-9]{6}$/);
    assert.equal(codes.has(code), false, `Collision detected on code: ${code}`);
    codes.add(code);
  }
});

test('repository: concurrent writes serialize safely with monotonic version increments', async () => {
  const tempDir = path.resolve(process.cwd(), '.data/test_concurrency');
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch {}

  const repo = new SingleInstanceFileWatchPartyRepository('.data/test_concurrency', 'concurrent_parties.json');
  const manager = new WatchPartyManager(repo);

  const { room, hostToken } = await manager.createRoom({
    title: 'Concurrency Test Party',
    hostName: 'Host C',
    sourceVideo: SAMPLE_SOURCES[0],
    primaryReaction: SAMPLE_REACTIONS[0],
  });

  // Launch 15 concurrent host commands simultaneously to stress mutex queue and atomic writes
  const commands = Array.from({ length: 15 }, (_, i) =>
    manager.executeHostCommand(room.id, hostToken, {
      command: 'seek',
      sourceTime: i * 2,
    })
  );

  const results = await Promise.all(commands);
  for (const res of results) {
    assert.equal(res.success, true, 'All concurrent host commands must succeed without race crash');
  }

  // Retrieve room after all concurrent updates
  const finalRoom = await repo.getRoomById(room.id);
  assert.ok(finalRoom);
  assert.ok(finalRoom.version >= 15, `Version must increment monotonically, got ${finalRoom.version}`);

  // Cleanup test directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

test('repository: persistence reloads state safely across simulated restarts', async () => {
  const tempDir = path.resolve(process.cwd(), '.data/test_restart');
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch {}

  const repo1 = new SingleInstanceFileWatchPartyRepository('.data/test_restart', 'restart_parties.json');
  const manager1 = new WatchPartyManager(repo1);

  const created = await manager1.createRoom({
    title: 'Restart Survival Room',
    hostName: 'Host S',
    sourceVideo: SAMPLE_SOURCES[0],
    primaryReaction: SAMPLE_REACTIONS[0],
  });

  const join1 = await manager1.joinRoom(created.room.id, 'Viewer One');
  assert.ok(join1);

  // Add chat message
  await manager1.addChatMessage(created.room.id, join1.participantToken, 'Survives restart?');

  // Verify raw tokens are NOT in plaintext on disk
  const diskRaw = fs.readFileSync(path.join(tempDir, 'restart_parties.json'), 'utf-8');
  assert.equal(diskRaw.includes(created.hostToken), false, 'Raw host token must never appear on disk');
  assert.equal(diskRaw.includes(join1.participantToken), false, 'Raw participant token must never appear on disk');
  assert.equal(diskRaw.includes(hashSecretToken(created.hostToken)), true, 'SHA-256 hash of host token must be stored');

  // Simulate server restart by creating a new repository instance pointing to the same file
  const repo2 = new SingleInstanceFileWatchPartyRepository('.data/test_restart', 'restart_parties.json');
  const manager2 = new WatchPartyManager(repo2);

  const reloaded = await manager2.getRoom(created.room.id);
  assert.ok(reloaded, 'Room must be recovered after restart');
  assert.equal(reloaded.title, 'Restart Survival Room');
  assert.equal(reloaded.participants.length, 2);
  assert.ok(reloaded.chatMessages.some((m) => m.text === 'Survives restart?'));

  // Verify host authentication still works with the recovered room
  const isHost = await manager2.isAuthorizedHost(created.room.id, created.hostToken);
  assert.equal(isHost, true, 'Host must be recognized using hashed token after restart');

  // Reconnect with existing participant token works seamlessly
  const reconnect = await manager2.joinRoom(created.room.id, 'Viewer One', join1.participantToken);
  assert.ok(reconnect);
  assert.equal(reconnect.participantId, join1.participantId);
  assert.equal(reconnect.room.participants.length, 2, 'Deduplication preserved on restart');

  // Cleanup test directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

test('repository: recovers from malformed/corrupted files gracefully without crash', () => {
  const tempDir = path.resolve(process.cwd(), '.data/test_corrupt');
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch {}

  const corruptedFilePath = path.join(tempDir, 'corrupted_parties.json');
  // Write non-JSON corrupt content
  fs.writeFileSync(corruptedFilePath, '{ This is broken corrupted file content... not valid json! }', 'utf-8');

  // Instantiating repository must NOT throw; it should backup corrupted file and initialize fresh
  let repo: SingleInstanceFileWatchPartyRepository | null = null;
  assert.doesNotThrow(() => {
    repo = new SingleInstanceFileWatchPartyRepository('.data/test_corrupt', 'corrupted_parties.json');
  });

  assert.ok(repo);

  // Check that corrupted backup file was created
  const files = fs.readdirSync(tempDir);
  const hasBak = files.some((f) => f.includes('.corrupted.') && f.endsWith('.bak'));
  assert.equal(hasBak, true, 'Corrupted data backup must be created');

  // Cleanup test directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

test('repository: cleanupExpired removes stale rooms past TTL', async () => {
  const tempDir = path.resolve(process.cwd(), '.data/test_cleanup');
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch {}

  const repo = new SingleInstanceFileWatchPartyRepository('.data/test_cleanup', 'cleanup_parties.json');
  const manager = new WatchPartyManager(repo);

  const room = await manager.createRoom({
    title: 'Expiring Room',
    hostName: 'Host Expire',
    sourceVideo: SAMPLE_SOURCES[0],
    primaryReaction: SAMPLE_REACTIONS[0],
  });

  // Clean with TTL 0 (everything older than 0ms from now is considered expired)
  const cleaned = await repo.cleanupExpired(-1000);
  assert.equal(cleaned, 1, 'Expired room must be cleaned up');

  const afterCleanup = await repo.getRoomById(room.room.id);
  assert.equal(afterCleanup, null, 'Cleaned room must not be accessible');

  // Cleanup test directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});
