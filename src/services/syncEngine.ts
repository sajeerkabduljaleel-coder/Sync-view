/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SyncAnchor, DriftStatus, DriftMetrics } from '../types';

export interface DriftConfig {
  syncTolerance: number; // e.g. 0.08 seconds (within this, considered synced)
  microAdjustThreshold: number; // e.g. 0.8 seconds (use playbackRate 0.95x or 1.05x)
  hardSeekThreshold: number; // e.g. 1.2 seconds (trigger hard seek)
  microRateBoost: number; // e.g. 1.05
  microRateSlow: number; // e.g. 0.95
}

export const DEFAULT_DRIFT_CONFIG: DriftConfig = {
  syncTolerance: 0.08,
  microAdjustThreshold: 0.8,
  hardSeekThreshold: 1.2,
  microRateBoost: 1.05,
  microRateSlow: 0.95,
};

/**
 * Validates and sorts a list of anchors chronologically.
 */
export function sortAndCleanAnchors(anchors: SyncAnchor[]): SyncAnchor[] {
  return [...anchors].sort((a, b) => {
    if (a.sourceTime !== b.sourceTime) {
      return a.sourceTime - b.sourceTime;
    }
    return a.reactionTime - b.reactionTime;
  });
}

/**
 * Validate anchor integrity and detect invalid or conflicting configurations.
 */
export function validateAnchors(anchors: SyncAnchor[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!anchors || anchors.length === 0) {
    errors.push('At least one sync anchor is required.');
    return { valid: false, errors };
  }

  // Check for negative values
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    if (a.sourceTime < 0) {
      errors.push(`Anchor #${i + 1} (${a.id}) has negative sourceTime: ${a.sourceTime}`);
    }
    if (a.reactionTime < 0) {
      errors.push(`Anchor #${i + 1} (${a.id}) has negative reactionTime: ${a.reactionTime}`);
    }
  }

  // Sort anchors to verify monotonic reaction progression
  const sorted = sortAndCleanAnchors(anchors);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    // Reaction time must not flow backwards
    if (curr.reactionTime < prev.reactionTime) {
      errors.push(
        `Non-monotonic reaction time between anchor at source ${prev.sourceTime}s (rx: ${prev.reactionTime}s) and source ${curr.sourceTime}s (rx: ${curr.reactionTime}s)`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Maps source playback time to expected reaction playback time.
 * Handles:
 * - Linear interpolation across segments
 * - Intro offset (when sourceTime <= first anchor's sourceTime)
 * - Pause segments (source is paused while reaction advances)
 * - Skip segments (source jumps while reaction stays linear)
 */
export function mapSourceToReaction(sourceTime: number, rawAnchors: SyncAnchor[]): number {
  if (!rawAnchors || rawAnchors.length === 0) {
    return Math.max(0, sourceTime);
  }

  const anchors = sortAndCleanAnchors(rawAnchors);

  // If sourceTime is before or at the first anchor
  if (sourceTime <= anchors[0].sourceTime) {
    // If first anchor is an intro offset (e.g. source 0 -> reaction 15)
    const introOffset = anchors[0].reactionTime - anchors[0].sourceTime;
    return Math.max(0, sourceTime + introOffset);
  }

  // If sourceTime is past the last anchor
  const lastAnchor = anchors[anchors.length - 1];
  if (sourceTime >= lastAnchor.sourceTime) {
    // Project linear 1:1 forward from the last anchor
    const offset = lastAnchor.reactionTime - lastAnchor.sourceTime;
    return sourceTime + offset;
  }

  // Find the bounding segment [prev, next]
  for (let i = 0; i < anchors.length - 1; i++) {
    const p1 = anchors[i];
    const p2 = anchors[i + 1];

    if (sourceTime >= p1.sourceTime && sourceTime <= p2.sourceTime) {
      const sourceDelta = p2.sourceTime - p1.sourceTime;

      // Handle pause case where creator paused source video (sourceDelta === 0)
      if (sourceDelta === 0) {
        // Source is paused: reaction is progressing through this paused window
        // In this ambiguous state, we return the starting reaction time
        return p1.reactionTime;
      }

      // Piecewise linear interpolation
      const fraction = (sourceTime - p1.sourceTime) / sourceDelta;
      return p1.reactionTime + fraction * (p2.reactionTime - p1.reactionTime);
    }
  }

  return sourceTime;
}

/**
 * Maps reaction playback time to expected source playback time (inverse mapping).
 */
export function mapReactionToSource(reactionTime: number, rawAnchors: SyncAnchor[]): number {
  if (!rawAnchors || rawAnchors.length === 0) {
    return Math.max(0, reactionTime);
  }

  const anchors = sortAndCleanAnchors(rawAnchors);

  // If before first anchor reaction time (in intro window)
  if (reactionTime <= anchors[0].reactionTime) {
    const introOffset = anchors[0].reactionTime - anchors[0].sourceTime;
    const est = reactionTime - introOffset;
    return Math.max(0, est);
  }

  // If past last anchor
  const lastAnchor = anchors[anchors.length - 1];
  if (reactionTime >= lastAnchor.reactionTime) {
    const offset = lastAnchor.reactionTime - lastAnchor.sourceTime;
    return Math.max(0, reactionTime - offset);
  }

  // Search bounding segment by reaction time
  for (let i = 0; i < anchors.length - 1; i++) {
    const p1 = anchors[i];
    const p2 = anchors[i + 1];

    if (reactionTime >= p1.reactionTime && reactionTime <= p2.reactionTime) {
      const reactionDelta = p2.reactionTime - p1.reactionTime;
      if (reactionDelta === 0) {
        return p1.sourceTime;
      }
      const fraction = (reactionTime - p1.reactionTime) / reactionDelta;
      return Math.max(0, p1.sourceTime + fraction * (p2.sourceTime - p1.sourceTime));
    }
  }

  return Math.max(0, reactionTime);
}

/**
 * Calculates drift and recommended correction action.
 */
export function computeDriftCorrection(
  actualReactionTime: number,
  targetReactionTime: number,
  isBuffering: boolean = false,
  isPaused: boolean = false,
  config: DriftConfig = DEFAULT_DRIFT_CONFIG
): {
  status: DriftStatus;
  currentDrift: number; // seconds
  recommendedRate: number; // playbackRate for reaction
  shouldHardSeek: boolean;
  seekTarget: number | null;
} {
  if (isBuffering) {
    return {
      status: 'buffering',
      currentDrift: 0,
      recommendedRate: 1.0,
      shouldHardSeek: false,
      seekTarget: null,
    };
  }

  if (isPaused) {
    return {
      status: 'paused',
      currentDrift: 0,
      recommendedRate: 1.0,
      shouldHardSeek: false,
      seekTarget: null,
    };
  }

  // drift = actual - target
  // Positive drift: reaction is running ahead of source -> slow down reaction
  // Negative drift: reaction is running behind source -> speed up reaction
  const currentDrift = actualReactionTime - targetReactionTime;
  const absDrift = Math.abs(currentDrift);

  // Within tight tolerance: perfectly synchronized
  if (absDrift <= config.syncTolerance) {
    return {
      status: 'synced',
      currentDrift,
      recommendedRate: 1.0,
      shouldHardSeek: false,
      seekTarget: null,
    };
  }

  // Between tolerance and microAdjustThreshold: apply smooth micro-rate adjustment
  if (absDrift < config.microAdjustThreshold) {
    const recommendedRate =
      currentDrift > 0
        ? config.microRateSlow // reaction ahead: slow down slightly
        : config.microRateBoost; // reaction behind: speed up slightly

    return {
      status: 'adjusting',
      currentDrift,
      recommendedRate,
      shouldHardSeek: false,
      seekTarget: null,
    };
  }

  // Large drift exceeding hard threshold: trigger hard seek
  return {
    status: 'drifting',
    currentDrift,
    recommendedRate: 1.0,
    shouldHardSeek: true,
    seekTarget: targetReactionTime,
  };
}

/**
 * Exports anchors list to standardized CSV format for Creator Studio.
 */
export function exportAnchorsToCsv(anchors: SyncAnchor[]): string {
  const headers = ['id', 'sourceTime', 'reactionTime', 'type', 'label', 'notes'];
  const rows = anchors.map((a) => [
    `"${a.id}"`,
    a.sourceTime.toFixed(3),
    a.reactionTime.toFixed(3),
    `"${a.type}"`,
    `"${(a.label || '').replace(/"/g, '""')}"`,
    `"${(a.notes || '').replace(/"/g, '""')}"`,
  ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/**
 * Imports anchors from CSV text.
 */
export function importAnchorsFromCsv(csvText: string): SyncAnchor[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const anchors: SyncAnchor[] = [];
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parser supporting quotes
    const regex = /(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^,]*))/g;
    const parts: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      if (match.index === regex.lastIndex) regex.lastIndex++;
      const val = match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2];
      parts.push(val !== undefined ? val.trim() : '');
    }

    if (parts.length >= 3) {
      const sourceTime = parseFloat(parts[1]);
      const reactionTime = parseFloat(parts[2]);
      if (!isNaN(sourceTime) && !isNaN(reactionTime)) {
        anchors.push({
          id: parts[0] || `anchor-${Date.now()}-${i}`,
          sourceTime,
          reactionTime,
          type: (parts[3] as any) || 'linear',
          label: parts[4] || '',
          notes: parts[5] || '',
        });
      }
    }
  }

  return sortAndCleanAnchors(anchors);
}
