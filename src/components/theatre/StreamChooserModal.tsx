/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Play,
  Plus,
  Trash2,
  Sliders,
  Columns,
  LayoutGrid,
  Maximize,
  Tv,
  Film,
  Sparkles,
  Bookmark,
  CheckCircle2,
  Clock,
  UploadCloud,
  Folder,
  Globe,
  FileVideo,
  HardDrive,
} from 'lucide-react';
import { VideoSource, ReactionVideo, TheatreLayout } from '../../types';
import { catalogueService, SavedStreamSetup } from '../../services/catalogueService';

interface StreamChooserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunchStreams: (config: {
    source: VideoSource;
    primaryReaction: ReactionVideo;
    extraReactions: ReactionVideo[];
    layout: TheatreLayout;
    saveToLibrary?: boolean;
  }) => void;
  initialSource?: VideoSource | null;
  initialPrimaryReaction?: ReactionVideo | null;
  initialExtraReactions?: ReactionVideo[];
}

interface ExtraReactorInput {
  id: string;
  creator: string;
  url: string;
  introDuration: number;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDuration(secs: number | null | undefined): string {
  if (!secs || isNaN(secs) || secs <= 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function StreamChooserModal({
  isOpen,
  onClose,
  onLaunchStreams,
  initialSource,
  initialPrimaryReaction,
  initialExtraReactions = [],
}: StreamChooserModalProps) {
  const [activeTab, setActiveTab] = useState<'configure' | 'saved'>('configure');

  // Source selection: 'file' (local video file) or 'url' (stream)
  const [sourceMode, setSourceMode] = useState<'file' | 'url'>('file');
  const [sourceTitle, setSourceTitle] = useState(initialSource?.title || '');
  const [sourceUrl, setSourceUrl] = useState(initialSource?.url || '');
  const [sourceCategory, setSourceCategory] = useState<VideoSource['category']>(
    initialSource?.category || 'Movies & TV'
  );
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceFileUrl, setSourceFileUrl] = useState<string>('');
  const [sourceFileSize, setSourceFileSize] = useState<number | null>(null);
  const [sourceFileDuration, setSourceFileDuration] = useState<number | null>(null);
  const [isDraggingSourceFile, setIsDraggingSourceFile] = useState(false);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);

  // Primary reaction stream fields: 'url' or 'file'
  const [reactionMode, setReactionMode] = useState<'url' | 'file'>('url');
  const [reactorName, setReactorName] = useState(initialPrimaryReaction?.creator || '');
  const [reactionUrl, setReactionUrl] = useState(initialPrimaryReaction?.url || '');
  const [reactionFile, setReactionFile] = useState<File | null>(null);
  const [reactionFileUrl, setReactionFileUrl] = useState<string>('');
  const [reactionFileSize, setReactionFileSize] = useState<number | null>(null);
  const [reactionFileDuration, setReactionFileDuration] = useState<number | null>(null);
  const [isDraggingReactionFile, setIsDraggingReactionFile] = useState(false);
  const reactionFileInputRef = useRef<HTMLInputElement>(null);
  const [introOffset, setIntroOffset] = useState<number>(
    initialPrimaryReaction?.introDuration ?? 0
  );

  // Extra reaction streams (multi-reactor, up to 4)
  const [extraReactors, setExtraReactors] = useState<ExtraReactorInput[]>(() =>
    initialExtraReactions.map((r) => ({
      id: r.id,
      creator: r.creator,
      url: r.url,
      introDuration: r.introDuration,
    }))
  );

  // Layout preference
  const [layout, setLayout] = useState<TheatreLayout>('side-by-side');
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [savedSetups, setSavedSetups] = useState<SavedStreamSetup[]>([]);
  const [formError, setFormError] = useState('');

  // Load saved stream setups from catalogue service
  useEffect(() => {
    if (isOpen) {
      catalogueService.getSavedStreamSetups().then(setSavedSetups);
      setFormError('');
      if (initialSource) {
        setSourceTitle(initialSource.title);
        setSourceUrl(initialSource.url);
        setSourceCategory(initialSource.category);
        if (initialSource.isLocalFile) {
          setSourceMode('file');
        }
      }
      if (initialPrimaryReaction) {
        setReactorName(initialPrimaryReaction.creator);
        setReactionUrl(initialPrimaryReaction.url);
        setIntroOffset(initialPrimaryReaction.introDuration);
        if (initialPrimaryReaction.isLocalFile) {
          setReactionMode('file');
        }
      }
    }
  }, [isOpen, initialSource, initialPrimaryReaction]);

  if (!isOpen) return null;

  const handleSelectSourceFile = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('video/') && !file.name.match(/\.(mp4|webm|mkv|mov|m4v|avi)$/i)) {
      setFormError('Please select a valid video file (MP4, WebM, MKV, MOV).');
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    setSourceFile(file);
    setSourceFileUrl(blobUrl);
    setSourceFileSize(file.size);
    setFormError('');

    // Pre-populate title with readable file name if empty
    if (!sourceTitle || sourceTitle === 'Original Source Video') {
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      setSourceTitle(cleanName);
    }

    // Detect actual duration via video metadata
    try {
      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.src = blobUrl;
      tempVideo.onloadedmetadata = () => {
        if (tempVideo.duration && !isNaN(tempVideo.duration)) {
          setSourceFileDuration(Math.round(tempVideo.duration));
        }
      };
    } catch {}
  };

  const handleSelectReactionFile = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('video/') && !file.name.match(/\.(mp4|webm|mkv|mov|m4v|avi)$/i)) {
      setFormError('Please select a valid video file (MP4, WebM, MKV, MOV).');
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    setReactionFile(file);
    setReactionFileUrl(blobUrl);
    setReactionFileSize(file.size);
    setFormError('');

    if (!reactorName || reactorName === 'Primary Reactor') {
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      setReactorName(cleanName);
    }

    try {
      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.src = blobUrl;
      tempVideo.onloadedmetadata = () => {
        if (tempVideo.duration && !isNaN(tempVideo.duration)) {
          setReactionFileDuration(Math.round(tempVideo.duration));
        }
      };
    } catch {}
  };

  const handleAddExtraReactor = () => {
    if (extraReactors.length >= 4) return;
    setExtraReactors((prev) => [
      ...prev,
      {
        id: `extra-${Date.now()}-${prev.length + 1}`,
        creator: `Reactor ${prev.length + 2}`,
        url: '',
        introDuration: 0,
      },
    ]);
  };

  const handleRemoveExtraReactor = (id: string) => {
    setExtraReactors((prev) => prev.filter((r) => r.id !== id));
  };

  const handleUpdateExtraReactor = (
    id: string,
    field: keyof ExtraReactorInput,
    val: string | number
  ) => {
    setExtraReactors((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: val } : r))
    );
  };

  const handleFillTestStreams = () => {
    setSourceMode('url');
    setSourceTitle('Cinematic Sci-Fi Teaser');
    setSourceUrl('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4');
    setSourceCategory('Movies & TV');

    setReactionMode('url');
    setReactorName('Alex Rivers');
    setReactionUrl('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4');
    setIntroOffset(12.5);

    setFormError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate Source
    const finalSourceUrl = sourceMode === 'file' ? sourceFileUrl : sourceUrl.trim();
    if (!finalSourceUrl) {
      if (sourceMode === 'file') {
        setFormError('Please select a local video file for the Original Video.');
      } else {
        setFormError('Please enter a valid Source Video stream URL.');
      }
      return;
    }

    // Validate Reaction
    const finalReactionUrl = reactionMode === 'file' ? reactionFileUrl : reactionUrl.trim();
    if (!finalReactionUrl) {
      if (reactionMode === 'file') {
        setFormError('Please select a local video file for the Reaction Video.');
      } else {
        setFormError('Please enter a valid Primary Reaction stream URL.');
      }
      return;
    }

    const cleanSourceTitle =
      sourceTitle.trim() ||
      (sourceFile ? sourceFile.name.replace(/\.[^/.]+$/, '') : 'Original Source Video');
    const cleanReactorName =
      reactorName.trim() ||
      (reactionFile ? reactionFile.name.replace(/\.[^/.]+$/, '') : 'Primary Reactor');
    const sourceId = `src-${Date.now()}`;
    const reactionId = `rx-${Date.now()}`;
    const now = Date.now();

    const sourceVideo: VideoSource = {
      id: sourceId,
      title: cleanSourceTitle,
      creator: sourceMode === 'file' ? 'Local Media File' : 'Source Content Creator',
      duration: sourceFileDuration || 300,
      url: finalSourceUrl,
      thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
      category: sourceCategory,
      description: sourceMode === 'file' ? `Local file: ${sourceFile?.name}` : 'Synchronized stream viewing session',
      isLocalFile: sourceMode === 'file',
      fileName: sourceFile?.name,
      fileSize: sourceFileSize || undefined,
    };

    const primaryReaction: ReactionVideo = {
      id: reactionId,
      sourceId,
      creator: cleanReactorName,
      channelName: `${cleanReactorName} Live`,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanReactorName}`,
      title: `${cleanReactorName} Reacts to ${cleanSourceTitle}`,
      duration: reactionFileDuration || 320,
      introDuration: Math.max(0, Number(introOffset) || 0),
      url: finalReactionUrl,
      thumbnail: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
      anchors: [
        {
          id: `a-${now}`,
          sourceTime: 0,
          reactionTime: Math.max(0, Number(introOffset) || 0),
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
      isLocalFile: reactionMode === 'file',
      fileName: reactionFile?.name,
      fileSize: reactionFileSize || undefined,
    };

    const builtExtraReactions: ReactionVideo[] = extraReactors
      .filter((er) => er.url.trim().length > 0)
      .map((er, idx) => ({
        id: `extra-rx-${now}-${idx}`,
        sourceId,
        creator: er.creator.trim() || `Reactor ${idx + 2}`,
        channelName: `${er.creator.trim()} Channel`,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${er.creator}`,
        title: `${er.creator} Reacts to ${cleanSourceTitle}`,
        duration: 320,
        introDuration: Math.max(0, Number(er.introDuration) || 0),
        url: er.url.trim(),
        thumbnail: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
        anchors: [
          {
            id: `ea-${now}-${idx}`,
            sourceTime: 0,
            reactionTime: Math.max(0, Number(er.introDuration) || 0),
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
      }));

    onLaunchStreams({
      source: sourceVideo,
      primaryReaction,
      extraReactions: builtExtraReactions,
      layout,
      saveToLibrary: sourceMode === 'file' ? false : saveToLibrary,
    });

    onClose();
  };

  const handleLoadSavedSetup = (setup: SavedStreamSetup) => {
    onLaunchStreams({
      source: setup.source,
      primaryReaction: setup.primaryReaction,
      extraReactions: setup.extraReactions || [],
      layout: setup.layout || 'side-by-side',
      saveToLibrary: false,
    });
    onClose();
  };

  const handleDeleteSavedSetup = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await catalogueService.deleteStreamSetup(id);
    setSavedSetups((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto animate-fade-in">
      <div className="bg-[#0b0f19] border border-slate-800 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col my-8">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Choose Streams to Watch</h2>
              <p className="text-xs text-slate-400">
                Configure your original content stream and synchronized reaction stream(s).
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-slate-800/80 bg-slate-950/40">
          <button
            onClick={() => setActiveTab('configure')}
            className={`pb-3 text-xs font-semibold px-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'configure'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Configure Streams
          </button>
          <button
            onClick={() => setActiveTab('saved')}
            className={`pb-3 text-xs font-semibold px-2 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'saved'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>Saved Streams ({savedSetups.length})</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[72vh]">
          {activeTab === 'configure' ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {formError && (
                <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs font-medium">
                  {formError}
                </div>
              )}

              {/* Stream 1: Source Video (Original Content) */}
              <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 p-4 sm:p-5 flex flex-col gap-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-indigo-600/30 text-indigo-300 text-[11px] font-bold flex items-center justify-center">
                      1
                    </span>
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Original Source Video
                    </span>
                  </div>

                  {/* Mode switcher: Local File vs Stream URL */}
                  <div className="flex items-center bg-slate-950 p-0.5 rounded-xl border border-slate-800 text-[11px] font-semibold self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setSourceMode('file')}
                      className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                        sourceMode === 'file'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Folder className="w-3.5 h-3.5 text-indigo-300" />
                      <span>Local Video File</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceMode('url')}
                      className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                        sourceMode === 'url'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5 text-slate-400" />
                      <span>Stream URL</span>
                    </button>
                  </div>
                </div>

                {sourceMode === 'file' ? (
                  /* Local File Picker & Drag-and-Drop Area */
                  <div className="flex flex-col gap-3">
                    {!sourceFile && !sourceFileUrl ? (
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDraggingSourceFile(true);
                        }}
                        onDragLeave={() => setIsDraggingSourceFile(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDraggingSourceFile(false);
                          if (e.dataTransfer.files?.[0]) handleSelectSourceFile(e.dataTransfer.files[0]);
                        }}
                        onClick={() => sourceFileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-2xl p-6 sm:p-7 flex flex-col items-center justify-center gap-2.5 text-center cursor-pointer transition-all ${
                          isDraggingSourceFile
                            ? 'border-indigo-500 bg-indigo-950/40 text-white scale-[1.01]'
                            : 'border-slate-800 hover:border-indigo-500/50 bg-slate-950/50 text-slate-400 hover:text-slate-300'
                        }`}
                      >
                        <input
                          ref={sourceFileInputRef}
                          type="file"
                          accept="video/*,.mkv,.mp4,.webm,.mov,.avi,.m4v"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files?.[0]) handleSelectSourceFile(e.target.files[0]);
                          }}
                        />
                        <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-indigo-400 shadow-inner">
                          <UploadCloud className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">
                            Select Original Video File from Your Device
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Drag & drop your movie or video file here, or click to browse
                          </p>
                          <span className="text-[10px] text-slate-500 block mt-1">
                            Supports MP4, WebM, MKV, MOV, M4V (Zero upload lag · Plays locally)
                          </span>
                        </div>
                        <button
                          type="button"
                          className="mt-1 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all pointer-events-none"
                        >
                          Browse Video File
                        </button>
                      </div>
                    ) : (
                      /* File Selected Card */
                      <div className="bg-slate-950 border border-indigo-500/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-11 h-11 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                            <FileVideo className="w-6 h-6" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white truncate max-w-[240px] sm:max-w-[320px]">
                                {sourceFile?.name || 'Local Video Selected'}
                              </span>
                              <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0">
                                Ready
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                              <span>{formatBytes(sourceFileSize)}</span>
                              {sourceFileDuration ? (
                                <>
                                  <span>&bull;</span>
                                  <span>Duration: {formatDuration(sourceFileDuration)}</span>
                                </>
                              ) : null}
                              <span>&bull;</span>
                              <span className="text-indigo-400 font-mono text-[10px]">Local Disk File</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => sourceFileInputRef.current?.click()}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 font-medium transition-colors cursor-pointer"
                          >
                            Change File
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSourceFile(null);
                              setSourceFileUrl('');
                              setSourceFileSize(null);
                              setSourceFileDuration(null);
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                            title="Remove file"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <input
                            ref={sourceFileInputRef}
                            type="file"
                            accept="video/*,.mkv,.mp4,.webm,.mov,.avi,.m4v"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files?.[0]) handleSelectSourceFile(e.target.files[0]);
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Metadata fields for local file */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          Source Video Title
                        </label>
                        <input
                          type="text"
                          value={sourceTitle}
                          onChange={(e) => setSourceTitle(e.target.value)}
                          placeholder="e.g. Official Cinematic Trailer"
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          Category
                        </label>
                        <select
                          value={sourceCategory}
                          onChange={(e) => setSourceCategory(e.target.value as any)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="Movies & TV">Movies & TV</option>
                          <option value="Gaming">Gaming</option>
                          <option value="Music">Music</option>
                          <option value="Tech">Tech</option>
                          <option value="Sports">Sports</option>
                          <option value="Anime">Anime</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Stream URL Input */
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          Source Stream URL *
                        </label>
                        <input
                          type="url"
                          value={sourceUrl}
                          onChange={(e) => setSourceUrl(e.target.value)}
                          placeholder="https://example.com/source-video.mp4"
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          Source Video Title
                        </label>
                        <input
                          type="text"
                          value={sourceTitle}
                          onChange={(e) => setSourceTitle(e.target.value)}
                          placeholder="e.g. Official Cinematic Trailer"
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-400">
                      <span className="font-semibold text-slate-300">Category:</span>
                      <select
                        value={sourceCategory}
                        onChange={(e) => setSourceCategory(e.target.value as any)}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="Movies & TV">Movies & TV</option>
                        <option value="Gaming">Gaming</option>
                        <option value="Music">Music</option>
                        <option value="Tech">Tech</option>
                        <option value="Sports">Sports</option>
                        <option value="Anime">Anime</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Stream 2: Primary Reaction Video */}
              <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 p-4 sm:p-5 flex flex-col gap-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-purple-600/30 text-purple-300 text-[11px] font-bold flex items-center justify-center">
                      2
                    </span>
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Primary Reaction Stream
                    </span>
                  </div>

                  {/* Mode switcher: Stream URL vs Local File */}
                  <div className="flex items-center bg-slate-950 p-0.5 rounded-xl border border-slate-800 text-[11px] font-semibold self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setReactionMode('url')}
                      className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                        reactionMode === 'url'
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>Stream URL</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReactionMode('file')}
                      className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                        reactionMode === 'file'
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Folder className="w-3.5 h-3.5 text-purple-300" />
                      <span>Local Video File</span>
                    </button>
                  </div>
                </div>

                {reactionMode === 'file' ? (
                  /* Local Reaction Video File Picker */
                  <div className="flex flex-col gap-3">
                    {!reactionFile && !reactionFileUrl ? (
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDraggingReactionFile(true);
                        }}
                        onDragLeave={() => setIsDraggingReactionFile(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDraggingReactionFile(false);
                          if (e.dataTransfer.files?.[0]) handleSelectReactionFile(e.dataTransfer.files[0]);
                        }}
                        onClick={() => reactionFileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-2xl p-5 flex flex-col items-center justify-center gap-2 text-center cursor-pointer transition-all ${
                          isDraggingReactionFile
                            ? 'border-purple-500 bg-purple-950/40 text-white scale-[1.01]'
                            : 'border-slate-800 hover:border-purple-500/50 bg-slate-950/50 text-slate-400 hover:text-slate-300'
                        }`}
                      >
                        <input
                          ref={reactionFileInputRef}
                          type="file"
                          accept="video/*,.mkv,.mp4,.webm,.mov,.avi,.m4v"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files?.[0]) handleSelectReactionFile(e.target.files[0]);
                          }}
                        />
                        <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-purple-400">
                          <UploadCloud className="w-5 h-5" />
                        </div>
                        <div className="text-xs font-bold text-white">
                          Choose Reaction Video File from Your Device
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Select your recorded reaction or creator video file
                        </p>
                      </div>
                    ) : (
                      <div className="bg-slate-950 border border-purple-500/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
                            <FileVideo className="w-5 h-5" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white truncate max-w-[240px] sm:max-w-[320px]">
                                {reactionFile?.name}
                              </span>
                              <span className="text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0">
                                Ready
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                              <span>{formatBytes(reactionFileSize)}</span>
                              {reactionFileDuration ? (
                                <>
                                  <span>&bull;</span>
                                  <span>Duration: {formatDuration(reactionFileDuration)}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => reactionFileInputRef.current?.click()}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 font-medium transition-colors cursor-pointer"
                          >
                            Change File
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setReactionFile(null);
                              setReactionFileUrl('');
                              setReactionFileSize(null);
                              setReactionFileDuration(null);
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                            title="Remove file"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <input
                            ref={reactionFileInputRef}
                            type="file"
                            accept="video/*,.mkv,.mp4,.webm,.mov,.avi,.m4v"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files?.[0]) handleSelectReactionFile(e.target.files[0]);
                            }}
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                        Reactor / Channel Name
                      </label>
                      <input
                        type="text"
                        value={reactorName}
                        onChange={(e) => setReactorName(e.target.value)}
                        placeholder="e.g. Alex Rivers Reacts"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                ) : (
                  /* Reaction Stream URL Input */
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                        Reaction Stream URL *
                      </label>
                      <input
                        type="url"
                        value={reactionUrl}
                        onChange={(e) => setReactionUrl(e.target.value)}
                        placeholder="https://example.com/reactor-video.mp4"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                        Reactor / Channel Name
                      </label>
                      <input
                        type="text"
                        value={reactorName}
                        onChange={(e) => setReactorName(e.target.value)}
                        placeholder="e.g. CineCritique Reactions"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                )}

                {/* Intro Offset calibration */}
                <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Intro Offset (Seconds)</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Time the reactor spends talking before pressing play on the source video.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="3600"
                      value={introOffset}
                      onChange={(e) => setIntroOffset(parseFloat(e.target.value) || 0)}
                      className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono text-center focus:outline-none focus:border-indigo-500"
                    />
                    <span className="text-xs text-slate-400">sec</span>
                  </div>
                </div>
              </div>

              {/* Additional Reactors (Optional, up to 4) */}
              <div className="rounded-2xl bg-slate-900/40 border border-slate-800/60 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Additional Reactor Streams (Optional)
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {extraReactors.length}/4
                    </span>
                  </div>
                  {extraReactors.length < 4 && (
                    <button
                      type="button"
                      onClick={handleAddExtraReactor}
                      className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-semibold px-2.5 py-1 rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/20 transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Extra Reactor</span>
                    </button>
                  )}
                </div>

                {extraReactors.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">
                    Watching with a single reactor. Click &quot;Add Extra Reactor&quot; to stream up to 5 synchronized reactors side-by-side!
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {extraReactors.map((extra, idx) => (
                      <div
                        key={extra.id}
                        className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-indigo-300">
                            Reactor #{idx + 2}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveExtraReactor(extra.id)}
                            className="text-slate-400 hover:text-red-400 text-xs flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove</span>
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={extra.creator}
                            onChange={(e) =>
                              handleUpdateExtraReactor(extra.id, 'creator', e.target.value)
                            }
                            placeholder="Reactor Name"
                            className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                          />
                          <input
                            type="url"
                            value={extra.url}
                            onChange={(e) =>
                              handleUpdateExtraReactor(extra.id, 'url', e.target.value)
                            }
                            placeholder="Stream URL (mp4 / webm)"
                            className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 sm:col-span-1"
                          />
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={extra.introDuration}
                              onChange={(e) =>
                                handleUpdateExtraReactor(
                                  extra.id,
                                  'introDuration',
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              placeholder="Offset"
                              className="w-20 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white font-mono text-center focus:outline-none focus:border-indigo-500"
                            />
                            <span className="text-[11px] text-slate-400">s offset</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Layout mode picker */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-2">
                  Initial Theatre Layout
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { id: 'side-by-side', label: 'Side-by-Side', icon: Columns },
                    { id: 'source-focus', label: 'Source Focus', icon: Maximize },
                    { id: 'reactor-focus', label: 'Reactor Focus', icon: Tv },
                    { id: 'grid', label: 'Multi-Grid', icon: LayoutGrid },
                    { id: 'pip', label: 'Picture-in-Pic', icon: Sliders },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setLayout(item.id as TheatreLayout)}
                        className={`p-2.5 rounded-xl border flex flex-col items-center gap-1.5 text-xs transition-all cursor-pointer ${
                          layout === item.id
                            ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-[11px] truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quick test streams link & save checkbox */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={handleFillTestStreams}
                  className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-4 flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Need a quick test? Fill sample stream URLs</span>
                </button>

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={saveToLibrary}
                    onChange={(e) => setSaveToLibrary(e.target.checked)}
                    className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>Save this stream configuration to My Library</span>
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>Launch Synchronized Viewing</span>
                </button>
              </div>
            </form>
          ) : (
            /* Saved Streams List */
            <div className="flex flex-col gap-4">
              {savedSetups.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
                    <Bookmark className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-white">No saved stream configurations</h3>
                  <p className="text-xs text-slate-400 max-w-sm">
                    Configure your streams in the first tab and check &quot;Save this stream configuration&quot; to quickly launch them here anytime.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('configure')}
                    className="mt-2 text-xs font-bold text-indigo-400 hover:text-indigo-300"
                  >
                    Go to Configure Streams &rarr;
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {savedSetups.map((setup) => (
                    <div
                      key={setup.id}
                      onClick={() => handleLoadSavedSetup(setup)}
                      className="bg-slate-900/60 border border-slate-800 hover:border-indigo-500/50 p-4 rounded-2xl flex flex-col justify-between gap-3 group cursor-pointer transition-all"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase font-bold text-indigo-400 bg-indigo-950/60 border border-indigo-500/20 px-2 py-0.5 rounded-md">
                            {setup.source.category}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteSavedSetup(e, setup.id)}
                            className="text-slate-500 hover:text-red-400 transition-colors p-1"
                            title="Delete saved stream"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <h4 className="text-xs font-bold text-white group-hover:text-indigo-300 transition-colors mt-2 line-clamp-1">
                          {setup.title}
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Reactor: {setup.primaryReaction.creator} ({setup.primaryReaction.introDuration}s offset)
                        </p>
                        {setup.extraReactions && setup.extraReactions.length > 0 && (
                          <span className="text-[10px] text-purple-400 mt-1 block">
                            +{setup.extraReactions.length} additional reactors
                          </span>
                        )}
                      </div>

                      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{new Date(setup.savedAt).toLocaleDateString()}</span>
                        <span className="text-indigo-400 font-semibold group-hover:translate-x-1 transition-transform flex items-center gap-1">
                          Launch &rarr;
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
