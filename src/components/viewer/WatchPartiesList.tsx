/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { VideoSource, ReactionVideo, WatchParty } from '../../types';
import {
  Users,
  Plus,
  Play,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  X,
  Globe,
  Bookmark,
} from 'lucide-react';
import { ContextualHelp } from '../common/ContextualHelp';
import { resolvePlayableMediaUrl, validateUrlInput } from '../../services/mediaResolver';

interface WatchPartiesListProps {
  sources: VideoSource[];
  reactions: ReactionVideo[];
  onJoinRoom: (roomCode: string) => void;
  onCreateParty: (
    source: VideoSource,
    reaction: ReactionVideo,
    extraReactions?: ReactionVideo[],
    customTitle?: string
  ) => void;
  joinError?: string | null;
  onClearJoinError?: () => void;
}

export function WatchPartiesList({
  sources,
  reactions,
  onJoinRoom,
  onCreateParty,
  joinError,
  onClearJoinError,
}: WatchPartiesListProps) {
  const [code, setCode] = useState('');
  const [activeParties, setActiveParties] = useState<WatchParty[]>([]);
  const [isLoadingParties, setIsLoadingParties] = useState(true);
  const [partiesLoadError, setPartiesLoadError] = useState<string | null>(null);

  // Create Watch Party modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'saved' | 'custom'>(
    sources.length > 0 && reactions.length > 0 ? 'saved' : 'custom'
  );
  const [partyTitle, setPartyTitle] = useState('Synchronized Reaction Watch Party');
  const [selectedSourceId, setSelectedSourceId] = useState(sources[0]?.id || '');
  const [selectedReactionId, setSelectedReactionId] = useState(reactions[0]?.id || '');

  // Custom stream fields (when blank canvas / custom URLs)
  const [customSourceUrl, setCustomSourceUrl] = useState('');
  const [customSourceTitle, setCustomSourceTitle] = useState('');
  const [customReactionUrl, setCustomReactionUrl] = useState('');
  const [customReactorName, setCustomReactorName] = useState('');
  const [customIntroOffset, setCustomIntroOffset] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);

  const loadParties = useCallback(async () => {
    setIsLoadingParties(true);
    setPartiesLoadError(null);
    try {
      const res = await fetch('/api/parties');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setActiveParties(Array.isArray(data) ? data : []);
    } catch {
      setPartiesLoadError('Unable to fetch active watch parties from server.');
      setActiveParties([]);
    } finally {
      setIsLoadingParties(false);
    }
  }, []);

  useEffect(() => {
    loadParties();
  }, [loadParties]);

  // Keep selected source/reaction synced when catalogue loads
  useEffect(() => {
    if (!selectedSourceId && sources.length > 0) {
      setSelectedSourceId(sources[0].id);
    }
  }, [sources, selectedSourceId]);

  useEffect(() => {
    const matching = reactions.filter((r) => r.sourceId === selectedSourceId);
    const fallback = matching[0] || reactions[0];
    if (fallback && !matching.some((r) => r.id === selectedReactionId)) {
      setSelectedReactionId(fallback.id);
    }
  }, [selectedSourceId, reactions, selectedReactionId]);

  const matchingReactions = reactions.filter((r) => r.sourceId === selectedSourceId);
  const selectableReactions = matchingReactions.length > 0 ? matchingReactions : reactions;

  const selectedSource = sources.find((s) => s.id === selectedSourceId);
  const selectedReaction = reactions.find((r) => r.id === selectedReactionId);
  const hasLocalSelectedMedia = Boolean(
    selectedSource?.isLocalFile ||
      selectedSource?.url?.startsWith('blob:') ||
      selectedReaction?.isLocalFile ||
      selectedReaction?.url?.startsWith('blob:')
  );

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (createMode === 'saved') {
      const source = sources.find((s) => s.id === selectedSourceId);
      const reaction = reactions.find((r) => r.id === selectedReactionId);
      if (!source || !reaction) {
        setFormError('Select both a saved source video and a reaction, or switch to Custom URLs.');
        return;
      }
      if (
        source.isLocalFile ||
        source.url.startsWith('blob:') ||
        reaction.isLocalFile ||
        reaction.url.startsWith('blob:')
      ) {
        setFormError(
          'Local files play in your browser only and cannot be streamed to remote Watch Party guests. Choose a web stream URL.'
        );
        return;
      }
      setIsCreateOpen(false);
      onCreateParty(source, reaction, [], partyTitle);
      return;
    }

    const srcValidation = validateUrlInput(customSourceUrl);
    if (!srcValidation.isValid) {
      setFormError(srcValidation.error || 'Enter a valid web stream URL for the source video.');
      return;
    }

    const rxValidation = validateUrlInput(customReactionUrl);
    if (!rxValidation.isValid) {
      setFormError(rxValidation.error || 'Enter a valid web stream URL for the reaction video.');
      return;
    }

    const creator = customReactorName.trim() || 'Reactor';
    const sourceObj: VideoSource = {
      id: `src-party-${Date.now()}`,
      title: customSourceTitle.trim() || 'Watch Party Source Video',
      creator: 'Stream Host',
      duration: 600,
      url: resolvePlayableMediaUrl(customSourceUrl.trim()),
      thumbnail:
        'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=600&q=80',
      category: 'Movies & TV',
      description: 'Custom Watch Party source stream',
    };

    const intro = Math.max(0, Number.isFinite(customIntroOffset) ? customIntroOffset : 0);
    const reactionObj: ReactionVideo = {
      id: `rx-party-${Date.now()}`,
      sourceId: sourceObj.id,
      creator,
      channelName: `${creator} Live`,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(creator)}`,
      title: `${creator} Reaction`,
      duration: 600 + intro,
      introDuration: intro,
      url: resolvePlayableMediaUrl(customReactionUrl.trim()),
      thumbnail:
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
      anchors: [
        {
          id: 'anc-intro',
          sourceTime: 0,
          reactionTime: intro,
          type: 'intro',
          label: 'Source Starts',
        },
      ],
      chapters: [],
      highlights: [],
      notes: [],
      views: 0,
      likes: 0,
      isPublished: true,
      createdAt: Date.now(),
    };

    setIsCreateOpen(false);
    onCreateParty(sourceObj, reactionObj, [], partyTitle);
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
          onClick={() => {
            setFormError(null);
            setCreateMode(sources.length > 0 && reactions.length > 0 ? 'saved' : 'custom');
            setIsCreateOpen(true);
          }}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-purple-600/30 transition-colors self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Host Watch Party</span>
        </button>
      </div>

      {joinError && (
        <div className="bg-rose-950/70 border border-rose-500/50 rounded-2xl p-4 flex items-start justify-between gap-3 text-xs text-rose-100">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-rose-200">Unable to join room: </span>
              <span>{joinError}</span>
            </div>
          </div>
          {onClearJoinError && (
            <button
              onClick={onClearJoinError}
              className="text-rose-300 hover:text-white p-0.5"
              aria-label="Dismiss error"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      <ContextualHelp
        id="watch_party_help"
        title="Authoritative Host Sync"
        description="When you create a party, you become the authoritative host. Play, pause, and seek commands are validated on the server with sequence numbers so all participants stay in lockstep."
        bulletPoints={[
          'Audience participants follow host playback automatically.',
          'Server-issued credential headers prevent room takeovers or spoofing.',
          'Everyone can chat, add timestamped notes, and send emoji reactions.',
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
            placeholder="e.g. 72K69J"
            maxLength={6}
            className="w-full sm:w-44 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold tracking-widest text-white text-center focus:outline-none focus:border-purple-500"
          />
          <button
            type="submit"
            disabled={!code.trim()}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold whitespace-nowrap transition-colors"
          >
            Join
          </button>
        </form>
      </div>

      {/* Active Server-Backed Parties */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Live Parties Happening Now ({activeParties.length})
          </h3>
          <button
            onClick={loadParties}
            disabled={isLoadingParties}
            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingParties ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {partiesLoadError ? (
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 text-center text-xs text-rose-300">
            {partiesLoadError}
          </div>
        ) : isLoadingParties ? (
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-400">
            Loading live Watch Parties from server...
          </div>
        ) : activeParties.length === 0 ? (
          <div className="bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl p-8 text-center flex flex-col items-center gap-2.5">
            <Users className="w-8 h-8 text-slate-600" />
            <div className="text-sm font-semibold text-slate-200">No Active Watch Parties Right Now</div>
            <p className="text-xs text-slate-400 max-w-md">
              Start a synchronized Watch Party using your saved streams or any public stream URL, then share your 6-character code with guests.
            </p>
            <button
              onClick={() => {
                setFormError(null);
                setCreateMode(sources.length > 0 && reactions.length > 0 ? 'saved' : 'custom');
                setIsCreateOpen(true);
              }}
              className="mt-1 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Host the First Party</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeParties.map((party) => (
              <div
                key={party.id}
                className="bg-slate-900/60 border border-slate-800 hover:border-purple-500/50 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4 shadow-xl transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                        {party.playbackState?.isPlaying ? 'PLAYING LIVE' : 'STANDBY'}
                      </span>
                      <span className="text-xs font-mono text-purple-400 font-bold bg-purple-950/60 border border-purple-500/20 px-1.5 py-0.5 rounded">
                        Code: {party.roomCode}
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-white line-clamp-1">{party.title}</h4>
                    <p className="text-xs text-slate-400">
                      Host: <span className="text-slate-300 font-medium">{party.hostName}</span>{' '}
                      &bull; {party.participants?.length || 1} watching
                    </p>
                  </div>

                  {party.primaryReaction?.thumbnail && (
                    <img
                      src={party.primaryReaction.thumbnail}
                      alt=""
                      className="w-20 h-14 rounded-lg object-cover ring-1 ring-slate-800 shrink-0"
                    />
                  )}
                </div>

                <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-400 truncate max-w-[220px]">
                    Source: {party.sourceVideo?.title || 'Stream'}
                  </div>
                  <button
                    onClick={() => onJoinRoom(party.roomCode)}
                    className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-white ml-0.5" />
                    <span>Join Party</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Host Party Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 max-w-md w-full flex flex-col gap-4 shadow-2xl my-4 sm:my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base">Host a Synchronized Watch Party</h3>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                &times;
              </button>
            </div>

            {sources.length > 0 && reactions.length > 0 && (
              <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-xl text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setCreateMode('saved');
                    setFormError(null);
                  }}
                  className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 font-medium transition-colors ${
                    createMode === 'saved'
                      ? 'bg-purple-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>Saved Streams</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateMode('custom');
                    setFormError(null);
                  }}
                  className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 font-medium transition-colors ${
                    createMode === 'custom'
                      ? 'bg-purple-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Custom URLs</span>
                </button>
              </div>
            )}

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

              {createMode === 'saved' ? (
                <>
                  <div>
                    <label className="text-slate-300 font-medium block mb-1">Select Source Video</label>
                    <select
                      value={selectedSourceId}
                      onChange={(e) => setSelectedSourceId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none"
                    >
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title} ({s.category}){s.isLocalFile ? ' [Local File]' : ''}
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
                      {selectableReactions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title} — {r.creator}{r.isLocalFile ? ' [Local File]' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {hasLocalSelectedMedia && (
                    <div className="p-2.5 bg-amber-950/50 border border-amber-500/30 rounded-lg text-amber-200 text-[11px]">
                      Local browser files cannot be streamed to remote guests. Switch to Custom URLs or pick web streams.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="text-slate-300 font-medium block mb-1">Source Stream URL</label>
                    <input
                      type="url"
                      value={customSourceUrl}
                      onChange={(e) => setCustomSourceUrl(e.target.value)}
                      placeholder="https://example.com/video.mp4, YouTube, or Google Drive"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="text-slate-300 font-medium block mb-1">Source Title</label>
                    <input
                      type="text"
                      value={customSourceTitle}
                      onChange={(e) => setCustomSourceTitle(e.target.value)}
                      placeholder="e.g. Finale Episode"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="text-slate-300 font-medium block mb-1">Reaction Stream URL</label>
                    <input
                      type="url"
                      value={customReactionUrl}
                      onChange={(e) => setCustomReactionUrl(e.target.value)}
                      placeholder="https://example.com/reaction.mp4, YouTube, or Drive"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-300 font-medium block mb-1">Reactor Name</label>
                      <input
                        type="text"
                        value={customReactorName}
                        onChange={(e) => setCustomReactorName(e.target.value)}
                        placeholder="Creator"
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-medium block mb-1">Intro Offset (s)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={customIntroOffset}
                        onChange={(e) => setCustomIntroOffset(parseFloat(e.target.value) || 0)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                </>
              )}

              {formError && (
                <div className="p-2.5 bg-rose-950/60 border border-rose-500/40 rounded-lg text-rose-200 text-[11px]">
                  {formError}
                </div>
              )}

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
