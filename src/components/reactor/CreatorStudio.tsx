/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  VideoSource,
  ReactionVideo,
  SyncAnchor,
  AnchorType,
  ReactionChapter,
  ReactionHighlight,
} from '../../types';
import {
  exportAnchorsToCsv,
  importAnchorsFromCsv,
  validateAnchors,
  mapSourceToReaction,
} from '../../services/syncEngine';
import { resolvePlayableMediaUrl } from '../../services/mediaResolver';
import { detectMediaProvider } from '../../services/mediaProviders/mediaProviderRegistry';
import {
  Play,
  Pause,
  Plus,
  Trash2,
  FileSpreadsheet,
  Download,
  Upload,
  CheckCircle,
  AlertCircle,
  Sliders,
  Bookmark,
  Sparkles,
  ArrowLeft,
  Save,
  HelpCircle,
  RefreshCw,
} from 'lucide-react';
import { ContextualHelp } from '../common/ContextualHelp';

const getDraftStorageKey = (reactionId: string) => `syncview_studio_draft_${reactionId}`;

function describeVideoMediaError(videoEl: HTMLVideoElement | null, label: string): string {
  const code = videoEl?.error?.code;
  switch (code) {
    case 1:
      return `${label} preview loading was aborted.`;
    case 2:
      return `Network error while loading ${label} preview stream.`;
    case 3:
      return `${label} stream could not be decoded by this browser.`;
    case 4:
      return `${label} URL is unreachable, blocked by CORS, or uses an unsupported media format.`;
    default:
      return `Unable to load ${label} preview media.`;
  }
}

interface CreatorStudioProps {
  sourceVideo: VideoSource;
  reaction: ReactionVideo;
  onSave: (updatedReaction: ReactionVideo) => void;
  onBack: () => void;
  onOpenInTheatre: (reaction: ReactionVideo) => void;
}

export function CreatorStudio({
  sourceVideo,
  reaction: initialReaction,
  onSave,
  onBack,
  onOpenInTheatre,
}: CreatorStudioProps) {
  const draftKey = getDraftStorageKey(initialReaction.id);

  // Restore unsaved working draft from sessionStorage if present
  const initialDraft = React.useMemo(() => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.anchors)) {
        return parsed as {
          anchors: SyncAnchor[];
          chapters: ReactionChapter[];
          highlights: ReactionHighlight[];
        };
      }
    } catch {}
    return null;
  }, [draftKey]);

  const [reaction, setReaction] = useState<ReactionVideo>(initialReaction);
  const [anchors, setAnchors] = useState<SyncAnchor[]>(
    initialDraft?.anchors || initialReaction.anchors || []
  );
  const [chapters, setChapters] = useState<ReactionChapter[]>(
    initialDraft?.chapters || initialReaction.chapters || []
  );
  const [highlights, setHighlights] = useState<ReactionHighlight[]>(
    initialDraft?.highlights || initialReaction.highlights || []
  );
  const [restoredDraftNotice, setRestoredDraftNotice] = useState<boolean>(Boolean(initialDraft));
  const [showUnsavedLeavePrompt, setShowUnsavedLeavePrompt] = useState(false);

  // Real or fallback media durations
  const [sourceDuration, setSourceDuration] = useState<number>(sourceVideo.duration || 300);
  const [reactionDuration, setReactionDuration] = useState<number>(initialReaction.duration || 320);

  // Preview playback errors & clean reload keys
  const [sourcePreviewError, setSourcePreviewError] = useState<string | null>(null);
  const [reactionPreviewError, setReactionPreviewError] = useState<string | null>(null);
  const [sourceReloadKey, setSourceReloadKey] = useState(0);
  const [reactionReloadKey, setReactionReloadKey] = useState(0);

  // Scrubber times & live preview refs
  const initialIntroAnchor =
    (initialDraft?.anchors || initialReaction.anchors || []).find((a) => a.type === 'intro') ||
    (initialDraft?.anchors || initialReaction.anchors || [])[0];
  const [sourceTime, setSourceTime] = useState(0);
  const [reactionTime, setReactionTime] = useState(
    initialIntroAnchor?.reactionTime ?? initialReaction.introDuration ?? 0
  );
  const [isPlayingTest, setIsPlayingTest] = useState(false);
  const sourcePreviewRef = useRef<HTMLVideoElement | null>(null);
  const reactionPreviewRef = useRef<HTMLVideoElement | null>(null);

  // Always-fresh refs for playback interval (prevents stale closures)
  const anchorsRef = useRef<SyncAnchor[]>(anchors);
  const sourceTimeRef = useRef<number>(sourceTime);
  const reactionTimeRef = useRef<number>(reactionTime);
  const sourceDurationRef = useRef<number>(sourceDuration);
  const reactionDurationRef = useRef<number>(reactionDuration);

  anchorsRef.current = anchors;
  sourceTimeRef.current = sourceTime;
  reactionTimeRef.current = reactionTime;
  sourceDurationRef.current = sourceDuration;
  reactionDurationRef.current = reactionDuration;

  const sourceProvider = detectMediaProvider(sourceVideo.url || '', sourceVideo.isLocalFile);
  const reactionProvider = detectMediaProvider(reaction.url || '', reaction.isLocalFile);
  const resolvedSourceUrl = sourceVideo.url ? resolvePlayableMediaUrl(sourceVideo.url) : '';
  const resolvedReactionUrl = reaction.url ? resolvePlayableMediaUrl(reaction.url) : '';
  const canPlayNativeSourcePreview = Boolean(resolvedSourceUrl) && sourceProvider.playbackMode === 'native';
  const canPlayNativeReactionPreview = Boolean(resolvedReactionUrl) && reactionProvider.playbackMode === 'native';

  // Track whether local edits differ from saved reaction state
  const isDirty = React.useMemo(() => {
    return (
      JSON.stringify(anchors) !== JSON.stringify(reaction.anchors || []) ||
      JSON.stringify(chapters) !== JSON.stringify(reaction.chapters || []) ||
      JSON.stringify(highlights) !== JSON.stringify(reaction.highlights || [])
    );
  }, [anchors, chapters, highlights, reaction]);

  // Auto-save working draft to sessionStorage so accidental navigation doesn't lose edits
  useEffect(() => {
    try {
      if (isDirty) {
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({ anchors, chapters, highlights, updatedAt: Date.now() })
        );
      } else {
        sessionStorage.removeItem(draftKey);
      }
    } catch {}
  }, [draftKey, isDirty, anchors, chapters, highlights]);

  // Reset preview errors & pause cleanly whenever media URLs change
  useEffect(() => {
    setIsPlayingTest(false);
    setSourcePreviewError(null);
    setSourceDuration(sourceVideo.duration || 300);
    sourcePreviewRef.current?.pause();
  }, [resolvedSourceUrl, sourceVideo.duration]);

  useEffect(() => {
    setIsPlayingTest(false);
    setReactionPreviewError(null);
    setReactionDuration(reaction.duration || 320);
    reactionPreviewRef.current?.pause();
  }, [resolvedReactionUrl, reaction.duration]);

  // Pause videos on unmount to prevent lingering audio/player instances
  useEffect(() => {
    return () => {
      sourcePreviewRef.current?.pause();
      reactionPreviewRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!isPlayingTest) {
      sourcePreviewRef.current?.pause();
      reactionPreviewRef.current?.pause();
      return;
    }

    if (canPlayNativeSourcePreview && sourcePreviewRef.current && !sourcePreviewError) {
      try {
        sourcePreviewRef.current.currentTime = sourceTimeRef.current;
      } catch {}
      sourcePreviewRef.current.play().catch(() => {});
    }
    if (canPlayNativeReactionPreview && reactionPreviewRef.current && !reactionPreviewError) {
      try {
        reactionPreviewRef.current.currentTime = reactionTimeRef.current;
      } catch {}
      reactionPreviewRef.current.play().catch(() => {});
    }

    const tickInterval = setInterval(() => {
      const currentAnchors = anchorsRef.current;
      const maxSourceDur = sourceDurationRef.current || 300;
      const maxReactionDur = reactionDurationRef.current || 320;

      setSourceTime((prev) => {
        const next = Math.min(maxSourceDur, +(prev + 0.2).toFixed(1));
        const mapped = Math.min(maxReactionDur, +mapSourceToReaction(next, currentAnchors).toFixed(1));
        setReactionTime(mapped);

        if (
          reactionPreviewRef.current &&
          reactionPreviewRef.current.readyState >= 1 &&
          Math.abs(reactionPreviewRef.current.currentTime - mapped) > 0.5
        ) {
          try {
            reactionPreviewRef.current.currentTime = mapped;
          } catch {}
        }

        if (next >= maxSourceDur) {
          setIsPlayingTest(false);
        }
        return next;
      });
    }, 200);

    return () => {
      clearInterval(tickInterval);
      sourcePreviewRef.current?.pause();
      reactionPreviewRef.current?.pause();
    };
  }, [isPlayingTest, canPlayNativeSourcePreview, canPlayNativeReactionPreview, sourcePreviewError, reactionPreviewError]);

  const syncScrubPreviewVideos = (nextSource: number, nextReaction: number) => {
    if (sourcePreviewRef.current && sourcePreviewRef.current.readyState >= 1) {
      try {
        sourcePreviewRef.current.currentTime = nextSource;
      } catch {}
    }
    if (reactionPreviewRef.current && reactionPreviewRef.current.readyState >= 1) {
      try {
        reactionPreviewRef.current.currentTime = nextReaction;
      } catch {}
    }
  };

  // New anchor form
  const [newAnchorType, setNewAnchorType] = useState<AnchorType>('linear');
  const [newAnchorLabel, setNewAnchorLabel] = useState('');

  // CSV modal & errors
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvError, setCsvError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  // Chapter form
  const [chapterTitle, setChapterTitle] = useState('');

  // Validation status
  const validation = validateAnchors(anchors);

  const handleAddAnchorCurrent = () => {
    const newAnchor: SyncAnchor = {
      id: `anc-${Date.now()}`,
      sourceTime: parseFloat(sourceTime.toFixed(2)),
      reactionTime: parseFloat(reactionTime.toFixed(2)),
      type: newAnchorType,
      label: newAnchorLabel.trim() || undefined,
    };
    const updated = [...anchors, newAnchor].sort((a, b) => a.sourceTime - b.sourceTime);
    setAnchors(updated);
    setNewAnchorLabel('');
  };

  const handleDeleteAnchor = (id: string) => {
    setAnchors((prev) => prev.filter((a) => a.id !== id));
  };

  const handleUpdateAnchor = (id: string, field: keyof SyncAnchor, value: any) => {
    setAnchors((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [field]: value } : a))
    );
  };

  const handleExportCsv = () => {
    const csv = exportAnchorsToCsv(anchors);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reaction.creator.toLowerCase().replace(/\s+/g, '-')}-sync-anchors.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenCsvImport = () => {
    setCsvError(null);
    setCsvText(exportAnchorsToCsv(anchors));
    setIsCsvModalOpen(true);
  };

  const handleApplyCsv = () => {
    setCsvError(null);
    try {
      const imported = importAnchorsFromCsv(csvText);
      if (imported.length === 0) {
        setCsvError('No valid anchor rows found in CSV input.');
        return;
      }
      const csvCheck = validateAnchors(imported);
      if (!csvCheck.valid) {
        setCsvError(csvCheck.errors[0] || 'Imported CSV anchors contain invalid timeline values.');
        return;
      }
      setAnchors(imported);
      setIsCsvModalOpen(false);
      setSaveError(null);
    } catch (err: any) {
      setCsvError(err?.message || 'Failed to parse CSV anchors.');
    }
  };

  const handleAddChapter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chapterTitle.trim()) return;
    const newCh: ReactionChapter = {
      id: `ch-${Date.now()}`,
      title: chapterTitle.trim(),
      sourceTimestamp: sourceTime,
      reactionTimestamp: reactionTime,
    };
    setChapters((prev) => [...prev, newCh].sort((a, b) => a.sourceTimestamp - b.sourceTimestamp));
    setChapterTitle('');
  };

  const handleDeleteChapter = (id: string) => {
    setChapters((prev) => prev.filter((c) => c.id !== id));
  };

  const handleSaveAll = (overridePublished?: boolean): ReactionVideo | null => {
    setSaveError(null);
    setSaveFeedback(null);
    const currentCheck = validateAnchors(anchors);
    if (!currentCheck.valid) {
      setSaveError(currentCheck.errors[0] || 'Cannot save invalid timeline anchors.');
      return null;
    }
    const sortedAnchors = [...anchors].sort((a, b) => a.sourceTime - b.sourceTime);
    const introAnchor =
      sortedAnchors.find((a) => a.type === 'intro') || sortedAnchors[0];

    const updated: ReactionVideo = {
      ...reaction,
      anchors: sortedAnchors,
      chapters,
      highlights,
      duration: reactionDuration,
      introDuration: introAnchor?.reactionTime ?? reaction.introDuration,
      isPublished: overridePublished !== undefined ? overridePublished : reaction.isPublished,
    };
    setAnchors(sortedAnchors);
    setReaction(updated);
    onSave(updated);
    try {
      sessionStorage.removeItem(draftKey);
    } catch {}
    setRestoredDraftNotice(false);
    setShowUnsavedLeavePrompt(false);
    setSaveFeedback(
      overridePublished !== undefined
        ? overridePublished
          ? 'Reaction published.'
          : 'Reaction moved to Drafts.'
        : 'Calibration anchors and chapters saved.'
    );
    return updated;
  };

  const handleDiscardDraft = () => {
    setAnchors(reaction.anchors || []);
    setChapters(reaction.chapters || []);
    setHighlights(reaction.highlights || []);
    setRestoredDraftNotice(false);
    setShowUnsavedLeavePrompt(false);
    try {
      sessionStorage.removeItem(draftKey);
    } catch {}
  };

  const handleBackClick = () => {
    if (isDirty) {
      setShowUnsavedLeavePrompt(true);
      return;
    }
    onBack();
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = (secs % 60).toFixed(1);
    return `${m}:${parseFloat(s) < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 px-3 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-2.5 relative z-20">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={handleBackClick}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Reactions</span>
          </button>
          <div className="hidden sm:block h-4 w-px bg-slate-800" />
          <h2 className="text-xs sm:text-sm font-semibold text-white">
            Creator Studio & Calibration
          </h2>
          <span className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-0.5 rounded-full font-medium">
            {reaction.creator}
          </span>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${
              reaction.isPublished
                ? 'text-emerald-300 bg-emerald-950/50 border-emerald-500/30'
                : 'text-amber-300 bg-amber-950/50 border-amber-500/30'
            }`}
          >
            {reaction.isPublished ? 'Published' : 'Draft'}
          </span>
          {isDirty && (
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-sky-500/30 bg-sky-950/50 text-sky-300 font-semibold">
              Unsaved edits
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleSaveAll(!reaction.isPublished)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              reaction.isPublished
                ? 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-amber-300'
                : 'bg-emerald-600 hover:bg-emerald-500 border-emerald-500 text-white'
            }`}
          >
            {reaction.isPublished ? 'Unpublish' : 'Publish Reaction'}
          </button>
          <button
            type="button"
            onClick={() => handleSaveAll()}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition-colors cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Anchors</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const saved = handleSaveAll();
              if (saved) {
                onOpenInTheatre(saved);
              }
            }}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 ml-0.5" />
            <span>Test in Theatre</span>
          </button>
        </div>
      </header>

      {/* Main Studio Body */}
      <div className="flex-1 p-4 max-w-7xl mx-auto w-full flex flex-col gap-5">
        {showUnsavedLeavePrompt && (
          <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-100 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                You have unsaved anchor or chapter changes. Save them before leaving, or keep them as a temporary draft?
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const saved = handleSaveAll();
                  if (saved) onBack();
                }}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold cursor-pointer"
              >
                Save & Leave
              </button>
              <button
                type="button"
                onClick={() => {
                  handleDiscardDraft();
                  onBack();
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-900/60 hover:bg-rose-800 border border-rose-500/40 text-rose-100 font-medium cursor-pointer"
              >
                Discard & Leave
              </button>
              <button
                type="button"
                onClick={() => setShowUnsavedLeavePrompt(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium cursor-pointer"
              >
                Stay
              </button>
            </div>
          </div>
        )}
        {restoredDraftNotice && !showUnsavedLeavePrompt && (
          <div className="p-3 rounded-xl bg-sky-950/60 border border-sky-500/40 text-sky-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>Restored unsaved calibration draft from this session.</span>
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-sky-500/30 text-sky-200 font-medium self-start sm:self-auto cursor-pointer"
            >
              Discard Draft
            </button>
          </div>
        )}
        {saveError && (
          <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}
        {saveFeedback && !saveError && (
          <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{saveFeedback}</span>
          </div>
        )}
        <ContextualHelp
          id="creator_studio_intro"
          title="How Calibration Works"
          description="SyncView aligns video timelines using piecewise linear anchors. Align the source frame with the corresponding reaction moment, then click 'Link Current Timestamps as Anchor'. SyncView handles intros, pauses, and drift automatically."
          bulletPoints={[
            'Intro Anchor: Set source to 00:00 and reaction to the exact second the creator starts watching.',
            'Pause Anchor: If the creator pauses to speak, set two anchors at the same source timestamp.',
            'Use CSV export/import to backup or batch-edit timing points.',
          ]}
          defaultExpanded={true}
        />

        {/* Dual Frame Scrubber Arena */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Source Video Frame Box */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <span className="text-xs font-bold text-sky-400 uppercase tracking-wider block">
                  Source Timeline
                </span>
                <h4 className="text-sm font-semibold text-white truncate">
                  {sourceVideo.title}
                </h4>
              </div>
              <span className="font-mono text-xs text-sky-300 bg-sky-950/60 border border-sky-500/30 px-2 py-0.5 rounded shrink-0">
                {formatTime(sourceTime)}
              </span>
            </div>

            {/* Real native video preview or provider timeline indicator */}
            <div className="w-full aspect-video bg-black rounded-lg border border-slate-800 flex items-center justify-center relative overflow-hidden">
              {canPlayNativeSourcePreview ? (
                <>
                  <video
                    key={`${resolvedSourceUrl}-${sourceReloadKey}`}
                    ref={sourcePreviewRef}
                    src={resolvedSourceUrl}
                    muted
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      const el = e.currentTarget;
                      setSourcePreviewError(null);
                      if (Number.isFinite(el.duration) && el.duration > 0) {
                        setSourceDuration(Math.round(el.duration));
                      }
                      try {
                        el.currentTime = sourceTimeRef.current;
                      } catch {}
                    }}
                    onError={(e) => {
                      setIsPlayingTest(false);
                      setSourcePreviewError(describeVideoMediaError(e.currentTarget, 'Source'));
                    }}
                    className="w-full h-full object-contain"
                  />
                  {sourcePreviewError && (
                    <div className="absolute inset-0 bg-slate-950/90 p-4 flex flex-col items-center justify-center text-center gap-2.5">
                      <AlertCircle className="w-6 h-6 text-rose-400" />
                      <p className="text-xs text-rose-200 max-w-xs">{sourcePreviewError}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setSourcePreviewError(null);
                          setSourceReloadKey((k) => k + 1);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry Preview</span>
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center px-4">
                  <div className="font-mono text-2xl font-bold text-sky-400">
                    {formatTime(sourceTime)}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {sourceVideo.url
                      ? `${sourceProvider.name} timeline scrubbing — open "Test in Theatre" for live provider playback`
                      : 'Source URL not provided'}
                  </div>
                </div>
              )}
            </div>

            {/* Source Time Scrubber */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-slate-400 w-10">0:00</span>
              <input
                type="range"
                min="0"
                max={sourceDuration}
                step="0.1"
                value={Math.min(sourceTime, sourceDuration)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setSourceTime(val);
                  const mapped = mapSourceToReaction(val, anchors);
                  setReactionTime(Math.min(reactionDuration, mapped));
                  syncScrubPreviewVideos(val, mapped);
                }}
                aria-label="Source timeline scrubber"
                className="flex-1 h-2 bg-slate-700 rounded appearance-none accent-sky-400 cursor-pointer"
              />
              <span className="text-[11px] font-mono text-slate-400 w-10 text-right">
                {formatTime(sourceDuration)}
              </span>
            </div>
          </div>

          {/* Reaction Video Frame Box */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <span className="text-xs font-bold text-purple-400 uppercase tracking-wider block">
                  Reaction Timeline
                </span>
                <h4 className="text-sm font-semibold text-white truncate">
                  {reaction.title}
                </h4>
              </div>
              <span className="font-mono text-xs text-purple-300 bg-purple-950/60 border border-purple-500/30 px-2 py-0.5 rounded shrink-0">
                {formatTime(reactionTime)}
              </span>
            </div>

            {/* Real native video preview or provider timeline indicator */}
            <div className="w-full aspect-video bg-black rounded-lg border border-slate-800 flex items-center justify-center relative overflow-hidden">
              {canPlayNativeReactionPreview ? (
                <>
                  <video
                    key={`${resolvedReactionUrl}-${reactionReloadKey}`}
                    ref={reactionPreviewRef}
                    src={resolvedReactionUrl}
                    muted
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      const el = e.currentTarget;
                      setReactionPreviewError(null);
                      if (Number.isFinite(el.duration) && el.duration > 0) {
                        setReactionDuration(Math.round(el.duration));
                      }
                      try {
                        el.currentTime = reactionTimeRef.current;
                      } catch {}
                    }}
                    onError={(e) => {
                      setIsPlayingTest(false);
                      setReactionPreviewError(describeVideoMediaError(e.currentTarget, 'Reaction'));
                    }}
                    className="w-full h-full object-contain"
                  />
                  {reactionPreviewError && (
                    <div className="absolute inset-0 bg-slate-950/90 p-4 flex flex-col items-center justify-center text-center gap-2.5">
                      <AlertCircle className="w-6 h-6 text-rose-400" />
                      <p className="text-xs text-rose-200 max-w-xs">{reactionPreviewError}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setReactionPreviewError(null);
                          setReactionReloadKey((k) => k + 1);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry Preview</span>
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center px-4">
                  <div className="font-mono text-2xl font-bold text-purple-400">
                    {formatTime(reactionTime)}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {reaction.url
                      ? `${reactionProvider.name} timeline scrubbing — open "Test in Theatre" for live provider playback`
                      : 'Reaction URL not provided'}
                  </div>
                </div>
              )}
            </div>

            {/* Reaction Time Scrubber */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-slate-400 w-10">0:00</span>
              <input
                type="range"
                min="0"
                max={reactionDuration}
                step="0.1"
                value={Math.min(reactionTime, reactionDuration)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setReactionTime(val);
                  syncScrubPreviewVideos(sourceTime, val);
                }}
                aria-label="Reaction timeline scrubber"
                className="flex-1 h-2 bg-slate-700 rounded appearance-none accent-purple-400 cursor-pointer"
              />
              <span className="text-[11px] font-mono text-slate-400 w-10 text-right">
                {formatTime(reactionDuration)}
              </span>
            </div>
          </div>
        </div>

        {/* Synced Preview Playback Bar */}
        <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-2.5">
          <div className="text-xs text-slate-400">
            Preview mapped timeline synchronization before publishing
          </div>
          <button
            type="button"
            onClick={() => setIsPlayingTest((p) => !p)}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {isPlayingTest ? (
              <>
                <Pause className="w-3.5 h-3.5 text-amber-400" />
                <span>Pause Preview</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span>Preview Synced Playback</span>
              </>
            )}
          </button>
        </div>

        {/* Anchor Creation Action Bar */}
        <div className="bg-slate-900/90 border border-indigo-500/30 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-400">Type:</span>
              <select
                value={newAnchorType}
                onChange={(e) => setNewAnchorType(e.target.value as AnchorType)}
                className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded px-2.5 py-1.5 focus:outline-none"
              >
                <option value="intro">Intro Offset (Source starts)</option>
                <option value="linear">Linear Sync Point</option>
                <option value="pause">Creator Pause (Hold source)</option>
                <option value="skip">Creator Skip / Cut</option>
                <option value="outro">Outro Wrap-up</option>
              </select>
            </div>

            <input
              type="text"
              value={newAnchorLabel}
              onChange={(e) => setNewAnchorLabel(e.target.value)}
              placeholder="Label (e.g. 'Portal scene starts')"
              className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded px-2.5 py-1.5 focus:outline-none w-52 placeholder:text-slate-500"
            />
          </div>

          <button
            onClick={handleAddAnchorCurrent}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Link Current Frame ({formatTime(sourceTime)} &rarr; {formatTime(reactionTime)})</span>
          </button>
        </div>

        {/* Anchors Table & Integrity Check */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">
                Mapping Anchors ({anchors.length})
              </h3>
              {validation.valid ? (
                <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                  <CheckCircle className="w-3 h-3" />
                  <span>Valid Timeline</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] text-rose-400 bg-rose-950/40 border border-rose-500/30 px-2 py-0.5 rounded-full">
                  <AlertCircle className="w-3 h-3" />
                  <span>{validation.errors[0]}</span>
                </span>
              )}
            </div>

            {/* CSV Import/Export */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenCsvImport}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import CSV</span>
              </button>
              <button
                onClick={handleExportCsv}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-3">#</th>
                  <th className="py-2 px-3">Source Time (s)</th>
                  <th className="py-2 px-3">Reaction Time (s)</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Label</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {anchors.map((anc, idx) => (
                  <tr key={anc.id} className="hover:bg-slate-800/40">
                    <td className="py-2 px-3 text-slate-500">{idx + 1}</td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        step="0.1"
                        value={anc.sourceTime}
                        onChange={(e) =>
                          handleUpdateAnchor(anc.id, 'sourceTime', parseFloat(e.target.value) || 0)
                        }
                        className="w-20 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-white"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        step="0.1"
                        value={anc.reactionTime}
                        onChange={(e) =>
                          handleUpdateAnchor(anc.id, 'reactionTime', parseFloat(e.target.value) || 0)
                        }
                        className="w-20 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-white"
                      />
                    </td>
                    <td className="py-2 px-3 font-sans">
                      <select
                        value={anc.type}
                        onChange={(e) =>
                          handleUpdateAnchor(anc.id, 'type', e.target.value as AnchorType)
                        }
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-200"
                      >
                        <option value="intro">intro</option>
                        <option value="linear">linear</option>
                        <option value="pause">pause</option>
                        <option value="skip">skip</option>
                        <option value="outro">outro</option>
                      </select>
                    </td>
                    <td className="py-2 px-3 font-sans">
                      <input
                        type="text"
                        value={anc.label || ''}
                        onChange={(e) => handleUpdateAnchor(anc.id, 'label', e.target.value)}
                        placeholder="Description..."
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-200"
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => handleDeleteAnchor(anc.id)}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                        title="Delete anchor"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Chapters & Highlights Manager */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-indigo-400" />
            <span>Reaction Chapters & Moments</span>
          </h3>

          <form onSubmit={handleAddChapter} className="flex gap-2">
            <input
              type="text"
              value={chapterTitle}
              onChange={(e) => setChapterTitle(e.target.value)}
              placeholder="Chapter title (e.g. 'Opening Discussion')"
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
            <span className="text-xs text-slate-400 flex items-center px-2 font-mono">
              at {formatTime(sourceTime)}
            </span>
            <button
              type="submit"
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium"
            >
              Add Chapter
            </button>
          </form>

          <div className="space-y-1.5">
            {chapters.map((ch) => (
              <div
                key={ch.id}
                className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-indigo-400">
                    {formatTime(ch.sourceTimestamp)}
                  </span>
                  <span className="text-slate-200 font-medium">{ch.title}</span>
                </div>
                <button
                  onClick={() => handleDeleteChapter(ch.id)}
                  className="p-1 text-slate-400 hover:text-rose-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CSV Import Modal */}
      {isCsvModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-lg w-full flex flex-col gap-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="font-semibold text-white text-sm">
                Import / Edit Anchors CSV
              </h4>
              <button
                onClick={() => setIsCsvModalOpen(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                &times;
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Columns: <code>id, sourceTime, reactionTime, type, label, notes</code>
            </p>
            <textarea
              rows={8}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 font-mono text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            />
            {csvError && (
              <div className="p-2 rounded-lg bg-rose-950/70 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>{csvError}</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setIsCsvModalOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyCsv}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
              >
                Parse & Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
