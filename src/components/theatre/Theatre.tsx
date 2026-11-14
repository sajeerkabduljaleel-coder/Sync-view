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
  Tv,
  Film,
  X,
  UploadCloud,
  Folder,
  FileVideo,
  Globe,
  Lock,
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
import { StreamChooserModal } from './StreamChooserModal';
import { catalogueService } from '../../services/catalogueService';
import {
  parseGoogleDriveUrl,
  isGoogleDriveUrl,
  validateUrlInput,
  resolvePlayableMediaUrl,
} from '../../services/mediaResolver';
import {
  detectMediaProvider,
  computeSessionSyncCapability,
} from '../../services/mediaProviders/mediaProviderRegistry';
import { SyncCapability } from '../../services/mediaProviders/types';

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

interface TheatreProps {
  sourceVideo?: VideoSource | null;
  primaryReaction?: ReactionVideo | null;
  extraReactions?: ReactionVideo[];
  isHost?: boolean;
  roomCode?: string;
  hostToken?: string;
  participantToken?: string;
  onExit?: () => void;
  onOpenCreatorStudio?: (reaction: ReactionVideo) => void;
  onStreamsChanged?: (config: {
    source: VideoSource;
    primaryReaction: ReactionVideo;
    extraReactions: ReactionVideo[];
  }) => void;
  onJoinPartyByCode?: (code: string) => void;
}

export function Theatre({
  sourceVideo: initialSourceVideo,
  primaryReaction: initialPrimaryReaction,
  extraReactions: initialExtraReactions = [],
  isHost = true,
  roomCode,
  hostToken,
  participantToken,
  onExit,
  onOpenCreatorStudio,
  onStreamsChanged,
  onJoinPartyByCode,
}: TheatreProps) {
  // Sync controller instance (authoritative engine)
  const controllerRef = useRef<SessionSyncController | null>(null);
  const lastServerSeqRef = useRef<number>(0);

  const [sourceVideo, setSourceVideo] = useState<VideoSource | null>(initialSourceVideo || null);
  const [primaryReaction, setPrimaryReaction] = useState<ReactionVideo | null>(initialPrimaryReaction || null);
  const [extraReactions, setExtraReactions] = useState<ReactionVideo[]>(initialExtraReactions);
  const [syncState, setSyncState] = useState<SessionSyncState | null>(null);

  // Stream Chooser & Blank Canvas State
  const [isStreamChooserOpen, setIsStreamChooserOpen] = useState(false);
  const [partyInputCode, setPartyInputCode] = useState('');
  const [isPartyInputOpen, setIsPartyInputOpen] = useState(false);

  // Quick stream inputs for blank canvas
  const [quickSourceUrl, setQuickSourceUrl] = useState('');
  const [quickReactionUrl, setQuickReactionUrl] = useState('');
  const [quickReactorName, setQuickReactorName] = useState('');
  const [quickIntroOffset, setQuickIntroOffset] = useState<number>(0);

  // Local file state for original video on canvas
  const [localSourceFile, setLocalSourceFile] = useState<File | null>(null);
  const [localSourceUrl, setLocalSourceUrl] = useState<string>('');
  const [localSourceDuration, setLocalSourceDuration] = useState<number | null>(null);
  const [isDraggingCanvasSource, setIsDraggingCanvasSource] = useState(false);
  const canvasFileInputRef = useRef<HTMLInputElement>(null);
  const [quickSourceMode, setQuickSourceMode] = useState<'file' | 'url'>('file');

  const handleSelectCanvasSourceFile = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('video/') && !file.name.match(/\.(mp4|webm|mkv|mov|m4v|avi)$/i)) {
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    setLocalSourceFile(file);
    setLocalSourceUrl(blobUrl);
    setQuickSourceUrl(blobUrl);

    try {
      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.src = blobUrl;
      tempVideo.onloadedmetadata = () => {
        if (tempVideo.duration && !isNaN(tempVideo.duration)) {
          setLocalSourceDuration(Math.round(tempVideo.duration));
        }
      };
    } catch {}
  };

  // Active side panel tab
  const [activeTab, setActiveTab] = useState<'chat' | 'chapters' | 'notes' | 'reactors'>('chapters');

  // Watch party chat & notes state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newChatText, setNewChatText] = useState('');
  const [activeNotes, setActiveNotes] = useState<ReactionNote[]>(initialPrimaryReaction?.notes || []);
  const [newNoteText, setNewNoteText] = useState('');

  // Floating emoji reaction bursts
  const [emojiBursts, setEmojiBursts] = useState<{ id: number; emoji: string; x: number }[]>([]);

  // Countdown cue state for manual sync coordination (e.g. Patreon)
  const [countdownCount, setCountdownCount] = useState<number | null>(null);
  const isCountingDown = countdownCount !== null;

  // Compute session-level sync capability across all active media streams
  const sessionCapability = React.useMemo(() => {
    const caps: SyncCapability[] = [];
    if (sourceVideo?.url) {
      caps.push(detectMediaProvider(sourceVideo.url, sourceVideo.isLocalFile).syncCapability);
    }
    if (primaryReaction?.url) {
      caps.push(detectMediaProvider(primaryReaction.url, primaryReaction.isLocalFile).syncCapability);
    }
    extraReactions.forEach((rx) => {
      if (rx.url) {
        caps.push(detectMediaProvider(rx.url, rx.isLocalFile).syncCapability);
      }
    });
    return computeSessionSyncCapability(caps);
  }, [sourceVideo, primaryReaction, extraReactions]);

  const handleStartCountdownCue = () => {
    if (isCountingDown) return;
    setCountdownCount(3);
    const interval = setInterval(() => {
      setCountdownCount((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          controllerRef.current?.play();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Sync state if props change from outside
  useEffect(() => {
    if (initialSourceVideo) setSourceVideo(initialSourceVideo);
    if (initialPrimaryReaction) {
      setPrimaryReaction(initialPrimaryReaction);
      setActiveNotes(initialPrimaryReaction.notes || []);
    }
    if (initialExtraReactions) setExtraReactions(initialExtraReactions);
  }, [initialSourceVideo, initialPrimaryReaction, initialExtraReactions]);

  // Watch Party live sync polling
  useEffect(() => {
    if (!roomCode) return;

    let isMounted = true;
    const fetchPartyState = async () => {
      try {
        const res = await fetch(`/api/parties/${roomCode}`);
        if (!res.ok) return;
        const data = await res.json();
        const room = data.room;
        if (!isMounted || !room) return;

        if (room.chatMessages) {
          setChatMessages(room.chatMessages);
        }
        if (room.notes) {
          setActiveNotes(room.notes);
        }

        // If not host, synchronize to host's authoritative playback state
        if (!isHost && room.playbackState && controllerRef.current) {
          const serverSeq = room.playbackState.seq;
          if (serverSeq > lastServerSeqRef.current) {
            lastServerSeqRef.current = serverSeq;
            const estimatedTime = data.estimatedSourceTime ?? room.playbackState.sourceTime;
            controllerRef.current.seekToSourceTime(estimatedTime);
            if (room.playbackState.isPlaying) {
              controllerRef.current.play();
            } else {
              controllerRef.current.pause();
            }
          }
        }
      } catch {}
    };

    fetchPartyState();
    const interval = setInterval(fetchPartyState, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [roomCode, isHost]);

  // Initialize Controller whenever source and primary reaction are available
  useEffect(() => {
    if (!sourceVideo || !primaryReaction) {
      if (controllerRef.current) {
        controllerRef.current.destroy();
        controllerRef.current = null;
      }
      setSyncState(null);
      return;
    }

    const controller = new SessionSyncController();
    controllerRef.current = controller;

    // Set initial reaction and anchors
    controller.setActiveReaction(primaryReaction.id);
    controller.setReactionAnchors(primaryReaction.id, primaryReaction.anchors || []);

    extraReactions.forEach((rx) => {
      controller.setReactionAnchors(rx.id, rx.anchors || []);
    });

    const unsubscribe = controller.subscribe((state) => {
      setSyncState(state);
    });

    return () => {
      unsubscribe();
      controller.destroy();
    };
  }, [sourceVideo?.id, primaryReaction?.id]);

  // Update anchors when reactions change
  useEffect(() => {
    if (controllerRef.current && primaryReaction) {
      controllerRef.current.setActiveReaction(primaryReaction.id);
      controllerRef.current.setReactionAnchors(primaryReaction.id, primaryReaction.anchors || []);
      extraReactions.forEach((rx) => {
        controllerRef.current?.setReactionAnchors(rx.id, rx.anchors || []);
      });
    }
  }, [primaryReaction, extraReactions]);

  const handlePlayToggle = async () => {
    if (!controllerRef.current) return;
    const willPlay = !syncState?.isPlaying;
    controllerRef.current.togglePlay();

    if (roomCode && isHost && hostToken) {
      try {
        await fetch(`/api/parties/${roomCode}/command`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-host-token': hostToken,
          },
          body: JSON.stringify({
            command: willPlay ? 'play' : 'pause',
            sourceTime: controllerRef.current.getSourceTime(),
          }),
        });
      } catch (err) {
        console.warn('Failed to broadcast play command:', err);
      }
    }
  };

  const handleSeek = async (time: number) => {
    controllerRef.current?.seekToSourceTime(time);

    if (roomCode && isHost && hostToken) {
      try {
        await fetch(`/api/parties/${roomCode}/command`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-host-token': hostToken,
          },
          body: JSON.stringify({
            command: 'seek',
            sourceTime: time,
          }),
        });
      } catch (err) {
        console.warn('Failed to broadcast seek command:', err);
      }
    }
  };

  const handleStepReaction = (delta: number) => {
    if (primaryReaction) {
      controllerRef.current?.stepReactionOffset(primaryReaction.id, delta);
    }
  };

  const handleAddExtraReactor = (rx: ReactionVideo) => {
    if (extraReactions.length >= 4) return;
    if (primaryReaction && rx.id === primaryReaction.id) return;
    if (extraReactions.some((e) => e.id === rx.id)) return;
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
    if (oldPrimary) {
      setExtraReactions([oldPrimary, ...remainingExtras]);
    } else {
      setExtraReactions(remainingExtras);
    }
    controllerRef.current?.setActiveReaction(newPrimary.id);
  };

  const handleSendChat = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = newChatText.trim();
    if (!text) return;

    if (roomCode && participantToken) {
      try {
        const res = await fetch(`/api/parties/${roomCode}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-participant-token': participantToken,
          },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          const msg: ChatMessage = await res.json();
          setChatMessages((prev) => [...prev, msg]);
          setNewChatText('');
          return;
        }
      } catch {}
    }

    const msg: ChatMessage = {
      id: `msg-${Date.now()}`,
      senderId: 'user-me',
      senderName: isHost ? 'You (Host)' : 'You',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80',
      text,
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

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = newNoteText.trim();
    if (!text) return;
    const curSourceTime = syncState?.sourceTime || 0;
    const curRxTime = syncState?.primaryReactionTime || 0;

    if (roomCode && participantToken) {
      try {
        const res = await fetch(`/api/parties/${roomCode}/notes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-participant-token': participantToken,
          },
          body: JSON.stringify({
            sourceTime: curSourceTime,
            reactionTime: curRxTime,
            text,
          }),
        });
        if (res.ok) {
          const note: ReactionNote = await res.json();
          setActiveNotes((prev) => [note, ...prev]);
          setNewNoteText('');
          return;
        }
      } catch {}
    }

    const note: ReactionNote = {
      id: `note-${Date.now()}`,
      userId: 'user-me',
      userName: 'You',
      sourceTimestamp: curSourceTime,
      reactionTimestamp: curRxTime,
      text,
      isPublic: true,
      createdAt: Date.now(),
    };
    setActiveNotes((prev) => [note, ...prev]);
    setNewNoteText('');
  };

  const handleDeleteNote = async (noteId: string) => {
    if (roomCode) {
      const headers: Record<string, string> = {};
      if (hostToken) headers['x-host-token'] = hostToken;
      if (participantToken) headers['x-participant-token'] = participantToken;
      try {
        const res = await fetch(`/api/parties/${roomCode}/notes/${noteId}`, {
          method: 'DELETE',
          headers,
        });
        if (res.ok) {
          setActiveNotes((prev) => prev.filter((n) => n.id !== noteId));
          return;
        }
      } catch {}
    }
    setActiveNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Launch streams handler
  const handleLaunchChosenStreams = async (config: {
    source: VideoSource;
    primaryReaction: ReactionVideo;
    extraReactions: ReactionVideo[];
    layout?: TheatreLayout;
    saveToLibrary?: boolean;
  }) => {
    setSourceVideo(config.source);
    setPrimaryReaction(config.primaryReaction);
    setExtraReactions(config.extraReactions);
    setActiveNotes(config.primaryReaction.notes || []);

    if (config.saveToLibrary) {
      await catalogueService.saveStreamSetup({
        source: config.source,
        primaryReaction: config.primaryReaction,
        extraReactions: config.extraReactions,
        layout: config.layout,
      });
    }

    if (config.layout && controllerRef.current) {
      controllerRef.current.setLayout(config.layout);
    }

    if (onStreamsChanged) {
      onStreamsChanged({
        source: config.source,
        primaryReaction: config.primaryReaction,
        extraReactions: config.extraReactions,
      });
    }
  };

  const handleQuickLaunch = (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveSourceUrl =
      quickSourceMode === 'file' ? (localSourceUrl || quickSourceUrl) : quickSourceUrl;

    if (!effectiveSourceUrl.trim() || !quickReactionUrl.trim()) {
      setIsStreamChooserOpen(true);
      return;
    }

    const cleanReactor = quickReactorName.trim() || 'Primary Reactor';
    const sourceId = `src-${Date.now()}`;
    const reactionId = `rx-${Date.now()}`;
    const now = Date.now();

    const cleanSourceTitle = localSourceFile
      ? localSourceFile.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
      : 'Original Source Video';

    const resolvedSourceUrl = resolvePlayableMediaUrl(effectiveSourceUrl.trim());
    const resolvedReactionUrl = resolvePlayableMediaUrl(quickReactionUrl.trim());

    const source: VideoSource = {
      id: sourceId,
      title: cleanSourceTitle,
      creator: localSourceFile ? 'Local Media File' : 'Source Content Creator',
      duration: localSourceDuration || 300,
      url: resolvedSourceUrl,
      thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
      category: 'Movies & TV',
      description: localSourceFile ? `Local file: ${localSourceFile.name}` : 'Synchronized stream viewing session',
      isLocalFile: Boolean(localSourceFile),
      fileName: localSourceFile?.name,
      fileSize: localSourceFile?.size,
    };

    const primaryRx: ReactionVideo = {
      id: reactionId,
      sourceId,
      creator: cleanReactor,
      channelName: `${cleanReactor} Live`,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanReactor}`,
      title: `${cleanReactor} Reacts to ${cleanSourceTitle}`,
      duration: 320,
      introDuration: Math.max(0, Number(quickIntroOffset) || 0),
      url: resolvedReactionUrl,
      thumbnail: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
      anchors: [
        {
          id: `a-${now}`,
          sourceTime: 0,
          reactionTime: Math.max(0, Number(quickIntroOffset) || 0),
          type: 'intro',
        },
      ],
      chapters: [],
      highlights: [],
      notes: [],
      views: 1,
      likes: 1,
      isPublished: true,
      createdAt: now,
    };

    handleLaunchChosenStreams({
      source,
      primaryReaction: primaryRx,
      extraReactions: [],
      saveToLibrary: !localSourceFile,
    });
  };

  const handleQuickTestStreams = () => {
    setQuickSourceMode('url');
    setLocalSourceFile(null);
    setLocalSourceUrl('');
    setQuickSourceUrl('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4');
    setQuickReactionUrl('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4');
    setQuickReactorName('Alex Rivers');
    setQuickIntroOffset(12.5);
  };

  // ========================================================
  // 1. BLANK CANVAS VIEW (No generic placeholder videos)
  // ========================================================
  if (!sourceVideo || !primaryReaction) {
    return (
      <div className="relative min-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans select-none">
        {/* Minimalist Top Canvas Bar */}
        <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            {onExit && (
              <button
                onClick={onExit}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <span>&larr; Exit Stage</span>
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30">
                <Tv className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-sm tracking-tight text-white">SyncView Stage</span>
            </div>
            <span className="text-[11px] font-semibold text-slate-400">
              Blank Canvas
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsStreamChooserOpen(true)}
              className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-600/25 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>Choose Streams</span>
            </button>
          </div>
        </header>

        {/* Blank Canvas Stage Arena */}
        <main className="flex-1 flex flex-col items-center justify-center p-6 relative overflow-hidden">
          {/* Subtle Ambient Background Grid Frame */}
          <div className="absolute inset-0 bg-[radial-gradient(#1e1e38_1px,transparent_1px)] [background-size:24px_24px] opacity-25 pointer-events-none" />

          {/* Central Interactive Blank Canvas Stage */}
          <div className="relative z-10 w-full max-w-4xl flex flex-col items-center gap-8 text-center my-auto">
            {/* Aspect Ratio Synchronization Wireframe */}
            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
              {/* Left Monitor: Source Video Slot (Interactive File Dropper) */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingCanvasSource(true);
                }}
                onDragLeave={() => setIsDraggingCanvasSource(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingCanvasSource(false);
                  if (e.dataTransfer.files?.[0]) {
                    handleSelectCanvasSourceFile(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => {
                  if (!localSourceFile) canvasFileInputRef.current?.click();
                }}
                className={`aspect-video rounded-2xl border-2 border-dashed p-6 flex flex-col items-center justify-center gap-3 backdrop-blur-sm cursor-pointer transition-all group ${
                  isDraggingCanvasSource
                    ? 'border-indigo-500 bg-indigo-950/60 scale-[1.02]'
                    : localSourceFile
                    ? 'border-indigo-500/80 bg-indigo-950/30'
                    : 'border-slate-800 bg-slate-950/60 hover:border-indigo-500/60'
                }`}
              >
                <input
                  ref={canvasFileInputRef}
                  type="file"
                  accept="video/*,.mkv,.mp4,.webm,.mov,.avi,.m4v"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleSelectCanvasSourceFile(e.target.files[0]);
                  }}
                />

                {localSourceFile ? (
                  <div className="flex flex-col items-center text-center max-w-[280px]">
                    <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 mb-2 shadow-inner">
                      <FileVideo className="w-6 h-6" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full mb-1">
                      Local Original Video Ready
                    </span>
                    <span className="text-xs font-bold text-white truncate max-w-full">
                      {localSourceFile.name}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-0.5">
                      {formatBytes(localSourceFile.size)} &bull; Plays instantly from disk
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        canvasFileInputRef.current?.click();
                      }}
                      className="mt-2 text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold underline underline-offset-4 cursor-pointer"
                    >
                      Change Local File
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 group-hover:text-indigo-400 group-hover:scale-105 transition-all">
                      <Film className="w-6 h-6" />
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                        Original Source Video
                      </span>
                      <span className="text-[11px] text-indigo-400 font-medium mt-0.5">
                        Click to select local file or drag & drop here
                      </span>
                      <span className="text-[10px] text-slate-500 mt-0.5">
                        Supports MP4, WebM, MKV, MOV &bull; Or use Stream URL
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Right Monitor: Reaction Stream Slot */}
              <div
                onClick={() => setIsStreamChooserOpen(true)}
                className="aspect-video rounded-2xl border-2 border-dashed border-slate-800 bg-slate-950/60 backdrop-blur-sm p-6 flex flex-col items-center justify-center gap-3 text-slate-500 group hover:border-purple-500/50 transition-all cursor-pointer"
              >
                <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 group-hover:text-purple-400 group-hover:scale-105 transition-all">
                  <Tv className="w-6 h-6" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Reaction Video Stream(s)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Intro offset & lip-sync calibration
                  </span>
                </div>
              </div>
            </div>

            {/* Canvas Call-to-Action Card */}
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-3xl p-6 sm:p-8 max-w-xl w-full backdrop-blur-md shadow-2xl flex flex-col items-center gap-5">
              <div>
                <span className="text-[10px] font-bold tracking-wider uppercase bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-3 py-1 rounded-full">
                  Canvas Ready &bull; Zero Placeholders
                </span>
                <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight mt-3">
                  Synchronize Any Reaction Video
                </h1>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed max-w-md mx-auto">
                  Play your original video (local file or stream) alongside one or more creator reactions with automatic timeline offset, drift correction, and volume balance.
                </p>
              </div>

              {/* Primary Launch Action */}
              <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                <button
                  onClick={() => setIsStreamChooserOpen(true)}
                  className="w-full sm:w-auto px-6 py-3 rounded-2xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer hover:scale-105"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>Choose Streams to Begin Viewing</span>
                </button>

                {onJoinPartyByCode && (
                  <button
                    onClick={() => setIsPartyInputOpen(true)}
                    className="w-full sm:w-auto px-5 py-3 rounded-2xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <Users className="w-4 h-4 text-purple-400" />
                    <span>Join Watch Party</span>
                  </button>
                )}
              </div>

              {/* Quick Setup Launcher */}
              <div className="w-full pt-4 border-t border-slate-900 flex flex-col gap-3">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-300">Original Video Source:</span>
                    <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[10px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setQuickSourceMode('file')}
                        className={`px-2 py-0.5 rounded transition-all cursor-pointer flex items-center gap-1 ${
                          quickSourceMode === 'file'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Folder className="w-3 h-3" />
                        <span>Local File</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuickSourceMode('url')}
                        className={`px-2 py-0.5 rounded transition-all cursor-pointer flex items-center gap-1 ${
                          quickSourceMode === 'url'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Globe className="w-3 h-3" />
                        <span>Web URL</span>
                      </button>
                    </div>
                  </div>

                  {quickSourceMode === 'url' && (
                    <button
                      type="button"
                      onClick={handleQuickTestStreams}
                      className="text-indigo-400 hover:text-indigo-300 underline underline-offset-4 flex items-center gap-1 cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Fill sample URLs</span>
                    </button>
                  )}
                </div>

                <form onSubmit={handleQuickLaunch} className="flex flex-col gap-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {quickSourceMode === 'file' ? (
                      <div
                        onClick={() => canvasFileInputRef.current?.click()}
                        className="bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-indigo-500/50 rounded-xl px-3 py-2 text-xs text-white flex items-center justify-between cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Folder className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span className="truncate">
                            {localSourceFile ? localSourceFile.name : 'Choose Local Original Video File...'}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider shrink-0 ml-2">
                          {localSourceFile ? 'Change' : 'Browse'}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <input
                          type="url"
                          value={quickSourceUrl}
                          onChange={(e) => setQuickSourceUrl(e.target.value)}
                          placeholder="Source Video Stream URL (or Google Drive link)"
                          className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                        />
                        {isGoogleDriveUrl(quickSourceUrl) && (
                          <div className="text-[10px] text-indigo-400 flex items-center gap-1 px-1">
                            <span>Google Drive link detected &bull; Must be shared as &quot;Anyone with the link can view&quot;</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col gap-1">
                      <input
                        type="url"
                        value={quickReactionUrl}
                        onChange={(e) => setQuickReactionUrl(e.target.value)}
                        placeholder="Reaction Video Stream URL (or Google Drive link)"
                        className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                      />
                      {isGoogleDriveUrl(quickReactionUrl) && (
                        <div className="text-[10px] text-indigo-400 flex items-center gap-1 px-1">
                          <span>Google Drive link detected &bull; Must be shared as &quot;Anyone with the link can view&quot;</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={quickReactorName}
                      onChange={(e) => setQuickReactorName(e.target.value)}
                      placeholder="Reactor Name (optional)"
                      className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 sm:col-span-2"
                    />
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={quickIntroOffset}
                        onChange={(e) => setQuickIntroOffset(parseFloat(e.target.value) || 0)}
                        placeholder="Intro offset"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white font-mono text-center focus:outline-none focus:border-indigo-500"
                      />
                      <span className="text-[11px] text-slate-400">sec</span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="mt-1 w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/20 cursor-pointer"
                  >
                    Launch Synchronized Viewing
                  </button>
                </form>
              </div>
            </div>
          </div>
        </main>

        {/* Stream Chooser Modal */}
        <StreamChooserModal
          isOpen={isStreamChooserOpen}
          onClose={() => setIsStreamChooserOpen(false)}
          onLaunchStreams={handleLaunchChosenStreams}
        />

        {/* Join Watch Party Dialog */}
        {isPartyInputOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
            <div className="bg-[#0b0f19] border border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-400" />
                  <h3 className="text-sm font-bold text-white">Join Synchronized Watch Party</h3>
                </div>
                <button
                  onClick={() => setIsPartyInputOpen(false)}
                  className="text-slate-500 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-400">
                Enter the 6-character room code shared by the host to join in real-time sync.
              </p>
              <input
                type="text"
                maxLength={6}
                value={partyInputCode}
                onChange={(e) => setPartyInputCode(e.target.value.toUpperCase())}
                placeholder="e.g. 72K69J"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-center font-mono font-bold tracking-widest text-white uppercase focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={() => {
                  if (partyInputCode.trim() && onJoinPartyByCode) {
                    onJoinPartyByCode(partyInputCode.trim());
                    setIsPartyInputOpen(false);
                  }
                }}
                className="w-full py-2.5 rounded-xl text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 transition-colors cursor-pointer"
              >
                Join Party
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ========================================================
  // 2. ACTIVE SYNCHRONIZED THEATRE VIEW
  // ========================================================
  const currentSourceTime = syncState?.sourceTime || 0;
  const currentDuration = sourceVideo?.duration || 180;
  const currentLayout = syncState?.layout || 'side-by-side';
  const isAdvanced = syncState?.isAdvancedMode || false;
  const primaryStatus = syncState?.primaryStatus || 'synced';

  return (
    <div className="relative min-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans">
      {/* Top Header Bar */}
      <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md px-4 py-2.5 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          {onExit && (
            <button
              onClick={onExit}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 transition-colors"
            >
              <span>&larr; Exit</span>
            </button>
          )}
          <div className="h-4 w-px bg-slate-800" />
          <h2 className="text-sm font-semibold text-white truncate max-w-md">
            {sourceVideo.title}
          </h2>
          <span className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full font-medium">
            with {primaryReaction.creator}
          </span>

          {/* Change streams button */}
          <button
            onClick={() => setIsStreamChooserOpen(true)}
            className="hidden sm:flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white px-2.5 py-1 rounded-lg bg-indigo-600/20 border border-indigo-500/30 hover:bg-indigo-600/30 transition-colors cursor-pointer"
            title="Change streams or add extra reactors"
          >
            <Tv className="w-3.5 h-3.5" />
            <span>Streams ({1 + extraReactions.length})</span>
          </button>

          {/* Clear back to blank canvas button */}
          <button
            onClick={() => {
              setSourceVideo(null);
              setPrimaryReaction(null);
              setExtraReactions([]);
              if (controllerRef.current) {
                controllerRef.current.destroy();
                controllerRef.current = null;
              }
              setSyncState(null);
            }}
            className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Clear and return to blank canvas"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Blank Canvas</span>
          </button>
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

          {/* Manual Sync Coordination Banner */}
          {sessionCapability.capability === 'manual_sync' && (
            <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shadow-lg">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2 font-semibold text-amber-200">
                    <span>Manual Synchronisation Active</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                      Target Reaction Cue:{' '}
                      {formatTime(
                        syncState?.primaryMetrics
                          ? syncState.sourceTime + (primaryReaction.introDuration || 0)
                          : syncState?.sourceTime || 0
                      )}
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-300/80 mt-0.5">
                    External playback is active (e.g. Patreon). Use the countdown cue to synchronize with the external stream.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleStartCountdownCue}
                  disabled={isCountingDown}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-md"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>{isCountingDown ? `Cue: ${countdownCount}...` : '3-2-1 Sync Cue'}</span>
                </button>
              </div>
            </div>
          )}

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
                subtitle={
                  sourceVideo.isLocalFile && sourceVideo.fileName
                    ? `${sourceVideo.fileName} (${formatBytes(sourceVideo.fileSize)})`
                    : sourceVideo.creator
                }
                isSource={true}
                isLocalFile={sourceVideo.isLocalFile}
                isMuted={syncState?.audioFocus !== 'source' && !syncState?.isDuckingEnabled}
                syncStatus="Master"
                targetTimestamp={syncState?.sourceTime || 0}
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
                subtitle={
                  primaryReaction.isLocalFile && primaryReaction.fileName
                    ? `${primaryReaction.fileName} (${formatBytes(primaryReaction.fileSize)})`
                    : primaryReaction.creator
                }
                avatar={primaryReaction.avatar}
                isPrimary={true}
                isLocalFile={primaryReaction.isLocalFile}
                isMuted={syncState?.audioFocus !== primaryReaction.id}
                syncStatus={primaryStatus}
                playbackRate={syncState?.primaryMetrics?.playbackRate || 1.0}
                targetTimestamp={
                  syncState?.primaryMetrics
                    ? syncState.sourceTime + (primaryReaction.introDuration || 0)
                    : syncState?.sourceTime || 0
                }
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
                  targetTimestamp={(syncState?.sourceTime || 0) + (rx.introDuration || 0)}
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
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleSeek(n.sourceTimestamp)}
                            className="font-mono text-[10px] text-indigo-400 hover:text-indigo-300 bg-indigo-950/60 px-1.5 py-0.5 rounded flex items-center gap-1"
                          >
                            <Clock className="w-2.5 h-2.5" />
                            <span>{formatTime(n.sourceTimestamp)}</span>
                          </button>
                          <button
                            onClick={() => handleDeleteNote(n.id)}
                            className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                            title="Delete note"
                            aria-label="Delete note"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
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

              {extraReactions.length < 4 && (
                <div className="mt-3">
                  <button
                    onClick={() => setIsStreamChooserOpen(true)}
                    className="w-full p-2.5 rounded-xl bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 font-semibold flex items-center justify-center gap-2 text-xs transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Extra Reactor Stream</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Stream Chooser Modal */}
      <StreamChooserModal
        isOpen={isStreamChooserOpen}
        onClose={() => setIsStreamChooserOpen(false)}
        onLaunchStreams={handleLaunchChosenStreams}
        initialSource={sourceVideo}
        initialPrimaryReaction={primaryReaction}
        initialExtraReactions={extraReactions}
      />
    </div>
  );
}
