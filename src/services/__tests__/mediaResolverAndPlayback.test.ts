/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGoogleDriveUrl,
  isGoogleDriveUrl,
  resolvePlayableMediaUrl,
  validateUrlInput,
  classifyMediaError,
} from '../mediaResolver';
import { SessionSyncController } from '../SessionSyncController';
import { SyncAnchor } from '../../types';

// Mock HTMLVideoElement simulating browser media events and error states
class MockVideoElement {
  public currentTime = 0;
  public duration = 180;
  public paused = true;
  public playbackRate = 1.0;
  public muted = false;
  public volume = 1.0;
  public readyState = 4; // HAVE_ENOUGH_DATA
  public networkState = 1; // NETWORK_IDLE
  public error: MediaError | null = null;
  public src = '';

  async play() {
    if (this.error) {
      throw new Error('MEDIA_ELEMENT_ERROR: play() rejected due to media error');
    }
    this.paused = false;
  }

  pause() {
    this.paused = true;
  }

  load() {
    this.error = null;
    this.readyState = 1; // HAVE_METADATA
  }
}

// 1. Google Drive "/file/d/ID/view" parsing
test('mediaResolver: parses Google Drive /file/d/ID/view URLs correctly', () => {
  const url = 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view?usp=sharing';
  const parsed = parseGoogleDriveUrl(url);

  assert.equal(parsed.isGoogleDrive, true);
  assert.equal(parsed.fileId, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs');
  assert.equal(
    parsed.directDownloadUrl,
    'https://drive.google.com/uc?export=download&id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs'
  );
  assert.equal(
    parsed.proxyStreamUrl,
    '/api/media/stream?driveId=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs'
  );
  assert.equal(isGoogleDriveUrl(url), true);
});

// 2. Google Drive "open?id=ID" and "uc?id=ID" parsing
test('mediaResolver: parses Google Drive open?id=ID and uc?id=ID URLs correctly', () => {
  const openUrl = 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz_012';
  const openParsed = parseGoogleDriveUrl(openUrl);
  assert.equal(openParsed.isGoogleDrive, true);
  assert.equal(openParsed.fileId, '1AbCdEfGhIjKlMnOpQrStUvWxYz_012');

  const ucUrl = 'https://drive.google.com/uc?id=1AbCdEfGhIjKlMnOpQrStUvWxYz_012&export=download';
  const ucParsed = parseGoogleDriveUrl(ucUrl);
  assert.equal(ucParsed.isGoogleDrive, true);
  assert.equal(ucParsed.fileId, '1AbCdEfGhIjKlMnOpQrStUvWxYz_012');

  const docsUrl = 'https://docs.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_012/edit';
  const docsParsed = parseGoogleDriveUrl(docsUrl);
  assert.equal(docsParsed.isGoogleDrive, true);
  assert.equal(docsParsed.fileId, '1AbCdEfGhIjKlMnOpQrStUvWxYz_012');
});

// 3. Malformed Drive URLs & arbitrary Google URLs
test('mediaResolver: rejects malformed Drive URLs and non-Drive Google URLs', () => {
  // Arbitrary Google domains
  assert.equal(parseGoogleDriveUrl('https://www.google.com/search?q=video').isGoogleDrive, false);
  assert.equal(parseGoogleDriveUrl('https://maps.google.com/?q=location').isGoogleDrive, false);
  assert.equal(parseGoogleDriveUrl('https://youtube.com/watch?v=12345').isGoogleDrive, false);

  // Malformed Drive URLs with no valid ID
  const malformed = parseGoogleDriveUrl('https://drive.google.com/file/d//view');
  assert.equal(malformed.isGoogleDrive, true);
  assert.equal(malformed.fileId, null);
  assert.ok(malformed.error);

  const shortId = parseGoogleDriveUrl('https://drive.google.com/open?id=abc');
  assert.equal(shortId.fileId, null);
});

// 4. URL validation helper
test('mediaResolver: validates user URL inputs and warns on Google Drive', () => {
  // Empty
  assert.equal(validateUrlInput('').isValid, false);

  // Blob URL
  assert.equal(validateUrlInput('blob:http://localhost:3000/123-abc').isValid, true);

  // Webpage player links (YouTube, Vimeo)
  const yt = validateUrlInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(yt.isValid, false);
  assert.ok(yt.error?.includes('YouTube'));

  // Valid Direct MP4
  const mp4 = validateUrlInput('https://commondatastorage.googleapis.com/sample.mp4');
  assert.equal(mp4.isValid, true);
  assert.equal(mp4.isGoogleDrive, false);

  // Google Drive URL with helpful sharing warning
  const drive = validateUrlInput('https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view');
  assert.equal(drive.isValid, true);
  assert.equal(drive.isGoogleDrive, true);
  assert.ok(drive.warning?.includes('Anyone with the link can view'));
});

// 5. Media resolution
test('mediaResolver: resolves Google Drive URLs to proxy stream endpoints while preserving direct MP4s', () => {
  const directMp4 = 'https://commondatastorage.googleapis.com/sample.mp4';
  assert.equal(resolvePlayableMediaUrl(directMp4), directMp4);

  const blobUrl = 'blob:http://localhost:3000/media-blob-123';
  assert.equal(resolvePlayableMediaUrl(blobUrl), blobUrl);

  const driveUrl = 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view';
  assert.equal(
    resolvePlayableMediaUrl(driveUrl, true),
    '/api/media/stream?driveId=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs'
  );
  assert.equal(
    resolvePlayableMediaUrl(driveUrl, false),
    'https://drive.google.com/uc?export=download&id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs'
  );
});

// 6. Media error classification
test('mediaResolver: classifies media errors with actionable steps for Google Drive and generic streams', () => {
  // Google Drive MEDIA_ERR_SRC_NOT_SUPPORTED (code 4)
  const mockError4 = { code: 4, message: 'Format error' } as MediaError;
  const driveClassified = classifyMediaError(
    mockError4,
    'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view'
  );
  assert.equal(driveClassified.isGoogleDrive, true);
  assert.equal(driveClassified.codeName, 'MEDIA_ERR_SRC_NOT_SUPPORTED');
  assert.ok(driveClassified.title.includes('Google Drive'));
  assert.ok(
    driveClassified.actionableSteps.some((step) =>
      step.includes('Anyone with the link can view')
    )
  );

  // Generic network error (code 2)
  const mockError2 = { code: 2, message: 'Network dropped' } as MediaError;
  const netClassified = classifyMediaError(mockError2, 'https://example.com/video.mp4');
  assert.equal(netClassified.codeName, 'MEDIA_ERR_NETWORK');
  assert.ok(netClassified.actionableSteps.some((step) => step.includes('Retry Video')));
});

// 7. Source plays while reaction fails
test('theatreSync: source video plays uninterrupted when reaction stream encounters an error', async () => {
  const controller = new SessionSyncController();

  const mockSource = new MockVideoElement() as unknown as HTMLVideoElement;
  const mockReaction = new MockVideoElement() as unknown as HTMLVideoElement;

  // Set reaction in error state
  (mockReaction as any).error = { code: 4, message: 'HTML returned instead of media' };
  (mockReaction as any).readyState = 0;

  controller.registerSourceElement(mockSource);
  controller.registerReactionElement('rx-1', mockReaction);
  controller.setActiveReaction('rx-1');

  // Authoritative Play
  await controller.play();

  // Source element MUST play successfully without rejection
  assert.equal(mockSource.paused, false);
  assert.equal(controller.getState().isPlaying, true);

  // Trigger evaluation cycle
  (controller as any).evaluateSyncCycle();

  // Reaction element must remain in error state without crashing controller
  assert.equal(mockReaction.paused, true);
  assert.equal(controller.getState().primaryStatus, 'drifting');

  controller.destroy();
});

// 8. Reaction plays while source fails
test('theatreSync: reaction video can play when source stream is in error or unready', async () => {
  const controller = new SessionSyncController();

  const mockSource = new MockVideoElement() as unknown as HTMLVideoElement;
  const mockReaction = new MockVideoElement() as unknown as HTMLVideoElement;

  // Set source in error state
  (mockSource as any).error = { code: 4, message: 'Source stream 404' };
  (mockSource as any).readyState = 0;

  controller.registerSourceElement(mockSource);
  controller.registerReactionElement('rx-1', mockReaction);
  controller.setActiveReaction('rx-1');

  // Trigger play
  await controller.play();

  // Reaction plays cleanly
  assert.equal(mockReaction.paused, false);
  assert.equal(mockSource.paused, true);

  controller.destroy();
});

// 9. Retry and recovery
test('theatreSync: recovering from an error restores synchronization cleanly', async () => {
  const controller = new SessionSyncController();

  const anchors: SyncAnchor[] = [
    { id: 'a1', sourceTime: 0, reactionTime: 15, type: 'intro' }, // 15s intro
    { id: 'a2', sourceTime: 100, reactionTime: 115, type: 'linear' },
  ];
  controller.setActiveReaction('rx-1');
  controller.setReactionAnchors('rx-1', anchors);

  const mockSource = new MockVideoElement() as unknown as HTMLVideoElement;
  const mockReaction = new MockVideoElement() as unknown as HTMLVideoElement;

  // Initially failed reaction
  (mockReaction as any).error = { code: 4, message: 'Google Drive private' };
  (mockReaction as any).readyState = 0;

  controller.registerSourceElement(mockSource);
  controller.registerReactionElement('rx-1', mockReaction);

  mockSource.currentTime = 50;

  // Simulate user fixing link / clicking Retry Video
  (mockReaction as any).error = null;
  (mockReaction as any).readyState = 4; // Media is now loaded

  // Seek on controller
  controller.seekToSourceTime(50);

  // Mapped reaction time should be 50 + 15 = 65
  assert.equal(mockReaction.currentTime, 65);
  assert.equal(mockSource.currentTime, 50);

  controller.destroy();
});
