/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  VideoSource,
  ReactionVideo,
  SyncAnchor,
} from '../../types';
import { catalogueService } from '../../services/catalogueService';
import {
  Check,
  ArrowRight,
  ArrowLeft,
  Film,
  Video,
  Sliders,
  Sparkles,
  Play,
  UploadCloud,
  Layers,
  Folder,
  Globe,
  FileVideo,
  HardDrive,
} from 'lucide-react';
import { ContextualHelp } from '../common/ContextualHelp';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

interface ReactionWizardProps {
  onComplete: (reaction: ReactionVideo, source: VideoSource) => void;
  onCancel: () => void;
}

export function ReactionWizard({ onComplete, onCancel }: ReactionWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [savedSources, setSavedSources] = useState<VideoSource[]>([]);

  // Step 1: Source (Web URL or Local File)
  const [sourceMode, setSourceMode] = useState<'file' | 'url'>('file');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceFileUrl, setSourceFileUrl] = useState<string>('');
  const [sourceFileSize, setSourceFileSize] = useState<number | null>(null);
  const [sourceFileDuration, setSourceFileDuration] = useState<number | null>(null);
  const [isDraggingSourceFile, setIsDraggingSourceFile] = useState(false);
  const sourceFileInputRef = useRef<HTMLInputElement | null>(null);

  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceCategory, setSourceCategory] = useState<VideoSource['category']>('Movies & TV');
  const [selectedSource, setSelectedSource] = useState<VideoSource | null>(null);

  // Step 2: Reaction info (Web URL or Local File)
  const [reactionMode, setReactionMode] = useState<'url' | 'file'>('url');
  const [reactionFile, setReactionFile] = useState<File | null>(null);
  const [reactionFileUrl, setReactionFileUrl] = useState<string>('');
  const [reactionFileSize, setReactionFileSize] = useState<number | null>(null);
  const [reactionFileDuration, setReactionFileDuration] = useState<number | null>(null);
  const [isDraggingReactionFile, setIsDraggingReactionFile] = useState(false);
  const reactionFileInputRef = useRef<HTMLInputElement | null>(null);

  const [creatorName, setCreatorName] = useState('');
  const [reactionTitle, setReactionTitle] = useState('');
  const [reactionUrl, setReactionUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');

  // Step 3: Synchronization calibration
  const [introDuration, setIntroDuration] = useState<number>(0);
  const [hasPause, setHasPause] = useState(false);
  const [pauseSourceTime, setPauseSourceTime] = useState(45);
  const [pauseDuration, setPauseDuration] = useState(10);

  // Step 4: Preview & Publish
  const [isPublished, setIsPublished] = useState(true);

  const handleSelectSourceFile = (file: File) => {
    try {
      const objUrl = URL.createObjectURL(file);
      setSourceFile(file);
      setSourceFileUrl(objUrl);
      setSourceFileSize(file.size);
      setSelectedSource(null);

      if (!sourceTitle) {
        const cleanName = file.name
          .replace(/\.[^/.]+$/, '')
          .replace(/[_-]+/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        setSourceTitle(cleanName);
      }

      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.src = objUrl;
      tempVideo.onloadedmetadata = () => {
        if (tempVideo.duration && !isNaN(tempVideo.duration)) {
          setSourceFileDuration(Math.round(tempVideo.duration));
        }
      };
    } catch (e) {
      console.error('Failed to create object URL for local source file:', e);
    }
  };

  const handleSelectReactionFile = (file: File) => {
    try {
      const objUrl = URL.createObjectURL(file);
      setReactionFile(file);
      setReactionFileUrl(objUrl);
      setReactionFileSize(file.size);

      if (!reactionTitle) {
        const cleanName = file.name
          .replace(/\.[^/.]+$/, '')
          .replace(/[_-]+/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        setReactionTitle(`${cleanName} (Reaction)`);
      }

      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.src = objUrl;
      tempVideo.onloadedmetadata = () => {
        if (tempVideo.duration && !isNaN(tempVideo.duration)) {
          setReactionFileDuration(Math.round(tempVideo.duration));
        }
      };
    } catch (e) {
      console.error('Failed to create object URL for local reaction file:', e);
    }
  };

  useEffect(() => {
    catalogueService.getSources().then((srcs) => {
      setSavedSources(srcs);
      if (srcs.length > 0 && !selectedSource) {
        setSelectedSource(srcs[0]);
      }
    });
  }, []);

  const handleNext = () => {
    if (step < 4) setStep((prev) => (prev + 1) as any);
  };

  const handleBack = () => {
    if (step > 1) setStep((prev) => (prev - 1) as any);
  };

  const handleFinish = () => {
    const finalSourceUrl =
      sourceMode === 'file' && sourceFileUrl
        ? sourceFileUrl
        : sourceUrl.trim() || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

    const finalSource: VideoSource = selectedSource || {
      id: `src-${Date.now()}`,
      title: sourceTitle.trim() || (sourceFile ? sourceFile.name : 'Custom Source Video'),
      url: finalSourceUrl,
      thumbnail: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=600&q=80',
      duration: sourceFileDuration || 600,
      creator: sourceMode === 'file' ? 'Local Media' : 'Master Source',
      category: sourceCategory || 'Movies & TV',
      description: sourceMode === 'file' ? `Local video file: ${sourceFile?.name}` : 'Stream source entered by user',
      isLocalFile: sourceMode === 'file' && Boolean(sourceFile),
      fileName: sourceFile?.name,
      fileSize: sourceFileSize || undefined,
    };

    const anchors: SyncAnchor[] = [
      {
        id: 'anc-intro',
        sourceTime: 0,
        reactionTime: introDuration,
        type: 'intro',
        label: 'Source Video Starts',
      },
    ];

    if (hasPause) {
      anchors.push({
        id: 'anc-pause-start',
        sourceTime: pauseSourceTime,
        reactionTime: introDuration + pauseSourceTime,
        type: 'pause',
        label: 'Creator pauses to explain',
      });
      anchors.push({
        id: 'anc-pause-end',
        sourceTime: pauseSourceTime,
        reactionTime: introDuration + pauseSourceTime + pauseDuration,
        type: 'pause',
        label: 'Resumes playback',
      });
    }

    const duration = finalSource.duration + introDuration + (hasPause ? pauseDuration : 0);

    const finalReactionUrl =
      reactionMode === 'file' && reactionFileUrl
        ? reactionFileUrl
        : reactionUrl.trim() || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';

    const newReaction: ReactionVideo = {
      id: `rx-${Date.now()}`,
      sourceId: finalSource.id,
      creator: creatorName.trim() || 'Reactor',
      channelName: `${creatorName.trim() || 'Reactor'} Reacts`,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
      title: reactionTitle.trim() || (reactionFile ? reactionFile.name : 'Reaction Video'),
      duration: reactionFileDuration || duration,
      introDuration,
      url: finalReactionUrl,
      thumbnail: thumbnailUrl.trim() || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
      isLocalFile: reactionMode === 'file' && Boolean(reactionFile),
      fileName: reactionFile?.name,
      fileSize: reactionFileSize || undefined,
      anchors,
      chapters: [
        {
          id: 'ch-1',
          title: 'Intro Commentary',
          sourceTimestamp: 0,
          reactionTimestamp: 0,
        },
        {
          id: 'ch-2',
          title: 'Reaction Starts',
          sourceTimestamp: 0,
          reactionTimestamp: introDuration,
        },
      ],
      highlights: [],
      notes: [],
      views: 0,
      likes: 0,
      isPublished,
      createdAt: Date.now(),
    };

    onComplete(newReaction, finalSource);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 w-full flex flex-col gap-6">
      {/* Wizard Step Indicator */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white">Create & Synchronize Reaction</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Step {step} of 4 &bull; Guided 4-step workflow
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 transition-colors"
        >
          Cancel
        </button>
      </div>

      {/* Steps Pill Bar */}
      <div className="grid grid-cols-4 gap-2 text-xs font-medium">
        {[
          { num: 1, label: 'Select Source' },
          { num: 2, label: 'Reaction Details' },
          { num: 3, label: 'Synchronize' },
          { num: 4, label: 'Preview & Publish' },
        ].map((s) => (
          <div
            key={s.num}
            className={`p-2.5 rounded-xl border flex items-center gap-2 transition-all ${
              step === s.num
                ? 'bg-indigo-600/20 border-indigo-500 text-white'
                : step > s.num
                ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-400'
                : 'bg-slate-900/40 border-slate-800 text-slate-500'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step === s.num
                  ? 'bg-indigo-600 text-white'
                  : step > s.num
                  ? 'bg-emerald-500 text-black'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {step > s.num ? <Check className="w-3 h-3" /> : s.num}
            </span>
            <span className="truncate hidden sm:inline">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Step 1: Select Source Video */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <ContextualHelp
            id="wizard_step_1"
            title="Choosing a Source Video"
            description="Select the original movie trailer, gameplay run, or music video you are reacting to. You can pick a local video file from your computer, an online stream URL, or a catalogue item."
          />

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Source Video Stream (Original Content)</h3>
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-0.5 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setSourceMode('file')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors font-medium ${
                  sourceMode === 'file'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Local File</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceMode('url')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors font-medium ${
                  sourceMode === 'url'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Web URL</span>
              </button>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            {sourceMode === 'file' ? (
              <div>
                <input
                  ref={sourceFileInputRef}
                  type="file"
                  accept="video/*,.mkv,.mp4,.webm,.mov,.avi,.m4v"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleSelectSourceFile(f);
                  }}
                />

                {!sourceFile ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingSourceFile(true);
                    }}
                    onDragLeave={() => setIsDraggingSourceFile(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingSourceFile(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f && f.type.startsWith('video/')) {
                        handleSelectSourceFile(f);
                      }
                    }}
                    onClick={() => sourceFileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 ${
                      isDraggingSourceFile
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-slate-700 bg-slate-950/60 hover:border-indigo-400 hover:bg-slate-950'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
                      <UploadCloud className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">
                        Click to browse or drag & drop a local video file
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        MP4, WebM, MKV, MOV &bull; Zero upload lag (plays instantly in browser)
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-950 border border-indigo-500/40 rounded-xl p-3.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0">
                        <FileVideo className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white truncate max-w-[280px]">
                            {sourceFile.name}
                          </span>
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            LOCAL MEDIA
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {sourceFileSize ? formatBytes(sourceFileSize) : ''}
                          {sourceFileDuration ? ` • ${formatDuration(sourceFileDuration)}` : ''}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => sourceFileInputRef.current?.click()}
                      className="px-2.5 py-1 text-xs text-indigo-300 hover:text-white bg-indigo-950/60 border border-indigo-800/50 hover:bg-indigo-900/60 rounded-lg transition-colors shrink-0"
                    >
                      Change File
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  Source Video Stream URL (Direct MP4, WebM, or HLS)
                </label>
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => {
                    setSourceUrl(e.target.value);
                    setSelectedSource(null);
                  }}
                  placeholder="https://example.com/source-video.mp4"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  Source Content Title
                </label>
                <input
                  type="text"
                  value={sourceTitle}
                  onChange={(e) => setSourceTitle(e.target.value)}
                  placeholder="e.g. Dune: Part Two Trailer"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  Category
                </label>
                <select
                  value={sourceCategory}
                  onChange={(e) => setSourceCategory(e.target.value as VideoSource['category'])}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="Movies & TV">Movies & TV</option>
                  <option value="Music">Music</option>
                  <option value="Gaming">Gaming</option>
                  <option value="Anime">Anime</option>
                  <option value="Tech">Tech</option>
                  <option value="Sports">Sports</option>
                </select>
              </div>
            </div>
          </div>

          {savedSources.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              <span className="text-xs text-slate-400 font-medium">Or choose from your previously saved sources:</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {savedSources.map((src) => (
                  <div
                    key={src.id}
                    onClick={() => {
                      setSelectedSource(src);
                      setSourceUrl(src.url);
                      setSourceTitle(src.title);
                      setSourceCategory(src.category);
                      setSourceMode('url');
                    }}
                    className={`p-3 rounded-xl border cursor-pointer transition-all flex gap-3 ${
                      selectedSource?.id === src.id
                        ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="w-16 h-12 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400">
                      <Film className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col justify-center">
                      <span className="text-[10px] text-indigo-400 font-semibold uppercase">{src.category}</span>
                      <h4 className="text-xs font-bold text-white line-clamp-1">{src.title}</h4>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Add Reaction Video */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <ContextualHelp
            id="wizard_step_2"
            title="Reaction Media & Creator Identity"
            description="Provide your reaction video file or hosted stream URL, creator title, and channel information."
          />

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Reaction Video (Camera / Reactor Feed)</h3>
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-0.5 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setReactionMode('file')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors font-medium ${
                  reactionMode === 'file'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Local File</span>
              </button>
              <button
                type="button"
                onClick={() => setReactionMode('url')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors font-medium ${
                  reactionMode === 'url'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Web URL</span>
              </button>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            {reactionMode === 'file' ? (
              <div>
                <input
                  ref={reactionFileInputRef}
                  type="file"
                  accept="video/*,.mkv,.mp4,.webm,.mov,.avi,.m4v"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleSelectReactionFile(f);
                  }}
                />

                {!reactionFile ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingReactionFile(true);
                    }}
                    onDragLeave={() => setIsDraggingReactionFile(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingReactionFile(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f && f.type.startsWith('video/')) {
                        handleSelectReactionFile(f);
                      }
                    }}
                    onClick={() => reactionFileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 ${
                      isDraggingReactionFile
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-slate-700 bg-slate-950/60 hover:border-indigo-400 hover:bg-slate-950'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
                      <UploadCloud className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">
                        Click to select your reactor footage or drag & drop video file
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Direct browser playback &bull; No upload required
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-950 border border-indigo-500/40 rounded-xl p-3.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0">
                        <FileVideo className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white truncate max-w-[280px]">
                            {reactionFile.name}
                          </span>
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            LOCAL MEDIA
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {reactionFileSize ? formatBytes(reactionFileSize) : ''}
                          {reactionFileDuration ? ` • ${formatDuration(reactionFileDuration)}` : ''}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => reactionFileInputRef.current?.click()}
                      className="px-2.5 py-1 text-xs text-indigo-300 hover:text-white bg-indigo-950/60 border border-indigo-800/50 hover:bg-indigo-900/60 rounded-lg transition-colors shrink-0"
                    >
                      Change File
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  Reaction Video URL (MP4 / WebM / Stream)
                </label>
                <input
                  type="url"
                  value={reactionUrl}
                  onChange={(e) => setReactionUrl(e.target.value)}
                  placeholder="https://example.com/reaction-cam.mp4"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  Reaction Video Title
                </label>
                <input
                  type="text"
                  value={reactionTitle}
                  onChange={(e) => setReactionTitle(e.target.value)}
                  placeholder="e.g. Creator reacts to trailer!"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  Creator Name / Channel
                </label>
                <input
                  type="text"
                  value={creatorName}
                  onChange={(e) => setCreatorName(e.target.value)}
                  placeholder="e.g. JohnDoe"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Synchronize */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <ContextualHelp
            id="wizard_step_3"
            title="Timing Calibration"
            description="Set when the source video begins inside your reaction video (intro offset), and whether you paused the source to speak."
          />

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-slate-200 font-semibold">
                  Intro Offset (Seconds before source starts)
                </label>
                <span className="font-mono text-xs text-indigo-400 font-bold">
                  {introDuration} seconds
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="60"
                step="0.5"
                value={introDuration}
                onChange={(e) => setIntroDuration(parseFloat(e.target.value))}
                className="w-full h-2 bg-slate-700 rounded appearance-none accent-indigo-500 cursor-pointer"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Your greeting and intro lasts {introDuration}s before the source media begins playing.
              </p>
            </div>

            {/* Optional Creator Pause */}
            <div className="pt-3 border-t border-slate-800 flex flex-col gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-200 font-medium">
                <input
                  type="checkbox"
                  checked={hasPause}
                  onChange={(e) => setHasPause(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                />
                <span>I paused the source video during the reaction to comment</span>
              </label>

              {hasPause && (
                <div className="grid grid-cols-2 gap-3 pl-6">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      Source time when paused (s)
                    </label>
                    <input
                      type="number"
                      value={pauseSourceTime}
                      onChange={(e) => setPauseSourceTime(parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      Pause duration (s)
                    </label>
                    <input
                      type="number"
                      value={pauseDuration}
                      onChange={(e) => setPauseDuration(parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Preview & Publish */}
      {step === 4 && (
        <div className="flex flex-col gap-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-white">Review Reaction Summary</h3>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400">Source Video</div>
                <div className="font-semibold text-white mt-0.5">{selectedSource?.title || sourceTitle || 'Custom Source Stream'}</div>
                <div className="text-[11px] text-slate-400">{selectedSource?.creator || 'Master Source'}</div>
              </div>
              <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400">Reaction Video</div>
                <div className="font-semibold text-white mt-0.5">{reactionTitle}</div>
                <div className="text-[11px] text-slate-400">By {creatorName}</div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-indigo-950/20 border border-indigo-500/20 text-xs text-indigo-200">
              <span className="font-semibold">Synchronization Map:</span> Intro offset of {introDuration}s
              {hasPause ? `, with 1 pause at ${pauseSourceTime}s for ${pauseDuration}s.` : '.'}
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-200 font-medium mt-2">
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
                className="rounded border-slate-700 text-indigo-600"
              />
              <span>Publish immediately to Discover & Explore</span>
            </label>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <div className="flex items-center justify-between border-t border-slate-800 pt-4">
        {step > 1 ? (
          <button
            onClick={handleBack}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>
        ) : (
          <div />
        )}

        {step < 4 ? (
          <button
            onClick={handleNext}
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition-all"
          >
            <span>Continue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={handleFinish}
            className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-emerald-600/30 transition-all"
          >
            <Sparkles className="w-4 h-4" />
            <span>{isPublished ? 'Publish Reaction' : 'Save as Draft'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
