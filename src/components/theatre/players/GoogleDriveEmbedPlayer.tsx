/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useImperativeHandle, forwardRef, useState } from 'react';
import { MediaPlayerElement } from '../../../services/mediaProviders/types';
import { ExternalLink, HardDrive, Info } from 'lucide-react';

export interface GoogleDriveEmbedPlayerProps {
  id: string;
  fileId: string;
  title?: string;
  className?: string;
}

export const GoogleDriveEmbedPlayer = forwardRef<MediaPlayerElement, GoogleDriveEmbedPlayerProps>(
  function GoogleDriveEmbedPlayer({ id, fileId, title, className = '' }, ref) {
    const embedUrl = `https://drive.google.com/file/d/${fileId}/preview`;
    const shareUrl = `https://drive.google.com/file/d/${fileId}/view`;

    const [currentTime, setCurrentTime] = useState(0);
    const [paused, setPaused] = useState(true);

    // Provide MediaPlayerElement interface for session coordination
    useImperativeHandle(ref, () => ({
      get currentTime() {
        return currentTime;
      },
      set currentTime(val: number) {
        setCurrentTime(val);
      },
      get duration() {
        return 180;
      },
      get paused() {
        return paused;
      },
      get error() {
        return null;
      },
      get readyState() {
        return 4;
      },
      get playbackRate() {
        return 1.0;
      },
      set playbackRate(_val: number) {},
      get muted() {
        return false;
      },
      set muted(_val: boolean) {},
      get volume() {
        return 1.0;
      },
      set volume(_val: number) {},
      play: () => {
        setPaused(false);
      },
      pause: () => {
        setPaused(true);
      },
    }));

    return (
      <div className={`relative bg-black rounded-xl overflow-hidden aspect-video flex flex-col ${className}`}>
        {/* Official Google Drive Preview IFrame */}
        <iframe
          src={embedUrl}
          title={title || 'Google Drive Video'}
          allow="autoplay; fullscreen"
          className="w-full h-full border-0"
        />

        {/* Top Info Pill */}
        <div className="absolute top-2 left-2 z-10 pointer-events-none">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-md text-[10px] font-bold text-amber-400 border border-amber-500/30">
            <HardDrive className="w-3 h-3" />
            Google Drive Preview
          </span>
        </div>

        {/* External Link Action */}
        <div className="absolute top-2 right-2 z-10">
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
