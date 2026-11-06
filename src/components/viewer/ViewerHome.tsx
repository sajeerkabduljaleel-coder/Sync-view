/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { VideoSource, ReactionVideo } from '../../types';
import {
  Play,
  Users,
  Compass,
  Bookmark,
  Sparkles,
  TrendingUp,
  Clock,
  Eye,
  Layers,
  ArrowRight,
  Search,
  CheckCircle2,
} from 'lucide-react';

interface ViewerHomeProps {
  sources: VideoSource[];
  reactions: ReactionVideo[];
  onWatch: (source: VideoSource, reaction: ReactionVideo, additionalReactions?: ReactionVideo[]) => void;
  onJoinPartyByCode: (code: string) => void;
  onCreateParty: (source: VideoSource, reaction: ReactionVideo) => void;
  onSwitchToReactor: () => void;
}

export function ViewerHome({
  sources,
  reactions,
  onWatch,
  onJoinPartyByCode,
  onCreateParty,
  onSwitchToReactor,
}: ViewerHomeProps) {
  const [partyCodeInput, setPartyCodeInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Featured hero reaction
  const featuredReaction = reactions[0] || reactions[0];
  const featuredSource = sources.find((s) => s.id === featuredReaction?.sourceId) || sources[0];

  // Additional reactions for the featured item (e.g. multi-reactor trailer)
  const featuredExtras = reactions
    .filter((r) => r.sourceId === featuredSource?.id && r.id !== featuredReaction?.id)
    .slice(0, 3);

  const categories = ['All', 'Movies & TV', 'Gaming', 'Music', 'Tech', 'Sports'];

  const filteredReactions = reactions.filter((rx) => {
    const src = sources.find((s) => s.id === rx.sourceId);
    const matchesCat =
      selectedCategory === 'All' || (src && src.category === selectedCategory);
    const matchesSearch =
      rx.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rx.creator.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (src && src.title.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (partyCodeInput.trim()) {
      onJoinPartyByCode(partyCodeInput.trim().toUpperCase());
    }
  };

  return (
    <div className="flex flex-col gap-8 pb-12 w-full max-w-7xl mx-auto px-4 sm:px-6">
      {/* Featured Hero Showcase */}
      {featuredReaction && featuredSource && (
        <section className="relative rounded-3xl overflow-hidden border border-slate-800/80 bg-slate-950 shadow-2xl mt-4">
          {/* Backdrop Image with gradient masks */}
          <div className="absolute inset-0 z-0">
            <img
              src={featuredSource.thumbnail}
              alt=""
              className="w-full h-full object-cover object-center opacity-40 blur-xs scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#07090e] via-[#07090e]/80 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#07090e] via-[#07090e]/70 to-transparent" />
          </div>

          <div className="relative z-10 p-6 md:p-10 flex flex-col justify-end min-h-[420px] max-w-3xl gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold tracking-wider bg-indigo-600 text-white px-2.5 py-0.5 rounded-full uppercase">
                Featured Reaction Experience
              </span>
              <span className="text-xs text-indigo-300 font-medium bg-indigo-950/60 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                {featuredSource.category}
              </span>
              <span className="text-xs text-slate-400">
                {featuredExtras.length + 1} Synchronized Reactors Available
              </span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
              {featuredReaction.title}
            </h1>

            <p className="text-xs sm:text-sm text-slate-300 line-clamp-2 leading-relaxed">
              Reacting to <span className="text-white font-semibold">{featuredSource.title}</span>. {featuredSource.description}
            </p>

            <div className="flex items-center gap-3 pt-2">
              <img
                src={featuredReaction.avatar}
                alt=""
                className="w-8 h-8 rounded-full object-cover ring-2 ring-indigo-500"
              />
              <div className="text-xs">
                <span className="text-white font-semibold">{featuredReaction.creator}</span>
                <span className="text-slate-400 ml-2">&bull; {featuredReaction.views.toLocaleString()} views</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-3">
              <button
                onClick={() => onWatch(featuredSource, featuredReaction, featuredExtras)}
                className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs sm:text-sm flex items-center gap-2 shadow-xl shadow-indigo-600/30 transition-all hover:scale-105 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white ml-0.5" />
                <span>Watch Synchronized</span>
              </button>
              <button
                onClick={() => onCreateParty(featuredSource, featuredReaction)}
                className="px-5 py-3 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700/80 font-semibold text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Users className="w-4 h-4 text-purple-400" />
                <span>Start Watch Party</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Quick Watch Party Code Entry Bar */}
      <section className="bg-gradient-to-r from-purple-950/40 via-slate-900 to-indigo-950/40 border border-purple-500/20 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-300 shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Join a Live Watch Party</h3>
            <p className="text-xs text-slate-400">
              Enter a 6-digit party code to watch reactions in lockstep with friends and live chat.
            </p>
          </div>
        </div>

        <form onSubmit={handleJoinSubmit} className="flex items-center gap-2 w-full md:w-auto">
          <input
            type="text"
            value={partyCodeInput}
            onChange={(e) => setPartyCodeInput(e.target.value.toUpperCase())}
            placeholder="PARTY CODE (e.g. A9B2X7)"
            maxLength={6}
            className="w-full md:w-48 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono font-bold tracking-widest text-white uppercase placeholder:text-slate-500 placeholder:tracking-normal focus:outline-none focus:border-purple-500 text-center"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold whitespace-nowrap transition-colors shadow-md shadow-purple-600/30 cursor-pointer"
          >
            Join Party
          </button>
        </form>
      </section>

      {/* Explore & Category Filters */}
      <section className="flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-400" />
              <span>Trending Reaction Videos</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Source videos paired with creator reactions, ready for synchronized playback.
            </p>
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search creators or videos..."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Reaction Content Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredReactions.map((rx) => {
            const src = sources.find((s) => s.id === rx.sourceId) || sources[0];
            const extraReactorsCount = reactions.filter(
              (r) => r.sourceId === src.id && r.id !== rx.id
            ).length;

            return (
              <div
                key={rx.id}
                onClick={() => onWatch(src, rx)}
                className="group bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden hover:border-slate-700 hover:shadow-xl hover:shadow-black/60 transition-all flex flex-col justify-between cursor-pointer"
              >
                {/* Thumbnail Aspect Container */}
                <div className="relative aspect-video bg-black overflow-hidden">
                  <img
                    src={rx.thumbnail}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" />

                  {/* Category tag */}
                  <div className="absolute top-2.5 left-2.5 bg-slate-950/80 backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-semibold text-slate-300 border border-slate-700">
                    {src.category}
                  </div>

                  {/* Multi-reactor count badge */}
                  {extraReactorsCount > 0 && (
                    <div className="absolute top-2.5 right-2.5 bg-purple-950/80 backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-semibold text-purple-300 border border-purple-500/30 flex items-center gap-1">
                      <Layers className="w-3 h-3" />
                      <span>+{extraReactorsCount} reactors</span>
                    </div>
                  )}

                  {/* Duration & Play Pill on hover */}
                  <div className="absolute bottom-2.5 right-2.5 bg-slate-950/80 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-mono text-slate-300">
                    {Math.floor(rx.duration / 60)}:{(rx.duration % 60).toString().padStart(2, '0')}
                  </div>

                  <div className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-indigo-600/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity scale-90 group-hover:scale-100 shadow-xl">
                    <Play className="w-5 h-5 fill-white ml-0.5" />
                  </div>
                </div>

                {/* Meta details */}
                <div className="p-3.5 flex flex-col gap-2">
                  <div className="flex items-start gap-2.5">
                    <img
                      src={rx.avatar}
                      alt=""
                      className="w-7 h-7 rounded-full object-cover ring-1 ring-slate-700 shrink-0 mt-0.5"
                    />
                    <div className="flex flex-col">
                      <h3 className="text-xs font-bold text-white line-clamp-2 group-hover:text-indigo-400 transition-colors leading-tight">
                        {rx.title}
                      </h3>
                      <span className="text-[11px] text-slate-400 mt-0.5">{rx.creator}</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="truncate max-w-[140px]">Source: {src.title}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <Eye className="w-3 h-3 text-slate-500" />
                      <span>{rx.views.toLocaleString()}</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Creator Callout Banner */}
      <section className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6 shadow-xl">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
              Are you a video creator?
            </span>
          </div>
          <h3 className="text-xl font-bold text-white">
            Publish your reactions with zero manual desync
          </h3>
          <p className="text-xs sm:text-sm text-slate-300 max-w-xl">
            Switch to Reactor mode to access our visual calibration studio, set intro offsets, and publish reactions that stay in sync for thousands of viewers.
          </p>
        </div>

        <button
          onClick={onSwitchToReactor}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-indigo-600/30 whitespace-nowrap self-start sm:self-auto cursor-pointer"
        >
          <span>Switch to Reactor Mode</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </section>
    </div>
  );
}
