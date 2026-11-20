/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { VideoSource, ReactionVideo } from '../../types';
import { Search, Play, AlertCircle, RefreshCw, X } from 'lucide-react';

interface ExploreViewProps {
  sources: VideoSource[];
  reactions: ReactionVideo[];
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onWatch: (source: VideoSource, reaction: ReactionVideo) => void;
}

const DEFAULT_CATEGORIES = ['All', 'Movies & TV', 'Gaming', 'Music', 'Tech', 'Anime', 'Sports'];

export function ExploreView({
  sources,
  reactions,
  isLoading = false,
  error = null,
  onRetry,
  onWatch,
}: ExploreViewProps) {
  const [selectedCat, setSelectedCat] = useState('All');
  const [search, setSearch] = useState('');

  const categories = useMemo(() => {
    const extra = sources
      .map((s) => s.category)
      .filter((c) => Boolean(c) && !DEFAULT_CATEGORIES.includes(c));
    return [...DEFAULT_CATEGORIES, ...Array.from(new Set(extra))];
  }, [sources]);

  const query = search.trim().toLowerCase();

  const filteredSources = useMemo(() => {
    return sources.filter((source) => {
      const matchCat = selectedCat === 'All' || source.category === selectedCat;
      if (!matchCat) return false;
      if (!query) return true;

      const sourceMatch =
        source.title.toLowerCase().includes(query) ||
        source.creator.toLowerCase().includes(query) ||
        (source.description || '').toLowerCase().includes(query);

      if (sourceMatch) return true;

      // Also match linked published reactions by creator, channel, or title
      return reactions.some(
        (rx) =>
          rx.sourceId === source.id &&
          rx.isPublished !== false &&
          (rx.creator.toLowerCase().includes(query) ||
            rx.title.toLowerCase().includes(query) ||
            (rx.channelName || '').toLowerCase().includes(query))
      );
    });
  }, [sources, reactions, selectedCat, query]);

  const hasActiveFilter = selectedCat !== 'All' || query.length > 0;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 w-full flex flex-col gap-5 sm:gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-white">
            Explore Original Sources & Reactions
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Discover films, gaming runs, and music videos with synchronized creator commentary.
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sources or reactors..."
            aria-label="Search sources or reactors"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-8 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Category Filter Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setSelectedCat(c)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
              selectedCat === c
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Error State Banner */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-950/60 border border-rose-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-200">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-3 py-1.5 rounded-lg bg-rose-600/30 hover:bg-rose-600/50 border border-rose-400/40 text-rose-100 font-semibold flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          )}
        </div>
      )}

      {/* Loading State */}
      {isLoading && sources.length === 0 ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading catalogue">
          {[1, 2].map((idx) => (
            <div
              key={idx}
              className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 animate-pulse space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-24 h-16 rounded-xl bg-slate-800 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-20 bg-slate-800 rounded" />
                  <div className="h-4 w-48 bg-slate-800 rounded" />
                  <div className="h-3 w-32 bg-slate-800 rounded" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t border-slate-800/80">
                <div className="h-14 rounded-xl bg-slate-800/70" />
                <div className="h-14 rounded-xl bg-slate-800/70" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Sources Grid with Linked Reactions */
        <div className="space-y-6">
          {filteredSources.length === 0 ? (
            <div className="p-8 sm:p-10 rounded-2xl bg-slate-900/40 border border-slate-800 text-center flex flex-col items-center gap-3">
              <p className="text-xs text-slate-300 max-w-md">
                {hasActiveFilter
                  ? 'No sources or reactions match your current search or category filter.'
                  : 'No sources or reactions are available in the catalogue yet. Create a reaction or launch streams in the Viewing Canvas to add entries here.'}
              </p>
              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCat('All');
                    setSearch('');
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            filteredSources.map((source) => {
              const allPublishedReactions = reactions.filter(
                (r) => r.sourceId === source.id && r.isPublished !== false
              );
              const sourceMatchesQuery =
                !query ||
                source.title.toLowerCase().includes(query) ||
                source.creator.toLowerCase().includes(query) ||
                (source.description || '').toLowerCase().includes(query);

              const linkedReactions = sourceMatchesQuery
                ? allPublishedReactions
                : allPublishedReactions.filter(
                    (rx) =>
                      rx.creator.toLowerCase().includes(query) ||
                      rx.title.toLowerCase().includes(query) ||
                      (rx.channelName || '').toLowerCase().includes(query)
                  );

              return (
                <div
                  key={source.id}
                  className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 sm:p-5 flex flex-col gap-4 shadow-lg"
                >
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-start sm:items-center justify-between min-w-0">
                    <div className="flex gap-3 items-center w-full sm:w-auto min-w-0 flex-1">
                      <img
                        src={source.thumbnail}
                        alt=""
                        className="w-20 h-14 sm:w-24 sm:h-16 rounded-xl object-cover ring-1 ring-slate-800 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider block">
                          {source.category}
                        </span>
                        <h3 className="text-sm font-bold text-white truncate">{source.title}</h3>
                        <p className="text-xs text-slate-400 truncate">
                          {source.creator} &bull; {source.releaseYear || 'Saved Source'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-slate-400">
                        {linkedReactions.length} Published Reaction
                        {linkedReactions.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>

                  {/* Linked Reactions Grid */}
                  {linkedReactions.length === 0 ? (
                    <p className="text-xs text-slate-500 pt-2 border-t border-slate-800/80">
                      No published reactions linked to this source yet.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t border-slate-800/80">
                      {linkedReactions.map((rx) => (
                        <button
                          key={rx.id}
                          type="button"
                          onClick={() => onWatch(source, rx)}
                          className="w-full text-left p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900/80 transition-all flex items-center justify-between gap-3 cursor-pointer group"
                        >
                          <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
                            <img
                              src={rx.avatar}
                              alt=""
                              className="w-8 h-8 rounded-full object-cover shrink-0 ring-1 ring-slate-700"
                            />
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-semibold text-slate-200 truncate group-hover:text-indigo-300">
                                {rx.creator}
                              </span>
                              <span className="text-[10px] text-slate-400 truncate">
                                {rx.title}
                              </span>
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
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
