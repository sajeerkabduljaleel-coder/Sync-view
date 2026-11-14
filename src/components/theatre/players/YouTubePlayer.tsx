/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { MediaPlayerElement } from '../../../services/mediaProviders/types';
import { AlertTriangle, ExternalLink, Loader2, Play, RefreshCw, Volume2, VolumeX } from 'lucide-react';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

// Singleton promise for loading the official YouTube IFrame API script once
let youTubeApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();

  if (!youTubeApiPromise) {
    youTubeApiPromise = new Promise<void>((resolve) => {
      const existingScript = document.getElementById('youtube-iframe-api');
      if (existingScript) {
        if (window.YT && window.YT.Player) {
          resolve();
          return;
        }
        const previousReady = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (previousReady) previousReady();
          resolve();
        };
        return;
      }

      const script = document.createElement('script');
      script.id = 'youtube-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;

      window.onYouTubeIframeAPIReady = () => {
        resolve();
      };

      document.head.appendChild(script);
    });
  }

  return youTubeApiPromise;
}

export interface YouTubePlayerProps {
  id: string;
  videoId: string;
  title?: string;
  isMuted?: boolean;
  volume?: number;
  playbackRate?: number;
  onTimeUpdate?: (currentTime: number) => void;
  onTogglePlay?: () => void;
  onError?: (errorMessage: string) => void;
  className?: string;
}

export const YouTubePlayer = forwardRef<MediaPlayerElement, YouTubePlayerProps>(function YouTubePlayer(
  {
    id,
    videoId,
    title,
    isMuted = false,
    volume = 1.0,
    playbackRate = 1.0,
    onTimeUpdate,
    onTogglePlay,
    onError,
    className = '',
  },
  ref
) {
  const containerId = `yt-player-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const playerRef = useRef<any>(null);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isApiLoading, setIsApiLoading] = useState(true);

  // Cached state for synchronous getter access in MediaPlayerElement
  const internalStateRef = useRef({
    currentTime: 0,
    duration: 180,
    paused: true,
    error: null as any,
    readyState: 0,
    playbackRate: 1.0,
    muted: isMuted,
    volume: volume,
  });

  // Expose authoritative MediaPlayerElement to SessionSyncController
  useImperativeHandle(ref, () => ({
    get currentTime() {
      if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        try {
          const t = playerRef.current.getCurrentTime();
          if (typeof t === 'number' && !isNaN(t)) {
            internalStateRef.current.currentTime = t;
            return t;
          }
        } catch {}
      }
      return internalStateRef.current.currentTime;
    },
    set currentTime(val: number) {
      internalStateRef.current.currentTime = val;
      if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
        try {
          playerRef.current.seekTo(val, true);
        } catch {}
      }
    },
    get duration() {
      if (playerRef.current && typeof playerRef.current.getDuration === 'function') {
        try {
          const d = playerRef.current.getDuration();
          if (typeof d === 'number' && d > 0) {
            internalStateRef.current.duration = d;
            return d;
          }
        } catch {}
      }
      return internalStateRef.current.duration;
    },
    get paused() {
      if (playerRef.current && typeof playerRef.current.getPlayerState === 'function') {
        try {
          const state = playerRef.current.getPlayerState();
          // YT.PlayerState: -1 (unstarted), 0 (ended), 1 (playing), 2 (paused), 3 (buffering), 5 (video cued)
          return state !== 1;
        } catch {}
      }
      return internalStateRef.current.paused;
    },
    get error() {
      return internalStateRef.current.error;
    },
    get readyState() {
      return isReady ? 4 : 1;
    },
    get playbackRate() {
      return internalStateRef.current.playbackRate;
    },
    set playbackRate(val: number) {
      internalStateRef.current.playbackRate = val;
      if (playerRef.current && typeof playerRef.current.setPlaybackRate === 'function') {
        try {
          playerRef.current.setPlaybackRate(val);
        } catch {}
      }
    },
    get muted() {
      return internalStateRef.current.muted;
    },
    set muted(val: boolean) {
      internalStateRef.current.muted = val;
      if (playerRef.current) {
        try {
          if (val && typeof playerRef.current.mute === 'function') {
            playerRef.current.mute();
          } else if (!val && typeof playerRef.current.unMute === 'function') {
            playerRef.current.unMute();
          }
        } catch {}
      }
    },
    get volume() {
      return internalStateRef.current.volume;
    },
    set volume(val: number) {
      internalStateRef.current.volume = val;
      if (playerRef.current && typeof playerRef.current.setVolume === 'function') {
        try {
          playerRef.current.setVolume(Math.round(val * 100));
        } catch {}
      }
    },
    play: async () => {
      internalStateRef.current.paused = false;
      if (playerRef.current && typeof playerRef.current.playVideo === 'function') {
        try {
          playerRef.current.playVideo();
        } catch {}
      }
    },
    pause: () => {
      internalStateRef.current.paused = true;
      if (playerRef.current && typeof playerRef.current.pauseVideo === 'function') {
        try {
          playerRef.current.pauseVideo();
        } catch {}
      }
    },
  }));

  // Initialize official YouTube IFrame Player
  useEffect(() => {
    let isDisposed = false;
    setIsApiLoading(true);
    setHasError(false);
    setErrorMessage(null);

    loadYouTubeIframeApi().then(() => {
      if (isDisposed) return;
      setIsApiLoading(false);

      try {
        if (playerRef.current) {
          playerRef.current.destroy();
          playerRef.current = null;
        }

        playerRef.current = new window.YT.Player(containerId, {
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
              if (isDisposed) return;
              setIsReady(true);
              if (isMuted) event.target.mute();
              else event.target.unMute();
              event.target.setVolume(Math.round(volume * 100));
            },
            onStateChange: (event: any) => {
              if (isDisposed) return;
              const s = event.data;
              internalStateRef.current.paused = s !== 1;
            },
            onError: (event: any) => {
              if (isDisposed) return;
              const code = event.data;
              let msg = 'Unable to play this YouTube video.';
              if (code === 2) msg = 'Invalid YouTube video ID parameter.';
              else if (code === 5) msg = 'HTML5 player error on YouTube.';
              else if (code === 100) msg = 'Video not found or has been marked private by its creator.';
              else if (code === 101 || code === 150) {
                msg = 'The video owner does not allow embedded playback outside YouTube.';
              }
              setHasError(true);
              setErrorMessage(msg);
              internalStateRef.current.error = new Error(msg);
              onError?.(msg);
            },
          },
        });
      } catch (err: any) {
        setHasError(true);
        setErrorMessage(err?.message || 'Failed to initialize YouTube player.');
      }
    });

    return () => {
      isDisposed = true;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
      }
    };
  }, [videoId, containerId]);

  // Sync mute and volume prop changes
  useEffect(() => {
    if (playerRef.current && isReady) {
      try {
        if (isMuted) playerRef.current.mute();
        else playerRef.current.unMute();
        playerRef.current.setVolume(Math.round(volume * 100));
      } catch {}
    }
  }, [isMuted, volume, isReady]);

  // Sync playbackRate prop changes
  useEffect(() => {
    if (playerRef.current && isReady && playbackRate) {
      try {
        playerRef.current.setPlaybackRate(playbackRate);
      } catch {}
    }
  }, [playbackRate, isReady]);

  return (
    <div className={`relative bg-black rounded-xl overflow-hidden aspect-video flex items-center justify-center ${className}`}>
      {/* Target DOM Element replaced by YouTube IFrame API */}
      <div id={containerId} className="w-full h-full" />

      {/* Loading Overlay */}
      {isApiLoading && (
        <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center gap-2.5 z-10">
          <Loader2 className="w-7 h-7 text-red-500 animate-spin" />
          <span className="text-xs text-slate-300 font-medium">Loading YouTube player...</span>
        </div>
      )}

      {/* Error Overlay */}
      {hasError && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm p-4 flex flex-col items-center justify-center text-center gap-3 z-20">
          <div className="p-2.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white">YouTube Playback Restricted</h4>
            <p className="text-xs text-slate-400 max-w-sm mt-1">{errorMessage}</p>
          </div>
          <div className="flex items-center gap-2 pt-1">
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
          YouTube &bull; Full Sync
        </span>
      </div>
    </div>
  );
});
