/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { VideoSource, ReactionVideo, WatchParty } from '../../types';
import { Users, Plus, Play, Sparkles, ShieldCheck, ArrowRight } from 'lucide-react';
import { ContextualHelp } from '../common/ContextualHelp';

interface WatchPartiesListProps {
  sources: VideoSource[];
  reactions: ReactionVideo[];
  onJoinRoom: (roomCode: string) => void;
  onCreateParty: (source: VideoSource, reaction: ReactionVideo) => void;
}

export function WatchPartiesList({
  sources,
  reactions,
  onJoinRoom,
  onCreateParty,
}: WatchPartiesListProps) {
  const [code, setCode] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState(sources[0]?.id || '');
  const [selectedReactionId, setSelectedReactionId] = useState(reactions[0]?.id || '');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [partyTitle, setPartyTitle] = useState('Weekend Cinema Reaction Party');

  // Active parties demo display
  const activeParties = [
    {
      id: 'party-aethelgard',
      roomCode: 'AETH99',
      title: '🔥 Live Film Breakdown: Aethelgard Reveal',
      hostName: 'Marcus Vance',
      source: sources[0],
      reaction: reactions[0],
      participantCount: 14,
      isLive: true,
    },
    {
      id: 'party-gaming',
      roomCode: 'VALK42',
      title: 'Valkyrie Boss Run — Sync Watch & Chat',
      hostName: 'Leo Frost',
      source: sources[2] || sources[0],
      reaction: reactions[2] || reactions[0],
      participantCount: 8,
      isLive: true,
    },
  ];

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const source = sources.find((s) => s.id === selectedSourceId) || sources[0];
    const reaction = reactions.find((r) => r.id === selectedReactionId) || reactions[0];
    onCreateParty(source, reaction);
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 w-full flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-400" />
            <span>Synchronized Watch Parties</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Watch source and reaction videos in real-time lockstep with friends.
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-purple-600/30 transition-colors self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Host Watch Party</span>
        </button>
      </div>

      <ContextualHelp
        id="watch_party_help"
        title="Authoritative Host Sync"
        description="When you create a party, you become the authoritative host. Play, pause, and seek commands are validated on the server with sequence numbers so all participants stay in lockstep."
        bulletPoints={[
          'Audience participants follow host playback automatically.',
          'Secure host token prevents room takeovers or spoofing.',
          'Everyone can chat and send real-time emoji reactions.',
        ]}
      />

      {/* Join Code Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
        <div>
          <h3 className="text-sm font-bold text-white">Have a Party Code?</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Enter the 6-character room code provided by your host.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) onJoinRoom(code.trim().toUpperCase());
          }}
          className="flex items-center gap-2 w-full sm:w-auto"
        >
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. AETH99"
            maxLength={6}
            className="w-full sm:w-44 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold tracking-widest text-white text-center focus:outline-none focus:border-purple-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold whitespace-nowrap transition-colors"
          >
            Join
          </button>
        </form>
      </div>

      {/* Active Public Parties */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Live Parties Happening Now
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeParties.map((party) => (
            <div
              key={party.id}
              className="bg-slate-900/60 border border-slate-800 hover:border-purple-500/50 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4 shadow-xl transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                      LIVE NOW
                    </span>
                    <span className="text-xs font-mono text-purple-400 font-bold bg-purple-950/60 border border-purple-500/20 px-1.5 py-0.5 rounded">
                      Code: {party.roomCode}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-white line-clamp-1">{party.title}</h4>
                  <p className="text-xs text-slate-400">
                    Host: <span className="text-slate-300 font-medium">{party.hostName}</span> &bull; {party.participantCount} watching
                  </p>
                </div>

                <img
                  src={party.reaction.thumbnail}
                  alt=""
                  className="w-20 h-14 rounded-lg object-cover ring-1 ring-slate-800 shrink-0"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                <div className="text-[11px] text-slate-400 truncate max-w-[200px]">
                  Source: {party.source.title}
                </div>
                <button
                  onClick={() => onJoinRoom(party.roomCode)}
                  className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Play className="w-3 h-3 fill-white ml-0.5" />
                  <span>Join Party</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Host Party Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base">Host a Synchronized Watch Party</h3>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="flex flex-col gap-3 text-xs">
              <div>
                <label className="text-slate-300 font-medium block mb-1">Party Title</label>
                <input
                  type="text"
                  value={partyTitle}
                  onChange={(e) => setPartyTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="text-slate-300 font-medium block mb-1">Select Source Video</label>
                <select
                  value={selectedSourceId}
                  onChange={(e) => setSelectedSourceId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none"
                >
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} ({s.category})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-300 font-medium block mb-1">Primary Reaction Video</label>
                <select
                  value={selectedReactionId}
                  onChange={(e) => setSelectedReactionId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none"
                >
                  {reactions
                    .filter((r) => r.sourceId === selectedSourceId)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} — {r.creator}
                      </option>
                    ))}
                </select>
              </div>

              <div className="p-3 bg-purple-950/30 border border-purple-500/20 rounded-lg text-purple-300 text-[11px] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>You will receive host controls and a unique shareable party code.</span>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold shadow-md shadow-purple-600/30"
                >
                  Launch Party
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
