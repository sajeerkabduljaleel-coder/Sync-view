/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SyncAnchor,
  DriftStatus,
  DriftMetrics,
  TheatreLayout,
  ReactionVideo,
  VideoSource,
} from '../types';
import {
  mapSourceToReaction,
  mapReactionToSource,
  computeDriftCorrection,
  DEFAULT_DRIFT_CONFIG,
  DriftConfig,
} from './syncEngine';

export type SyncEventListener = (state: SessionSyncState) => void;

export interface SessionSyncState {
  isPlaying: boolean;
  sourceTime: number;
  sourceDuration: number;
  activeReactionId: string;
  primaryReactionTime: number;
  primaryStatus: DriftStatus;
  primaryMetrics: DriftMetrics;
  extraReactorMetrics: Record<string, DriftMetrics>;
  audioFocus: string; // 'source' or reactionId
  isDuckingEnabled: boolean;
  layout: TheatreLayout;
  isAdvancedMode: boolean;
  isBuffering: boolean;
  isInPip: boolean;
}

/**
 * Authoritative client-side synchronization controller for Theatre.
 * Manages playback, drift correction loops, audio focus, and layout.
 */
export class SessionSyncController {
  private sourceElement: HTMLVideoElement | null = null;
  private reactionElements: Map<string, HTMLVideoElement> = new Map();
  private reactionAnchors: Map<string, SyncAnchor[]> = new Map();

  private listeners: Set<SyncEventListener> = new Set();
  private syncIntervalId: any = null;

  private state: SessionSyncState = {
    isPlaying: false,
    sourceTime: 0,
    sourceDuration: 180,
    activeReactionId: '',
    primaryReactionTime: 0,
    primaryStatus: 'synced',
    primaryMetrics: {
      currentDrift: 0,
      targetTime: 0,
      actualTime: 0,
      status: 'synced',
      playbackRate: 1.0,
      lastCorrectionTime: Date.now(),
      correctionCount: 0,
    },
    extraReactorMetrics: {},
    audioFocus: 'source',
    isDuckingEnabled: true,
    layout: 'side-by-side',
    isAdvancedMode: false,
    isBuffering: false,
    isInPip: false,
  };

  private config: DriftConfig = DEFAULT_DRIFT_CONFIG;

  constructor() {
    this.startSyncLoop();
  }

  public registerSourceElement(el: HTMLVideoElement | null): void {
    this.sourceElement = el;
    if (el) {
      el.playbackRate = 1.0;
    }
  }

  public registerReactionElement(reactionId: string, el: HTMLVideoElement | null): void {
    if (el) {
      this.reactionElements.set(reactionId, el);
    } else {
      this.reactionElements.delete(reactionId);
    }
  }

  public setReactionAnchors(reactionId: string, anchors: SyncAnchor[]): void {
    this.reactionAnchors.set(reactionId, anchors);
  }

  public setActiveReaction(reactionId: string): void {
    this.state.activeReactionId = reactionId;
    this.notify();
  }

  public setLayout(layout: TheatreLayout): void {
    this.state.layout = layout;
    this.notify();
  }

  public toggleAdvancedMode(): void {
    this.state.isAdvancedMode = !this.state.isAdvancedMode;
    this.notify();
  }

  public setAudioFocus(focus: string): void {
    this.state.audioFocus = focus;
    this.applyAudioMix();
    this.notify();
  }

  public toggleDucking(): void {
    this.state.isDuckingEnabled = !this.state.isDuckingEnabled;
    this.applyAudioMix();
    this.notify();
  }

  /**
   * Authoritative Play action across all players.
   * If one stream has an error or is unready, healthy streams continue playing smoothly.
   */
  public async play(): Promise<void> {
    this.state.isPlaying = true;
    const promises: Promise<any>[] = [];

    if (this.sourceElement && this.sourceElement.paused && !this.sourceElement.error) {
      promises.push(this.sourceElement.play().catch(() => {}));
    }

    for (const [id, el] of this.reactionElements.entries()) {
      if (el && el.paused && !el.error) {
        // Fast pre-align before play if metadata is available
        const anchors = this.reactionAnchors.get(id) || [];
        const target = mapSourceToReaction(this.getSourceTime(), anchors);
        if (el.readyState >= 1 && Math.abs(el.currentTime - target) > 0.5) {
          try {
            el.currentTime = Math.max(0, target);
          } catch {}
        }
        promises.push(el.play().catch(() => {}));
      }
    }

    await Promise.allSettled(promises);
    this.notify();
  }

  /**
   * Authoritative Pause action across all players.
   */
  public pause(): void {
    this.state.isPlaying = false;
    if (this.sourceElement && !this.sourceElement.paused) {
      try {
        this.sourceElement.pause();
      } catch {}
    }
    for (const el of this.reactionElements.values()) {
      if (el && !el.paused) {
        try {
          el.pause();
        } catch {}
      }
    }
    this.state.primaryStatus = 'paused';
    this.notify();
  }

  public togglePlay(): void {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Authoritative Seek action based on source video timeline.
   */
  public seekToSourceTime(targetSourceTime: number): void {
    const clampedSourceTime = Math.max(0, targetSourceTime);
    this.state.sourceTime = clampedSourceTime;

    if (this.sourceElement && !this.sourceElement.error && this.sourceElement.readyState >= 1) {
      try {
        this.sourceElement.currentTime = clampedSourceTime;
      } catch {}
    }

    // Simultaneously seek all healthy reaction players to their mapped timeline points
    for (const [id, el] of this.reactionElements.entries()) {
      const anchors = this.reactionAnchors.get(id) || [];
      const targetReactionTime = mapSourceToReaction(clampedSourceTime, anchors);
      if (el && !el.error && el.readyState >= 1) {
        try {
          el.currentTime = Math.max(0, targetReactionTime);
        } catch {}
      }
    }

    this.notify();
  }

  /**
   * Manual micro-offset step for active reaction (useful in calibrator and advanced mode).
   */
  public stepReactionOffset(reactionId: string, deltaSeconds: number): void {
    const el = this.reactionElements.get(reactionId);
    if (el) {
      el.currentTime = Math.max(0, el.currentTime + deltaSeconds);
    }
    this.notify();
  }

  public getSourceTime(): number {
    if (this.sourceElement && !this.sourceElement.error) {
      return this.sourceElement.currentTime;
    }
    return this.state.sourceTime;
  }

  /**
   * Trigger Picture-in-Picture on primary reaction or source.
   */
  public async togglePictureInPicture(): Promise<void> {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        this.state.isInPip = false;
      } else {
        const targetEl =
          this.reactionElements.get(this.state.activeReactionId) || this.sourceElement;
        if (targetEl && targetEl.requestPictureInPicture) {
          await targetEl.requestPictureInPicture();
          this.state.isInPip = true;
        } else {
          // Toggle floating PiP layout fallback
          this.state.layout = this.state.layout === 'pip' ? 'side-by-side' : 'pip';
        }
      }
    } catch {
      // Fallback layout
      this.state.layout = this.state.layout === 'pip' ? 'side-by-side' : 'pip';
    }
    this.notify();
  }

  /**
   * Audio mixing with focus and smart ducking.
   */
  private applyAudioMix(): void {
    const isSourceFocus = this.state.audioFocus === 'source';

    if (this.sourceElement) {
      if (isSourceFocus) {
        this.sourceElement.muted = false;
        this.sourceElement.volume = 1.0;
      } else if (this.state.isDuckingEnabled) {
        // Source is ducked so reactor voice is clearly heard
        this.sourceElement.muted = false;
        this.sourceElement.volume = 0.25;
      } else {
        this.sourceElement.muted = true;
      }
    }

    for (const [id, el] of this.reactionElements.entries()) {
      if (!el) continue;
      if (this.state.audioFocus === id) {
        el.muted = false;
        el.volume = 1.0;
      } else {
        // Other reactors muted to prevent audio chaos
        el.muted = true;
      }
    }
  }

  /**
   * Periodic synchronization and drift evaluation loop (runs every 100ms).
   */
  private startSyncLoop(): void {
    if (this.syncIntervalId) clearInterval(this.syncIntervalId);

    this.syncIntervalId = setInterval(() => {
      this.evaluateSyncCycle();
    }, 100);

    if (this.syncIntervalId && typeof this.syncIntervalId.unref === 'function') {
      this.syncIntervalId.unref();
    }
  }

  private evaluateSyncCycle(): void {
    if (!this.sourceElement && this.reactionElements.size === 0) return;

    const sourceCurrentTime = this.getSourceTime();
    this.state.sourceTime = sourceCurrentTime;

    if (this.sourceElement && !this.sourceElement.error) {
      this.state.sourceDuration = this.sourceElement.duration || 180;
      this.state.isPlaying = !this.sourceElement.paused;
    }

    const primaryId = this.state.activeReactionId;
    const extraMetrics: Record<string, DriftMetrics> = {};

    for (const [id, el] of this.reactionElements.entries()) {
      if (!el) continue;

      // If the reaction video encountered a media error, report error status and do not attempt rate adjustments
      if (el.error) {
        const errorMetrics: DriftMetrics = {
          currentDrift: 0,
          targetTime: 0,
          actualTime: el.currentTime || 0,
          status: 'drifting',
          playbackRate: 1.0,
          lastCorrectionTime: Date.now(),
          correctionCount: this.state.primaryMetrics?.correctionCount || 0,
        };
        if (id === primaryId) {
          this.state.primaryStatus = 'drifting';
          this.state.primaryMetrics = errorMetrics;
        } else {
          extraMetrics[id] = errorMetrics;
        }
        continue;
      }

      const anchors = this.reactionAnchors.get(id) || [];
      const targetTime = mapSourceToReaction(sourceCurrentTime, anchors);
      const actualTime = el.currentTime;

      // Check if player is buffering or seeking
      const isBuffering = el.readyState < 3; // HAVE_FUTURE_DATA

      const correction = computeDriftCorrection(
        actualTime,
        targetTime,
        isBuffering,
        !this.state.isPlaying,
        this.config
      );

      // If playing and ready (not buffering), apply drift correction
      if (this.state.isPlaying && !isBuffering && el.readyState >= 2) {
        if (correction.shouldHardSeek && correction.seekTarget !== null) {
          try {
            el.currentTime = correction.seekTarget;
            el.playbackRate = 1.0;
          } catch {}
        } else {
          el.playbackRate = correction.recommendedRate;
        }
      } else if (!this.state.isPlaying) {
        el.playbackRate = 1.0;
      }

      const metrics: DriftMetrics = {
        currentDrift: correction.currentDrift,
        targetTime,
        actualTime,
        status: correction.status,
        playbackRate: el.playbackRate,
        lastCorrectionTime: Date.now(),
        correctionCount: (this.state.primaryMetrics?.correctionCount || 0) + (correction.shouldHardSeek ? 1 : 0),
      };

      if (id === primaryId) {
        this.state.primaryReactionTime = actualTime;
        this.state.primaryStatus = correction.status;
        this.state.primaryMetrics = metrics;
      } else {
        extraMetrics[id] = metrics;
      }
    }

    this.state.extraReactorMetrics = extraMetrics;
    this.notify();
  }

  public subscribe(listener: SyncEventListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): SessionSyncState {
    return { ...this.state };
  }

  private notify(): void {
    const currentState = this.getState();
    for (const listener of this.listeners) {
      listener(currentState);
    }
  }

  public destroy(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    this.reactionElements.clear();
    this.reactionAnchors.clear();
    this.listeners.clear();
  }
}
