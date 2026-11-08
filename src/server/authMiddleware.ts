/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { WatchPartyManager } from '../services/watchPartyModel';
import { ParticipantSession } from '../services/watchPartyRepository';

// Extend Express Request declaration
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      participantSession?: ParticipantSession;
      rawParticipantToken?: string;
      isHost?: boolean;
    }
  }
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: 'viewer' | 'reactor' | 'admin';
  avatar: string;
}

export interface IServerAuthProvider {
  readonly id: string;
  readonly name: string;
  readonly isProductionReady: boolean;
  verifyUserToken(token: string): Promise<AuthenticatedUser | null>;
  getMissingProductionConfig(): string[];
}

/**
 * Development & Prototype Authentication Provider.
 * Transparently indicates it is not a production provider and explains what
 * cloud credentials/services are required before public deployment.
 */
export class DevelopmentServerAuthProvider implements IServerAuthProvider {
  public readonly id = 'dev-server-provider';
  public readonly name = 'Development Mock Auth Provider';
  public readonly isProductionReady = false;

  public async verifyUserToken(token: string): Promise<AuthenticatedUser | null> {
    if (!token || typeof token !== 'string') return null;

    // Reject malformed or empty tokens
    const cleanToken = token.trim();
    if (!cleanToken.startsWith('dev_token_') && !cleanToken.startsWith('usr_')) {
      return null;
    }

    // In development mode, derive mock user identity deterministically
    const userHash = crypto.createHash('sha256').update(cleanToken).digest('hex').slice(0, 12);
    return {
      id: `usr_${userHash}`,
      name: `DevUser-${userHash.slice(0, 5)}`,
      email: `dev-${userHash.slice(0, 6)}@syncview.local`,
      role: 'viewer',
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${userHash}`,
    };
  }

  public getMissingProductionConfig(): string[] {
    return [
      'FIREBASE_PROJECT_ID or GOOGLE_CLIENT_ID not configured.',
      'Production token signature verification (verifyIdToken) requires Firebase Admin SDK or Google OAuth library credentials.',
      'HTTPS cookie or Bearer JWT validation infrastructure is required for live public domains.',
    ];
  }
}

export const serverAuthProvider: IServerAuthProvider = new DevelopmentServerAuthProvider();

// ==========================================
// Sanitization & Input Validation
// ==========================================

export function sanitizeHtml(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

export function isValidRoomIdentifier(id: string): boolean {
  if (typeof id !== 'string') return false;
  return /^[a-zA-Z0-9_-]{4,64}$/.test(id.trim());
}

export function isValidCommandType(cmd: string): boolean {
  const allowed = new Set(['play', 'pause', 'seek', 'rate', 'change_media']);
  return allowed.has(cmd);
}

export function isValidTimestamp(val: unknown): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 86400; // max 24 hours
}

export function isValidPlaybackRate(val: unknown): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0.25 && val <= 3.0;
}

// ==========================================
// Token Extraction (Strict Headers Only)
// Credentials in request body or URL query strings are REJECTED.
// ==========================================

export function extractHostToken(req: Request): string {
  // Only accept from dedicated headers
  const hostHeader = req.headers['x-host-token'];
  if (typeof hostHeader === 'string' && hostHeader.trim()) {
    return hostHeader.trim();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  // Request body and query string fallbacks are explicitly prohibited
  return '';
}

export function extractParticipantToken(req: Request): string {
  const pHeader = req.headers['x-participant-token'] || req.headers['x-session-token'];
  if (typeof pHeader === 'string' && pHeader.trim()) {
    return pHeader.trim();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  // Request body and query string fallbacks are explicitly prohibited
  return '';
}

// ==========================================
// Express Middlewares
// ==========================================

/**
 * Validates room identifier parameter format.
 */
export function validateRoomParam(req: Request, res: Response, next: NextFunction) {
  const roomId = req.params.id;
  if (!isValidRoomIdentifier(roomId)) {
    return res.status(400).json({ error: 'Invalid room identifier format' });
  }
  next();
}

/**
 * Optional user authentication middleware.
 */
export async function authenticateUser(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    try {
      const user = await serverAuthProvider.verifyUserToken(token);
      if (user) {
        req.user = user;
      }
    } catch {
      // Continue unauthenticated
    }
  }
  next();
}

/**
 * Enforces room membership verification for chat, notes, and participant actions.
 */
export function createRequireRoomMembership(partyManager: WatchPartyManager) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const roomId = req.params.id;
    if (!isValidRoomIdentifier(roomId)) {
      return res.status(400).json({ error: 'Invalid room identifier' });
    }

    const token = extractParticipantToken(req);
    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized: valid participant session token required in x-participant-token or Authorization: Bearer header',
      });
    }

    const session = await partyManager.getParticipantSession(roomId, token);
    if (!session) {
      return res.status(403).json({
        error: 'Forbidden: not a verified member of this watch party room',
      });
    }

    req.participantSession = session;
    req.rawParticipantToken = token;
    next();
  };
}

/**
 * Enforces host authorization for playback controls and administrative actions.
 */
export function createRequireHostAuth(partyManager: WatchPartyManager) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const roomId = req.params.id;
    if (!isValidRoomIdentifier(roomId)) {
      return res.status(400).json({ error: 'Invalid room identifier' });
    }

    const token = extractHostToken(req);
    if (!token) {
      return res.status(401).json({
        error: 'Host authorization token required in x-host-token or Authorization: Bearer header',
      });
    }

    const isHost = await partyManager.isAuthorizedHost(roomId, token);
    if (!isHost) {
      return res.status(403).json({
        error: 'Forbidden: invalid host authorization credentials',
      });
    }

    req.isHost = true;
    next();
  };
}
