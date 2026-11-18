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
import { MediaPlayerAdapter, NATIVE_CAPABILITIES } from '../mediaProviders/types';
import { createGoogleDrivePreviewAdapter } from '../../components/theatre/players/GoogleDriveEmbedPlayer';
import { createPatreonExternalAdapter } from '../../components/theatre/players/PatreonExternalPlayer';
import {
  createYouTubePlayerAdapter,
  YouTubePlayerInstanceLike,
} from '../../components/theatre/players/YouTubePlayer';
import { SessionSyncController } from '../SessionSyncController';

describe('Media Provider Architecture Tests', () => {
  describe('YouTube URL Extraction & Normalization', () => {
    it('extracts video ID from standard watch URL', () => {
      assert.equal(
        extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
        'dQw4w9WgXcQ'
      );
    });

    it('extracts video ID with extra query parameters', () => {
      assert.equal(
        extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&feature=share'),
        'dQw4w9WgXcQ'
      );
    });

    it('extracts video ID from short youtu.be URL', () => {
      assert.equal(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    });

    it('extracts video ID from embed, shorts, live, and mobile URLs', () => {
      assert.equal(extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
      assert.equal(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
      assert.equal(extractYouTubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
      assert.equal(extractYouTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    });

    it('returns null for non-YouTube or invalid URLs', () => {
      assert.equal(extractYouTubeVideoId('https://example.com/video.mp4'), null);
      assert.equal(extractYouTubeVideoId('https://youtube.com/invalid_page'), null);
      assert.equal(extractYouTubeVideoId(''), null);
    });

    it('declares discrete-rate capabilities for YouTube', () => {
      const provider = detectMediaProvider('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      assert.equal(provider.provider, 'youtube');
      assert.equal(provider.playbackMode, 'embedded');
      assert.equal(provider.syncCapability, 'full_sync');
      assert.equal(provider.capabilities.canPlay, true);
      assert.equal(provider.capabilities.canSeek, true);
      assert.equal(provider.capabilities.supportsContinuousRate, false);
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
      assert.equal(provider.capabilities.canPlay, false);
      assert.equal(provider.capabilities.canReadTime, false);
      assert.match(provider.badgeText, /manual synchronisation/i);
    });
  });

  describe('Google Drive Honest Capability Detection', () => {
    it('declares embedded preview Google Drive URLs as manual_sync rather than full_sync', () => {
      const provider = detectMediaProvider(
        'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view'
      );
      assert.equal(provider.provider, 'google_drive');
      assert.equal(provider.fileId, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
      assert.equal(provider.playbackMode, 'embedded');
      assert.equal(provider.syncCapability, 'manual_sync');
      assert.equal(provider.capabilities.canSeek, false);
      assert.equal(provider.capabilities.canPlay, false);
    });

    it('declares verified Google Drive proxy streams as native full_sync', () => {
      const provider = detectMediaProvider(
        '/api/media/stream?driveId=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
      );
      assert.equal(provider.provider, 'google_drive');
      assert.equal(provider.fileId, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
      assert.equal(provider.playbackMode, 'native');
      assert.equal(provider.syncCapability, 'full_sync');
      assert.equal(provider.capabilities.canSeek, true);
      assert.equal(provider.capabilities.supportsContinuousRate, true);
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
      const provider = detectMediaProvider(
        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
      );
      assert.equal(provider.provider, 'native');
      assert.equal(provider.playbackMode, 'native');
      assert.equal(provider.syncCapability, 'full_sync');
    });
  });

  describe('Truthful Player Adapters (No Simulated Playback)', () => {
    it('Google Drive preview adapter reports null telemetry and returns false on unsupported controls', async () => {
      const drive = createGoogleDrivePreviewAdapter('drive-preview');
      assert.equal(drive.syncCapability, 'manual_sync');
      assert.equal(drive.getCurrentTime(), null);
      assert.equal(drive.getDuration(), null);
      assert.equal(drive.isPaused(), null);
      assert.equal(drive.getPlaybackRate(), null);
      assert.equal(drive.isMuted(), null);
      assert.equal(drive.getVolume(), null);
      assert.equal(await drive.play(), false);
      assert.equal(drive.pause(), false);
      assert.equal(drive.seekTo(42), false);
      assert.equal(drive.setPlaybackRate(1.05), false);
    });

    it('Patreon external adapter reports null telemetry and returns false on unsupported controls', async () => {
      const patreon = createPatreonExternalAdapter('patreon-ext');
      assert.equal(patreon.syncCapability, 'manual_sync');
      assert.equal(patreon.playbackMode, 'external');
      assert.equal(patreon.getCurrentTime(), null);
      assert.equal(patreon.getDuration(), null);
      assert.equal(patreon.isPaused(), null);
      assert.equal(await patreon.play(), false);
      assert.equal(patreon.pause(), false);
      assert.equal(patreon.seekTo(100), false);
    });

    it('YouTube adapter reads real state, returns null duration when unavailable, isolates multiple instances, and halts after disposal', async () => {
      let disposedA = false;
      let stateA = 2;
      let timeA = 12;
      let durationA = 0; // unavailable initially
      let rateA = 1.0;

      const ytMockA: YouTubePlayerInstanceLike = {
        getCurrentTime: () => timeA,
        getDuration: () => durationA,
        getPlayerState: () => stateA,
        getPlaybackRate: () => rateA,
        setPlaybackRate: (r) => {
          rateA = r;
        },
        getAvailablePlaybackRates: () => [0.5, 1, 1.25, 1.5, 2],
        seekTo: (s) => {
          timeA = s;
        },
        playVideo: () => {
          stateA = 1;
        },
        pauseVideo: () => {
          stateA = 2;
        },
      };

      let timeB = 90;
      const ytMockB: YouTubePlayerInstanceLike = {
        getCurrentTime: () => timeB,
        getDuration: () => 500,
        getPlayerState: () => 1,
        getPlaybackRate: () => 1,
        seekTo: (s) => {
          timeB = s;
        },
      };

      const adapterA = createYouTubePlayerAdapter('yt-a', {
        getPlayer: () => ytMockA,
        isReady: () => true,
        getError: () => null,
        isDisposed: () => disposedA,
      });

      const adapterB = createYouTubePlayerAdapter('yt-b', {
        getPlayer: () => ytMockB,
        isReady: () => true,
        getError: () => null,
        isDisposed: () => false,
      });

      assert.equal(adapterA.getDuration(), null, 'Must return null instead of fake 180s');
      durationA = 245;
      assert.equal(adapterA.getDuration(), 245);
      assert.equal(adapterB.getDuration(), 500);
      assert.equal(adapterA.getCurrentTime(), 12);
      assert.equal(adapterB.getCurrentTime(), 90);

      // Continuous micro-rate 1.05 must be rejected by discrete YouTube rate check
      assert.equal(adapterA.setPlaybackRate(1.05), false);
      assert.equal(rateA, 1.0);
      assert.equal(adapterA.setPlaybackRate(1.25), true);
      assert.equal(rateA, 1.25);

      assert.equal(await adapterA.play(), true);
      assert.equal(adapterA.isPaused(), false);

      // Clean disposal stops further operations on A while leaving B untouched
      disposedA = true;
      assert.equal(adapterA.getCurrentTime(), null);
      assert.equal(adapterA.seekTo(99), false);
      assert.equal(adapterB.getCurrentTime(), 90);
    });
  });

  describe('Session-Wide Sync Capability Computation & Controller Behavior', () => {
    it('computes full_sync when all active players have full_sync capability', () => {
      const res = computeSessionSyncCapability(['full_sync', 'full_sync']);
      assert.equal(res.capability, 'full_sync');
      assert.equal(res.isAutomaticSyncAvailable, true);
      assert.equal(res.hasErrors, false);
    });

    it('downgrades to manual_sync when any active player requires manual_sync', () => {
      const res = computeSessionSyncCapability(['full_sync', 'manual_sync']);
      assert.equal(res.capability, 'manual_sync');
      assert.equal(res.isAutomaticSyncAvailable, false);
      assert.match(res.guidanceText, /manual synchronisation/i);
    });

    it('surfaces player errors cleanly in computeSessionSyncCapability', () => {
      const res = computeSessionSyncCapability(['full_sync', 'full_sync'], ['rx-1']);
      assert.equal(res.hasErrors, true);
      assert.equal(res.isAutomaticSyncAvailable, false);
    });

    it('SessionSyncController skips unsupported commands on manual adapters while updating target cues', async () => {
      const controller = new SessionSyncController();
      let sourceTime = 20;
      let sourcePaused = true;

      const sourceAdapter: MediaPlayerAdapter = {
        id: 'source-player',
        provider: 'native',
        playbackMode: 'native',
        syncCapability: 'full_sync',
        capabilities: NATIVE_CAPABILITIES,
        getCurrentTime: () => sourceTime,
        getDuration: () => null, // unavailable duration
        isPaused: () => sourcePaused,
        isBuffering: () => false,
        getReadyState: () => 4,
        getError: () => null,
        getPlaybackRate: () => 1.0,
        isMuted: () => false,
        getVolume: () => 1.0,
        play: async () => {
          sourcePaused = false;
          return true;
        },
        pause: () => {
          sourcePaused = true;
          return true;
        },
        seekTo: (s) => {
          sourceTime = s;
          return true;
        },
        setPlaybackRate: () => true,
        setMuted: () => true,
        setVolume: () => true,
      };

      const drivePreview = createGoogleDrivePreviewAdapter('rx-drive');
      controller.setActiveReaction('rx-drive');
      controller.setReactionAnchors('rx-drive', [
        { id: 'intro', sourceTime: 0, reactionTime: 15, type: 'intro' },
      ]);
      controller.registerSourceAdapter(sourceAdapter);
      controller.registerReactionAdapter('rx-drive', drivePreview);

      await controller.play();
      controller.seekToSourceTime(30);
      controller.evaluateSyncCycle();

      const st = controller.getState();
      assert.equal(st.sourceDuration, null, 'Unavailable duration must remain null');
      assert.equal(st.sessionCapability.capability, 'manual_sync');
      assert.equal(st.primaryStatus, 'manual');
      assert.equal(st.manualTargetTimes['rx-drive'], 45);
      assert.equal(sourcePaused, false);

      controller.destroy();
    });

    it('SessionSyncController avoids continuous micro-rate adjustments on YouTube discrete-rate adapter', async () => {
      const controller = new SessionSyncController();
      let setRateCalls: number[] = [];
      let ytTime = 20.6; // 0.6s drift > 0.25s soft threshold, < 1.5s hard seek threshold
      let ytPaused = false;

      const sourceAdapter: MediaPlayerAdapter = {
        id: 'source-player',
        provider: 'native',
        playbackMode: 'native',
        syncCapability: 'full_sync',
        capabilities: NATIVE_CAPABILITIES,
        getCurrentTime: () => 20,
        getDuration: () => 300,
        isPaused: () => false,
        isBuffering: () => false,
        getReadyState: () => 4,
        getError: () => null,
        getPlaybackRate: () => 1.0,
        isMuted: () => false,
        getVolume: () => 1.0,
        play: async () => true,
        pause: () => true,
        seekTo: () => true,
        setPlaybackRate: () => true,
        setMuted: () => true,
        setVolume: () => true,
      };

      const ytAdapter = createYouTubePlayerAdapter('rx-yt', {
        getPlayer: () => ({
          getCurrentTime: () => ytTime,
          getDuration: () => 400,
          getPlayerState: () => (ytPaused ? 2 : 1),
          getPlaybackRate: () => 1.0,
          getAvailablePlaybackRates: () => [0.5, 1, 1.25, 1.5, 2],
          setPlaybackRate: (r) => setRateCalls.push(r),
          seekTo: (s) => {
            ytTime = s;
          },
          playVideo: () => {
            ytPaused = false;
          },
          pauseVideo: () => {
            ytPaused = true;
          },
        }),
        isReady: () => true,
        getError: () => null,
        isDisposed: () => false,
      });

      controller.setActiveReaction('rx-yt');
      controller.registerSourceAdapter(sourceAdapter);
      controller.registerReactionAdapter('rx-yt', ytAdapter);

      controller.evaluateSyncCycle();
      // Should keep discrete 1.0x and never send 0.95x continuous rate
      assert.equal(
        setRateCalls.some((r) => Math.abs(r - 1.0) > 0.01),
        false,
        'Must not send unsupported 0.95x continuous rate to YouTube'
      );

      // Large drift >= 1.5s triggers hard seek
      ytTime = 25;
      controller.evaluateSyncCycle();
      assert.equal(ytTime, 20);

      controller.destroy();
    });
  });
});
