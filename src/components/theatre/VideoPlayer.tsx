/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import {
  Volume2,
  VolumeX,
  Maximize2,
  PictureInPicture,
  Play,
  Pause,
  AlertTriangle,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Info,
  CheckCircle2,
  Loader2,
  HardDrive,
  ExternalLink,
} from 'lucide-react';
import {
  resolvePlayableMediaUrl,
  classifyMediaError,
  ClassifiedMediaError,
  isGoogleDriveUrl,
  inspectMediaUrl,
} from '../../services/mediaResolver';
import { MediaPlayerElement } from '../../services/mediaProviders/types';
import { detectMediaProvider } from '../../services/mediaProviders/mediaProviderRegistry';
import { YouTubePlayer } from './players/YouTubePlayer';
import { GoogleDriveEmbedPlayer } from './players/GoogleDriveEmbedPlayer';
import { PatreonExternalPlayer } from './players/PatreonExternalPlayer';

interface VideoPlayerProps {
  id: string;
  src?: string;
  title: string;
  subtitle?: string;
  avatar?: string;
  isSource?: boolean;
  isPrimary?: boolean;
  isLocalFile?: boolean;
  hasAudio?: boolean;
  isMuted?: boolean;
  volume?: number;
  syncStatus?: string;
  playbackRate?: number;
  targetTimestamp?: number;
  onTimeUpdate?: (currentTime: number) => void;
  onTogglePlay?: () => void;
  onToggleMute?: () => void;
  onVolumeChange?: (val: number) => void;
  onTogglePip?: () => void;
  onErrorStateChange?: (hasError: boolean, errorDetail?: ClassifiedMediaError) => void;
  className?: string;
}

export interface VideoPlayerRef {
  getElement: () => MediaPlayerElement | HTMLVideoElement | null;
  seek: (time: number) => void;
  retry: () => void;
}

export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(function VideoPlayer(
  {
    id,
    src,
    title,
    subtitle,
    avatar,
    isSource = false,
    isPrimary = false,
    isLocalFile = false,
    hasAudio = true,
    isMuted = false,
    volume = 1.0,
    syncStatus = 'synced',
    playbackRate = 1.0,
    targetTimestamp,
    onTimeUpdate,
    onTogglePlay,
    onToggleMute,
    onVolumeChange,
    onTogglePip,
    onErrorStateChange,
    className = '',
  },
  ref
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const youtubePlayerRef = useRef<MediaPlayerElement | null>(null);
  const driveEmbedRef = useRef<MediaPlayerElement | null>(null);
  const patreonPlayerRef = useRef<MediaPlayerElement | null>(null);

  // Provider detection & capabilities
  const providerInfo = useMemo(() => detectMediaProvider(src || '', isLocalFile), [src, isLocalFile]);
  const [forceDriveEmbed, setForceDriveEmbed] = useState(false);

  // Resolved media URL (e.g. Google Drive resolved to /api/media/stream?driveId=...)
  const resolvedSrc = src ? resolvePlayableMediaUrl(src) : '';

  // Media loading & diagnostic states
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<ClassifiedMediaError | null>(null);
  const [serverInspectResult, setServerInspectResult] = useState<any>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(180);
  const [lastMediaEvent, setLastMediaEvent] = useState<string>('idle');

  // Remember intended timeline position across retries
  const pendingSeekTimeRef = useRef<number | null>(null);

  // Reset error state when src changes
  useEffect(() => {
    setHasError(false);
    setErrorInfo(null);
    setServerInspectResult(null);
    setIsRetrying(false);
    setForceDriveEmbed(false);
    onErrorStateChange?.(false);
  }, [src]);

  // Handle Retry action
  const handleRetry = useCallback(() => {
    if (providerInfo.provider === 'youtube') {
      setHasError(false);
      setErrorInfo(null);
      onErrorStateChange?.(false);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    setIsRetrying(true);
    setHasError(false);
    setErrorInfo(null);
    onErrorStateChange?.(false);

    // Save current playback position
    pendingSeekTimeRef.current = video.currentTime > 0 ? video.currentTime : currentTime;

    // Trigger fresh reload on the video element
    video.load();

    // Reset retrying state after a brief delay
    setTimeout(() => {
      setIsRetrying(false);
    }, 1200);
  }, [currentTime, onErrorStateChange, providerInfo.provider]);

  useImperativeHandle(ref, () => ({
    getElement: () => {
      if (providerInfo.provider === 'youtube') {
        return youtubePlayerRef.current;
      }
      if (providerInfo.provider === 'patreon') {
        return patreonPlayerRef.current;
      }
      if (forceDriveEmbed && providerInfo.fileId) {
        return driveEmbedRef.current;
      }
      return videoRef.current;
    },
    seek: (time: number) => {
      if (providerInfo.provider === 'youtube' && youtubePlayerRef.current) {
        youtubePlayerRef.current.currentTime = time;
        return;
      }
      if (providerInfo.provider === 'patreon' && patreonPlayerRef.current) {
        patreonPlayerRef.current.currentTime = time;
        return;
      }
      if (forceDriveEmbed && driveEmbedRef.current) {
        driveEmbedRef.current.currentTime = time;
        return;
      }
      if (videoRef.current) {
        if (videoRef.current.readyState >= 1) {
          videoRef.current.currentTime = time;
        } else {
          pendingSeekTimeRef.current = time;
        }
      }
    },
    retry: () => {
      if (forceDriveEmbed) {
        setForceDriveEmbed(false);
      }
      handleRetry();
    },
  }));

  // Handle volume, mute, and playback rate sync for native player
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      videoRef.current.volume = volume;
      videoRef.current.playbackRate = playbackRate;
    }
  }, [isMuted, volume, playbackRate]);

  // Media Event Handlers
  const handleLoadStart = () => {
    setLastMediaEvent('loadstart');
  };

  const handleLoadedMetadata = () => {
    setLastMediaEvent('loadedmetadata');
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      if (dur && !isNaN(dur) && dur > 0) {
        setDuration(dur);
      }
      // If we had a pending seek from before retry
      if (pendingSeekTimeRef.current !== null && pendingSeekTimeRef.current > 0) {
        videoRef.current.currentTime = pendingSeekTimeRef.current;
        pendingSeekTimeRef.current = null;
      }
    }
  };

  const handleLoadedData = () => {
    setLastMediaEvent('loadeddata');
  };

  const handleCanPlay = () => {
    setLastMediaEvent('canplay');
    setHasError(false);
    setIsBuffering(false);
    onErrorStateChange?.(false);
  };

  const handleWaiting = () => {
    setLastMediaEvent('waiting');
    setIsBuffering(true);
  };

  const handlePlaying = () => {
    setLastMediaEvent('playing');
    setIsPlaying(true);
    setIsBuffering(false);
  };

  const handlePause = () => {
    setLastMediaEvent('pause');
    setIsPlaying(false);
  };

  const handleStalled = () => {
    setLastMediaEvent('stalled');
  };

  const handleError = () => {
    setLastMediaEvent('error');
    setIsBuffering(false);
    setHasError(true);

    const video = videoRef.current;
    const mediaError = video?.error || null;
    const readyState = video?.readyState;
    const networkState = video?.networkState;

    const classified = classifyMediaError(mediaError, src, readyState, networkState);
    setErrorInfo(classified);
    onErrorStateChange?.(true, classified);

    // Asynchronously perform background inspection to fetch server status code & exact error
    if (src) {
      inspectMediaUrl(src).then((res) => {
        setServerInspectResult(res);
      }).catch(() => {});
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const cur = videoRef.current.currentTime;
      setCurrentTime(cur);
      onTimeUpdate?.(cur);
    }
  };

  // Canvas visualizer fallback only when no src is provided (e.g. blank preview)
  useEffect(() => {
    if (src && !hasError) return;
    if (hasError) return; // Show clean error overlay when there's an actual error

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const time = currentTime;

      const grad = ctx.createLinearGradient(0, 0, w, h);
      if (isSource) {
        grad.addColorStop(0, '#0f172a');
        grad.addColorStop(1, '#020617');
      } else {
        grad.addColorStop(0, '#1e1b4b');
        grad.addColorStop(1, '#090514');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = isSource ? 'rgba(56, 189, 248, 0.08)' : 'rgba(168, 85, 247, 0.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = '600 22px monospace';
      ctx.textAlign = 'center';
      const mins = Math.floor(time / 60);
      const secs = (time % 60).toFixed(2).padStart(5, '0');
      ctx.fillText(`${String(mins).padStart(2, '0')}:${secs}`, w / 2, h / 2 + 20);

      ctx.font = '500 12px system-ui, sans-serif';
      ctx.fillStyle = isSource ? '#7dd3fc' : '#d8b4fe';
      ctx.fillText(isSource ? 'AWAITING SOURCE FEED' : `AWAITING REACTION: ${title.toUpperCase()}`, w / 2, h / 2 + 50);

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [currentTime, hasError, isSource, src, title]);

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const streamRoleLabel = isSource
    ? 'Original Source Stream'
    : isPrimary
    ? 'Primary Reaction Stream'
    : 'Reactor Stream';

  return (
    <div
      className={`relative group bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-xl flex flex-col justify-between ${className}`}
      data-testid={`player-${id}`}
    >
      {/* Video Viewport / Error Viewport */}
      <div className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden aspect-video">
        {src && providerInfo.provider === 'youtube' && providerInfo.videoId ? (
          <YouTubePlayer
            ref={youtubePlayerRef}
            id={id}
            videoId={providerInfo.videoId}
            title={title}
            isMuted={isMuted}
            volume={volume}
            playbackRate={playbackRate}
            onTimeUpdate={(t) => {
              setCurrentTime(t);
              onTimeUpdate?.(t);
            }}
            onTogglePlay={onTogglePlay}
            onError={(msg) => {
              setHasError(true);
              setErrorInfo({
                code: 99,
                codeName: 'YOUTUBE_RESTRICTED',
                title: 'YouTube Playback Restricted',
                summary: msg,
                detail: msg,
                isGoogleDrive: false,
                actionableSteps: [
                  'Verify the video is public or unlisted.',
                  'Ensure embedding is not disabled by the content creator.',
                  'Click "Watch on YouTube" to open directly.',
                ],
              });
              onErrorStateChange?.(true);
            }}
            className="w-full h-full"
          />
        ) : src && providerInfo.provider === 'patreon' ? (
          <PatreonExternalPlayer
            ref={patreonPlayerRef}
            id={id}
            url={src}
            title={title}
            subtitle={subtitle}
            avatar={avatar}
            targetTimestamp={targetTimestamp ?? currentTime}
            className="w-full h-full"
          />
        ) : src && forceDriveEmbed && providerInfo.fileId ? (
          <GoogleDriveEmbedPlayer
            ref={driveEmbedRef}
            id={id}
            fileId={providerInfo.fileId}
            title={title}
            className="w-full h-full"
          />
        ) : (
          <>
            {/* Real HTML5 Video Element */}
            <video
              ref={videoRef}
              src={resolvedSrc}
              playsInline
              muted={isMuted}
              onLoadStart={handleLoadStart}
              onLoadedMetadata={handleLoadedMetadata}
              onLoadedData={handleLoadedData}
              onCanPlay={handleCanPlay}
              onWaiting={handleWaiting}
              onPlaying={handlePlaying}
              onPause={handlePause}
              onStalled={handleStalled}
              onError={handleError}
              onTimeUpdate={handleTimeUpdate}
              className={`w-full h-full object-contain ${hasError || !src ? 'hidden' : 'block'}`}
            />

            {/* Buffering Indicator */}
            {isBuffering && !hasError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-xs pointer-events-none">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700 text-xs text-white">
                  <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                  <span>Buffering stream...</span>
                </div>
              </div>
            )}

            {/* Actionable Diagnostics Error Overlay */}
            {hasError && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/95 p-4 text-center overflow-y-auto">
                <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center mb-2.5 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>

                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                  <span>{streamRoleLabel} Error</span>
                </div>

                <h3 className="text-sm font-bold text-white mb-1">
                  {errorInfo?.title || 'Video Stream Could Not Be Played'}
                </h3>
                <p className="text-xs text-slate-300 max-w-md mb-3 leading-relaxed">
                  {errorInfo?.summary ||
                    'The browser encountered a media decoding or access error while loading this stream.'}
                </p>

                {/* Actionable Steps */}
                {errorInfo?.actionableSteps && errorInfo.actionableSteps.length > 0 && (
                  <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 mb-3 text-left max-w-md w-full">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                      How to resolve:
                    </span>
                    <ul className="text-[11px] text-slate-300 space-y-1 list-disc list-inside">
                      {errorInfo.actionableSteps.map((step, idx) => (
                        <li key={idx} className="leading-tight">
                          {step}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Retry & Embed Switch Buttons */}
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  <button
                    onClick={handleRetry}
                    disabled={isRetrying}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                    <span>{isRetrying ? 'Retrying Stream...' : 'Retry Video'}</span>
                  </button>

                  {providerInfo.provider === 'google_drive' && providerInfo.fileId && !forceDriveEmbed && (
                    <button
                      onClick={() => {
                        setForceDriveEmbed(true);
                        setHasError(false);
                        onErrorStateChange?.(false);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer"
                    >
                      <HardDrive className="w-3.5 h-3.5" />
                      <span>Switch to Drive Preview Embed</span>
                    </button>
                  )}

                  <button
                    onClick={() => setShowDiagnostics((prev) => !prev)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs transition-colors cursor-pointer"
                  >
                    <Info className="w-3.5 h-3.5" />
                    <span>Details</span>
                    {showDiagnostics ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {/* Collapsible Technical Diagnostics */}
                {showDiagnostics && (
                  <div className="mt-3 bg-black/80 border border-slate-800 rounded-lg p-3 text-left max-w-md w-full font-mono text-[10px] text-slate-400 space-y-1">
                    <div>
                      <span className="text-slate-500">Error Code:</span>{' '}
                      <span className="text-rose-400 font-semibold">
                        {errorInfo?.codeName} (code {errorInfo?.code})
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Last Event:</span>{' '}
                      <span className="text-slate-200">{lastMediaEvent}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Ready / Network State:</span>{' '}
                      <span className="text-slate-200">
                        {videoRef.current?.readyState ?? 0} / {videoRef.current?.networkState ?? 0}
                      </span>
                    </div>
                    <div className="truncate">
                      <span className="text-slate-500">Target URL:</span>{' '}
                      <span className="text-indigo-300 truncate" title={src}>
                        {src}
                      </span>
                    </div>
                    {serverInspectResult && (
                      <div>
                        <span className="text-slate-500">Server Inspection:</span>{' '}
                        <span
                          className={serverInspectResult.ok ? 'text-emerald-400' : 'text-amber-400'}
                        >
                          {serverInspectResult.humanMessage}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Fallback canvas when video source isn't provided (blank canvas mode) */}
            {!src && !hasError && (
              <canvas
                ref={canvasRef}
                width={640}
                height={360}
                className="w-full h-full object-cover block"
              />
            )}
          </>
        )}

        {/* Top Overlay Badge */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none z-10">
          <div className="flex items-center gap-2 bg-slate-950/80 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-slate-700/60 shadow-md">
            {avatar && (
              <img
                src={avatar}
                alt=""
                className="w-5 h-5 rounded-full object-cover ring-1 ring-slate-600"
              />
            )}
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-white tracking-tight truncate max-w-[180px]">
                {title}
              </span>
              {subtitle && <span className="text-[10px] text-slate-400 truncate max-w-[180px]">{subtitle}</span>}
            </div>
            {isSource ? (
              <span className="ml-1 text-[10px] font-bold tracking-wider bg-sky-500/20 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded">
                SOURCE
              </span>
            ) : isPrimary ? (
              <span className="ml-1 text-[10px] font-bold tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded">
                PRIMARY
              </span>
            ) : (
              <span className="ml-1 text-[10px] font-medium bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">
                REACTOR
              </span>
            )}
            {isLocalFile ? (
              <span className="ml-1 text-[9px] font-bold tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                LOCAL
              </span>
            ) : providerInfo.provider === 'youtube' ? (
              <span className="ml-1 text-[9px] font-bold tracking-wider bg-red-500/20 text-red-300 border border-red-500/30 px-1.5 py-0.5 rounded">
                YOUTUBE
              </span>
            ) : providerInfo.provider === 'patreon' ? (
              <span className="ml-1 text-[9px] font-bold tracking-wider bg-orange-500/20 text-orange-300 border border-orange-500/30 px-1.5 py-0.5 rounded">
                PATREON
              </span>
            ) : providerInfo.provider === 'google_drive' ? (
              <span className="ml-1 text-[9px] font-bold tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded">
                {forceDriveEmbed ? 'DRIVE EMBED' : 'DRIVE STREAM'}
              </span>
            ) : src ? (
              <span className="ml-1 text-[9px] font-bold tracking-wider bg-sky-500/20 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded">
                DIRECT STREAM
              </span>
            ) : null}
          </div>

          {/* Sync status indicator */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 backdrop-blur-md px-2 py-1 rounded-md border border-slate-700/60 text-[11px]">
            <span
              className={`w-2 h-2 rounded-full ${
                hasError
                  ? 'bg-rose-500'
                  : isBuffering
                  ? 'bg-blue-400 animate-spin'
                  : syncStatus === 'synced'
                  ? 'bg-emerald-400 animate-pulse'
                  : syncStatus === 'adjusting'
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-indigo-400'
              }`}
            />
            <span className="font-medium text-slate-200 capitalize">
              {hasError ? 'Stream Error' : isBuffering ? 'Buffering' : syncStatus}
            </span>
          </div>
        </div>

        {/* Centered play overlay on hover if user clicks player */}
        {!hasError && src && (
          <button
            onClick={onTogglePlay}
            className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-slate-900/70 border border-white/20 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 pointer-events-auto"
            aria-label={isPlaying ? 'Pause video' : 'Play video'}
          >
            {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
          </button>
        )}

        {/* Bottom player controls bar */}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/90 via-slate-950/60 to-transparent p-2.5 flex items-center justify-between text-xs text-slate-200 opacity-90 group-hover:opacity-100 transition-opacity">
          <div className="flex items-center gap-3">
            <button
              onClick={onToggleMute}
              className={`p-1.5 rounded hover:bg-slate-800 transition-colors ${
                isMuted ? 'text-rose-400' : 'text-slate-200'
              }`}
              title={isMuted ? 'Unmute' : 'Mute'}
              aria-label={isMuted ? `Unmute ${title}` : `Mute ${title}`}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            {/* Volume slider */}
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => onVolumeChange?.(parseFloat(e.target.value))}
              className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              aria-label={`Volume for ${title}`}
            />

            <span className="font-mono text-[11px] text-slate-300">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {onTogglePip && (
              <button
                onClick={onTogglePip}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
                title="Picture in Picture"
                aria-label="Toggle Picture in Picture"
              >
                <PictureInPicture className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => {
                const el = videoRef.current;
                if (el) {
                  if (el.requestFullscreen) el.requestFullscreen();
                }
              }}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
              title="Fullscreen"
              aria-label="Enter fullscreen"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
