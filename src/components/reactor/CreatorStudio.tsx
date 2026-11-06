/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
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
} from 'lucide-react';
import { ContextualHelp } from '../common/ContextualHelp';

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
  const [reaction, setReaction] = useState<ReactionVideo>(initialReaction);
  const [anchors, setAnchors] = useState<SyncAnchor[]>(initialReaction.anchors || []);
  const [chapters, setChapters] = useState<ReactionChapter[]>(initialReaction.chapters || []);
  const [highlights, setHighlights] = useState<ReactionHighlight[]>(initialReaction.highlights || []);

  // Scrubber times
  const [sourceTime, setSourceTime] = useState(0);
  const [reactionTime, setReactionTime] = useState(anchors[0]?.reactionTime || 15);
  const [isPlayingTest, setIsPlayingTest] = useState(false);

  // New anchor form
  const [newAnchorType, setNewAnchorType] = useState<AnchorType>('linear');
  const [newAnchorLabel, setNewAnchorLabel] = useState('');

  // CSV modal
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [csvText, setCsvText] = useState('');

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
    setCsvText(exportAnchorsToCsv(anchors));
    setIsCsvModalOpen(true);
  };

  const handleApplyCsv = () => {
    try {
      const imported = importAnchorsFromCsv(csvText);
      if (imported.length > 0) {
        setAnchors(imported);
        setIsCsvModalOpen(false);
      }
    } catch {}
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

  const handleSaveAll = () => {
    const updated: ReactionVideo = {
      ...reaction,
      anchors,
      chapters,
      highlights,
      introDuration: anchors[0]?.reactionTime || reaction.introDuration,
    };
    setReaction(updated);
    onSave(updated);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = (secs % 60).toFixed(1);
    return `${m}:${parseFloat(s) < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Reactions</span>
          </button>
          <div className="h-4 w-px bg-slate-800" />
          <h2 className="text-sm font-semibold text-white">
            Creator Studio & Calibration
          </h2>
          <span className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-0.5 rounded-full font-medium">
            {reaction.creator}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveAll}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Anchors</span>
          </button>
          <button
            onClick={() => {
              handleSaveAll();
              onOpenInTheatre({ ...reaction, anchors, chapters, highlights });
            }}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <Play className="w-3.5 h-3.5 ml-0.5" />
            <span>Test in Theatre</span>
          </button>
        </div>
      </header>

      {/* Main Studio Body */}
      <div className="flex-1 p-4 max-w-7xl mx-auto w-full flex flex-col gap-5">
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
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-sky-400 uppercase tracking-wider">
                  Source Timeline
                </span>
                <h4 className="text-sm font-semibold text-white truncate max-w-xs">
                  {sourceVideo.title}
                </h4>
              </div>
              <span className="font-mono text-xs text-sky-300 bg-sky-950/60 border border-sky-500/30 px-2 py-0.5 rounded">
                {formatTime(sourceTime)}
              </span>
            </div>

            {/* Video preview simulation */}
            <div className="w-full aspect-video bg-black rounded-lg border border-slate-800 flex items-center justify-center relative overflow-hidden">
              <div className="text-center">
                <div className="font-mono text-2xl font-bold text-sky-400">
                  {formatTime(sourceTime)}
                </div>
                <div className="text-xs text-slate-400 mt-1">Source Video Frame Preview</div>
              </div>
            </div>

            {/* Source Time Scrubber */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-slate-400 w-10">0:00</span>
              <input
                type="range"
                min="0"
                max={sourceVideo.duration}
                step="0.1"
                value={sourceTime}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setSourceTime(val);
                  // Predict reaction time using existing mapping
                  const mapped = mapSourceToReaction(val, anchors);
                  setReactionTime(mapped);
                }}
                className="flex-1 h-2 bg-slate-700 rounded appearance-none accent-sky-400 cursor-pointer"
              />
              <span className="text-[11px] font-mono text-slate-400 w-10 text-right">
                {formatTime(sourceVideo.duration)}
              </span>
            </div>
          </div>

          {/* Reaction Video Frame Box */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">
                  Reaction Timeline
                </span>
                <h4 className="text-sm font-semibold text-white truncate max-w-xs">
                  {reaction.title}
                </h4>
              </div>
              <span className="font-mono text-xs text-purple-300 bg-purple-950/60 border border-purple-500/30 px-2 py-0.5 rounded">
                {formatTime(reactionTime)}
              </span>
            </div>

            {/* Video preview simulation */}
            <div className="w-full aspect-video bg-black rounded-lg border border-slate-800 flex items-center justify-center relative overflow-hidden">
              <div className="text-center">
                <div className="font-mono text-2xl font-bold text-purple-400">
                  {formatTime(reactionTime)}
                </div>
                <div className="text-xs text-slate-400 mt-1">Reaction Video Frame Preview</div>
              </div>
            </div>

            {/* Reaction Time Scrubber */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-slate-400 w-10">0:00</span>
              <input
                type="range"
                min="0"
                max={reaction.duration}
                step="0.1"
                value={reactionTime}
                onChange={(e) => setReactionTime(parseFloat(e.target.value))}
                className="flex-1 h-2 bg-slate-700 rounded appearance-none accent-purple-400 cursor-pointer"
              />
              <span className="text-[11px] font-mono text-slate-400 w-10 text-right">
                {formatTime(reaction.duration)}
              </span>
            </div>
          </div>
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
