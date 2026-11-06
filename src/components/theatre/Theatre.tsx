/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  LayoutGrid,
  Columns,
  Maximize,
  Sliders,
  Volume2,
  Users,
  Bookmark,
  MessageSquare,
  Sparkles,
  ChevronDown,
  Plus,
  Trash2,
  Share2,
  FileSpreadsheet,
  Clock,
  Layers,
  ArrowRight,
  Send,
  Smile,
  ShieldCheck,
} from 'lucide-react';
import {
  VideoSource,
  ReactionVideo,
  TheatreLayout,
  DriftStatus,
  ReactionNote,
  ChatMessage,
  SyncAnchor,
} from '../../types';
import { SessionSyncController, SessionSyncState } from '../../services/SessionSyncController';
import { VideoPlayer } from './VideoPlayer';
import { ContextualHelp } from '../common/ContextualHelp';
import { SAMPLE_REACTIONS } from '../../data/mockCatalogue';

interface TheatreProps {
  sourceVideo: VideoSource;
  primaryReaction: ReactionVideo;
  extraReactions?: ReactionVideo[];
  isHost?: boolean;
  roomCode?: string;
  onExit?: () => void;
  onOpenCreatorStudio?: (reaction: ReactionVideo) => void;
}

export function Theatre({
  sourceVideo,
  primaryReaction: initialPrimaryReaction,
  extraReactions: initialExtraReactions = [],
  isHost = true,
  roomCode,
  onExit,
  onOpenCreatorStudio,
}: TheatreProps) {
  // Sync controller instance (authoritative engine)
  const controllerRef = useRef<SessionSyncController | null>(null);

  const [primaryReaction, setPrimaryReaction] = useState<ReactionVideo>(initialPrimaryReaction);
  const [extraReactions, setExtraReactions] = useState<ReactionVideo[]>(initialExtraReactions);
  const [syncState, setSyncState] = useState<SessionSyncState | null>(null);

  // Active side panel tab
  const [activeTab, setActiveTab] = useState<'chat' | 'chapters' | 'notes' | 'reactors'>('chapters');

  // Watch party chat & notes state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'm1',
      senderId: 'alex',
      senderName: 'Alex Rivers',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
      text: 'Synchronized with the trailer! Check out 0:45 when the portal opens 🔥',
      timestamp: Date.now() - 60000,
      isHost: true,
    },
  ]);
  const [newChatText, setNewChatText] = useState('');
  const [activeNotes, setActiveNotes] = useState<ReactionNote[]>(initialPrimaryReaction.notes || []);
  const [newNoteText, setNewNoteText] = useState('');

  // Floating emoji reaction bursts
  const [emojiBursts, setEmojiBursts] = useState<{ id: number; emoji: string; x: number }[]>([]);

  // Initialize Controller
  useEffect(() => {
    const controller = new SessionSyncController();
    controllerRef.current = controller;

    // Set initial reaction and anchors
    controller.setActiveReaction(primaryReaction.id);
    controller.setReactionAnchors(primaryReaction.id, primaryReaction.anchors);

    extraReactions.forEach((rx) => {
      controller.setReactionAnchors(rx.id, rx.anchors);
    });

    const unsubscribe = controller.subscribe((state) => {
      setSyncState(state);
    });

    return () => {
      unsubscribe();
      controller.destroy();
    };
  }, []);

  // Update anchors when reactions change
  useEffect(() => {
    if (controllerRef.current) {
      controllerRef.current.setActiveReaction(primaryReaction.id);
      controllerRef.current.setReactionAnchors(primaryReaction.id, primaryReaction.anchors);
      extraReactions.forEach((rx) => {
        controllerRef.current?.setReactionAnchors(rx.id, rx.anchors);
      });
    }
  }, [primaryReaction, extraReactions]);

  const handlePlayToggle = () => {
    controllerRef.current?.togglePlay();
  };

  const handleSeek = (time: number) => {
    controllerRef.current?.seekToSourceTime(time);
  };

  const handleStepReaction = (delta: number) => {
    if (primaryReaction) {
      controllerRef.current?.stepReactionOffset(primaryReaction.id, delta);
    }
  };

  const handleAddExtraReactor = (rx: ReactionVideo) => {
    if (extraReactions.length >= 4) return;
    if (rx.id === primaryReaction.id || extraReactions.some((e) => e.id === rx.id)) return;
    setExtraReactions((prev) => [...prev, rx]);
    controllerRef.current?.setReactionAnchors(rx.id, rx.anchors);
  };

  const handleRemoveExtraReactor = (rxId: string) => {
    setExtraReactions((prev) => prev.filter((r) => r.id !== rxId));
  };

  const handleSwapPrimaryReactor = (newPrimary: ReactionVideo) => {
    // Current primary becomes an extra reactor
    const oldPrimary = primaryReaction;
    const remainingExtras = extraReactions.filter((r) => r.id !== newPrimary.id);
    setPrimaryReaction(newPrimary);
    setExtraReactions([oldPrimary, ...remainingExtras]);
    controllerRef.current?.setActiveReaction(newPrimary.id);
  };

  const handleSendChat = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newChatText.trim()) return;

    const msg: ChatMessage = {
      id: `msg-${Date.now()}`,
      senderId: 'user-me',
      senderName: isHost ? 'You (Host)' : 'You',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80',
      text: newChatText.trim(),
      timestamp: Date.now(),
      isHost,
    };
    setChatMessages((prev) => [...prev, msg]);
    setNewChatText('');
  };

  const triggerEmoji = (emoji: string) => {
    const burst = { id: Date.now() + Math.random(), emoji, x: 20 + Math.random() * 60 };
    setEmojiBursts((prev) => [...prev, burst]);
    setTimeout(() => {
      setEmojiBursts((prev) => prev.filter((b) => b.id !== burst.id));
    }, 2000);
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;
    const curSourceTime = syncState?.sourceTime || 0;
    const curRxTime = syncState?.primaryReactionTime || 0;

    const note: ReactionNote = {
      id: `note-${Date.now()}`,
      userId: 'user-me',
      userName: 'You',
      sourceTimestamp: curSourceTime,
      reactionTimestamp: curRxTime,
      text: newNoteText.trim(),
      isPublic: true,
      createdAt: Date.now(),
    };
    setActiveNotes((prev) => [note, ...prev]);
    setNewNoteText('');
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const currentSourceTime = syncState?.sourceTime || 0;
  const currentDuration = sourceVideo.duration || 180;
  const currentLayout = syncState?.layout || 'side-by-side';
  const isAdvanced = syncState?.isAdvancedMode || false;
  const primaryStatus = syncState?.primaryStatus || 'synced';

  // Available reactors from sample catalogue not yet added
  const availableCatalogueReactions = SAMPLE_REACTIONS.filter(
    (r) =>
      r.id !== primaryReaction.id &&
      !extraReactions.some((er) => er.id === r.id) &&
      r.sourceId === sourceVideo.id
  );

  return (
    <div className="relative min-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans">
      {/* Top Header Bar */}
      <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md px-4 py-2.5 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 transition-colors"
          >
            <span>&larr; Exit Theatre</span>
          </button>
          <div className="h-4 w-px bg-slate-800" />
          <h2 className="text-sm font-semibold text-white truncate max-w-md">
            {sourceVideo.title}
          </h2>
          <span className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full font-medium">
            with {primaryReaction.creator}
          </span>
        </div>

        {/* Sync Status Badge & Mode Switcher */}
        <div className="flex items-center gap-2.5">
          {roomCode && (
            <div className="hidden sm:flex items-center gap-1.5 bg-purple-950/40 border border-purple-500/30 px-2.5 py-1 rounded-md text-xs">
              <Users className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-slate-400">Party Code:</span>
              <span className="font-mono font-bold text-purple-300">{roomCode}</span>
            </div>
          )}

          {/* Sync status pill */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-3 py-1 rounded-full text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                primaryStatus === 'synced'
                  ? 'bg-emerald-400 animate-pulse'
                  : primaryStatus === 'adjusting'
                  ? 'bg-amber-400'
                  : primaryStatus === 'buffering'
                  ? 'bg-blue-400 animate-spin'
                  : 'bg-indigo-400'
              }`}
            />
            <span className="font-medium text-slate-300 capitalize">{primaryStatus}</span>
            {isAdvanced && syncState?.primaryMetrics && (
              <span className="text-[10px] font-mono text-slate-400 ml-1">
                {(syncState.primaryMetrics.currentDrift * 1000).toFixed(0)}ms
              </span>
            )}
          </div>

          {/* Basic vs Advanced Mode Toggle */}
          <button
            onClick={() => controllerRef.current?.toggleAdvancedMode()}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
              isAdvanced
                ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle between Basic and Advanced technical tools"
            aria-label="Toggle Advanced Mode"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{isAdvanced ? 'Advanced Mode' : 'Basic Mode'}</span>
          </button>
        </div>
      </header>

      {/* Main Content Arena */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Side: Video Players Arena & Playback Timeline */}
        <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
          {/* Layout & Audio Quick-Bar */}
          <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800/80 px-3 py-1.5 rounded-lg text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 text-[11px] mr-1">Layout:</span>
              <button
                onClick={() => controllerRef.current?.setLayout('side-by-side')}
                className={`p-1.5 rounded ${
                  currentLayout === 'side-by-side' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
                title="Side by Side"
              >
                <Columns className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => controllerRef.current?.setLayout('grid')}
                className={`p-1.5 rounded ${
                  currentLayout === 'grid' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
                title="Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => controllerRef.current?.setLayout('source-focus')}
                className={`px-2 py-1 rounded ${
                  currentLayout === 'source-focus' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Source Focus
              </button>
              <button
                onClick={() => controllerRef.current?.setLayout('reactor-focus')}
                className={`px-2 py-1 rounded ${
                  currentLayout === 'reactor-focus' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Reactor Focus
              </button>
            </div>

            {/* Audio Focus Selector */}
            <div className="flex items-center gap-2">
              <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-slate-400 text-[11px]">Audio Focus:</span>
              <select
                value={syncState?.audioFocus || 'source'}
                onChange={(e) => controllerRef.current?.setAudioFocus(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded px-2 py-0.5 focus:outline-none"
              >
                <option value="source">Source Video (Original)</option>
                <option value={primaryReaction.id}>{primaryReaction.creator} (Primary)</option>
                {extraReactions.map((rx) => (
                  <option key={rx.id} value={rx.id}>
                    {rx.creator}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Video Grid based on layout */}
          <div
            className={`w-full flex-1 min-h-[420px] gap-3 ${
              currentLayout === 'side-by-side'
                ? 'grid grid-cols-1 md:grid-cols-2'
                : currentLayout === 'grid'
                ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                : currentLayout === 'source-focus'
                ? 'grid grid-cols-1 lg:grid-cols-3'
                : 'grid grid-cols-1 lg:grid-cols-3'
            }`}
          >
            {/* 1. Source Video Player */}
            <div
              className={`${
                currentLayout === 'source-focus'
                  ? 'lg:col-span-2'
                  : currentLayout === 'reactor-focus'
                  ? 'lg:col-span-1'
                  : ''
              } flex flex-col`}
            >
              <VideoPlayer
                id="source-player"
                src={sourceVideo.url}
                title={sourceVideo.title}
                subtitle={sourceVideo.creator}
                isSource={true}
                isMuted={syncState?.audioFocus !== 'source' && !syncState?.isDuckingEnabled}
                syncStatus="Master"
                onTogglePlay={handlePlayToggle}
                onTogglePip={() => controllerRef.current?.togglePictureInPicture()}
                ref={(inst) => {
                  if (inst) controllerRef.current?.registerSourceElement(inst.getElement());
                }}
                className="w-full h-full"
              />
            </div>

            {/* 2. Primary Reaction Player */}
            <div
              className={`${
                currentLayout === 'reactor-focus'
                  ? 'lg:col-span-2'
                  : currentLayout === 'source-focus'
                  ? 'lg:col-span-1'
                  : ''
              } flex flex-col`}
            >
              <VideoPlayer
                id={primaryReaction.id}
                src={primaryReaction.url}
                title={primaryReaction.title}
                subtitle={primaryReaction.creator}
                avatar={primaryReaction.avatar}
                isPrimary={true}
                isMuted={syncState?.audioFocus !== primaryReaction.id}
                syncStatus={primaryStatus}
                playbackRate={syncState?.primaryMetrics?.playbackRate || 1.0}
                onTogglePlay={handlePlayToggle}
                onTogglePip={() => controllerRef.current?.togglePictureInPicture()}
                ref={(inst) => {
                  if (inst)
                    controllerRef.current?.registerReactionElement(
                      primaryReaction.id,
                      inst.getElement()
                    );
                }}
                className="w-full h-full"
              />
            </div>

            {/* 3. Additional Reactors (Up to 4 extra) */}
            {extraReactions.map((rx) => (
              <div key={rx.id} className="relative flex flex-col">
                <VideoPlayer
                  id={rx.id}
                  src={rx.url}
                  title={rx.title}
                  subtitle={rx.creator}
                  avatar={rx.avatar}
                  isMuted={syncState?.audioFocus !== rx.id}
                  syncStatus={syncState?.extraReactorMetrics[rx.id]?.status || 'synced'}
                  playbackRate={syncState?.extraReactorMetrics[rx.id]?.playbackRate || 1.0}
                  onTogglePlay={handlePlayToggle}
                  ref={(inst) => {
                    if (inst)
                      controllerRef.current?.registerReactionElement(rx.id, inst.getElement());
                  }}
                  className="w-full h-full"
                />
                {/* Reactor action pill */}
                <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
                  <button
                    onClick={() => handleSwapPrimaryReactor(rx)}
                    className="text-[10px] bg-slate-900/90 hover:bg-indigo-600 text-slate-200 hover:text-white px-2 py-0.5 rounded border border-slate-700 transition-colors"
                    title="Make this reactor primary"
                  >
                    Set Primary
                  </button>
                  <button
                    onClick={() => handleRemoveExtraReactor(rx.id)}
                    className="p-1 bg-slate-900/90 hover:bg-rose-600 text-slate-400 hover:text-white rounded border border-slate-700 transition-colors"
                    title="Remove reactor"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Authoritative Playback Scrub Bar & Transport Controls */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
            {/* Timeline Scrubber */}
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-slate-300 w-12 text-right">
                {formatTime(currentSourceTime)}
              </span>
              <div className="relative flex-1 flex items-center">
                <input
                  type="range"
                  min="0"
                  max={currentDuration}
                  step="0.1"
                  value={currentSourceTime}
                  onChange={(e) => handleSeek(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  aria-label="Seek source timeline"
                />
                {/* Chapters tick markers on scrubber */}
                {primaryReaction.chapters.map((ch) => (
                  <div
                    key={ch.id}
                    style={{ left: `${(ch.sourceTimestamp / currentDuration) * 100}%` }}
                    className="absolute top-0 w-1 h-3 bg-amber-400/80 rounded-full -translate-y-1 pointer-events-none"
                    title={`Chapter: ${ch.title}`}
                  />
                ))}
              </div>
              <span className="font-mono text-xs text-slate-400 w-12">
                {formatTime(currentDuration)}
              </span>
            </div>

            {/* Transport Buttons Bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSeek(Math.max(0, currentSourceTime - 10))}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                  title="Rewind 10 seconds"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  onClick={handlePlayToggle}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all"
                  aria-label={syncState?.isPlaying ? 'Pause synchronized playback' : 'Play synchronized playback'}
                >
                  {syncState?.isPlaying ? (
                    <>
                      <Pause className="w-4 h-4" />
                      <span className="text-xs">Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 ml-0.5" />
                      <span className="text-xs">Play Synced</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleSeek(Math.min(currentDuration, currentSourceTime + 10))}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                  title="Forward 10 seconds"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </div>

              {/* Offset nudge buttons (for micro adjustment in Theatre) */}
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="text-[11px] hidden sm:inline">Nudge Sync:</span>
                <button
                  onClick={() => handleStepReaction(-0.2)}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px]"
                  title="Step reaction back 0.2s"
                >
                  -0.2s
                </button>
                <button
                  onClick={() => handleStepReaction(0.2)}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px]"
                  title="Step reaction forward 0.2s"
                >
                  +0.2s
                </button>
                {onOpenCreatorStudio && (
                  <button
                    onClick={() => onOpenCreatorStudio(primaryReaction)}
                    className="ml-2 text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                  >
                    Calibrate in Studio &rarr;
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Advanced Mode Diagnostics Panel (Shown ONLY in Advanced Mode) */}
          {isAdvanced && (
            <div className="bg-slate-950/90 border border-indigo-500/30 rounded-xl p-3.5 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-semibold text-white">
                    Advanced Synchronization Diagnostics
                  </span>
                </div>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded">
                  AUTHORITATIVE CLOCK ACTIVE
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-400">Source Clock</div>
                  <div className="font-mono font-bold text-white mt-0.5">
                    {currentSourceTime.toFixed(3)}s
                  </div>
                </div>
                <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-400">Target Reaction Clock</div>
                  <div className="font-mono font-bold text-white mt-0.5">
                    {syncState?.primaryMetrics?.targetTime?.toFixed(3) || '0.000'}s
                  </div>
                </div>
                <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-400">Measured Drift</div>
                  <div
                    className={`font-mono font-bold mt-0.5 ${
                      Math.abs(syncState?.primaryMetrics?.currentDrift || 0) < 0.08
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {((syncState?.primaryMetrics?.currentDrift || 0) * 1000).toFixed(1)} ms
                  </div>
                </div>
                <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-400">Drift Compensation Rate</div>
                  <div className="font-mono font-bold text-white mt-0.5">
                    {syncState?.primaryMetrics?.playbackRate.toFixed(2)}x
                  </div>
                </div>
              </div>

              {/* Anchors Inspector */}
              <div className="mt-1">
                <div className="text-[11px] font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>Active Mapping Anchors ({primaryReaction.anchors.length})</span>
                  <span className="text-[10px] text-slate-500">Piecewise Linear Interpolation</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] text-slate-300 border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-1 px-2 font-medium">Anchor</th>
                        <th className="py-1 px-2 font-medium">Source Time</th>
                        <th className="py-1 px-2 font-medium">Reaction Time</th>
                        <th className="py-1 px-2 font-medium">Type</th>
                        <th className="py-1 px-2 font-medium">Label</th>
                      </tr>
                    </thead>
                    <tbody>
                      {primaryReaction.anchors.map((anc) => (
                        <tr key={anc.id} className="border-b border-slate-900 hover:bg-slate-900/40">
                          <td className="py-1 px-2 font-mono text-[10px] text-slate-400">{anc.id}</td>
                          <td className="py-1 px-2 font-mono">{anc.sourceTime.toFixed(1)}s</td>
                          <td className="py-1 px-2 font-mono">{anc.reactionTime.toFixed(1)}s</td>
                          <td className="py-1 px-2">
                            <span className="bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded text-[10px]">
                              {anc.type}
                            </span>
                          </td>
                          <td className="py-1 px-2 text-slate-400 truncate max-w-xs">
                            {anc.label || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Interactive Tabs (Watch Party Chat, Chapters/Highlights, Notes, Multi-Reactors) */}
        <aside className="w-full lg:w-80 lg:border-l border-slate-800/80 bg-slate-950/60 flex flex-col h-[400px] lg:h-auto">
          {/* Tab Headers */}
          <div className="grid grid-cols-4 border-b border-slate-800 text-xs font-medium">
            <button
              onClick={() => setActiveTab('chapters')}
              className={`py-3 flex flex-col items-center gap-1 border-b-2 transition-colors ${
                activeTab === 'chapters'
                  ? 'border-indigo-500 text-white bg-slate-900/40'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Chapters</span>
            </button>
            <button
              onClick={() => setActiveTab('notes')}
              className={`py-3 flex flex-col items-center gap-1 border-b-2 transition-colors ${
                activeTab === 'notes'
                  ? 'border-indigo-500 text-white bg-slate-900/40'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Notes ({activeNotes.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`py-3 flex flex-col items-center gap-1 border-b-2 transition-colors ${
                activeTab === 'chat'
                  ? 'border-indigo-500 text-white bg-slate-900/40'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Party Chat</span>
            </button>
            <button
              onClick={() => setActiveTab('reactors')}
              className={`py-3 flex flex-col items-center gap-1 border-b-2 transition-colors ${
                activeTab === 'reactors'
                  ? 'border-indigo-500 text-white bg-slate-900/40'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Reactors ({extraReactions.length + 1})</span>
            </button>
          </div>

          {/* Tab 1: Chapters & Highlights */}
          {activeTab === 'chapters' && (
            <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-3">
              <div>
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Chapters
                </h4>
                {primaryReaction.chapters.length === 0 ? (
                  <p className="text-xs text-slate-500">No chapters marked for this reaction.</p>
                ) : (
                  <div className="space-y-1.5">
                    {primaryReaction.chapters.map((ch) => (
                      <button
                        key={ch.id}
                        onClick={() => handleSeek(ch.sourceTimestamp)}
                        className="w-full text-left p-2 rounded-lg bg-slate-900/70 hover:bg-slate-800/80 border border-slate-800/80 transition-colors flex items-center justify-between group"
                      >
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-slate-200 group-hover:text-indigo-300">
                            {ch.title}
                          </span>
                          {ch.description && (
                            <span className="text-[10px] text-slate-400 line-clamp-1">
                              {ch.description}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-indigo-400 bg-indigo-950/60 px-1.5 py-0.5 rounded shrink-0">
                          {formatTime(ch.sourceTimestamp)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {primaryReaction.highlights.length > 0 && (
                <div className="mt-2">
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    <span>Highlights & Climax Moments</span>
                  </h4>
                  <div className="space-y-1.5">
                    {primaryReaction.highlights.map((hl) => (
                      <button
                        key={hl.id}
                        onClick={() => handleSeek(hl.sourceTimestamp)}
                        className="w-full text-left p-2 rounded-lg bg-amber-950/20 hover:bg-amber-950/40 border border-amber-500/20 transition-colors flex items-center justify-between"
                      >
                        <span className="text-xs text-amber-200 font-medium truncate">
                          {hl.title}
                        </span>
                        <span className="text-[10px] font-mono text-amber-300 bg-amber-950/80 px-1.5 py-0.5 rounded">
                          {formatTime(hl.sourceTimestamp)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Timestamped Notes */}
          {activeTab === 'notes' && (
            <div className="flex-1 p-3 overflow-y-auto flex flex-col justify-between">
              <div className="space-y-2 overflow-y-auto flex-1 pr-1">
                <ContextualHelp
                  id="reaction_notes_hint"
                  title="Timestamped Notes"
                  description="Notes are mapped to the timeline. When you click a note, SyncView jumps to that exact moment in both the source and reaction videos."
                />

                {activeNotes.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">
                    No notes yet. Add a note at the current timestamp below!
                  </p>
                ) : (
                  activeNotes.map((n) => (
                    <div
                      key={n.id}
                      className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-300">{n.userName}</span>
                        <button
                          onClick={() => handleSeek(n.sourceTimestamp)}
                          className="font-mono text-[10px] text-indigo-400 hover:text-indigo-300 bg-indigo-950/60 px-1.5 py-0.5 rounded flex items-center gap-1"
                        >
                          <Clock className="w-2.5 h-2.5" />
                          <span>{formatTime(n.sourceTimestamp)}</span>
                        </button>
                      </div>
                      <p className="text-slate-300 text-xs leading-relaxed">{n.text}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Add Note Form */}
              <form onSubmit={handleAddNote} className="mt-3 pt-2 border-t border-slate-800 flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Note timestamp:</span>
                  <span className="font-mono text-indigo-400">{formatTime(currentSourceTime)}</span>
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    placeholder="Attach note to this moment..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium"
                  >
                    Post
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Tab 3: Party Chat */}
          {activeTab === 'chat' && (
            <div className="flex-1 p-3 overflow-y-auto flex flex-col justify-between relative">
              {/* Emoji bursts overlay */}
              {emojiBursts.map((burst) => (
                <div
                  key={burst.id}
                  style={{ left: `${burst.x}%` }}
                  className="absolute bottom-16 text-3xl pointer-events-none animate-bounce"
                >
                  {burst.emoji}
                </div>
              ))}

              <div className="space-y-2 overflow-y-auto flex-1 pr-1">
                {chatMessages.map((msg) => (
                  <div key={msg.id} className="text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-300">{msg.senderName}</span>
                      {msg.isHost && (
                        <span className="text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1 rounded">
                          HOST
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-slate-200 mt-0.5">{msg.text}</p>
                  </div>
                ))}
              </div>

              {/* Chat Input & Emoji quick bar */}
              <div className="mt-3 pt-2 border-t border-slate-800 flex flex-col gap-2">
                <div className="flex items-center justify-between px-1">
                  {['🔥', '🤯', '😂', '👏', '😱'].map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => triggerEmoji(emoji)}
                      className="text-base hover:scale-125 transition-transform"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <form onSubmit={handleSendChat} className="flex gap-1.5">
                  <input
                    type="text"
                    value={newChatText}
                    onChange={(e) => setNewChatText(e.target.value)}
                    placeholder="Send message to party..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Tab 4: Multi-Reactors Manager */}
          {activeTab === 'reactors' && (
            <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-3">
              <ContextualHelp
                id="multi_reactor_hint"
                title="Multi-Reactor Sync"
                description="SyncView supports up to 6 players simultaneously (1 source + 1 primary reactor + 4 extra reactors). Each reactor's timeline is independently mapped and drift-corrected to the source video."
                bulletPoints={[
                  'Audio Focus allows you to choose which reactor you hear.',
                  'Each reactor has its own intro offset and pauses.',
                  'Click "Set Primary" on any extra reactor to elevate them.',
                ]}
              />

              <div>
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Active Players ({extraReactions.length + 1} / 5 Reactions)
                </h4>
                <div className="space-y-2">
                  <div className="p-2.5 rounded-lg bg-purple-950/30 border border-purple-500/30 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <img
                        src={primaryReaction.avatar}
                        alt=""
                        className="w-6 h-6 rounded-full object-cover"
                      />
                      <div>
                        <div className="font-semibold text-white">{primaryReaction.creator}</div>
                        <div className="text-[10px] text-purple-300">Primary Reactor</div>
                      </div>
                    </div>
                  </div>

                  {extraReactions.map((rx) => (
                    <div
                      key={rx.id}
                      className="p-2 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <img
                          src={rx.avatar}
                          alt=""
                          className="w-6 h-6 rounded-full object-cover"
                        />
                        <div>
                          <div className="font-medium text-slate-200">{rx.creator}</div>
                          <div className="text-[10px] text-slate-400">Additional Reactor</div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveExtraReactor(rx.id)}
                        className="p-1 text-slate-400 hover:text-rose-400"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {availableCatalogueReactions.length > 0 && extraReactions.length < 4 && (
                <div className="mt-2">
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Add Another Reactor
                  </h4>
                  <div className="space-y-1.5">
                    {availableCatalogueReactions.map((rx) => (
                      <button
                        key={rx.id}
                        onClick={() => handleAddExtraReactor(rx)}
                        className="w-full p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left flex items-center justify-between text-xs transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <img
                            src={rx.avatar}
                            alt=""
                            className="w-5 h-5 rounded-full object-cover"
                          />
                          <span className="font-medium text-slate-200">{rx.creator}</span>
                        </div>
                        <span className="flex items-center gap-1 text-[11px] text-indigo-400">
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
