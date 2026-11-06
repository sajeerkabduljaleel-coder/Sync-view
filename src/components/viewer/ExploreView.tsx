/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { VideoSource, ReactionVideo } from '../../types';
import { Search, Filter, Play, Layers, Eye } from 'lucide-react';

interface ExploreViewProps {
  sources: VideoSource[];
  reactions: ReactionVideo[];
  onWatch: (source: VideoSource, reaction: ReactionVideo) => void;
}

export function ExploreView({ sources, reactions, onWatch }: ExploreViewProps) {
  const [selectedCat, setSelectedCat] = useState('All');
  const [search, setSearch] = useState('');

  const categories = ['All', 'Movies & TV', 'Gaming', 'Music', 'Tech'];

  const filteredSources = sources.filter((s) => {
    const matchCat = selectedCat === 'All' || s.category === selectedCat;
    const matchSearch =
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.creator.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 w-full flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white">Explore Original Sources & Reactions</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Discover films, gaming runs, and music videos with synchronized creator commentary.
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search catalogue..."
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setSelectedCat(c)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
              selectedCat === c
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Sources Grid with Linked Reactions Drawer */}
      <div className="space-y-6">
        {filteredSources.map((source) => {
          const linkedReactions = reactions.filter((r) => r.sourceId === source.id);

          return (
            <div
              key={source.id}
              className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 sm:p-5 flex flex-col gap-4 shadow-lg"
            >
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="flex gap-3 items-center">
                  <img
                    src={source.thumbnail}
                    alt=""
                    className="w-24 h-16 rounded-xl object-cover ring-1 ring-slate-800"
                  />
                  <div>
                    <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">
                      {source.category}
                    </span>
                    <h3 className="text-sm font-bold text-white">{source.title}</h3>
                    <p className="text-xs text-slate-400">{source.creator} &bull; {source.releaseYear}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">
                    {linkedReactions.length} Linked Reaction{linkedReactions.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              {/* Linked Reactions Carousels / Horizontal Scroll */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t border-slate-800/80">
                {linkedReactions.map((rx) => (
                  <div
                    key={rx.id}
                    onClick={() => onWatch(source, rx)}
                    className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900/80 transition-all flex items-center justify-between gap-3 cursor-pointer group"
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden">
                      <img
                        src={rx.avatar}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover shrink-0 ring-1 ring-slate-700"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold text-slate-200 truncate group-hover:text-indigo-300">
                          {rx.creator}
                        </span>
                        <span className="text-[10px] text-slate-400 truncate">{rx.title}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-slate-400 font-mono">
                        {rx.introDuration}s intro
                      </span>
                      <div className="p-1.5 rounded-lg bg-indigo-600/80 text-white group-hover:bg-indigo-600 transition-colors">
                        <Play className="w-3 h-3 fill-white ml-0.5" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
