/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { Volume2, VolumeX, Maximize2, PictureInPicture, Play, Pause } from 'lucide-react';

interface VideoPlayerProps {
  id: string;
  src?: string;
  title: string;
  subtitle?: string;
  avatar?: string;
  isSource?: boolean;
  isPrimary?: boolean;
  hasAudio?: boolean;
  isMuted?: boolean;
  volume?: number;
  syncStatus?: string;
  playbackRate?: number;
  onTimeUpdate?: (currentTime: number) => void;
  onTogglePlay?: () => void;
  onToggleMute?: () => void;
  onVolumeChange?: (val: number) => void;
  onTogglePip?: () => void;
  className?: string;
}

export interface VideoPlayerRef {
  getElement: () => HTMLVideoElement | null;
  seek: (time: number) => void;
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
    hasAudio = true,
    isMuted = false,
    volume = 1.0,
    syncStatus = 'synced',
    playbackRate = 1.0,
    onTimeUpdate,
    onTogglePlay,
    onToggleMute,
    onVolumeChange,
    onTogglePip,
    className = '',
  },
  ref
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasError, setHasError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(180);

  useImperativeHandle(ref, () => ({
    getElement: () => videoRef.current,
    seek: (time: number) => {
      if (videoRef.current) {
        videoRef.current.currentTime = time;
      }
    },
  }));

  // Handle media updates
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      videoRef.current.volume = volume;
      videoRef.current.playbackRate = playbackRate;
    }
  }, [isMuted, volume, playbackRate]);

  // Canvas visualizer fallback for rock-solid sync demonstration
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const time = videoRef.current ? videoRef.current.currentTime : currentTime;

      // Dark cinematic backdrop
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

      // Animated waveform bar visualization
      const bars = 24;
      const barWidth = 6;
      const startX = (w - bars * (barWidth + 4)) / 2;
      ctx.fillStyle = isSource ? '#38bdf8' : '#a855f7';

      for (let i = 0; i < bars; i++) {
        const offset = i * 0.2;
        const wave = Math.sin(time * 4 + offset) * 0.5 + 0.5;
        const barH = isPlaying ? 10 + wave * 45 : 8;
        const bx = startX + i * (barWidth + 4);
        const by = h / 2 - barH / 2;
        ctx.beginPath();
        ctx.roundRect(bx, by, barWidth, barH, 3);
        ctx.fill();
      }

      // Precise timecode readout
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 24px monospace';
      ctx.textAlign = 'center';
      const mins = Math.floor(time / 60);
      const secs = (time % 60).toFixed(2).padStart(5, '0');
      const timeStr = `${String(mins).padStart(2, '0')}:${secs}`;
      ctx.fillText(timeStr, w / 2, h / 2 + 55);

      // Stream label
      ctx.font = '500 13px system-ui, sans-serif';
      ctx.fillStyle = isSource ? '#7dd3fc' : '#d8b4fe';
      ctx.fillText(isSource ? 'ORIGINAL SOURCE FEED' : `REACTION: ${title.toUpperCase()}`, w / 2, h / 2 + 82);

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [currentTime, isPlaying, isSource, title]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const cur = videoRef.current.currentTime;
      setCurrentTime(cur);
      onTimeUpdate?.(cur);
    }
  };

  const handlePlayState = (playing: boolean) => {
    setIsPlaying(playing);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={`relative group bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-xl flex flex-col justify-between ${className}`}
      data-testid={`player-${id}`}
    >
      {/* Video / Synthetic Fallback layer */}
      <div className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden aspect-video">
        <video
          ref={videoRef}
          src={src}
          playsInline
          muted={isMuted}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => handlePlayState(true)}
          onPause={() => handlePlayState(false)}
          onLoadedMetadata={() => {
            if (videoRef.current) setDuration(videoRef.current.duration || 180);
          }}
          onError={() => setHasError(true)}
          className={`w-full h-full object-contain ${hasError ? 'hidden' : 'block'}`}
        />

        {/* Fallback canvas when video source isn't provided or fails */}
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          className={`w-full h-full object-cover ${hasError || !src ? 'block' : 'hidden'}`}
        />

        {/* Top Overlay Badge */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
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
          </div>

          {/* Sync status indicator */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 backdrop-blur-md px-2 py-1 rounded-md border border-slate-700/60 text-[11px]">
            <span
              className={`w-2 h-2 rounded-full ${
                syncStatus === 'synced'
                  ? 'bg-emerald-400 animate-pulse'
                  : syncStatus === 'adjusting'
                  ? 'bg-amber-400 animate-ping'
                  : syncStatus === 'buffering'
                  ? 'bg-blue-400 animate-spin'
                  : 'bg-indigo-400'
              }`}
            />
            <span className="font-medium text-slate-200 capitalize">{syncStatus}</span>
          </div>
        </div>

        {/* Centered play overlay on hover if user clicks player */}
        <button
          onClick={onTogglePlay}
          className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-slate-900/70 border border-white/20 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 pointer-events-auto"
          aria-label={isPlaying ? 'Pause video' : 'Play video'}
        >
          {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
        </button>

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
