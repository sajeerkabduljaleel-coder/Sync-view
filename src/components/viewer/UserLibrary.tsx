/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ReactionVideo, VideoSource } from '../../types';
import { Bookmark, Clock, Play, Trash2, Heart, Tv } from 'lucide-react';
import { catalogueService, SavedStreamSetup } from '../../services/catalogueService';

interface UserLibraryProps {
  sources: VideoSource[];
  reactions: ReactionVideo[];
  onWatch: (source: VideoSource, reaction: ReactionVideo, extraReactions?: ReactionVideo[]) => void;
  onOpenStreamChooser?: () => void;
}

export function UserLibrary({ sources, reactions, onWatch, onOpenStreamChooser }: UserLibraryProps) {
  const [activeTab, setActiveTab] = useState<'saved' | 'history'>('saved');
  const [savedSetups, setSavedSetups] = useState<SavedStreamSetup[]>([]);

  useEffect(() => {
    catalogueService.getSavedStreamSetups().then(setSavedSetups);
  }, []);

  const handleDeleteSetup = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await catalogueService.deleteStreamSetup(id);
    setSavedSetups((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 w-full flex flex-col gap-6">
      <div className="border-b border-slate-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-indigo-400" />
            <span>My Library</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Your saved synchronized stream configurations and viewing library.
          </p>
        </div>

        {onOpenStreamChooser && (
          <button
            onClick={onOpenStreamChooser}
            className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/30 flex items-center gap-2 self-start sm:self-auto transition-all cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Configure New Stream</span>
          </button>
        )}
      </div>

      {/* Saved stream setups */}
      {savedSetups.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-center gap-4 bg-slate-900/30 border border-slate-800/80 rounded-3xl p-8">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
            <Tv className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">No saved stream configurations yet</h3>
            <p className="text-xs text-slate-400 max-w-sm mt-1">
              When you configure and save video streams in the canvas, they will appear here for fast 1-click launch.
            </p>
          </div>
          {onOpenStreamChooser && (
            <button
              onClick={onOpenStreamChooser}
              className="mt-2 px-5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 transition-all cursor-pointer"
            >
              Choose Streams to Watch
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {savedSetups.map((setup) => (
            <div
              key={setup.id}
              onClick={() => onWatch(setup.source, setup.primaryReaction, setup.extraReactions)}
              className="bg-slate-900/60 border border-slate-800 hover:border-indigo-500/50 rounded-2xl overflow-hidden p-4 flex flex-col justify-between gap-3 group cursor-pointer transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-indigo-400 bg-indigo-950/60 border border-indigo-500/20 px-2.5 py-0.5 rounded-md">
                  {setup.source.category}
                </span>
                <button
                  type="button"
                  onClick={(e) => handleDeleteSetup(e, setup.id)}
                  className="text-slate-500 hover:text-red-400 transition-colors p-1"
                  title="Remove saved stream"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div>
                <h4 className="text-xs font-bold text-white line-clamp-1 group-hover:text-indigo-400 transition-colors">
                  {setup.title}
                </h4>
                <p className="text-[11px] text-slate-400 mt-1">
                  Source: {setup.source.title}
                </p>
                <p className="text-[11px] text-slate-400">
                  Reactor: {setup.primaryReaction.creator} ({setup.primaryReaction.introDuration}s intro)
                </p>
                {setup.extraReactions && setup.extraReactions.length > 0 && (
                  <span className="text-[10px] text-purple-400 mt-1 block">
                    +{setup.extraReactions.length} extra synchronized reactors
                  </span>
                )}
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                <span>{new Date(setup.savedAt).toLocaleDateString()}</span>
                <span className="text-indigo-400 font-semibold group-hover:translate-x-1 transition-transform flex items-center gap-1">
                  Launch in Theatre &rarr;
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
