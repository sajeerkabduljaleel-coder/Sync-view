/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { VideoSource, ReactionVideo, TheatreLayout } from '../types';

export interface WatchProgress {
  sourceId: string;
  reactionId: string;
  sourceTime: number;
  reactionTime: number;
  lastWatchedAt: number;
  completed: boolean;
}

export interface SavedStreamSetup {
  id: string;
  title: string;
  source: VideoSource;
  primaryReaction: ReactionVideo;
  extraReactions?: ReactionVideo[];
  layout?: TheatreLayout;
  savedAt: number;
}

export interface ICatalogueRepository {
  getSources(): Promise<VideoSource[]>;
  getSourceById(id: string): Promise<VideoSource | null>;
  saveSource(source: VideoSource): Promise<VideoSource>;
  getReactions(sourceId?: string): Promise<ReactionVideo[]>;
  getReactionById(id: string): Promise<ReactionVideo | null>;
  search(query: string, category?: string): Promise<{ sources: VideoSource[]; reactions: ReactionVideo[] }>;
  getCategories(): Promise<string[]>;
  saveReaction(reaction: ReactionVideo): Promise<ReactionVideo>;
  deleteReaction(id: string): Promise<boolean>;
}

const STORAGE_KEY_CUSTOM_SOURCES = 'syncview_custom_sources_v1';
const STORAGE_KEY_CUSTOM_REACTIONS = 'syncview_custom_reactions_v1';
const STORAGE_KEY_SAVED_STREAMS = 'syncview_saved_streams_v1';
const STORAGE_KEY_WATCH_PROGRESS = 'syncview_watch_progress_v1';
const STORAGE_KEY_FAVORITES = 'syncview_favorites_v1';

/**
 * Production-ready Catalogue Repository that persists custom streams, calibrated
 * reactions, and viewer library state to client storage without generic placeholder videos.
 */
export class LocalCatalogueRepository implements ICatalogueRepository {
  private sources: VideoSource[] = [];
  private baseReactions: ReactionVideo[] = [];

  private getStoredCustomSources(): VideoSource[] {
    try {
      if (typeof window === 'undefined') return [];
      const stored = localStorage.getItem(STORAGE_KEY_CUSTOM_SOURCES);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  private setStoredCustomSources(sources: VideoSource[]): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(STORAGE_KEY_CUSTOM_SOURCES, JSON.stringify(sources));
    } catch (err) {
      console.warn('Failed to persist custom sources:', err);
    }
  }

  private getStoredCustomReactions(): ReactionVideo[] {
    try {
      if (typeof window === 'undefined') return [];
      const stored = localStorage.getItem(STORAGE_KEY_CUSTOM_REACTIONS);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  private setStoredCustomReactions(reactions: ReactionVideo[]): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(STORAGE_KEY_CUSTOM_REACTIONS, JSON.stringify(reactions));
    } catch (err) {
      console.warn('Failed to persist custom reactions:', err);
    }
  }

  public async getSources(): Promise<VideoSource[]> {
    const custom = this.getStoredCustomSources();
    const map = new Map<string, VideoSource>();
    this.sources.forEach((s) => map.set(s.id, s));
    custom.forEach((s) => map.set(s.id, s));
    return Array.from(map.values());
  }

  public async getSourceById(id: string): Promise<VideoSource | null> {
    const all = await this.getSources();
    const src = all.find((s) => s.id === id);
    return src ? { ...src } : null;
  }

  public async saveSource(source: VideoSource): Promise<VideoSource> {
    const current = this.getStoredCustomSources();
    const filtered = current.filter((s) => s.id !== source.id);
    filtered.unshift(source);
    this.setStoredCustomSources(filtered);
    return source;
  }

  public async getReactions(sourceId?: string): Promise<ReactionVideo[]> {
    const custom = this.getStoredCustomReactions();
    // Combine base with custom, where custom overrides matching ids
    const map = new Map<string, ReactionVideo>();
    this.baseReactions.forEach((r) => map.set(r.id, r));
    custom.forEach((r) => map.set(r.id, r));

    const all = Array.from(map.values());
    if (sourceId) {
      return all.filter((r) => r.sourceId === sourceId);
    }
    return all;
  }

  public async getReactionById(id: string): Promise<ReactionVideo | null> {
    const all = await this.getReactions();
    const found = all.find((r) => r.id === id);
    return found ? { ...found } : null;
  }

  public async search(
    query: string,
    category?: string
  ): Promise<{ sources: VideoSource[]; reactions: ReactionVideo[] }> {
    const q = (query || '').toLowerCase().trim();
    let sources = await this.getSources();
    let reactions = await this.getReactions();

    if (category && category !== 'All') {
      sources = sources.filter((s) => s.category.toLowerCase() === category.toLowerCase());
      const sourceIds = new Set(sources.map((s) => s.id));
      reactions = reactions.filter((r) => sourceIds.has(r.sourceId));
    }

    if (q) {
      sources = sources.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.creator.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      );
      reactions = reactions.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.creator.toLowerCase().includes(q) ||
          r.channelName.toLowerCase().includes(q)
      );
    }

    return { sources, reactions };
  }

  public async getCategories(): Promise<string[]> {
    const cats = new Set<string>();
    this.sources.forEach((s) => cats.add(s.category));
    return ['All', ...Array.from(cats)];
  }

  public async saveReaction(reaction: ReactionVideo): Promise<ReactionVideo> {
    const custom = this.getStoredCustomReactions();
    const existingIdx = custom.findIndex((r) => r.id === reaction.id);
    if (existingIdx >= 0) {
      custom[existingIdx] = reaction;
    } else {
      custom.push(reaction);
    }
    this.setStoredCustomReactions(custom);
    return reaction;
  }

  public async deleteReaction(id: string): Promise<boolean> {
    const custom = this.getStoredCustomReactions();
    const filtered = custom.filter((r) => r.id !== id);
    this.setStoredCustomReactions(filtered);
    return true;
  }
}

/**
 * CatalogueService manages catalogue data, search indexing, and viewer library state.
 */
export class CatalogueService {
  private repository: ICatalogueRepository;

  constructor(repository?: ICatalogueRepository) {
    this.repository = repository || new LocalCatalogueRepository();
  }

  public async getFeatured(): Promise<{
    source: VideoSource;
    primaryReaction: ReactionVideo;
    allReactions: ReactionVideo[];
  } | null> {
    const sources = await this.repository.getSources();
    if (!sources.length) return null;
    const source = sources[0];
    const reactions = await this.repository.getReactions(source.id);
    if (!reactions.length) return null;
    return {
      source,
      primaryReaction: reactions[0],
      allReactions: reactions,
    };
  }

  public async getSources(): Promise<VideoSource[]> {
    return this.repository.getSources();
  }

  public async getSourceById(id: string): Promise<VideoSource | null> {
    return this.repository.getSourceById(id);
  }

  public async getReactions(sourceId?: string): Promise<ReactionVideo[]> {
    return this.repository.getReactions(sourceId);
  }

  public async getReactionById(id: string): Promise<ReactionVideo | null> {
    return this.repository.getReactionById(id);
  }

  public async search(query: string, category?: string) {
    return this.repository.search(query, category);
  }

  public async getCategories(): Promise<string[]> {
    return this.repository.getCategories();
  }

  public async saveReaction(reaction: ReactionVideo): Promise<ReactionVideo> {
    return this.repository.saveReaction(reaction);
  }

  public async deleteReaction(id: string): Promise<boolean> {
    return this.repository.deleteReaction(id);
  }

  // ==========================================
  // Viewer Library (Progress, Continue Watching, Favorites)
  // ==========================================

  public getAllWatchProgress(): Record<string, WatchProgress> {
    try {
      if (typeof window === 'undefined') return {};
      const raw = localStorage.getItem(STORAGE_KEY_WATCH_PROGRESS);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  public saveWatchProgress(
    sourceId: string,
    reactionId: string,
    sourceTime: number,
    reactionTime: number,
    completed = false
  ): void {
    try {
      if (typeof window === 'undefined') return;
      const key = `${sourceId}:::${reactionId}`;
      const all = this.getAllWatchProgress();
      all[key] = {
        sourceId,
        reactionId,
        sourceTime: Math.max(0, sourceTime),
        reactionTime: Math.max(0, reactionTime),
        lastWatchedAt: Date.now(),
        completed,
      };
      localStorage.setItem(STORAGE_KEY_WATCH_PROGRESS, JSON.stringify(all));
    } catch (err) {
      console.warn('Failed to save watch progress:', err);
    }
  }

  public getWatchProgress(sourceId: string, reactionId: string): WatchProgress | null {
    const key = `${sourceId}:::${reactionId}`;
    const all = this.getAllWatchProgress();
    return all[key] || null;
  }

  public getFavorites(): string[] {
    try {
      if (typeof window === 'undefined') return [];
      const raw = localStorage.getItem(STORAGE_KEY_FAVORITES);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  public isFavorite(reactionId: string): boolean {
    return this.getFavorites().includes(reactionId);
  }

  public toggleFavorite(reactionId: string): boolean {
    try {
      const favs = this.getFavorites();
      const idx = favs.indexOf(reactionId);
      let isFav = false;
      if (idx >= 0) {
        favs.splice(idx, 1);
        isFav = false;
      } else {
        favs.push(reactionId);
        isFav = true;
      }
      localStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(favs));
      return isFav;
    } catch {
      return false;
    }
  }

  public async saveSource(source: VideoSource): Promise<VideoSource> {
    return this.repository.saveSource(source);
  }

  // ==========================================
  // Custom Stream Setup Persistence
  // ==========================================

  public async getSavedStreamSetups(): Promise<SavedStreamSetup[]> {
    try {
      if (typeof window === 'undefined') return [];
      const raw = localStorage.getItem(STORAGE_KEY_SAVED_STREAMS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  public async saveStreamSetup(config: {
    source: VideoSource;
    primaryReaction: ReactionVideo;
    extraReactions?: ReactionVideo[];
    layout?: TheatreLayout;
  }): Promise<SavedStreamSetup> {
    const list = await this.getSavedStreamSetups();
    const id = `setup-${Date.now()}`;
    const newSetup: SavedStreamSetup = {
      id,
      title: `${config.primaryReaction.creator} Reacts to ${config.source.title}`,
      source: config.source,
      primaryReaction: config.primaryReaction,
      extraReactions: config.extraReactions || [],
      layout: config.layout,
      savedAt: Date.now(),
    };
    // Also save source and reaction to catalogue so they appear in library
    await this.saveSource(config.source);
    await this.saveReaction(config.primaryReaction);
    if (config.extraReactions) {
      for (const rx of config.extraReactions) {
        await this.saveReaction(rx);
      }
    }

    const updated = [newSetup, ...list.filter((s) => s.id !== id)];
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_SAVED_STREAMS, JSON.stringify(updated));
      }
    } catch (err) {
      console.warn('Failed to save stream setup:', err);
    }
    return newSetup;
  }

  public async deleteStreamSetup(id: string): Promise<boolean> {
    try {
      const list = await this.getSavedStreamSetups();
      const filtered = list.filter((s) => s.id !== id);
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_SAVED_STREAMS, JSON.stringify(filtered));
      }
      return true;
    } catch {
      return false;
    }
  }
}

// Global shared service instance
export const catalogueService = new CatalogueService();
