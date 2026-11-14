/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractYouTubeVideoId,
  isPatreonUrl,
  detectMediaProvider,
  computeSessionSyncCapability,
} from '../mediaProviders/mediaProviderRegistry';
import { MediaPlayerElement } from '../mediaProviders/types';

describe('Media Provider Architecture Tests', () => {
  describe('YouTube URL Extraction & Normalization', () => {
    it('extracts video ID from standard watch URL', () => {
      const id = extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      assert.equal(id, 'dQw4w9WgXcQ');
    });

    it('extracts video ID with extra query parameters', () => {
      const id = extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&feature=share');
      assert.equal(id, 'dQw4w9WgXcQ');
    });

    it('extracts video ID from short youtu.be URL', () => {
      const id = extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ');
      assert.equal(id, 'dQw4w9WgXcQ');
    });

    it('extracts video ID from embed URL', () => {
      const id = extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ');
      assert.equal(id, 'dQw4w9WgXcQ');
    });

    it('extracts video ID from shorts URL', () => {
      const id = extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ');
      assert.equal(id, 'dQw4w9WgXcQ');
    });

    it('extracts video ID from mobile m.youtube.com URL', () => {
      const id = extractYouTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ');
      assert.equal(id, 'dQw4w9WgXcQ');
    });

    it('returns null for non-YouTube or invalid URLs', () => {
      assert.equal(extractYouTubeVideoId('https://example.com/video.mp4'), null);
      assert.equal(extractYouTubeVideoId('https://youtube.com/invalid_page'), null);
      assert.equal(extractYouTubeVideoId(''), null);
    });
  });

  describe('Patreon Detection', () => {
    it('identifies Patreon post and creator URLs', () => {
      assert.equal(isPatreonUrl('https://www.patreon.com/posts/special-reaction-12345'), true);
      assert.equal(isPatreonUrl('https://patreon.com/creatorname'), true);
    });

    it('rejects non-Patreon URLs', () => {
      assert.equal(isPatreonUrl('https://example.com/patreon'), false);
      assert.equal(isPatreonUrl('https://notpatreon.com'), false);
    });

    it('declares external playbackMode and manual_sync capability for Patreon', () => {
      const provider = detectMediaProvider('https://www.patreon.com/posts/exclusive-video-999');
      assert.equal(provider.provider, 'patreon');
      assert.equal(provider.playbackMode, 'external');
      assert.equal(provider.syncCapability, 'manual_sync');
      assert.match(provider.badgeText, /manual synchronisation/i);
    });
  });

  describe('Google Drive Detection', () => {
    it('detects standard Google Drive file share URL', () => {
      const provider = detectMediaProvider('https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view');
      assert.equal(provider.provider, 'google_drive');
      assert.equal(provider.fileId, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
      assert.equal(provider.playbackMode, 'embedded');
    });

    it('detects Google Drive open?id= URL', () => {
      const provider = detectMediaProvider('https://drive.google.com/open?id=1234567890abcdef');
      assert.equal(provider.provider, 'google_drive');
      assert.equal(provider.fileId, '1234567890abcdef');
    });
  });

  describe('Native Media & Local File Detection', () => {
    it('detects local file blobs as native full_sync', () => {
      const provider = detectMediaProvider('blob:http://localhost:3000/some-uuid', true);
      assert.equal(provider.provider, 'native');
      assert.equal(provider.playbackMode, 'native');
      assert.equal(provider.syncCapability, 'full_sync');
    });

    it('detects direct MP4 URLs as native full_sync', () => {
      const provider = detectMediaProvider('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4');
      assert.equal(provider.provider, 'native');
      assert.equal(provider.playbackMode, 'native');
      assert.equal(provider.syncCapability, 'full_sync');
    });
  });

  describe('Session-Wide Sync Capability Computation', () => {
    it('computes full_sync when all active players have full_sync capability', () => {
      const res = computeSessionSyncCapability(['full_sync', 'full_sync']);
      assert.equal(res.capability, 'full_sync');
      assert.equal(res.isAutomaticSyncAvailable, true);
    });

    it('downgrades to manual_sync when any active player requires manual_sync (e.g. Patreon)', () => {
      const res = computeSessionSyncCapability(['full_sync', 'manual_sync']);
      assert.equal(res.capability, 'manual_sync');
      assert.equal(res.isAutomaticSyncAvailable, false);
      assert.match(res.guidanceText, /manual synchronisation/i);
    });

    it('computes partial_sync when partial_sync is present without manual_sync', () => {
      const res = computeSessionSyncCapability(['full_sync', 'partial_sync']);
      assert.equal(res.capability, 'partial_sync');
      assert.equal(res.isAutomaticSyncAvailable, false);
    });
  });

  describe('Unified MediaPlayerElement Interface Contract', () => {
    it('validates custom adapter fulfilling MediaPlayerElement contract', async () => {
      let playCalled = false;
      let pauseCalled = false;
      let seekTime = 0;

      const mockAdapter: MediaPlayerElement = {
        get currentTime() {
          return seekTime;
        },
        set currentTime(val: number) {
          seekTime = val;
        },
        duration: 240,
        paused: true,
        error: null,
        readyState: 4,
        playbackRate: 1.0,
        muted: false,
        volume: 0.8,
        play: () => {
          playCalled = true;
        },
        pause: () => {
          pauseCalled = true;
        },
      };

      assert.equal(mockAdapter.duration, 240);
      mockAdapter.currentTime = 55.5;
      assert.equal(mockAdapter.currentTime, 55.5);
      mockAdapter.play();
      assert.equal(playCalled, true);
      mockAdapter.pause();
      assert.equal(pauseCalled, true);
    });
  });
});
