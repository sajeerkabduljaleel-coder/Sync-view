/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import {
  MediaPlayerAdapter,
  PlayerErrorInfo,
  YOUTUBE_CAPABILITIES,
} from '../../../services/mediaProviders/types';
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from 'lucide-react';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

// Singleton promise + callback queue for loading the official YouTube IFrame API script once
let youTubeApiPromise: Promise<void> | null = null;
const YT_API_LOAD_TIMEOUT_MS = 12000;

export function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();

  if (!youTubeApiPromise) {
    youTubeApiPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const previousReady = window.onYouTubeIframeAPIReady;

      const finishSuccess = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve();
      };

      const finishError = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        // Clear singleton so caller can retry cleanly
        youTubeApiPromise = null;
        reject(new Error(message));
      };

      const timeoutId = setTimeout(() => {
        finishError('Timed out loading the official YouTube player script.');
      }, YT_API_LOAD_TIMEOUT_MS);

      window.onYouTubeIframeAPIReady = () => {
        if (previousReady) {
          try {
            previousReady();
          } catch {}
        }
        finishSuccess();
      };

      const existingScript = document.getElementById('youtube-iframe-api') as HTMLScriptElement | null;
      if (existingScript) {
        if (window.YT && window.YT.Player) {
          finishSuccess();
          return;
        }
        existingScript.addEventListener('error', () => {
          existingScript.remove();
          finishError('Failed to load the YouTube player script.');
        }, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.id = 'youtube-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        script.remove();
        finishError('Failed to load the YouTube player script. Check your network or content blocker.');
      };
      document.head.appendChild(script);
    });
  }

  return youTubeApiPromise;
}

export interface YouTubePlayerInstanceLike {
  getCurrentTime?(): number;
  seekTo?(seconds: number, allowSeekAhead?: boolean): void;
  getDuration?(): number;
  getPlayerState?(): number;
  getPlaybackRate?(): number;
  setPlaybackRate?(rate: number): void;
  getAvailablePlaybackRates?(): number[];
  isMuted?(): boolean;
  mute?(): void;
  unMute?(): void;
  getVolume?(): number;
  setVolume?(volume: number): void;
  playVideo?(): void;
  pauseVideo?(): void;
  destroy?(): void;
}

export interface YouTubeAdapterRuntime {
  getPlayer: () => YouTubePlayerInstanceLike | null;
  isReady: () => boolean;
  getError: () => PlayerErrorInfo | null;
  isDisposed: () => boolean;
  onAutoplayBlocked?: () => void;
  onTimeSync?: (time: number) => void;
}

/**
 * Builds a truthful MediaPlayerAdapter around a live YT.Player instance.
 * Exported separately so multi-instance isolation, discrete playback rates,
 * unavailable durations, and disposal can be verified in tests.
 */
export function createYouTubePlayerAdapter(
  id: string,
  runtime: YouTubeAdapterRuntime
): MediaPlayerAdapter {
  const getActivePlayer = (): YouTubePlayerInstanceLike | null => {
    if (runtime.isDisposed() || !runtime.isReady() || runtime.getError()) return null;
    return runtime.getPlayer();
  };

  return {
    id,
    provider: 'youtube',
    playbackMode: 'embedded',
    syncCapability: 'full_sync',
    capabilities: YOUTUBE_CAPABILITIES,

    getCurrentTime: () => {
      const player = getActivePlayer();
      if (!player || typeof player.getCurrentTime !== 'function') return null;
      try {
        const t = player.getCurrentTime();
        return typeof t === 'number' && Number.isFinite(t) && t >= 0 ? t : null;
      } catch {
        return null;
      }
    },

    getDuration: () => {
      const player = getActivePlayer();
      if (!player || typeof player.getDuration !== 'function') return null;
      try {
        const d = player.getDuration();
        return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null;
      } catch {
        return null;
      }
    },

    isPaused: () => {
      const player = getActivePlayer();
      if (!player || typeof player.getPlayerState !== 'function') return null;
      try {
        const state = player.getPlayerState();
        // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
        if (state === 1 || state === 3) return false;
        if (state === -1 || state === 0 || state === 2 || state === 5) return true;
        return null;
      } catch {
        return null;
      }
    },

    isBuffering: () => {
      const player = getActivePlayer();
      if (!player || typeof player.getPlayerState !== 'function') return false;
      try {
        return player.getPlayerState() === 3;
      } catch {
        return false;
      }
    },

    getReadyState: () => {
      if (runtime.isDisposed() || runtime.getError() || !runtime.isReady()) return 0;
      const player = runtime.getPlayer();
      if (!player || typeof player.getPlayerState !== 'function') return 0;
      try {
        const state = player.getPlayerState();
        return state === 3 ? 2 : 4;
      } catch {
        return 1;
      }
    },

    getError: () => runtime.getError(),

    getPlaybackRate: () => {
      const player = getActivePlayer();
      if (!player || typeof player.getPlaybackRate !== 'function') return null;
      try {
        const rate = player.getPlaybackRate();
        return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
      } catch {
        return null;
      }
    },

    isMuted: () => {
      const player = getActivePlayer();
      if (!player || typeof player.isMuted !== 'function') return null;
      try {
        return Boolean(player.isMuted());
      } catch {
        return null;
      }
    },

    getVolume: () => {
      const player = getActivePlayer();
      if (!player || typeof player.getVolume !== 'function') return null;
      try {
        const v = player.getVolume();
        return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : null;
      } catch {
        return null;
      }
    },

    play: async () => {
      const player = getActivePlayer();
      if (!player || typeof player.playVideo !== 'function') return false;
      try {
        player.playVideo();
        const immediateState =
          typeof player.getPlayerState === 'function' ? player.getPlayerState() : 1;
        if (immediateState === 1 || immediateState === 3) {
          return true;
        }
        // Wait briefly for YouTube iframe state confirmation without lying about autoplay success
        await new Promise((resolve) => setTimeout(resolve, 180));
        if (runtime.isDisposed() || runtime.getError()) return false;
        const confirmedState =
          typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
        const started = confirmedState === 1 || confirmedState === 3;
        if (!started) {
          runtime.onAutoplayBlocked?.();
        }
        return started;
      } catch {
        return false;
      }
    },

    pause: () => {
      const player = getActivePlayer();
      if (!player || typeof player.pauseVideo !== 'function') return false;
      try {
        player.pauseVideo();
        return true;
      } catch {
        return false;
      }
    },

    seekTo: (seconds: number) => {
      const player = getActivePlayer();
      if (!player || typeof player.seekTo !== 'function') return false;
      const clamped = Math.max(0, seconds);
      try {
        player.seekTo(clamped, true);
        runtime.onTimeSync?.(clamped);
        return true;
      } catch {
        return false;
      }
    },

    setPlaybackRate: (rate: number) => {
      const player = getActivePlayer();
      if (!player || typeof player.setPlaybackRate !== 'function') return false;
      try {
        if (typeof player.getAvailablePlaybackRates === 'function') {
          const supported = player.getAvailablePlaybackRates();
          if (Array.isArray(supported) && supported.length > 0) {
            const matchesDiscrete = supported.some((r) => Math.abs(r - rate) < 0.01);
            if (!matchesDiscrete) {
              return false;
            }
          }
        }
        player.setPlaybackRate(rate);
        return true;
      } catch {
        return false;
      }
    },

    setMuted: (muted: boolean) => {
      const player = getActivePlayer();
      if (!player) return false;
      try {
        if (muted && typeof player.mute === 'function') {
          player.mute();
          return true;
        }
        if (!muted && typeof player.unMute === 'function') {
          player.unMute();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    setVolume: (volume: number) => {
      const player = getActivePlayer();
      if (!player || typeof player.setVolume !== 'function') return false;
      try {
        player.setVolume(Math.round(Math.max(0, Math.min(1, volume)) * 100));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export interface YouTubePlayerProps {
  id: string;
  videoId: string;
  title?: string;
  isMuted?: boolean;
  volume?: number;
  playbackRate?: number;
  reloadTrigger?: number;
  onTimeUpdate?: (currentTime: number, duration: number | null) => void;
  onPlaybackStateChange?: (isPlaying: boolean, isBuffering: boolean) => void;
  onReadyChange?: (isReady: boolean) => void;
  onError?: (errorMessage: string) => void;
  className?: string;
}

export const YouTubePlayer = forwardRef<MediaPlayerAdapter, YouTubePlayerProps>(function YouTubePlayer(
  {
    id,
    videoId,
    isMuted = false,
    volume = 1.0,
    playbackRate = 1.0,
    reloadTrigger = 0,
    onTimeUpdate,
    onPlaybackStateChange,
    onReadyChange,
    onError,
    className = '',
  },
  ref
) {
  const mountWrapperRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerInstanceLike | null>(null);
  const isDisposedRef = useRef(false);
  const isReadyRef = useRef(false);
  const errorRef = useRef<PlayerErrorInfo | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isApiLoading, setIsApiLoading] = useState(true);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [internalRetryNonce, setInternalRetryNonce] = useState(0);

  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onPlaybackStateChangeRef = useRef(onPlaybackStateChange);
  const onReadyChangeRef = useRef(onReadyChange);
  const onErrorRef = useRef(onError);
  onTimeUpdateRef.current = onTimeUpdate;
  onPlaybackStateChangeRef.current = onPlaybackStateChange;
  onReadyChangeRef.current = onReadyChange;
  onErrorRef.current = onError;

  const adapterRef = useRef<MediaPlayerAdapter | null>(null);
  if (!adapterRef.current || adapterRef.current.id !== id) {
    adapterRef.current = createYouTubePlayerAdapter(id, {
      getPlayer: () => playerRef.current,
      isReady: () => isReadyRef.current,
      getError: () => errorRef.current,
      isDisposed: () => isDisposedRef.current,
      onAutoplayBlocked: () => {
        if (!isDisposedRef.current) setAutoplayBlocked(true);
      },
      onTimeSync: (t) => {
        if (!isDisposedRef.current) {
          const d = adapterRef.current?.getDuration() ?? null;
          onTimeUpdateRef.current?.(t, d);
        }
      },
    });
  }

  useImperativeHandle(ref, () => adapterRef.current!, [id]);

  // Initialize official YouTube IFrame Player inside an imperative child node
  // so YouTube's DOM iframe replacement never corrupts React's virtual DOM tree.
  useEffect(() => {
    isDisposedRef.current = false;
    isReadyRef.current = false;
    errorRef.current = null;
    setIsReady(false);
    setIsApiLoading(true);
    setHasError(false);
    setErrorMessage(null);
    setAutoplayBlocked(false);

    let timePollInterval: ReturnType<typeof setInterval> | null = null;

    loadYouTubeIframeApi()
      .then(() => {
        if (isDisposedRef.current) return;
        setIsApiLoading(false);

        const wrapper = mountWrapperRef.current;
        if (!wrapper || !window.YT || !window.YT.Player) {
          const msg = 'YouTube IFrame Player API did not finish initializing.';
          errorRef.current = { message: msg, code: 'YT_API_UNAVAILABLE' };
          setHasError(true);
          setErrorMessage(msg);
          onErrorRef.current?.(msg);
          return;
        }

        if (playerRef.current) {
          try {
            playerRef.current.destroy?.();
          } catch {}
          playerRef.current = null;
        }

        const hostEl = document.createElement('div');
        hostEl.className = 'w-full h-full';
        wrapper.replaceChildren(hostEl);

        playerRef.current = new window.YT.Player(hostEl, {
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 1,
            modestbranding: 1,
            rel: 0,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event: any) => {
              if (isDisposedRef.current) return;
              isReadyRef.current = true;
              setIsReady(true);
              onReadyChangeRef.current?.(true);

              try {
                if (isMuted) event.target.mute?.();
                else event.target.unMute?.();
                event.target.setVolume?.(Math.round(volume * 100));
                const d = event.target.getDuration?.();
                const t = event.target.getCurrentTime?.() ?? 0;
                onTimeUpdateRef.current?.(
                  typeof t === 'number' && Number.isFinite(t) ? t : 0,
                  typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null
                );
              } catch {}

              timePollInterval = setInterval(() => {
                if (isDisposedRef.current || !isReadyRef.current || !playerRef.current) return;
                try {
                  const t = playerRef.current.getCurrentTime?.();
                  const d = playerRef.current.getDuration?.();
                  if (typeof t === 'number' && Number.isFinite(t)) {
                    onTimeUpdateRef.current?.(
                      t,
                      typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null
                    );
                  }
                } catch {}
              }, 250);
            },
            onStateChange: (event: any) => {
              if (isDisposedRef.current) return;
              const s = event.data;
              const playing = s === 1;
              const buffering = s === 3;
              if (playing) {
                setAutoplayBlocked(false);
              }
              onPlaybackStateChangeRef.current?.(playing, buffering);
            },
            onError: (event: any) => {
              if (isDisposedRef.current) return;
              const code = event.data;
              let msg = 'Unable to play this YouTube video.';
              if (code === 2) msg = 'Invalid YouTube video ID parameter.';
              else if (code === 5) msg = 'HTML5 player error on YouTube.';
              else if (code === 100) msg = 'Video not found or has been marked private by its creator.';
              else if (code === 101 || code === 150) {
                msg = 'The video owner does not allow embedded playback outside YouTube.';
              }
              errorRef.current = { message: msg, code };
              setHasError(true);
              setErrorMessage(msg);
              onErrorRef.current?.(msg);
            },
          },
        });
      })
      .catch((err: any) => {
        if (isDisposedRef.current) return;
        const msg = err?.message || 'Failed to load YouTube player.';
        errorRef.current = { message: msg, code: 'YT_SCRIPT_LOAD_FAILED' };
        setIsApiLoading(false);
        setHasError(true);
        setErrorMessage(msg);
        onErrorRef.current?.(msg);
      });

    return () => {
      isDisposedRef.current = true;
      isReadyRef.current = false;
      if (timePollInterval) {
        clearInterval(timePollInterval);
        timePollInterval = null;
      }
      if (playerRef.current) {
        try {
          playerRef.current.destroy?.();
        } catch {}
        playerRef.current = null;
      }
      if (mountWrapperRef.current) {
        mountWrapperRef.current.replaceChildren();
      }
    };
  }, [videoId, reloadTrigger, internalRetryNonce]);

  // Sync mute and volume prop changes
  useEffect(() => {
    if (isReady && adapterRef.current) {
      adapterRef.current.setMuted(isMuted);
      adapterRef.current.setVolume(volume);
    }
  }, [isMuted, volume, isReady]);

  // Sync discrete playbackRate changes when supported
  useEffect(() => {
    if (isReady && adapterRef.current && playbackRate) {
      adapterRef.current.setPlaybackRate(playbackRate);
    }
  }, [playbackRate, isReady]);

  return (
    <div className={`relative bg-black rounded-xl overflow-hidden aspect-video flex items-center justify-center ${className}`}>
      {/* Unmanaged container holding the imperative YouTube host node */}
      <div ref={mountWrapperRef} className="w-full h-full" />

      {/* Loading Overlay */}
      {isApiLoading && !hasError && (
        <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center gap-2.5 z-10">
          <Loader2 className="w-7 h-7 text-red-500 animate-spin" />
          <span className="text-xs text-slate-300 font-medium">Loading YouTube player...</span>
        </div>
      )}

      {/* Browser autoplay blocked notice */}
      {autoplayBlocked && !hasError && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-lg bg-amber-950/90 border border-amber-500/40 text-amber-200 text-[11px] font-medium shadow-lg pointer-events-none">
          Browser paused YouTube autoplay — press play inside the YouTube frame once.
        </div>
      )}

      {/* Error Overlay */}
      {hasError && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm p-4 flex flex-col items-center justify-center text-center gap-3 z-20">
          <div className="p-2.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white">YouTube Playback Unavailable</h4>
            <p className="text-xs text-slate-400 max-w-sm mt-1">{errorMessage}</p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setInternalRetryNonce((n) => n + 1)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
            <a
              href={`https://www.youtube.com/watch?v=${videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-md transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Watch on YouTube
            </a>
          </div>
        </div>
      )}

      {/* Provider Branding Pill */}
      <div className="absolute top-2 left-2 z-10 pointer-events-none">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-md text-[10px] font-bold text-red-400 border border-red-500/30">
          YouTube &bull; {isReady ? 'API Sync' : 'Connecting'}
        </span>
      </div>
    </div>
  );
});
