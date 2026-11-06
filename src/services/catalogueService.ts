/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { VideoSource, ReactionVideo } from '../types';
import { SAMPLE_SOURCES, SAMPLE_REACTIONS } from '../data/mockCatalogue';

export interface WatchProgress {
  sourceId: string;
  reactionId: string;
  sourceTime: number;
  reactionTime: number;
  lastWatchedAt: number;
  completed: boolean;
}

export interface ICatalogueRepository {
  getSources(): Promise<VideoSource[]>;
  getSourceById(id: string): Promise<VideoSource | null>;
  getReactions(sourceId?: string): Promise<ReactionVideo[]>;
  getReactionById(id: string): Promise<ReactionVideo | null>;
  search(query: string, category?: string): Promise<{ sources: VideoSource[]; reactions: ReactionVideo[] }>;
  getCategories(): Promise<string[]>;
  saveReaction(reaction: ReactionVideo): Promise<ReactionVideo>;
  deleteReaction(id: string): Promise<boolean>;
}

const STORAGE_KEY_CUSTOM_REACTIONS = 'syncview_custom_reactions_v1';
const STORAGE_KEY_WATCH_PROGRESS = 'syncview_watch_progress_v1';
const STORAGE_KEY_FAVORITES = 'syncview_favorites_v1';

/**
 * Local / Development Catalogue Repository that seeds from standard curated fixtures
 * and persists creator studio additions and edits to client storage.
 */
export class LocalCatalogueRepository implements ICatalogueRepository {
  private sources: VideoSource[] = [...SAMPLE_SOURCES];
  private baseReactions: ReactionVideo[] = [...SAMPLE_REACTIONS];

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
    return [...this.sources];
  }

  public async getSourceById(id: string): Promise<VideoSource | null> {
    const src = this.sources.find((s) => s.id === id);
    return src ? { ...src } : null;
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
}

// Global shared service instance
export const catalogueService = new CatalogueService();
