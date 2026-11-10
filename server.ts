/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WatchPartyManager } from './src/services/watchPartyModel';
import { ReactionVideo } from './src/types';
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

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

// Enforce request payload size limit (max 64kb) to protect against DoS
app.use(express.json({ limit: '64kb' }));

// Global instance of the authoritative watch party manager
const partyManager = new WatchPartyManager();

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
    if (err) {
      res.status(500).json({ error: 'Failed to download source zip' });
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
  } catch (err) {
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
    } = req.body;

    let source = directSource;
    let primaryReaction = directReaction;

    // 1. Resolve source
    if (!source) {
      if (!sourceId || typeof sourceId !== 'string' || !sourceId.trim()) {
        return res.status(400).json({ error: 'Missing or invalid required field: sourceId' });
      }
      source = SAMPLE_SOURCES.find((s) => s.id === sourceId.trim());
      if (!source) {
        return res.status(404).json({ error: `Source video with id "${sourceId}" was not found` });
      }
    }

    // 2. Resolve reaction
    if (!primaryReaction) {
      if (!reactionId || typeof reactionId !== 'string' || !reactionId.trim()) {
        return res.status(400).json({ error: 'Missing or invalid required field: reactionId' });
      }
      primaryReaction = SAMPLE_REACTIONS.find((r) => r.id === reactionId.trim());
      if (!primaryReaction) {
        return res.status(404).json({ error: `Reaction video with id "${reactionId}" was not found` });
      }
    }

    // 3. Confirm selected reaction belongs to selected source
    if (primaryReaction.sourceId !== source.id) {
      return res.status(400).json({
        error: `Mismatched reaction: Reaction "${primaryReaction.id}" is mapped to source "${primaryReaction.sourceId}", not "${source.id}"`,
      });
    }

    // 4. Validate additional reaction IDs or objects
    const additional: ReactionVideo[] = [];
    if (Array.isArray(directAdditional)) {
      additional.push(...directAdditional.slice(0, 4));
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
      // Default auto-populated extras belonging to the same source
      const autoExtras = SAMPLE_REACTIONS.filter(
        (r) => r.sourceId === source.id && r.id !== primaryReaction.id
      ).slice(0, 4);
      additional.push(...autoExtras);
    }

    // 7. Validate and sanitize title
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

    // 8. Validate and sanitize host display name
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
    const room = await partyManager.getRoom(req.params.id);
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
      const { command, sourceTime, playbackRate } = req.body;

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
      });

      if (!result.success) {
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

// ==========================================
// Vite Integration & Static Serving
// ==========================================

async function startServer() {
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

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
