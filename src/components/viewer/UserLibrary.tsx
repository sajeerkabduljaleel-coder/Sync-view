/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ReactionVideo, VideoSource } from '../../types';
import { Bookmark, Clock, Play, Trash2, Heart, MessageSquare } from 'lucide-react';

interface UserLibraryProps {
  sources: VideoSource[];
  reactions: ReactionVideo[];
  onWatch: (source: VideoSource, reaction: ReactionVideo) => void;
}

export function UserLibrary({ sources, reactions, onWatch }: UserLibraryProps) {
  const [activeTab, setActiveTab] = useState<'saved' | 'history' | 'notes'>('saved');

  // Demo user saved items
  const savedReactions = reactions.slice(0, 3);
  const watchHistory = reactions.slice(0, 4);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 w-full flex flex-col gap-6">
      <div className="border-b border-slate-800 pb-4">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Bookmark className="w-5 h-5 text-indigo-400" />
          <span>My Library</span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Your saved reactions, viewing history, and personal timestamped notes.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('saved')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'saved'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Saved Reactions ({savedReactions.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'history'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Watch History ({watchHistory.length})
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {savedReactions.map((rx) => {
          const src = sources.find((s) => s.id === rx.sourceId) || sources[0];
          return (
            <div
              key={rx.id}
              onClick={() => onWatch(src, rx)}
              className="bg-slate-900/60 border border-slate-800 hover:border-slate-700 rounded-2xl overflow-hidden p-3.5 flex flex-col justify-between gap-3 group cursor-pointer transition-all"
            >
              <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
                <img
                  src={rx.thumbnail}
                  alt=""
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Play className="w-4 h-4 fill-white ml-0.5" />
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-white line-clamp-1 group-hover:text-indigo-400">
                  {rx.title}
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Reacting to: {src.title}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                <span>By {rx.creator}</span>
                <span className="text-indigo-400 font-mono text-[10px]">
                  {rx.introDuration}s intro offset
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
