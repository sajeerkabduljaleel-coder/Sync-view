/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ReactionVideo, VideoSource } from '../../types';
import {
  Plus,
  Sliders,
  Play,
  Film,
  Sparkles,
  Clock,
  Eye,
  Heart,
  Edit3,
  FileSpreadsheet,
  CheckCircle2,
  BookOpen,
} from 'lucide-react';
import { ContextualHelp } from '../common/ContextualHelp';

interface ReactorHomeProps {
  reactions: ReactionVideo[];
  sources: VideoSource[];
  onStartCreate: () => void;
  onOpenStudio: (reaction: ReactionVideo) => void;
  onOpenTheatre: (reaction: ReactionVideo) => void;
}

export function ReactorHome({
  reactions,
  sources,
  onStartCreate,
  onOpenStudio,
  onOpenTheatre,
}: ReactorHomeProps) {
  const publishedReactions = reactions.filter((r) => r.isPublished);
  const drafts = reactions.filter((r) => !r.isPublished);

  const totalViews = reactions.reduce((sum, r) => sum + r.views, 0);
  const totalLikes = reactions.reduce((sum, r) => sum + r.likes, 0);

  const getSourceForReaction = (reaction: ReactionVideo) => {
    return sources.find((s) => s.id === reaction.sourceId) || sources[0];
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 w-full flex flex-col gap-6">
      {/* Creator Hero Header */}
      <div className="relative rounded-2xl bg-gradient-to-r from-indigo-950/70 via-slate-900 to-slate-900 border border-indigo-500/30 p-6 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-6 overflow-hidden">
        <div className="flex flex-col gap-2 z-10">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full uppercase">
              Reactor Dashboard
            </span>
            <span className="text-xs text-slate-400">&bull; Creator Mode Active</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            Create, Synchronize & Publish Reactions
          </h1>
          <p className="text-xs md:text-sm text-slate-300 max-w-xl leading-relaxed">
            Align your reaction videos with original source content down to the millisecond.
            Intelligent piecewise mapping takes care of intros, pauses, and playback drift.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 z-10 shrink-0">
          <button
            onClick={onStartCreate}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs md:text-sm font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all hover:scale-105 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Reaction</span>
          </button>
        </div>
      </div>

      {/* Quick Creator Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="bg-slate-900/60 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-slate-400 text-[11px]">Published Reactions</span>
          <div className="text-xl font-bold text-white mt-1">{publishedReactions.length}</div>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-slate-400 text-[11px]">Total Views</span>
          <div className="text-xl font-bold text-indigo-400 mt-1">
            {totalViews.toLocaleString()}
          </div>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-slate-400 text-[11px]">Total Likes</span>
          <div className="text-xl font-bold text-rose-400 mt-1">
            {totalLikes.toLocaleString()}
          </div>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-slate-400 text-[11px]">Drafts</span>
          <div className="text-xl font-bold text-amber-400 mt-1">{drafts.length}</div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Published & Drafts */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Published Reactions Section */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Film className="w-4 h-4 text-indigo-400" />
                <span>My Published Reactions</span>
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                {publishedReactions.length} items
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {publishedReactions.map((rx) => {
                const src = getSourceForReaction(rx);
                return (
                  <div
                    key={rx.id}
                    className="bg-slate-900/70 border border-slate-800/80 rounded-xl overflow-hidden hover:border-slate-700 transition-all flex flex-col justify-between group shadow-lg"
                  >
                    <div className="relative aspect-video bg-black overflow-hidden">
                      <img
                        src={rx.thumbnail}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute top-2 left-2 bg-slate-950/80 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-mono text-indigo-300 border border-slate-700">
                        Intro: {rx.introDuration}s
                      </div>
                      <div className="absolute bottom-2 right-2 bg-slate-950/80 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-mono text-slate-300">
                        {rx.anchors.length} anchors
                      </div>
                    </div>

                    <div className="p-3.5 flex flex-col gap-2">
                      <h4 className="text-xs font-bold text-white line-clamp-1 group-hover:text-indigo-400 transition-colors">
                        {rx.title}
                      </h4>
                      <p className="text-[11px] text-slate-400 line-clamp-1">
                        Source: <span className="text-slate-300">{src.title}</span>
                      </p>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
                        <span className="flex items-center gap-1">
                          <Eye className="w-3 h-3 text-slate-500" />
                          <span>{rx.views.toLocaleString()}</span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => onOpenStudio(rx)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                            title="Edit Calibration in Studio"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onOpenTheatre(rx)}
                            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1 text-[11px] transition-colors"
                          >
                            <Play className="w-3 h-3 ml-0.5" />
                            <span>Theatre</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Drafts Section */}
          {drafts.length > 0 && (
            <section className="flex flex-col gap-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-amber-400" />
                <span>Unpublished Drafts</span>
              </h3>
              <div className="space-y-2">
                {drafts.map((d) => (
                  <div
                    key={d.id}
                    className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between"
                  >
                    <div>
                      <h4 className="text-xs font-semibold text-white">{d.title}</h4>
                      <span className="text-[10px] text-amber-400">Draft &bull; In calibration</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onOpenStudio(d)}
                        className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium"
                      >
                        Continue Editing
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right Col: Timing Best Practices Guide & Creator Studio Quick Entry */}
        <div className="flex flex-col gap-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-400" />
              <span>Timing Best Practices</span>
            </h3>

            <p className="text-xs text-slate-400 leading-relaxed">
              Achieving seamless reaction synchronization takes just a few seconds when following these three rules:
            </p>

            <div className="space-y-2.5 text-xs text-slate-300">
              <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                <div className="font-semibold text-white flex items-center gap-1.5 text-xs mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>1. Nail the Intro Offset</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Find the exact frame where you press play on the source video. Set that as your intro anchor (Source 0:00 &rarr; Reaction intro second).
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                <div className="font-semibold text-white flex items-center gap-1.5 text-xs mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>2. Mark Pauses Explicitly</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  If you pause the source to talk for 15 seconds, create two anchors at the same source timestamp. SyncView will hold the source and resume in lockstep.
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                <div className="font-semibold text-white flex items-center gap-1.5 text-xs mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>3. Add Chapter Landmarks</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Adding chapter timestamps gives viewers fast-scrub access to your best reactions, shock moments, and theory breakdowns.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
