/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useImperativeHandle, forwardRef } from 'react';
import {
  MANUAL_ONLY_CAPABILITIES,
  MediaPlayerAdapter,
} from '../../../services/mediaProviders/types';
import { ExternalLink, Lock } from 'lucide-react';

export interface PatreonExternalPlayerProps {
  id: string;
  url: string;
  title?: string;
  subtitle?: string;
  avatar?: string;
  targetTimestamp?: number | null;
  className?: string;
}

function formatCueTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '--:--';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function createPatreonExternalAdapter(id: string): MediaPlayerAdapter {
  return {
    id,
    provider: 'patreon',
    playbackMode: 'external',
    syncCapability: 'manual_sync',
    capabilities: MANUAL_ONLY_CAPABILITIES,
    getCurrentTime: () => null,
    getDuration: () => null,
    isPaused: () => null,
    isBuffering: () => false,
    getReadyState: () => 0,
    getError: () => null,
    getPlaybackRate: () => null,
    isMuted: () => null,
    getVolume: () => null,
    play: async () => false,
    pause: () => false,
    seekTo: () => false,
    setPlaybackRate: () => false,
    setMuted: () => false,
    setVolume: () => false,
  };
}

export const PatreonExternalPlayer = forwardRef<MediaPlayerAdapter, PatreonExternalPlayerProps>(
  function PatreonExternalPlayer(
    { id, url, title, subtitle, avatar, targetTimestamp = 0, className = '' },
    ref
  ) {
    useImperativeHandle(ref, () => createPatreonExternalAdapter(id), [id]);

    return (
      <div
        className={`relative bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 rounded-xl overflow-hidden aspect-video flex flex-col items-center justify-center p-6 text-center ${className}`}
      >
        {/* Top Provider Badge */}
        <div className="absolute top-2 left-2 z-10 pointer-events-none">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-md text-[10px] font-bold border border-orange-500/30 text-orange-400">
            <Lock className="w-3 h-3" />
            Patreon &bull; External / Manual Sync
          </span>
        </div>

        {/* Avatar or Logo */}
        <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-orange-500 to-rose-600 flex items-center justify-center text-white mb-3 shadow-lg shadow-orange-500/20">
          {avatar ? (
            <img src={avatar} alt={subtitle || 'Creator'} className="w-full h-full rounded-full object-cover" />
          ) : (
            <span className="font-extrabold text-lg">P</span>
          )}
        </div>

        <h3 className="text-sm sm:text-base font-bold text-white max-w-sm truncate">
          {title || 'Patreon Creator Stream'}
        </h3>
        <p className="text-xs text-slate-400 mt-1 max-w-xs">
          {subtitle ? `${subtitle} on Patreon` : 'Membership-protected content'}
        </p>

        {/* Live Synchronization Target Cue Marker computed from session timeline */}
        <div className="my-3 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/80 flex items-center gap-2 text-xs">
          <span className="text-slate-400">Target Cue on Patreon:</span>
          <span className="font-mono font-bold text-amber-400">{formatCueTime(targetTimestamp)}</span>
        </div>

        <div className="flex items-center gap-2.5">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold shadow-lg shadow-orange-600/30 transition-all cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open on Patreon
          </a>
        </div>

        <p className="text-[11px] text-slate-400 mt-3 max-w-xs">
          Patreon hosts playback externally. Open it in another tab and use SyncView timeline cues to align playback.
        </p>
      </div>
    );
  }
);
