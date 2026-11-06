/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchPartyManager } from '../watchPartyModel';
import { VideoSource, ReactionVideo } from '../../types';

const mockSource: VideoSource = {
  id: 'source-1',
  title: 'Cyberpunk Odyssey',
  creator: 'Neon Studio',
  duration: 300,
  url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
  thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
  category: 'Gaming',
  description: 'Futuristic teaser',
};

const mockReaction: ReactionVideo = {
  id: 'rx-1',
  sourceId: 'source-1',
  creator: 'Alex Rivers',
  channelName: 'Alex Reacts',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
  title: 'Alex Reacts to Cyberpunk Odyssey',
  duration: 340,
  introDuration: 15,
  url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  thumbnail: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
  anchors: [{ id: 'a1', sourceTime: 0, reactionTime: 15, type: 'intro' }],
  chapters: [],
  highlights: [],
  notes: [],
  views: 12000,
  likes: 980,
  isPublished: true,
  createdAt: Date.now(),
};

test('watchParty: creates room, generates tokens, and never discloses hostToken to public view', async () => {
  const manager = new WatchPartyManager();
  const { room, hostToken, participantToken } = await manager.createRoom({
    title: 'Neon Premiere Party',
    hostName: 'Captain Alex',
    sourceVideo: mockSource,
    primaryReaction: mockReaction,
  });

  assert.ok(room.id);
  assert.equal(room.roomCode.length, 6);
  assert.ok(hostToken);
  assert.equal(typeof hostToken, 'string');
  assert.ok(hostToken.length >= 32);
  assert.ok(participantToken);
  assert.equal(typeof participantToken, 'string');

  // Verify public representation does not leak tokens
  const publicRoom = await manager.getRoom(room.id);
  assert.ok(publicRoom);
  assert.equal((publicRoom as any).hostToken, undefined, 'hostToken must never be leaked in public room payload');
  assert.equal((publicRoom as any).sessions, undefined, 'sessions must never be leaked in public room payload');
});

test('watchParty: enforces host token authorization on playback commands', async () => {
  const manager = new WatchPartyManager();
  const { room, hostToken } = await manager.createRoom({
    title: 'Premiere',
    hostName: 'Host1',
    sourceVideo: mockSource,
    primaryReaction: mockReaction,
  });

  // Unauthorized attempt without valid token
  const failed = await manager.executeHostCommand(room.id, 'fake-token-12345', {
    command: 'play',
    sourceTime: 10,
  });
  assert.equal(failed.success, false);
  assert.match(failed.error || '', /Unauthorized/);

  // Authorized command with valid hostToken
  const success = await manager.executeHostCommand(room.id, hostToken, {
    command: 'play',
    sourceTime: 12.5,
  });
  assert.equal(success.success, true);
  assert.ok(success.state);
  assert.equal(success.state.isPlaying, true);
  assert.equal(success.state.sourceTime, 12.5);
  assert.equal(success.state.seq, 2, 'Sequence number should increment monotonically');
});

test('watchParty: joining, reconnect deduplication, and server-verified chat identity', async () => {
  const manager = new WatchPartyManager();
  const { room } = await manager.createRoom({
    title: 'Chat Test Party',
    hostName: 'Host1',
    sourceVideo: mockSource,
    primaryReaction: mockReaction,
  });

  // Join room as viewer
  const joinRes = await manager.joinRoom(room.roomCode, 'Viewer Sam');
  assert.ok(joinRes);
  assert.ok(joinRes.participantId);
  assert.ok(joinRes.participantToken);
  assert.equal(joinRes.room.participants.length, 2);

  // Reconnection with existing token does not duplicate participant
  const reconnectRes = await manager.joinRoom(room.roomCode, 'Viewer Sam', joinRes.participantToken);
  assert.ok(reconnectRes);
  assert.equal(reconnectRes.participantId, joinRes.participantId);
  assert.equal(reconnectRes.room.participants.length, 2, 'Participant count must remain 2 after reconnection');

  // Attempt chat without valid participant token -> REJECTED
  const unauthChat = await manager.addChatMessage(room.roomCode, 'invalid-token', 'Spoofed message');
  assert.equal(unauthChat.success, false);
  assert.match(unauthChat.error || '', /Unauthorized/);

  // Valid chat with participant token -> Sender identity derived strictly from session
  const chatRes = await manager.addChatMessage(room.roomCode, joinRes.participantToken, 'This sync is unreal!');
  assert.equal(chatRes.success, true);
  assert.equal(chatRes.message?.text, 'This sync is unreal!');
  assert.equal(chatRes.message?.senderName, 'Viewer Sam');
  assert.equal(chatRes.message?.senderId, joinRes.participantId);
  assert.equal(chatRes.message?.isHost, false);
});

test('watchParty: rate limits chat spamming', async () => {
  const manager = new WatchPartyManager();
  const { room } = await manager.createRoom({
    title: 'Rate Limit Party',
    hostName: 'Host1',
    sourceVideo: mockSource,
    primaryReaction: mockReaction,
  });

  const join = await manager.joinRoom(room.id, 'Spammy');
  assert.ok(join);

  // First message ok
  const msg1 = await manager.addChatMessage(room.id, join.participantToken, 'Hello 1');
  assert.equal(msg1.success, true);

  // Immediate second message (within 250ms) -> rate limited
  const msg2 = await manager.addChatMessage(room.id, join.participantToken, 'Hello 2');
  assert.equal(msg2.success, false);
  assert.match(msg2.error || '', /too quickly/);
});

test('watchParty: note creation and ownership-checked deletion', async () => {
  const manager = new WatchPartyManager();
  const { room, hostToken, participantToken: hostParticipantToken } = await manager.createRoom({
    title: 'Notes Test',
    hostName: 'Host1',
    sourceVideo: mockSource,
    primaryReaction: mockReaction,
  });

  const viewerJoin = await manager.joinRoom(room.id, 'NoteTaker');
  assert.ok(viewerJoin);

  // Add note using viewer's session token
  const noteRes = await manager.addNote(
    room.id,
    viewerJoin.participantToken,
    45,
    60,
    'Notice the audio transition here'
  );
  assert.equal(noteRes.success, true);
  assert.ok(noteRes.note?.id);
  assert.equal(noteRes.note?.userName, 'NoteTaker');
  assert.equal(noteRes.note?.userId, viewerJoin.participantId);

  const noteId = noteRes.note!.id;

  // Another participant tries to delete note -> REJECTED
  const viewer2Join = await manager.joinRoom(room.id, 'OtherViewer');
  assert.ok(viewer2Join);

  const unauthorizedDel = await manager.deleteNote(room.id, noteId, viewer2Join.participantToken);
  assert.equal(unauthorizedDel.success, false);
  assert.match(unauthorizedDel.error || '', /Unauthorized/);

  // Host CAN delete note for moderation
  const hostDel = await manager.deleteNote(room.id, noteId, undefined, hostToken);
  assert.equal(hostDel.success, true);
});

test('watchParty: host reassignment transfers command authorization', async () => {
  const manager = new WatchPartyManager();
  const { room, hostToken } = await manager.createRoom({
    title: 'Reassignment Test',
    hostName: 'OriginalHost',
    sourceVideo: mockSource,
    primaryReaction: mockReaction,
  });

  const newHostJoin = await manager.joinRoom(room.id, 'NewHostCandidate');
  assert.ok(newHostJoin);

  // Reassign host
  const reassignRes = await manager.reassignHost(room.id, hostToken, newHostJoin.participantId);
  assert.equal(reassignRes.success, true);
  assert.ok(reassignRes.newHostToken);

  // Old host token is now invalid
  const oldCmd = await manager.executeHostCommand(room.id, hostToken, { command: 'pause', sourceTime: 5 });
  assert.equal(oldCmd.success, false);

  // New host token works
  const newCmd = await manager.executeHostCommand(room.id, reassignRes.newHostToken!, {
    command: 'pause',
    sourceTime: 5,
  });
  assert.equal(newCmd.success, true);
});
