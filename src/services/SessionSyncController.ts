/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SyncAnchor,
  DriftStatus,
  DriftMetrics,
  TheatreLayout,
} from '../types';
import {
  mapSourceToReaction,
  computeDriftCorrection,
  DEFAULT_DRIFT_CONFIG,
  DriftConfig,
} from './syncEngine';
import {
  MediaPlayerAdapter,
  MediaPlayerElement,
  RegisteredPlayerStatus,
  SyncCapability,
  wrapHtmlVideoElementAsAdapter,
} from './mediaProviders/types';
import { computeSessionSyncCapability } from './mediaProviders/mediaProviderRegistry';

export type SyncEventListener = (state: SessionSyncState) => void;

export interface SessionCapabilitySummary {
  capability: SyncCapability;
  isAutomaticSyncAvailable: boolean;
  hasErrors: boolean;
  guidanceText: string;
}

export interface SessionSyncState {
  isPlaying: boolean;
  sourceTime: number;
  sourceDuration: number | null;
  activeReactionId: string;
  primaryReactionTime: number | null;
  primaryStatus: DriftStatus;
  primaryMetrics: DriftMetrics;
  extraReactorMetrics: Record<string, DriftMetrics>;
  manualTargetTimes: Record<string, number>;
  audioFocus: string; // 'source' or reactionId
  isDuckingEnabled: boolean;
  layout: TheatreLayout;
  isAdvancedMode: boolean;
  isBuffering: boolean;
  isInPip: boolean;
  hasPlayerErrors: boolean;
  unhealthyPlayerIds: string[];
  playerStatuses: Record<string, RegisteredPlayerStatus>;
  sessionCapability: SessionCapabilitySummary;
}

/**
 * Authoritative client-side synchronization controller for Theatre.
 * Operates exclusively through explicit player capabilities via MediaPlayerAdapter
 * so players without timeline telemetry or playback control never trigger fake
 * state reads or unsupported drift corrections.
 */
export class SessionSyncController {
  private sourceAdapter: MediaPlayerAdapter | null = null;
  private reactionAdapters: Map<string, MediaPlayerAdapter> = new Map();
  private reactionAnchors: Map<string, SyncAnchor[]> = new Map();
  private correctionCounts: Map<string, number> = new Map();

  private listeners: Set<SyncEventListener> = new Set();
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastClockTickMs: number | null = null;
  private autoStartedAdapterIds: Set<string> = new Set();
  private pausedForSourceBufferIds: Set<string> = new Set();

  private state: SessionSyncState = {
    isPlaying: false,
    sourceTime: 0,
    sourceDuration: null,
    activeReactionId: '',
    primaryReactionTime: null,
    primaryStatus: 'paused',
    primaryMetrics: {
      currentDrift: 0,
      targetTime: 0,
      actualTime: 0,
      status: 'paused',
      playbackRate: 1.0,
      lastCorrectionTime: Date.now(),
      correctionCount: 0,
    },
    extraReactorMetrics: {},
    manualTargetTimes: {},
    audioFocus: 'source',
    isDuckingEnabled: true,
    layout: 'side-by-side',
    isAdvancedMode: false,
    isBuffering: false,
    isInPip: false,
    hasPlayerErrors: false,
    unhealthyPlayerIds: [],
    playerStatuses: {},
    sessionCapability: {
      capability: 'full_sync',
      isAutomaticSyncAvailable: true,
      hasErrors: false,
      guidanceText: 'Full automatic synchronisation active across all streams.',
    },
  };

  private config: DriftConfig = DEFAULT_DRIFT_CONFIG;

  constructor() {
    this.startSyncLoop();
  }

  public registerSourceAdapter(adapter: MediaPlayerAdapter | null): void {
    const prev = this.sourceAdapter;
    this.sourceAdapter = adapter;
    if (adapter && adapter.capabilities.canControlRate && !adapter.getError()) {
      adapter.setPlaybackRate(1.0);
    }
    this.refreshSessionHealthAndCapabilities();
    this.applyAudioMix();
    if (prev !== adapter) {
      this.notify();
    }
  }

  public registerReactionAdapter(reactionId: string, adapter: MediaPlayerAdapter | null): void {
    const prev = this.reactionAdapters.get(reactionId) ?? null;
    if (adapter) {
      this.reactionAdapters.set(reactionId, adapter);
      if (prev !== adapter) {
        this.autoStartedAdapterIds.delete(reactionId);
        this.pausedForSourceBufferIds.delete(reactionId);
      }
    } else {
      this.reactionAdapters.delete(reactionId);
      this.correctionCounts.delete(reactionId);
      this.autoStartedAdapterIds.delete(reactionId);
      this.pausedForSourceBufferIds.delete(reactionId);
    }
    this.refreshSessionHealthAndCapabilities();
    this.applyAudioMix();
    if (prev !== adapter) {
      this.notify();
    }
  }

  /**
   * Backward-compatible registration helper for native HTMLVideoElements and legacy mocks.
   */
  public registerSourceElement(
    el: MediaPlayerAdapter | MediaPlayerElement | HTMLVideoElement | null
  ): void {
    this.registerSourceAdapter(el ? wrapHtmlVideoElementAsAdapter('source-player', el) : null);
  }

  /**
   * Backward-compatible registration helper for native HTMLVideoElements and legacy mocks.
   */
  public registerReactionElement(
    reactionId: string,
    el: MediaPlayerAdapter | MediaPlayerElement | HTMLVideoElement | null
  ): void {
    this.registerReactionAdapter(
      reactionId,
      el ? wrapHtmlVideoElementAsAdapter(reactionId, el) : null
    );
  }

  public setReactionAnchors(reactionId: string, anchors: SyncAnchor[]): void {
    this.reactionAnchors.set(reactionId, anchors);
    const target = mapSourceToReaction(this.getSourceTime(), anchors);
    this.state.manualTargetTimes = {
      ...this.state.manualTargetTimes,
      [reactionId]: target,
    };
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
   * Authoritative Play action across all controllable players.
   * Skips players without play capability or players in error states,
   * and avoids claiming playback started if all controllable players reject or fail.
   */
  public async play(): Promise<void> {
    this.refreshSessionHealthAndCapabilities();
    const attempts: Promise<boolean>[] = [];

    if (
      this.sourceAdapter &&
      this.sourceAdapter.capabilities.canPlay &&
      !this.sourceAdapter.getError()
    ) {
      if (this.sourceAdapter.isPaused() !== false) {
        attempts.push(this.sourceAdapter.play().catch(() => false));
      } else {
        attempts.push(Promise.resolve(true));
      }
    }

    const baseSourceTime = this.getSourceTime();

    for (const [id, adapter] of this.reactionAdapters.entries()) {
      if (!adapter || !adapter.capabilities.canPlay || adapter.getError()) continue;

      // Pre-align reaction before play when timeline reads and seeks are supported
      const anchors = this.reactionAnchors.get(id) || [];
      const target = mapSourceToReaction(baseSourceTime, anchors);
      if (
        adapter.capabilities.canSeek &&
        adapter.capabilities.canReadTime &&
        adapter.getReadyState() >= 1
      ) {
        const current = adapter.getCurrentTime();
        if (current !== null && Math.abs(current - target) > 0.5) {
          adapter.seekTo(Math.max(0, target));
        }
      }

      if (adapter.isPaused() !== false) {
        attempts.push(adapter.play().catch(() => false));
      } else {
        attempts.push(Promise.resolve(true));
      }
    }

    if (attempts.length === 0) {
      // No controllable players exist in this session (e.g., all manual/external or failed)
      this.state.isPlaying = false;
      this.lastClockTickMs = null;
      this.evaluateSyncCycle();
      return;
    }

    const results = await Promise.all(attempts);
    const anyPlaying = results.some(Boolean);
    this.state.isPlaying = anyPlaying;
    this.lastClockTickMs = anyPlaying ? Date.now() : null;
    this.evaluateSyncCycle();
  }

  /**
   * Authoritative Pause action across all controllable players.
   */
  public pause(): void {
    this.state.isPlaying = false;
    this.lastClockTickMs = null;
    this.autoStartedAdapterIds.clear();
    this.pausedForSourceBufferIds.clear();

    if (this.sourceAdapter && this.sourceAdapter.capabilities.canPause) {
      if (this.sourceAdapter.isPaused() === false) {
        this.sourceAdapter.pause();
      }
    }

    for (const adapter of this.reactionAdapters.values()) {
      if (adapter && adapter.capabilities.canPause && adapter.isPaused() === false) {
        adapter.pause();
      }
    }

    this.evaluateSyncCycle();
  }

  public togglePlay(): void {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      void this.play();
    }
  }

  /**
   * Authoritative Seek action based on source video timeline.
   * Updates target cues for manual players and executes seekTo only on seekable players.
   */
  public seekToSourceTime(targetSourceTime: number): void {
    const clampedSourceTime = Math.max(0, targetSourceTime);
    this.state.sourceTime = clampedSourceTime;
    if (this.state.isPlaying) {
      this.lastClockTickMs = Date.now();
    }

    if (
      this.sourceAdapter &&
      this.sourceAdapter.capabilities.canSeek &&
      !this.sourceAdapter.getError() &&
      this.sourceAdapter.getReadyState() >= 1
    ) {
      this.sourceAdapter.seekTo(clampedSourceTime);
    }

    const updatedCues: Record<string, number> = { ...this.state.manualTargetTimes };

    for (const [id, adapter] of this.reactionAdapters.entries()) {
      const anchors = this.reactionAnchors.get(id) || [];
      const targetReactionTime = Math.max(0, mapSourceToReaction(clampedSourceTime, anchors));
      updatedCues[id] = targetReactionTime;

      if (
        adapter &&
        adapter.capabilities.canSeek &&
        !adapter.getError() &&
        adapter.getReadyState() >= 1
      ) {
        const rxDuration = adapter.capabilities.canReadDuration ? adapter.getDuration() : null;
        const seekTarget =
          rxDuration !== null && Number.isFinite(rxDuration) && rxDuration > 0
            ? Math.min(targetReactionTime, rxDuration)
            : targetReactionTime;
        adapter.seekTo(seekTarget);
      }
    }

    this.state.manualTargetTimes = updatedCues;
    this.evaluateSyncCycle();
  }

  /**
   * Manual micro-offset step for active reaction when seeking and time reading are supported.
   */
  public stepReactionOffset(reactionId: string, deltaSeconds: number): void {
    const adapter = this.reactionAdapters.get(reactionId);
    if (
      adapter &&
      adapter.capabilities.canSeek &&
      adapter.capabilities.canReadTime &&
      !adapter.getError()
    ) {
      const current = adapter.getCurrentTime();
      if (current !== null) {
        adapter.seekTo(Math.max(0, current + deltaSeconds));
      }
    }
    this.notify();
  }

  public getSourceTime(): number {
    if (
      this.sourceAdapter &&
      !this.sourceAdapter.getError() &&
      this.sourceAdapter.capabilities.canReadTime
    ) {
      const t = this.sourceAdapter.getCurrentTime();
      if (t !== null && Number.isFinite(t)) {
        return t;
      }
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
        const targetAdapter =
          this.reactionAdapters.get(this.state.activeReactionId) || this.sourceAdapter;
        if (targetAdapter && targetAdapter.requestPictureInPicture) {
          await targetAdapter.requestPictureInPicture();
          this.state.isInPip = true;
        } else {
          this.state.layout = this.state.layout === 'pip' ? 'side-by-side' : 'pip';
        }
      }
    } catch {
      this.state.layout = this.state.layout === 'pip' ? 'side-by-side' : 'pip';
    }
    this.notify();
  }

  /**
   * Audio mixing with focus and smart ducking, applied only to players
   * exposing real volume/mute controls.
   */
  private applyAudioMix(): void {
    const isSourceFocus = this.state.audioFocus === 'source';

    if (this.sourceAdapter && this.sourceAdapter.capabilities.canControlVolume) {
      if (isSourceFocus) {
        this.sourceAdapter.setMuted(false);
        this.sourceAdapter.setVolume(1.0);
      } else if (this.state.isDuckingEnabled) {
        this.sourceAdapter.setMuted(false);
        this.sourceAdapter.setVolume(0.25);
      } else {
        this.sourceAdapter.setMuted(true);
      }
    }

    for (const [id, adapter] of this.reactionAdapters.entries()) {
      if (!adapter || !adapter.capabilities.canControlVolume) continue;
      if (this.state.audioFocus === id) {
        adapter.setMuted(false);
        adapter.setVolume(1.0);
      } else {
        adapter.setMuted(true);
      }
    }
  }

  private refreshSessionHealthAndCapabilities(): void {
    const capabilities: SyncCapability[] = [];
    const unhealthyPlayerIds: string[] = [];
    const statuses: Record<string, RegisteredPlayerStatus> = {};

    const collect = (role: 'source' | 'reaction', playerId: string, adapter: MediaPlayerAdapter) => {
      const err = adapter.getError();
      const hasError = Boolean(err);
      capabilities.push(adapter.syncCapability);
      if (hasError) {
        unhealthyPlayerIds.push(playerId);
      }
      statuses[playerId] = {
        playerId,
        role,
        provider: adapter.provider,
        playbackMode: adapter.playbackMode,
        syncCapability: adapter.syncCapability,
        capabilities: adapter.capabilities,
        isReady: !hasError && adapter.getReadyState() >= 2,
        isBuffering: adapter.isBuffering(),
        hasError,
        errorMessage: err?.message,
      };
    };

    if (this.sourceAdapter) {
      collect('source', 'source', this.sourceAdapter);
    }
    for (const [id, adapter] of this.reactionAdapters.entries()) {
      collect('reaction', id, adapter);
    }

    this.state.unhealthyPlayerIds = unhealthyPlayerIds;
    this.state.hasPlayerErrors = unhealthyPlayerIds.length > 0;
    this.state.playerStatuses = statuses;
    this.state.sessionCapability = computeSessionSyncCapability(capabilities, unhealthyPlayerIds);
  }

  /**
   * Periodic synchronization and drift evaluation loop (runs every 100ms).
   */
  private startSyncLoop(): void {
    if (this.syncIntervalId) clearInterval(this.syncIntervalId);

    this.syncIntervalId = setInterval(() => {
      this.evaluateSyncCycle();
    }, 100);

    if (this.syncIntervalId && typeof (this.syncIntervalId as any).unref === 'function') {
      (this.syncIntervalId as any).unref();
    }
  }

  public evaluateSyncCycle(): void {
    if (!this.sourceAdapter && this.reactionAdapters.size === 0) return;

    this.refreshSessionHealthAndCapabilities();

    const now = Date.now();
    let anyControllablePlaying = false;
    let anyBuffering = false;

    let sourceIsBuffering = false;

    // 1. Update authoritative source timeline & duration if readable
    if (
      this.sourceAdapter &&
      !this.sourceAdapter.getError() &&
      this.sourceAdapter.capabilities.canReadTime
    ) {
      const readTime = this.sourceAdapter.getCurrentTime();
      if (readTime !== null) {
        this.state.sourceTime = readTime;
      }
      this.state.sourceDuration = this.sourceAdapter.capabilities.canReadDuration
        ? this.sourceAdapter.getDuration()
        : null;

      const sourcePaused = this.sourceAdapter.isPaused();
      if (sourcePaused !== null) {
        this.state.isPlaying = !sourcePaused;
        if (!sourcePaused) anyControllablePlaying = true;
      }
      sourceIsBuffering =
        this.sourceAdapter.isBuffering() ||
        (this.state.isPlaying && this.sourceAdapter.getReadyState() < 3);
      if (sourceIsBuffering) {
        anyBuffering = true;
      }
      this.lastClockTickMs = this.state.isPlaying ? now : null;
    } else {
      // Source cannot expose real duration/time (e.g. failed stream or Drive Preview / Patreon)
      this.state.sourceDuration = null;
      if (this.state.isPlaying && this.lastClockTickMs !== null) {
        const dt = Math.max(0, (now - this.lastClockTickMs) / 1000);
        this.state.sourceTime += dt;
        this.lastClockTickMs = now;
      }
    }

    const sourceCurrentTime = this.state.sourceTime;
    const primaryId = this.state.activeReactionId;
    const extraMetrics: Record<string, DriftMetrics> = {};
    const targetCues: Record<string, number> = {};

    // 2. Evaluate each reaction adapter truthfully according to its capabilities
    for (const [id, adapter] of this.reactionAdapters.entries()) {
      if (!adapter) continue;

      const anchors = this.reactionAnchors.get(id) || [];
      const targetTime = Math.max(0, mapSourceToReaction(sourceCurrentTime, anchors));
      targetCues[id] = targetTime;
      const prevCount = this.correctionCounts.get(id) || 0;

      // Case A: Stream is in error state -> surface 'error' status and skip playback commands
      const adapterErr = adapter.getError();
      if (adapterErr) {
        const errorMetrics: DriftMetrics = {
          currentDrift: 0,
          targetTime,
          actualTime: adapter.getCurrentTime() ?? 0,
          status: 'error',
          playbackRate: 1.0,
          lastCorrectionTime: now,
          correctionCount: prevCount,
        };
        if (id === primaryId) {
          this.state.primaryStatus = 'error';
          this.state.primaryMetrics = errorMetrics;
          this.state.primaryReactionTime = null;
        } else {
          extraMetrics[id] = errorMetrics;
        }
        continue;
      }

      // Case B: Manual-only or unreadable telemetry player -> no drift loop or fake timestamps
      if (adapter.syncCapability === 'manual_sync' || !adapter.capabilities.canReadTime) {
        const manualMetrics: DriftMetrics = {
          currentDrift: 0,
          targetTime,
          actualTime: 0,
          status: 'manual',
          playbackRate: 1.0,
          lastCorrectionTime: now,
          correctionCount: prevCount,
        };
        if (id === primaryId) {
          this.state.primaryStatus = 'manual';
          this.state.primaryMetrics = manualMetrics;
          this.state.primaryReactionTime = null;
        } else {
          extraMetrics[id] = manualMetrics;
        }
        continue;
      }

      // Case C: Real readable timeline (HTML5 Native or YouTube IFrame API)
      const actualTime = adapter.getCurrentTime();
      if (actualTime === null) {
        anyBuffering = true;
        const waitingMetrics: DriftMetrics = {
          currentDrift: 0,
          targetTime,
          actualTime: 0,
          status: 'buffering',
          playbackRate: 1.0,
          lastCorrectionTime: now,
          correctionCount: prevCount,
        };
        if (id === primaryId) {
          this.state.primaryStatus = 'buffering';
          this.state.primaryMetrics = waitingMetrics;
          this.state.primaryReactionTime = null;
        } else {
          extraMetrics[id] = waitingMetrics;
        }
        continue;
      }

      if (adapter.isPaused() === false) {
        anyControllablePlaying = true;
      }

      const isReactionBuffering = adapter.isBuffering() || adapter.getReadyState() < 3;
      const effectiveBuffering = isReactionBuffering || sourceIsBuffering;
      if (effectiveBuffering) {
        anyBuffering = true;
        if (adapter.capabilities.canControlRate && (adapter.getPlaybackRate() ?? 1.0) !== 1.0) {
          adapter.setPlaybackRate(1.0);
        }
      }

      // Clamp target time cleanly if reaction video has a known finite shorter duration
      const reactionDuration = adapter.capabilities.canReadDuration ? adapter.getDuration() : null;
      const reachedReactionEnd =
        reactionDuration !== null &&
        Number.isFinite(reactionDuration) &&
        reactionDuration > 0 &&
        targetTime >= reactionDuration;
      const effectiveTargetTime =
        reachedReactionEnd && reactionDuration !== null ? reactionDuration : targetTime;

      // Hold controllable reaction while source buffers so it doesn't run ahead or trigger seek loops
      if (
        sourceIsBuffering &&
        this.state.isPlaying &&
        !reachedReactionEnd &&
        adapter.capabilities.canPause &&
        adapter.isPaused() === false
      ) {
        if (adapter.pause()) {
          this.pausedForSourceBufferIds.add(id);
        }
      } else if (
        !effectiveBuffering &&
        this.state.isPlaying &&
        !reachedReactionEnd &&
        this.pausedForSourceBufferIds.has(id)
      ) {
        this.pausedForSourceBufferIds.delete(id);
        if (adapter.capabilities.canSeek && Math.abs(actualTime - effectiveTargetTime) > 0.5) {
          adapter.seekTo(effectiveTargetTime);
        }
        if (adapter.capabilities.canPlay && adapter.isPaused() === true) {
          void adapter.play().catch(() => false);
        }
      }

      // If session is playing and a newly-mounted/recovered controllable reaction is still paused before end, align and start it
      if (
        this.state.isPlaying &&
        !effectiveBuffering &&
        !reachedReactionEnd &&
        adapter.capabilities.canPlay &&
        adapter.getReadyState() >= 3 &&
        adapter.isPaused() === true &&
        !this.autoStartedAdapterIds.has(id)
      ) {
        this.autoStartedAdapterIds.add(id);
        if (adapter.capabilities.canSeek && Math.abs(actualTime - effectiveTargetTime) > 0.5) {
          adapter.seekTo(effectiveTargetTime);
        }
        void adapter.play().catch(() => false);
      }

      if (reachedReactionEnd && actualTime >= (reactionDuration as number) - 0.15) {
        // Reaction has reached the end of its shorter media; hold cleanly without triggering endless hard-seeks
        if (adapter.capabilities.canPause && adapter.isPaused() === false) {
          adapter.pause();
        }
        if (adapter.capabilities.canControlRate && (adapter.getPlaybackRate() ?? 1.0) !== 1.0) {
          adapter.setPlaybackRate(1.0);
        }
        const endedMetrics: DriftMetrics = {
          currentDrift: 0,
          targetTime: effectiveTargetTime,
          actualTime,
          status: this.state.isPlaying ? 'synced' : 'paused',
          playbackRate: 1.0,
          lastCorrectionTime: now,
          correctionCount: prevCount,
        };
        if (id === primaryId) {
          this.state.primaryReactionTime = actualTime;
          this.state.primaryStatus = endedMetrics.status;
          this.state.primaryMetrics = endedMetrics;
        } else {
          extraMetrics[id] = endedMetrics;
        }
        continue;
      }

      const correction = computeDriftCorrection(
        actualTime,
        effectiveTargetTime,
        effectiveBuffering,
        !this.state.isPlaying,
        this.config
      );

      let didHardSeek = false;
      if (this.state.isPlaying && !effectiveBuffering && adapter.getReadyState() >= 2) {
        if (
          correction.shouldHardSeek &&
          correction.seekTarget !== null &&
          adapter.capabilities.canSeek
        ) {
          didHardSeek = adapter.seekTo(correction.seekTarget);
          if (adapter.capabilities.canControlRate) {
            adapter.setPlaybackRate(1.0);
          }
        } else if (
          adapter.capabilities.canControlRate &&
          adapter.capabilities.supportsContinuousRate
        ) {
          // Micro-rate adjustment (0.95x / 1.05x) only for continuous-rate players
          adapter.setPlaybackRate(correction.recommendedRate);
        } else if (adapter.capabilities.canControlRate) {
          // Discrete-rate player (e.g. YouTube): keep 1.0x until hardSeekThreshold triggers a seek
          adapter.setPlaybackRate(1.0);
        }
      } else if (!this.state.isPlaying && adapter.capabilities.canControlRate) {
        adapter.setPlaybackRate(1.0);
      }

      const nextCount = prevCount + (didHardSeek ? 1 : 0);
      this.correctionCounts.set(id, nextCount);

      const reportedRate = adapter.getPlaybackRate() ?? 1.0;
      const metrics: DriftMetrics = {
        currentDrift: correction.currentDrift,
        targetTime: effectiveTargetTime,
        actualTime,
        status: correction.status,
        playbackRate: reportedRate,
        lastCorrectionTime: now,
        correctionCount: nextCount,
      };

      if (id === primaryId) {
        this.state.primaryReactionTime = actualTime;
        this.state.primaryStatus = correction.status;
        this.state.primaryMetrics = metrics;
      } else {
        extraMetrics[id] = metrics;
      }
    }

    if (anyControllablePlaying && !this.sourceAdapter?.capabilities.canReadTime) {
      if (!this.state.isPlaying || this.lastClockTickMs === null) {
        this.lastClockTickMs = now;
      }
      this.state.isPlaying = true;
    }

    this.state.isBuffering = anyBuffering;
    this.state.extraReactorMetrics = extraMetrics;
    this.state.manualTargetTimes = targetCues;
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
    this.reactionAdapters.clear();
    this.reactionAnchors.clear();
    this.correctionCounts.clear();
    this.autoStartedAdapterIds.clear();
    this.pausedForSourceBufferIds.clear();
    this.listeners.clear();
  }
}
