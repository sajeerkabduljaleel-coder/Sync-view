/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionSyncController } from '../SessionSyncController';
import { SyncAnchor } from '../../types';

// Mock minimal HTMLVideoElement for Node test environment
class MockVideoElement {
  public currentTime = 0;
  public duration = 180;
  public paused = true;
  public playbackRate = 1.0;
  public muted = false;
  public volume = 1.0;
  public readyState = 4; // HAVE_ENOUGH_DATA

  async play() {
    this.paused = false;
  }

  pause() {
    this.paused = true;
  }
}

test('theatreSync: SessionSyncController initializes with authoritative state', () => {
  const controller = new SessionSyncController();
  const state = controller.getState();

  assert.equal(state.isPlaying, false);
  assert.equal(state.sourceTime, 0);
  assert.equal(state.layout, 'side-by-side');
  assert.equal(state.isDuckingEnabled, true);

  controller.destroy();
});

test('theatreSync: maps complex timelines with intro and pauses across multiple reactors', () => {
  const controller = new SessionSyncController();

  const primaryAnchors: SyncAnchor[] = [
    { id: 'a1', sourceTime: 0, reactionTime: 20, type: 'intro' }, // 20s intro
    { id: 'a2', sourceTime: 60, reactionTime: 80, type: 'linear' },
    { id: 'a3', sourceTime: 60, reactionTime: 110, type: 'pause' }, // 30s reactor pause/break
    { id: 'a4', sourceTime: 120, reactionTime: 170, type: 'linear' },
  ];

  controller.setActiveReaction('rx-primary');
  controller.setReactionAnchors('rx-primary', primaryAnchors);

  const mockSource = new MockVideoElement() as unknown as HTMLVideoElement;
  const mockPrimary = new MockVideoElement() as unknown as HTMLVideoElement;

  controller.registerSourceElement(mockSource);
  controller.registerReactionElement('rx-primary', mockPrimary);

  // Seek to 0 in source -> Reaction should seek to intro anchor (20s)
  controller.seekToSourceTime(0);
  assert.equal(mockSource.currentTime, 0);
  assert.equal(mockPrimary.currentTime, 20);

  // Seek to 60 in source -> Reaction should seek to 80s (pre-pause anchor)
  controller.seekToSourceTime(60);
  assert.equal(mockSource.currentTime, 60);
  assert.equal(mockPrimary.currentTime, 80);

  // Seek to 120 in source -> Reaction should seek to 170s
  controller.seekToSourceTime(120);
  assert.equal(mockSource.currentTime, 120);
  assert.equal(mockPrimary.currentTime, 170);

  controller.destroy();
});

test('theatreSync: supports up to 6 players simultaneously with independent mapping', () => {
  const controller = new SessionSyncController();
  const mockSource = new MockVideoElement() as unknown as HTMLVideoElement;
  controller.registerSourceElement(mockSource);

  controller.setActiveReaction('rx-1');

  // Register primary and 4 additional reactors (5 reactors + 1 source = 6 players)
  const reactorElements: MockVideoElement[] = [];
  for (let i = 1; i <= 5; i++) {
    const rxEl = new MockVideoElement();
    reactorElements.push(rxEl);
    controller.registerReactionElement(`rx-${i}`, rxEl as unknown as HTMLVideoElement);

    // Each reactor has a unique intro offset: 10s, 15s, 20s, 25s, 30s
    controller.setReactionAnchors(`rx-${i}`, [
      { id: `anchor-${i}`, sourceTime: 0, reactionTime: i * 5 + 5, type: 'intro' },
    ]);
  }

  // Seek source to 10s
  controller.seekToSourceTime(10);
  assert.equal(mockSource.currentTime, 10);

  // Each reactor should be accurately aligned to its own timeline offset
  assert.equal(reactorElements[0].currentTime, 20); // 10s source + 10s intro
  assert.equal(reactorElements[1].currentTime, 25); // 10s source + 15s intro
  assert.equal(reactorElements[2].currentTime, 30); // 10s source + 20s intro
  assert.equal(reactorElements[3].currentTime, 35); // 10s source + 25s intro
  assert.equal(reactorElements[4].currentTime, 40); // 10s source + 30s intro

  // Audio mix with focus on rx-2 ducks source and mutes other reactors
  controller.setAudioFocus('rx-2');
  assert.equal(mockSource.volume, 0.25, 'Source should duck to 0.25 when reactor has focus');
  assert.equal((reactorElements[1] as any).muted, false, 'Focused reactor should not be muted');
  assert.equal((reactorElements[0] as any).muted, true, 'Unfocused reactor should be muted');
  assert.equal((reactorElements[2] as any).muted, true, 'Unfocused reactor should be muted');

  controller.destroy();
});

test('theatreSync: clean lifecycle disposal clears all timers and listeners', () => {
  const controller = new SessionSyncController();
  let callCount = 0;
  const unsub = controller.subscribe(() => {
    callCount++;
  });

  assert.ok(callCount > 0);
  unsub();
  controller.destroy();

  // No throws after destruction
  assert.doesNotThrow(() => {
    controller.pause();
    controller.seekToSourceTime(50);
  });
});
