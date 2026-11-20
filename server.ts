/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WatchPartyManager } from './src/services/watchPartyModel';
import { SyncAnchor, AnchorType, VideoSource, ReactionVideo } from './src/types';
import { SAMPLE_SOURCES, SAMPLE_REACTIONS } from './src/data/mockCatalogue';
import { exportAnchorsToCsv, importAnchorsFromCsv } from './src/services/syncEngine';
import {
  authenticateUser,
  createRequireRoomMembership,
  createRequireHostAuth,
  validateRoomParam,
  extractHostToken,
  extractParticipantToken,
  serverAuthProvider,
  isValidTimestamp,
  isValidPlaybackRate,
  isValidCommandType,
  sanitizeHtml,
} from './src/server/authMiddleware';
import { handleMediaStream, handleMediaInspect } from './src/server/mediaStreamProxy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(): number {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf('--port');
  if (portIndex !== -1 && args[portIndex + 1]) {
    const parsed = parseInt(args[portIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  if (process.env.DEFAULT_APP_PORT) {
    const parsed = parseInt(process.env.DEFAULT_APP_PORT, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  if (process.env.PORT && process.env.PORT !== (process.env.NGINX_PORT || '8080')) {
    const parsed = parseInt(process.env.PORT, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 3000;
}
const port = resolvePort();

function isSafePartyMediaUrl(rawUrl: unknown): boolean {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  if (trimmed.startsWith('/api/media/stream')) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const ALLOWED_ANCHOR_TYPES = new Set<AnchorType>(['intro', 'linear', 'pause', 'skip', 'outro']);

function sanitizePlainText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
}

function validateAndSanitizeSource(input: any): { valid: boolean; source?: VideoSource; error?: string } {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Invalid source object' };
  }
  const id = sanitizePlainText(input.id, 100);
  const title = sanitizePlainText(input.title, 120);
  const url = typeof input.url === 'string' ? input.url.trim() : '';

  if (!id || !title) {
    return { valid: false, error: 'Source video must include valid id and title' };
  }
  if (url.startsWith('blob:')) {
    return {
      valid: false,
      error:
        'Local device files (blob: URLs) cannot be streamed to remote Watch Party guests. Choose a web stream URL (Direct MP4, Google Drive, or YouTube) to host a Watch Party.',
    };
  }
  if (!isSafePartyMediaUrl(url)) {
    return { valid: false, error: 'Source video URL must be a valid HTTP(S) or proxy stream URL' };
  }

  const duration =
    typeof input.duration === 'number' && Number.isFinite(input.duration) && input.duration > 0
      ? Math.min(86400, input.duration)
      : 300;

  return {
    valid: true,
    source: {
      id,
      title,
      creator: sanitizePlainText(input.creator, 60) || 'Source Creator',
      duration,
      url,
      thumbnail:
        typeof input.thumbnail === 'string' && isSafePartyMediaUrl(input.thumbnail)
          ? input.thumbnail.trim()
          : 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
      category: (sanitizePlainText(input.category, 40) || 'Movies & TV') as VideoSource['category'],
      description: sanitizePlainText(input.description, 300) || 'Synchronized stream source',
    },
  };
}

function validateAndSanitizeReaction(
  input: any,
  expectedSourceId: string
): { valid: boolean; reaction?: ReactionVideo; error?: string } {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Invalid reaction object' };
  }
  const id = sanitizePlainText(input.id, 100);
  const sourceId = sanitizePlainText(input.sourceId, 100);
  const creator = sanitizePlainText(input.creator, 60);
  const title = sanitizePlainText(input.title, 120);
  const url = typeof input.url === 'string' ? input.url.trim() : '';

  if (!id || !creator || !title) {
    return { valid: false, error: 'Reaction video must include valid id, title, and creator' };
  }
  if (sourceId !== expectedSourceId) {
    return {
      valid: false,
      error: `Mismatched reaction: Reaction "${id}" is mapped to source "${sourceId}", not "${expectedSourceId}"`,
    };
  }
  if (url.startsWith('blob:')) {
    return {
      valid: false,
      error:
        'Local device files (blob: URLs) cannot be streamed to remote Watch Party guests. Choose a web stream URL (Direct MP4, Google Drive, or YouTube) to host a Watch Party.',
    };
  }
  if (!isSafePartyMediaUrl(url)) {
    return { valid: false, error: 'Reaction video URL must be a valid HTTP(S) or proxy stream URL' };
  }

  const rawAnchors = Array.isArray(input.anchors) ? input.anchors.slice(0, 50) : [];
  const anchors: SyncAnchor[] = [];
  for (let i = 0; i < rawAnchors.length; i++) {
    const a = rawAnchors[i];
    if (!a || typeof a !== 'object') continue;
    const sTime = Number(a.sourceTime);
    const rTime = Number(a.reactionTime);
    if (!isValidTimestamp(sTime) || !isValidTimestamp(rTime)) {
      return { valid: false, error: 'Invalid anchor timestamp in reaction configuration' };
    }
    const anchorType: AnchorType = ALLOWED_ANCHOR_TYPES.has(a.type) ? a.type : 'linear';
    anchors.push({
      id: sanitizePlainText(a.id, 60) || `anc-${i}`,
      sourceTime: sTime,
      reactionTime: rTime,
      type: anchorType,
      label: sanitizePlainText(a.label, 80) || undefined,
    });
  }

  const introDuration =
    typeof input.introDuration === 'number' && Number.isFinite(input.introDuration) && input.introDuration >= 0
      ? Math.min(3600, input.introDuration)
      : anchors[0]?.reactionTime || 0;

  if (anchors.length === 0) {
    anchors.push({
      id: `anc-intro-${Date.now()}`,
      sourceTime: 0,
      reactionTime: introDuration,
      type: 'intro',
    });
  }

  const duration =
    typeof input.duration === 'number' && Number.isFinite(input.duration) && input.duration > 0
      ? Math.min(86400, input.duration)
      : 320;

  return {
    valid: true,
    reaction: {
      id,
      sourceId,
      creator,
      channelName: sanitizePlainText(input.channelName, 60) || `${creator} Live`,
      avatar:
        typeof input.avatar === 'string' && isSafePartyMediaUrl(input.avatar)
          ? input.avatar.trim()
          : `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(creator)}`,
      title,
      duration,
      introDuration,
      url,
      thumbnail:
        typeof input.thumbnail === 'string' && isSafePartyMediaUrl(input.thumbnail)
          ? input.thumbnail.trim()
          : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
      anchors,
      chapters: Array.isArray(input.chapters)
        ? input.chapters.slice(0, 30).map((c: any, idx: number) => ({
            id: sanitizePlainText(c?.id, 50) || `ch-${idx}`,
            title: sanitizePlainText(c?.title, 80) || 'Chapter',
            sourceTimestamp: isValidTimestamp(Number(c?.sourceTimestamp)) ? Number(c.sourceTimestamp) : 0,
            reactionTimestamp: isValidTimestamp(Number(c?.reactionTimestamp)) ? Number(c.reactionTimestamp) : 0,
          }))
        : [],
      highlights: [],
      notes: [],
      views: 0,
      likes: 0,
      isPublished: Boolean(input.isPublished ?? true),
      createdAt: typeof input.createdAt === 'number' ? input.createdAt : Date.now(),
    },
  };
}

export function createSyncViewApp(customPartyManager?: WatchPartyManager): express.Express {
  const app = express();

  // Enforce request payload size limit (max 64kb) to protect against DoS
  app.use(express.json({ limit: '64kb' }));

  // Authoritative watch party manager
  const partyManager = customPartyManager || new WatchPartyManager();

  // Middleware: Extract & attach authenticated user context if present
  app.use(authenticateUser);

  // ==========================================
  // API Routes
  // ==========================================

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      platform: 'SyncView',
      authProvider: serverAuthProvider.name,
      isProductionAuth: serverAuthProvider.isProductionReady,
      timestamp: Date.now(),
    });
  });

  // Auth provider status & missing production configuration disclosure
  app.get('/api/auth/status', (_req: Request, res: Response) => {
    res.json({
      providerId: serverAuthProvider.id,
      providerName: serverAuthProvider.name,
      isProductionReady: serverAuthProvider.isProductionReady,
      missingConfiguration: serverAuthProvider.getMissingProductionConfig(),
      documentation: 'To deploy to live users, configure Firebase Auth (verifyIdToken) or Google OAuth.',
    });
  });

  // Download full source code as zip
  app.get('/api/download-source', (_req: Request, res: Response) => {
    const zipPath = path.resolve(__dirname, 'public/syncview-source.zip');
    res.download(zipPath, 'syncview-source.zip', (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'Source bundle not found on server' });
      }
    });
  });

  // Media Stream Proxy & Google Drive Resolution (Supports Range Requests 206)
  app.get('/api/media/stream', handleMediaStream);
  app.get('/api/media/inspect', handleMediaInspect);

  // Catalogue API
  app.get('/api/catalogue/sources', (_req: Request, res: Response) => {
    res.json(SAMPLE_SOURCES);
  });

  app.get('/api/catalogue/reactions', (req: Request, res: Response) => {
    const sourceId = req.query.sourceId as string;
    if (sourceId) {
      const filtered = SAMPLE_REACTIONS.filter((r) => r.sourceId === sourceId);
      return res.json(filtered);
    }
    res.json(SAMPLE_REACTIONS);
  });

  // Watch Party API

  // Browse active watch parties
  app.get('/api/parties', async (_req: Request, res: Response) => {
    try {
      const allRooms = await partyManager.getAllRooms();
      res.json(allRooms);
    } catch {
      res.status(500).json({ error: 'Failed to retrieve active parties' });
    }
  });

  // Create a new room with strict input validation
  app.post('/api/parties', async (req: Request, res: Response) => {
    try {
      const {
        title,
        hostName,
        sourceId,
        reactionId,
        additionalReactionIds,
        source: directSource,
        reaction: directReaction,
        additionalReactions: directAdditional,
      } = req.body || {};

      let source: VideoSource | undefined;
      let primaryReaction: ReactionVideo | undefined;

      // 1. Resolve & validate source
      if (directSource !== undefined) {
        const srcValidation = validateAndSanitizeSource(directSource);
        if (!srcValidation.valid || !srcValidation.source) {
          return res.status(400).json({ error: srcValidation.error });
        }
        source = srcValidation.source;
      } else {
        if (!sourceId || typeof sourceId !== 'string' || !sourceId.trim()) {
          return res.status(400).json({ error: 'Missing or invalid required field: sourceId' });
        }
        source = SAMPLE_SOURCES.find((s) => s.id === sourceId.trim());
        if (!source) {
          return res.status(404).json({ error: `Source video with id "${sourceId}" was not found` });
        }
      }

      // 2. Resolve & validate primary reaction
      if (directReaction !== undefined) {
        const rxValidation = validateAndSanitizeReaction(directReaction, source.id);
        if (!rxValidation.valid || !rxValidation.reaction) {
          return res.status(400).json({ error: rxValidation.error });
        }
        primaryReaction = rxValidation.reaction;
      } else {
        if (!reactionId || typeof reactionId !== 'string' || !reactionId.trim()) {
          return res.status(400).json({ error: 'Missing or invalid required field: reactionId' });
        }
        primaryReaction = SAMPLE_REACTIONS.find((r) => r.id === reactionId.trim());
        if (!primaryReaction) {
          return res.status(404).json({ error: `Reaction video with id "${reactionId}" was not found` });
        }
        if (primaryReaction.sourceId !== source.id) {
          return res.status(400).json({
            error: `Mismatched reaction: Reaction "${primaryReaction.id}" is mapped to source "${primaryReaction.sourceId}", not "${source.id}"`,
          });
        }
      }

      // 3. Validate additional reaction IDs or objects
      const additional: ReactionVideo[] = [];
      if (directAdditional !== undefined) {
        if (!Array.isArray(directAdditional)) {
          return res.status(400).json({ error: 'additionalReactions must be an array' });
        }
        if (directAdditional.length > 4) {
          return res.status(400).json({ error: 'A maximum of 4 additional reactions can be added' });
        }
        for (const extraObj of directAdditional) {
          const extraValidation = validateAndSanitizeReaction(extraObj, source.id);
          if (!extraValidation.valid || !extraValidation.reaction) {
            return res.status(400).json({ error: extraValidation.error });
          }
          if (extraValidation.reaction.id === primaryReaction.id) {
            return res.status(400).json({ error: 'Additional reaction cannot be identical to primary reaction' });
          }
          if (!additional.some((a) => a.id === extraValidation.reaction!.id)) {
            additional.push(extraValidation.reaction);
          }
        }
      } else if (additionalReactionIds !== undefined) {
        if (!Array.isArray(additionalReactionIds)) {
          return res.status(400).json({ error: 'additionalReactionIds must be an array of strings' });
        }
        if (additionalReactionIds.length > 4) {
          return res.status(400).json({ error: 'A maximum of 4 additional reactions can be added' });
        }
        for (const extraId of additionalReactionIds) {
          if (typeof extraId !== 'string' || !extraId.trim()) {
            return res.status(400).json({ error: 'Invalid extra reaction id format' });
          }
          const cleanExtraId = extraId.trim();
          if (cleanExtraId === primaryReaction.id) {
            return res.status(400).json({ error: 'Additional reaction cannot be identical to primary reaction' });
          }
          const extraRx = SAMPLE_REACTIONS.find((r) => r.id === cleanExtraId);
          if (!extraRx) {
            return res.status(404).json({ error: `Additional reaction with id "${cleanExtraId}" was not found` });
          }
          if (extraRx.sourceId !== source.id) {
            return res.status(400).json({
              error: `Additional reaction "${cleanExtraId}" does not belong to source "${source.id}"`,
            });
          }
          if (!additional.some((a) => a.id === extraRx.id)) {
            additional.push(extraRx);
          }
        }
      } else {
        // Default auto-populated extras belonging to the same source (only when matching sample source)
        const autoExtras = SAMPLE_REACTIONS.filter(
          (r) => r.sourceId === source!.id && r.id !== primaryReaction!.id
        ).slice(0, 4);
        additional.push(...autoExtras);
      }

      // 4. Validate and sanitize title
      let cleanTitle = `${primaryReaction.creator}'s Watch Party`;
      if (title !== undefined) {
        if (typeof title !== 'string' || !title.trim()) {
          return res.status(400).json({ error: 'Room title cannot be empty if specified' });
        }
        if (title.trim().length > 80) {
          return res.status(400).json({ error: 'Room title exceeds maximum length of 80 characters' });
        }
        cleanTitle = sanitizeHtml(title.trim());
      }

      // 5. Validate and sanitize host display name
      let cleanHostName = 'Host';
      if (req.user) {
        cleanHostName = req.user.name;
      } else if (hostName !== undefined) {
        if (typeof hostName !== 'string' || !hostName.trim()) {
          return res.status(400).json({ error: 'Host name cannot be empty if specified' });
        }
        if (hostName.trim().length > 30) {
          return res.status(400).json({ error: 'Host name exceeds maximum length of 30 characters' });
        }
        cleanHostName = sanitizeHtml(hostName.trim());
      }

      const { room, hostToken, participantToken } = await partyManager.createRoom({
        title: cleanTitle,
        hostName: cleanHostName,
        sourceVideo: source,
        primaryReaction,
        additionalReactions: additional,
      });

      // Return room and private credentials (ONLY on initial creation)
      res.status(201).json({
        room,
        hostToken,
        participantToken,
      });
    } catch (err) {
      console.error('Error creating watch party:', err);
      res.status(500).json({ error: 'Failed to create watch party' });
    }
  });

// Get room details by ID or 6-digit Code (Safe view - hostToken NEVER exposed)
app.get('/api/parties/:id', validateRoomParam, async (req: Request, res: Response) => {
  try {
    const participantToken = extractParticipantToken(req);
    const room = await partyManager.getRoom(req.params.id, participantToken || undefined);
    if (!room) {
      return res.status(404).json({ error: 'Watch party not found' });
    }

    const estimatedTime = partyManager.estimateCurrentSourceTime(room.playbackState);
    res.json({
      room,
      estimatedSourceTime: estimatedTime,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error fetching watch party' });
  }
});

// Join room as viewer (supports reconnect via participantToken header)
app.post('/api/parties/:id/join', validateRoomParam, async (req: Request, res: Response) => {
  try {
    // Derive name from verified user if authenticated, otherwise sanitize guest name
    let participantName = 'Guest Viewer';
    if (req.user) {
      participantName = req.user.name;
    } else if (typeof req.body?.participantName === 'string' && req.body.participantName.trim()) {
      participantName = sanitizeHtml(req.body.participantName.trim().slice(0, 30));
    }

    // Extract existing token strictly from headers (never query string!)
    const existingToken = extractParticipantToken(req);

    const result = await partyManager.joinRoom(
      req.params.id,
      participantName,
      existingToken || undefined
    );

    if (!result) {
      return res.status(404).json({ error: 'Watch party not found' });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error joining watch party' });
  }
});

// Execute authoritative host playback command (Host ONLY)
app.post(
  '/api/parties/:id/command',
  createRequireHostAuth(partyManager),
  async (req: Request, res: Response) => {
    try {
      const token = extractHostToken(req);
      const { command, sourceTime, playbackRate, expectedSeq } = req.body;

      if (!isValidCommandType(command)) {
        return res.status(400).json({ error: `Invalid command type: ${command}` });
      }

      if (sourceTime !== undefined && !isValidTimestamp(sourceTime)) {
        return res.status(400).json({ error: 'Invalid source timestamp: must be finite number >= 0' });
      }

      if (playbackRate !== undefined && !isValidPlaybackRate(playbackRate)) {
        return res.status(400).json({ error: 'Invalid playback rate: must be between 0.25 and 3.0' });
      }

      const result = await partyManager.executeHostCommand(req.params.id, token, {
        command,
        sourceTime,
        playbackRate,
        expectedSeq: typeof expectedSeq === 'number' ? expectedSeq : undefined,
      });

      if (!result.success) {
        if (result.conflict) {
          return res.status(409).json({ error: result.error, playbackState: result.state });
        }
        return res.status(403).json({ error: result.error });
      }

      res.json({ success: true, playbackState: result.state });
    } catch (err) {
      res.status(500).json({ error: 'Error executing playback command' });
    }
  }
);

// Send chat message (Sender identity derived strictly from verified room membership session)
app.post(
  '/api/parties/:id/chat',
  createRequireRoomMembership(partyManager),
  async (req: Request, res: Response) => {
    try {
      const session = req.participantSession!;
      const { text } = req.body;

      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Message text cannot be empty' });
      }

      if (text.trim().length > 500) {
        return res.status(400).json({ error: 'Message exceeds maximum length of 500 characters' });
      }

      // Sender identity and display name are derived entirely by the server session!
      // Client-supplied senderId, senderName, and isHost are REJECTED and ignored.
      const rawToken = req.rawParticipantToken || extractParticipantToken(req);
      const result = await partyManager.addChatMessage(
        req.params.id,
        rawToken,
        text
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.status(201).json(result.message);
    } catch (err) {
      res.status(500).json({ error: 'Error sending chat message' });
    }
  }
);

// Add timestamped note (Ownership derived strictly from verified room membership session)
app.post(
  '/api/parties/:id/notes',
  createRequireRoomMembership(partyManager),
  async (req: Request, res: Response) => {
    try {
      const { sourceTime, reactionTime, text } = req.body;

      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Note text cannot be empty' });
      }

      if (text.trim().length > 280) {
        return res.status(400).json({ error: 'Note exceeds maximum length of 280 characters' });
      }

      const parsedSourceTime = parseFloat(sourceTime);
      const parsedReactionTime = parseFloat(reactionTime);

      if (!isValidTimestamp(parsedSourceTime) || !isValidTimestamp(parsedReactionTime)) {
        return res.status(400).json({ error: 'Invalid timestamps: must be finite non-negative numbers' });
      }

      // Note ownership and author name are derived entirely from server session!
      const rawToken = req.rawParticipantToken || extractParticipantToken(req);
      const result = await partyManager.addNote(
        req.params.id,
        rawToken,
        parsedSourceTime,
        parsedReactionTime,
        text
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.status(201).json(result.note);
    } catch (err) {
      res.status(500).json({ error: 'Error adding note' });
    }
  }
);

// Delete note (Restricted strictly to the actual note author or room host)
app.delete(
  '/api/parties/:id/notes/:noteId',
  validateRoomParam,
  async (req: Request, res: Response) => {
    try {
      const hostToken = extractHostToken(req);
      const participantToken = extractParticipantToken(req);

      if (!hostToken && !participantToken) {
        return res.status(401).json({
          error: 'Unauthorized: note author session token or host credentials required to delete a note',
        });
      }

      const result = await partyManager.deleteNote(
        req.params.id,
        req.params.noteId,
        participantToken || undefined,
        hostToken || undefined
      );

      if (!result.success) {
        return res.status(403).json({ error: result.error });
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Error deleting note' });
    }
  }
);

// Reassign host (Host ONLY)
app.post(
  '/api/parties/:id/reassign-host',
  createRequireHostAuth(partyManager),
  async (req: Request, res: Response) => {
    try {
      const currentHostToken = extractHostToken(req);
      const { targetParticipantId } = req.body;

      if (typeof targetParticipantId !== 'string' || !targetParticipantId.trim()) {
        return res.status(400).json({ error: 'Target participant ID is required' });
      }

      const result = await partyManager.reassignHost(
        req.params.id,
        currentHostToken,
        targetParticipantId.trim()
      );

      if (!result.success) {
        return res.status(403).json({ error: result.error });
      }

      res.json({ success: true, newHostToken: result.newHostToken });
    } catch (err) {
      res.status(500).json({ error: 'Error reassigning host' });
    }
  }
);

// Explicit participant leave (marks participant disconnected immediately)
app.post(
  '/api/parties/:id/leave',
  createRequireRoomMembership(partyManager),
  async (req: Request, res: Response) => {
    try {
      const rawToken = req.rawParticipantToken || extractParticipantToken(req);
      const result = await partyManager.leaveRoom(req.params.id, rawToken);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Error leaving watch party' });
    }
  }
);

// Safe host claim/recovery (succeeds for designated host or when current host is disconnected)
app.post(
  '/api/parties/:id/claim-host',
  createRequireRoomMembership(partyManager),
  async (req: Request, res: Response) => {
    try {
      const rawToken = req.rawParticipantToken || extractParticipantToken(req);
      const result = await partyManager.claimHost(req.params.id, rawToken);
      if (!result.success) {
        return res.status(403).json({ error: result.error });
      }
      res.json({ success: true, hostToken: result.hostToken, room: result.room });
    } catch {
      res.status(500).json({ error: 'Error claiming host controls' });
    }
  }
);

// CSV tools for Creator Studio
app.post('/api/reactions/export-csv', (req: Request, res: Response) => {
  const anchors = req.body?.anchors || [];
  const csv = exportAnchorsToCsv(anchors);
  res.header('Content-Type', 'text/csv');
  res.attachment('sync-anchors.csv');
  res.send(csv);
});

  app.post('/api/reactions/import-csv', (req: Request, res: Response) => {
    const csvText = req.body?.csv || '';
    const anchors = importAnchorsFromCsv(csvText);
    res.json({ success: true, anchors });
  });

  return app;
}

// ==========================================
// Vite Integration & Static Serving
// ==========================================

async function startServer() {
  const app = createSyncViewApp();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`SyncView server running on http://0.0.0.0:${port}`);
  });
}

const isDirectMainExecution =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (
  isDirectMainExecution &&
  process.env.SYNCVIEW_DISABLE_AUTO_LISTEN !== '1' &&
  process.env.NODE_ENV !== 'test'
) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
