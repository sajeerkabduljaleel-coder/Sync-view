/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  VideoSource,
  ReactionVideo,
  SyncAnchor,
} from '../../types';
import { SAMPLE_SOURCES } from '../../data/mockCatalogue';
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
} from 'lucide-react';
import { ContextualHelp } from '../common/ContextualHelp';

interface ReactionWizardProps {
  onComplete: (reaction: ReactionVideo, source: VideoSource) => void;
  onCancel: () => void;
}

export function ReactionWizard({ onComplete, onCancel }: ReactionWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: Source
  const [selectedSource, setSelectedSource] = useState<VideoSource>(SAMPLE_SOURCES[0]);
  const [customSourceUrl, setCustomSourceUrl] = useState('');
  const [customSourceTitle, setCustomSourceTitle] = useState('');

  // Step 2: Reaction info
  const [creatorName, setCreatorName] = useState('Alex Rivers');
  const [reactionTitle, setReactionTitle] = useState('First Time Watching! Mind Blown Reaction');
  const [reactionUrl, setReactionUrl] = useState('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4');
  const [thumbnailUrl, setThumbnailUrl] = useState('https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80');

  // Step 3: Synchronization calibration
  const [introDuration, setIntroDuration] = useState<number>(12);
  const [hasPause, setHasPause] = useState(false);
  const [pauseSourceTime, setPauseSourceTime] = useState(45);
  const [pauseDuration, setPauseDuration] = useState(10);

  // Step 4: Preview & Publish
  const [isPublished, setIsPublished] = useState(true);

  const handleNext = () => {
    if (step < 4) setStep((prev) => (prev + 1) as any);
  };

  const handleBack = () => {
    if (step > 1) setStep((prev) => (prev - 1) as any);
  };

  const handleFinish = () => {
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

    const duration = selectedSource.duration + introDuration + (hasPause ? pauseDuration : 0);

    const newReaction: ReactionVideo = {
      id: `rx-${Date.now()}`,
      sourceId: selectedSource.id,
      creator: creatorName.trim() || 'Creator',
      channelName: `${creatorName.trim()} Reacts`,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
      title: reactionTitle.trim() || 'Reaction Video',
      duration,
      introDuration,
      url: reactionUrl,
      thumbnail: thumbnailUrl,
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

    onComplete(newReaction, selectedSource);
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
            description="Select the original movie trailer, gameplay run, or music video you are reacting to. You can pick from the platform catalogue or provide a custom video URL."
          />

          <h3 className="text-sm font-semibold text-white">Choose Source Content</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SAMPLE_SOURCES.map((src) => (
              <div
                key={src.id}
                onClick={() => setSelectedSource(src)}
                className={`p-3 rounded-xl border cursor-pointer transition-all flex gap-3 ${
                  selectedSource.id === src.id
                    ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <img
                  src={src.thumbnail}
                  alt=""
                  className="w-24 h-16 rounded-lg object-cover shrink-0"
                />
                <div className="flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] text-indigo-400 font-semibold uppercase">
                      {src.category}
                    </span>
                    <h4 className="text-xs font-bold text-white line-clamp-1">{src.title}</h4>
                    <span className="text-[11px] text-slate-400">{src.creator}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">
                    Duration: {Math.floor(src.duration / 60)}:{(src.duration % 60).toString().padStart(2, '0')}
                  </span>
                </div>
              </div>
            ))}
          </div>
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

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div>
              <label className="text-xs text-slate-300 font-medium block mb-1">
                Reaction Video Title
              </label>
              <input
                type="text"
                value={reactionTitle}
                onChange={(e) => setReactionTitle(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  Creator Name / Channel
                </label>
                <input
                  type="text"
                  value={creatorName}
                  onChange={(e) => setCreatorName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  Reaction Video URL (MP4 / WebM / Stream)
                </label>
                <input
                  type="url"
                  value={reactionUrl}
                  onChange={(e) => setReactionUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
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
                <div className="font-semibold text-white mt-0.5">{selectedSource.title}</div>
                <div className="text-[11px] text-slate-400">{selectedSource.creator}</div>
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
