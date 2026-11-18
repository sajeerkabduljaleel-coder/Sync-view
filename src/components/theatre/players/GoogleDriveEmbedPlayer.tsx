/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useImperativeHandle, forwardRef } from 'react';
import {
  MANUAL_ONLY_CAPABILITIES,
  MediaPlayerAdapter,
} from '../../../services/mediaProviders/types';
import { ExternalLink, HardDrive, RotateCcw } from 'lucide-react';

export interface GoogleDriveEmbedPlayerProps {
  id: string;
  fileId: string;
  title?: string;
  onTryDirectStream?: () => void;
  className?: string;
}

export function createGoogleDrivePreviewAdapter(id: string): MediaPlayerAdapter {
  return {
    id,
    provider: 'google_drive',
    playbackMode: 'embedded',
    syncCapability: 'manual_sync',
    capabilities: MANUAL_ONLY_CAPABILITIES,
    getCurrentTime: () => null,
    getDuration: () => null,
    isPaused: () => null,
    isBuffering: () => false,
    getReadyState: () => 1,
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

export const GoogleDriveEmbedPlayer = forwardRef<MediaPlayerAdapter, GoogleDriveEmbedPlayerProps>(
  function GoogleDriveEmbedPlayer({ id, fileId, title, onTryDirectStream, className = '' }, ref) {
    const embedUrl = `https://drive.google.com/file/d/${fileId}/preview`;
    const shareUrl = `https://drive.google.com/file/d/${fileId}/view`;

    useImperativeHandle(ref, () => createGoogleDrivePreviewAdapter(id), [id]);

    return (
      <div className={`relative bg-black rounded-xl overflow-hidden aspect-video flex flex-col ${className}`}>
        {/* Official Google Drive Preview IFrame */}
        <iframe
          src={embedUrl}
          title={title || 'Google Drive Video'}
          allow="autoplay; fullscreen"
          className="w-full h-full border-0"
        />

        {/* Top Info & Manual Sync Pill */}
        <div className="absolute top-2 left-2 z-10 pointer-events-none">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/80 backdrop-blur-md text-[10px] font-bold text-amber-300 border border-amber-500/40">
            <HardDrive className="w-3 h-3" />
            Drive Preview &bull; Manual Sync (Controls Restricted)
          </span>
        </div>

        {/* Action Buttons */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
          {onTryDirectStream && (
            <button
              type="button"
              onClick={onTryDirectStream}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-950/90 hover:bg-indigo-900 text-[11px] font-medium text-indigo-200 border border-indigo-500/40 shadow-md transition-colors cursor-pointer"
              title="Retry verified Google Drive proxy stream for automatic sync"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">Try Auto-Sync Stream</span>
            </button>
          )}
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-900/90 hover:bg-slate-800 text-[11px] font-medium text-slate-200 border border-slate-700 shadow-md transition-colors"
            title="Open file in Google Drive"
          >
            <ExternalLink className="w-3 h-3" />
            <span className="hidden sm:inline">Drive View</span>
          </a>
        </div>
      </div>
    );
  }
);
