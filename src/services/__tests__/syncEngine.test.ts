/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapSourceToReaction,
  mapReactionToSource,
  computeDriftCorrection,
  validateAnchors,
  exportAnchorsToCsv,
  importAnchorsFromCsv,
  DEFAULT_DRIFT_CONFIG,
} from '../syncEngine';
import { SyncAnchor } from '../../types';

test('syncEngine: maps linear timeline with intro offset', () => {
  // Reaction has a 15-second intro before source begins
  const anchors: SyncAnchor[] = [
    { id: '1', sourceTime: 0, reactionTime: 15, type: 'intro', label: 'Source Starts' },
    { id: '2', sourceTime: 60, reactionTime: 75, type: 'linear' },
  ];

  // At source 0s, reaction is at 15s
  assert.equal(mapSourceToReaction(0, anchors), 15);
  // At source 30s, reaction is at 45s
  assert.equal(mapSourceToReaction(30, anchors), 45);
  // At source 60s, reaction is at 75s
  assert.equal(mapSourceToReaction(60, anchors), 75);

  // Inverse mapping
  assert.equal(mapReactionToSource(15, anchors), 0);
  assert.equal(mapReactionToSource(45, anchors), 30);
  assert.equal(mapReactionToSource(75, anchors), 60);
});

test('syncEngine: handles creator pause segment where source is held', () => {
  // Creator pauses source at 30s to talk for 10 seconds (from 45s to 55s reaction time)
  const anchors: SyncAnchor[] = [
    { id: '1', sourceTime: 0, reactionTime: 15, type: 'intro' },
    { id: '2', sourceTime: 30, reactionTime: 45, type: 'pause', label: 'Pause Start' },
    { id: '3', sourceTime: 30, reactionTime: 55, type: 'pause', label: 'Pause End' },
    { id: '4', sourceTime: 60, reactionTime: 85, type: 'linear' },
  ];

  // Before pause
  assert.equal(mapSourceToReaction(10, anchors), 25);
  // At pause source point
  assert.equal(mapSourceToReaction(30, anchors), 45);
  // After pause resumed
  assert.equal(mapSourceToReaction(45, anchors), 70);
  assert.equal(mapSourceToReaction(60, anchors), 85);

  // Inverse mapping: during reaction 50s (middle of pause), source should be held at 30s
  assert.equal(mapReactionToSource(50, anchors), 30);
});

test('syncEngine: drift correction states (synced, adjusting, drifting)', () => {
  const target = 50.0;

  // Perfectly synced (within 0.08s)
  const syncCheck = computeDriftCorrection(50.04, target);
  assert.equal(syncCheck.status, 'synced');
  assert.equal(syncCheck.recommendedRate, 1.0);
  assert.equal(syncCheck.shouldHardSeek, false);

  // Minor drift ahead (+0.4s) -> should apply microRateSlow (0.95x)
  const slowCheck = computeDriftCorrection(50.4, target);
  assert.equal(slowCheck.status, 'adjusting');
  assert.equal(slowCheck.recommendedRate, DEFAULT_DRIFT_CONFIG.microRateSlow);
  assert.equal(slowCheck.shouldHardSeek, false);

  // Minor drift behind (-0.4s) -> should apply microRateBoost (1.05x)
  const fastCheck = computeDriftCorrection(49.6, target);
  assert.equal(fastCheck.status, 'adjusting');
  assert.equal(fastCheck.recommendedRate, DEFAULT_DRIFT_CONFIG.microRateBoost);
  assert.equal(fastCheck.shouldHardSeek, false);

  // Large drift (2.5s) -> triggers hard seek
  const hardCheck = computeDriftCorrection(52.5, target);
  assert.equal(hardCheck.status, 'drifting');
  assert.equal(hardCheck.shouldHardSeek, true);
  assert.equal(hardCheck.seekTarget, 50.0);

  // Buffering state overrides drift
  const bufferCheck = computeDriftCorrection(55.0, target, true, false);
  assert.equal(bufferCheck.status, 'buffering');
  assert.equal(bufferCheck.shouldHardSeek, false);
});

test('syncEngine: validates anchors and flags errors', () => {
  // Empty
  const emptyRes = validateAnchors([]);
  assert.equal(emptyRes.valid, false);

  // Negative time
  const negRes = validateAnchors([
    { id: '1', sourceTime: -5, reactionTime: 0, type: 'linear' },
  ]);
  assert.equal(negRes.valid, false);

  // Non-monotonic reaction time
  const nonMono = validateAnchors([
    { id: '1', sourceTime: 0, reactionTime: 10, type: 'linear' },
    { id: '2', sourceTime: 10, reactionTime: 5, type: 'linear' },
  ]);
  assert.equal(nonMono.valid, false);

  // Valid
  const validRes = validateAnchors([
    { id: '1', sourceTime: 0, reactionTime: 10, type: 'linear' },
    { id: '2', sourceTime: 20, reactionTime: 30, type: 'linear' },
  ]);
  assert.equal(validRes.valid, true);
});

test('syncEngine: CSV export and import round-trip', () => {
  const original: SyncAnchor[] = [
    { id: 'a1', sourceTime: 0, reactionTime: 12.5, type: 'intro', label: 'Intro offset', notes: 'Creator says hi' },
    { id: 'a2', sourceTime: 45.2, reactionTime: 57.7, type: 'linear', label: 'Scene 1', notes: '' },
  ];

  const csv = exportAnchorsToCsv(original);
  assert.ok(csv.includes('sourceTime'));
  assert.ok(csv.includes('12.500'));

  const imported = importAnchorsFromCsv(csv);
  assert.equal(imported.length, 2);
  assert.equal(imported[0].id, 'a1');
  assert.equal(imported[0].sourceTime, 0);
  assert.equal(imported[0].reactionTime, 12.5);
  assert.equal(imported[0].label, 'Intro offset');
  assert.equal(imported[0].notes, 'Creator says hi');
});
