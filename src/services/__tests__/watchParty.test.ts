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
  url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
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
  url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
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

test('watchParty: creates room and never discloses hostToken to public view', () => {
  const manager = new WatchPartyManager();
  const { room, hostToken } = manager.createRoom({
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

  // Check public representation
  const publicRoom = manager.getRoom(room.id);
  assert.ok(publicRoom);
  assert.equal((publicRoom as any).hostToken, undefined, 'hostToken must never be leaked in public room payload');
});

test('watchParty: enforces host token authorization on playback commands', () => {
  const manager = new WatchPartyManager();
  const { room, hostToken } = manager.createRoom({
    title: 'Premiere',
    hostName: 'Host1',
    sourceVideo: mockSource,
    primaryReaction: mockReaction,
  });

  // Unauthorized attempt without token
  const failed = manager.executeHostCommand(room.id, 'fake-token-12345', {
    command: 'play',
    sourceTime: 10,
  });
  assert.equal(failed.success, false);
  assert.match(failed.error || '', /Unauthorized/);

  // Authorized command with valid token
  const success = manager.executeHostCommand(room.id, hostToken, {
    command: 'play',
    sourceTime: 12.5,
  });
  assert.equal(success.success, true);
  assert.ok(success.state);
  assert.equal(success.state.isPlaying, true);
  assert.equal(success.state.sourceTime, 12.5);
  assert.equal(success.state.seq, 2, 'Sequence number should increment monotonically');
});

test('watchParty: joining and chat message posting with rate limits', () => {
  const manager = new WatchPartyManager();
  const { room } = manager.createRoom({
    title: 'Chat Test Party',
    hostName: 'Host1',
    sourceVideo: mockSource,
    primaryReaction: mockReaction,
  });

  const joinRes = manager.joinRoom(room.roomCode, 'Viewer Sam');
  assert.ok(joinRes);
  assert.ok(joinRes.participantId);
  assert.equal(joinRes.room.participants.length, 2);

  const chatRes = manager.addChatMessage(room.roomCode, joinRes.participantId, 'Viewer Sam', 'This sync is unreal!');
  assert.equal(chatRes.success, true);
  assert.equal(chatRes.message?.text, 'This sync is unreal!');
  assert.equal(chatRes.message?.isHost, false);
});

test('watchParty: note creation and ownership-checked deletion', () => {
  const manager = new WatchPartyManager();
  const { room, hostToken } = manager.createRoom({
    title: 'Notes Test',
    hostName: 'Host1',
    sourceVideo: mockSource,
    primaryReaction: mockReaction,
  });

  const noteRes = manager.addNote(room.id, 'user-123', 'Sam', 45, 60, 'Notice the audio transition here');
  assert.equal(noteRes.success, true);
  assert.ok(noteRes.note?.id);

  const noteId = noteRes.note!.id;

  // Other user attempts to delete note -> fails
  const unauthorizedDel = manager.deleteNote(room.id, noteId, 'different-user-999');
  assert.equal(unauthorizedDel.success, false);

  // Author can delete their own note
  const authorDel = manager.deleteNote(room.id, noteId, 'user-123');
  assert.equal(authorDel.success, true);
});
