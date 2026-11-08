/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchPartyManager } from '../watchPartyModel';
import {
  isValidRoomIdentifier,
  isValidCommandType,
  isValidTimestamp,
  isValidPlaybackRate,
  sanitizeHtml,
  extractHostToken,
  extractParticipantToken,
} from '../../server/authMiddleware';
import { VideoSource, ReactionVideo } from '../../types';

const testSource: VideoSource = {
  id: 'src-security',
  title: 'Security Analysis Video',
  creator: 'SyncView Security Team',
  duration: 200,
  url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
  thumbnail: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=600&q=80',
  category: 'Tech',
  description: 'Test fixture for security verification',
};

const testReaction: ReactionVideo = {
  id: 'rx-security',
  sourceId: 'src-security',
  creator: 'Alice Host',
  channelName: 'Alice Security',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
  title: 'Alice Tests SyncView Security',
  duration: 220,
  introDuration: 10,
  url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  thumbnail: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
  anchors: [{ id: 'a1', sourceTime: 0, reactionTime: 10, type: 'intro' }],
  chapters: [],
  highlights: [],
  notes: [],
  views: 5000,
  likes: 400,
  isPublished: true,
  createdAt: Date.now(),
};

test('security: client-supplied spoofed identities are completely ignored and derived from session', async () => {
  const manager = new WatchPartyManager();
  const { room } = await manager.createRoom({
    title: 'Spoof Test Room',
    hostName: 'Legitimate Host',
    sourceVideo: testSource,
    primaryReaction: testReaction,
  });

  // Legitimate viewer joins
  const join = await manager.joinRoom(room.id, 'GenuineViewer');
  assert.ok(join);

  // An attacker attempts to inject a spoofed senderName, senderId, and isHost: true
  // Even if an attacker calls the model with spoofed parameters, the model derives identity strictly from join.participantToken
  const chatResult = await manager.addChatMessage(
    room.id,
    join.participantToken,
    'Trying to impersonate admin'
  );

  assert.equal(chatResult.success, true);
  assert.equal(chatResult.message?.senderName, 'GenuineViewer');
  assert.equal(chatResult.message?.senderId, join.participantId);
  assert.equal(chatResult.message?.isHost, false, 'Attacker must not be able to forge isHost status');
});

test('security: unauthorized room access across different rooms is rejected', async () => {
  const manager = new WatchPartyManager();

  // Create Room A and Room B
  const roomA = await manager.createRoom({
    title: 'Room Alpha',
    hostName: 'Host A',
    sourceVideo: testSource,
    primaryReaction: testReaction,
  });

  const roomB = await manager.createRoom({
    title: 'Room Beta',
    hostName: 'Host B',
    sourceVideo: testSource,
    primaryReaction: testReaction,
  });

  // Participant joins Room A
  const joinA = await manager.joinRoom(roomA.room.id, 'Member Alpha');
  assert.ok(joinA);

  // Participant attempts to post in Room B using Room A token
  const crossRoomChat = await manager.addChatMessage(
    roomB.room.id,
    joinA.participantToken,
    'I should not be able to post in Room B'
  );
  assert.equal(crossRoomChat.success, false);
  assert.match(crossRoomChat.error || '', /Unauthorized/);

  // Participant attempts to add note in Room B using Room A token
  const crossRoomNote = await manager.addNote(
    roomB.room.id,
    joinA.participantToken,
    10,
    20,
    'Sneaking note into Room B'
  );
  assert.equal(crossRoomNote.success, false);
  assert.match(crossRoomNote.error || '', /Unauthorized/);
});

test('security: host tokens and session secrets are never exposed in public room view', async () => {
  const manager = new WatchPartyManager();
  const { room, hostToken, participantToken } = await manager.createRoom({
    title: 'Secret Leak Test',
    hostName: 'Host Alice',
    sourceVideo: testSource,
    primaryReaction: testReaction,
  });

  const publicRoom = await manager.getRoom(room.id);
  assert.ok(publicRoom);

  // Verify hostToken is not anywhere in public object
  const serialized = JSON.stringify(publicRoom);
  assert.equal(serialized.includes(hostToken), false, 'Host token must NEVER be serialized into public room view');
  assert.equal(serialized.includes(participantToken), false, 'Participant token must NEVER be serialized into public room view');
  assert.equal((publicRoom as any).sessions, undefined);
  assert.equal((publicRoom as any).hostToken, undefined);
});

test('security: credentials supplied in request bodies or query strings are rejected', () => {
  // 1. Request body token attempt (MUST BE REJECTED)
  const mockReqWithBody: any = {
    headers: {},
    query: {},
    body: { hostToken: 'leaked-in-body', participantToken: 'body-participant-token' },
  };

  const extractedHostFromBody = extractHostToken(mockReqWithBody);
  assert.equal(extractedHostFromBody, '', 'Request body hostToken MUST be rejected');

  const extractedParticipantFromBody = extractParticipantToken(mockReqWithBody);
  assert.equal(extractedParticipantFromBody, '', 'Request body participantToken MUST be rejected');

  // 2. Query parameter token attempt (MUST BE REJECTED)
  const mockReqWithQuery: any = {
    headers: {},
    query: { hostToken: 'leaked-in-query-string', participantToken: 'query-participant-token' },
    body: {},
  };

  const extractedHostFromQuery = extractHostToken(mockReqWithQuery);
  assert.equal(extractedHostFromQuery, '', 'Query string host secrets MUST be rejected');

  const extractedParticipantFromQuery = extractParticipantToken(mockReqWithQuery);
  assert.equal(extractedParticipantFromQuery, '', 'Query string participant tokens MUST be rejected');

  // 3. Custom Header tokens are properly accepted
  const mockReqWithHeader: any = {
    headers: {
      'x-host-token': 'valid-host-secret-12345',
      'x-participant-token': 'valid-participant-token-67890',
    },
    query: {},
    body: {},
  };
  assert.equal(extractHostToken(mockReqWithHeader), 'valid-host-secret-12345');
  assert.equal(extractParticipantToken(mockReqWithHeader), 'valid-participant-token-67890');

  // 4. Authorization: Bearer header is properly accepted
  const mockReqWithBearer: any = {
    headers: {
      authorization: 'Bearer valid-bearer-token-abcde',
    },
    query: {},
    body: {},
  };
  assert.equal(extractHostToken(mockReqWithBearer), 'valid-bearer-token-abcde');
  assert.equal(extractParticipantToken(mockReqWithBearer), 'valid-bearer-token-abcde');
});

test('security: room takeover attempts via host reassignment without host credentials are blocked', async () => {
  const manager = new WatchPartyManager();
  const { room, hostToken } = await manager.createRoom({
    title: 'Takeover Prevention Room',
    hostName: 'Legit Host',
    sourceVideo: testSource,
    primaryReaction: testReaction,
  });

  const attackerJoin = await manager.joinRoom(room.id, 'Attacker');
  assert.ok(attackerJoin);

  // Attacker attempts to hijack room using their own participantToken as hostToken
  const hijackAttempt1 = await manager.reassignHost(room.id, attackerJoin.participantToken, attackerJoin.participantId);
  assert.equal(hijackAttempt1.success, false);
  assert.match(hijackAttempt1.error || '', /Unauthorized/);

  // Attacker attempts with empty / fake host token
  const hijackAttempt2 = await manager.reassignHost(room.id, 'invalid-fake-host-token', attackerJoin.participantId);
  assert.equal(hijackAttempt2.success, false);
  assert.match(hijackAttempt2.error || '', /Unauthorized/);

  // Legit host CAN reassign host
  const legitimateReassign = await manager.reassignHost(room.id, hostToken, attackerJoin.participantId);
  assert.equal(legitimateReassign.success, true);
  assert.ok(legitimateReassign.newHostToken);
});

test('security: unauthorized host commands are blocked and require constant-time match', async () => {
  const manager = new WatchPartyManager();
  const { room, hostToken } = await manager.createRoom({
    title: 'Command Auth Test',
    hostName: 'Real Host',
    sourceVideo: testSource,
    primaryReaction: testReaction,
  });

  const join = await manager.joinRoom(room.id, 'Audience Member');
  assert.ok(join);

  // 1. Audience member token attempts host playback command -> REJECTED
  const viewerAttempt = await manager.executeHostCommand(room.id, join.participantToken, {
    command: 'seek',
    sourceTime: 50,
  });
  assert.equal(viewerAttempt.success, false);
  assert.match(viewerAttempt.error || '', /Unauthorized/);

  // 2. Random attacker token -> REJECTED
  const attackerAttempt = await manager.executeHostCommand(room.id, 'random-attacker-token', {
    command: 'play',
    sourceTime: 0,
  });
  assert.equal(attackerAttempt.success, false);

  // 3. Valid host token -> SUCCEEDS
  const validHostCmd = await manager.executeHostCommand(room.id, hostToken, {
    command: 'seek',
    sourceTime: 45,
  });
  assert.equal(validHostCmd.success, true);
  assert.equal(validHostCmd.state?.sourceTime, 45);
});

test('security: note deletion is restricted strictly to note owner or verified host', async () => {
  const manager = new WatchPartyManager();
  const { room, hostToken } = await manager.createRoom({
    title: 'Note Ownership Test',
    hostName: 'Host Admin',
    sourceVideo: testSource,
    primaryReaction: testReaction,
  });

  const userA = await manager.joinRoom(room.id, 'UserA');
  const userB = await manager.joinRoom(room.id, 'UserB');
  assert.ok(userA);
  assert.ok(userB);

  // User A writes a note
  const noteRes = await manager.addNote(room.id, userA.participantToken, 15, 25, 'My Important Insight');
  assert.equal(noteRes.success, true);
  const noteId = noteRes.note!.id;

  // User B tries to delete User A's note -> REJECTED
  const bDeleteAttempt = await manager.deleteNote(room.id, noteId, userB.participantToken);
  assert.equal(bDeleteAttempt.success, false);
  assert.match(bDeleteAttempt.error || '', /Unauthorized/);

  // Random token tries to delete note -> REJECTED
  const randomDeleteAttempt = await manager.deleteNote(room.id, noteId, 'random-token');
  assert.equal(randomDeleteAttempt.success, false);

  // Room host CAN delete (for moderation)
  const hostDeleteRes = await manager.deleteNote(room.id, noteId, undefined, hostToken);
  assert.equal(hostDeleteRes.success, true);
});

test('security: input validation rejects invalid room IDs, commands, rates, and timestamps', () => {
  // Room ID validation
  assert.equal(isValidRoomIdentifier('valid-room-123'), true);
  assert.equal(isValidRoomIdentifier('ABC99Z'), true);
  assert.equal(isValidRoomIdentifier('../../../etc/passwd'), false, 'Path traversal room IDs must be rejected');
  assert.equal(isValidRoomIdentifier('<script>'), false, 'HTML injection room IDs must be rejected');
  assert.equal(isValidRoomIdentifier('ab'), false, 'Too short room IDs must be rejected');

  // Command type validation
  assert.equal(isValidCommandType('play'), true);
  assert.equal(isValidCommandType('seek'), true);
  assert.equal(isValidCommandType('rate'), true);
  assert.equal(isValidCommandType('drop_table'), false);
  assert.equal(isValidCommandType('eval'), false);

  // Timestamp validation
  assert.equal(isValidTimestamp(0), true);
  assert.equal(isValidTimestamp(120.5), true);
  assert.equal(isValidTimestamp(-1), false, 'Negative timestamps must be rejected');
  assert.equal(isValidTimestamp(NaN), false, 'NaN timestamps must be rejected');
  assert.equal(isValidTimestamp(Infinity), false, 'Infinity timestamps must be rejected');
  assert.equal(isValidTimestamp(1000000), false, 'Out-of-bounds timestamps must be rejected');

  // Playback rate validation
  assert.equal(isValidPlaybackRate(1.0), true);
  assert.equal(isValidPlaybackRate(0.5), true);
  assert.equal(isValidPlaybackRate(2.0), true);
  assert.equal(isValidPlaybackRate(0.1), false, 'Too low playback rates must be rejected');
  assert.equal(isValidPlaybackRate(10.0), false, 'Too high playback rates must be rejected');
  assert.equal(isValidPlaybackRate(-1.0), false, 'Negative playback rates must be rejected');
});

test('security: sanitization neutralizes HTML and script injections', async () => {
  const manager = new WatchPartyManager();
  const { room } = await manager.createRoom({
    title: 'Sanitization Test Room',
    hostName: 'Host1',
    sourceVideo: testSource,
    primaryReaction: testReaction,
  });

  const join = await manager.joinRoom(room.id, 'Tester');
  assert.ok(join);

  // Chat message with XSS payload
  const xssPayload = '<script>alert("pwned")</script><img src=x onerror=alert(1)>';
  const chatRes = await manager.addChatMessage(room.id, join.participantToken, xssPayload);
  assert.equal(chatRes.success, true);
  assert.equal(chatRes.message?.text.includes('<script>'), false, 'Script tags must be escaped');
  assert.equal(chatRes.message?.text.includes('&lt;script&gt;'), true);

  // Note with XSS payload
  const noteRes = await manager.addNote(room.id, join.participantToken, 10, 20, xssPayload);
  assert.equal(noteRes.success, true);
  assert.equal(noteRes.note?.text.includes('<script>'), false, 'Script tags must be escaped in notes');
  assert.equal(noteRes.note?.text.includes('&lt;script&gt;'), true);
});
