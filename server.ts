/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WatchPartyManager } from './src/services/watchPartyModel';
import { SAMPLE_SOURCES, SAMPLE_REACTIONS } from './src/data/mockCatalogue';
import { exportAnchorsToCsv, importAnchorsFromCsv } from './src/services/syncEngine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

// Global instance of the authoritative watch party manager
const partyManager = new WatchPartyManager();

// Helper to extract host token from headers or body
function extractHostToken(req: Request): string {
  const hostHeader = req.headers['x-host-token'];
  if (typeof hostHeader === 'string' && hostHeader.trim()) {
    return hostHeader.trim();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return (req.body?.hostToken || req.query?.hostToken || '').toString().trim();
}

// Helper to extract participant session token from headers or query/body
function extractParticipantToken(req: Request): string {
  const pHeader = req.headers['x-participant-token'];
  if (typeof pHeader === 'string' && pHeader.trim()) {
    return pHeader.trim();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return (
    req.body?.participantToken ||
    req.body?.existingToken ||
    req.query?.participantToken ||
    ''
  ).toString().trim();
}

// ==========================================
// API Routes
// ==========================================

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', platform: 'SyncView', timestamp: Date.now() });
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
    // Return sample active party or registered active rooms
    const activeDemo = await partyManager.getRoom('room-featured-demo');
    if (activeDemo) {
      return res.json([activeDemo]);
    }
    res.json([]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve active parties' });
  }
});

// Create a new room
app.post('/api/parties', async (req: Request, res: Response) => {
  try {
    const { title, hostName, sourceId, reactionId } = req.body;

    const source = SAMPLE_SOURCES.find((s) => s.id === sourceId) || SAMPLE_SOURCES[0];
    const primaryReaction = SAMPLE_REACTIONS.find((r) => r.id === reactionId) || SAMPLE_REACTIONS[0];
    const additional = SAMPLE_REACTIONS.filter(
      (r) => r.sourceId === source.id && r.id !== primaryReaction.id
    ).slice(0, 4);

    const { room, hostToken, participantToken } = await partyManager.createRoom({
      title: title || `${primaryReaction.creator}'s Watch Party`,
      hostName: hostName || 'Host',
      sourceVideo: source,
      primaryReaction,
      additionalReactions: additional,
    });

    // Return room, hostToken, and host's participantToken
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

// Get room details by ID or 6-digit Code (safe view - hostToken NEVER exposed)
app.get('/api/parties/:id', async (req: Request, res: Response) => {
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

// Join room as viewer (supports reconnect via participantToken / existingToken)
app.post('/api/parties/:id/join', async (req: Request, res: Response) => {
  try {
    const { participantName } = req.body;
    const existingToken = extractParticipantToken(req);

    const result = await partyManager.joinRoom(
      req.params.id,
      participantName || 'Guest Viewer',
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
app.post('/api/parties/:id/command', async (req: Request, res: Response) => {
  try {
    const token = extractHostToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Host authorization token is required' });
    }

    const { command, sourceTime, playbackRate } = req.body;
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
});

// Send chat message (Sender identity derived strictly from server participant session)
app.post('/api/parties/:id/chat', async (req: Request, res: Response) => {
  try {
    const participantToken = extractParticipantToken(req);
    if (!participantToken) {
      return res.status(401).json({
        error: 'Unauthorized: valid participant session token required to send chat messages',
      });
    }

    const { text } = req.body;
    const result = await partyManager.addChatMessage(
      req.params.id,
      participantToken,
      text || ''
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json(result.message);
  } catch (err) {
    res.status(500).json({ error: 'Error sending chat message' });
  }
});

// Add timestamped note (Ownership derived strictly from server participant session)
app.post('/api/parties/:id/notes', async (req: Request, res: Response) => {
  try {
    const participantToken = extractParticipantToken(req);
    if (!participantToken) {
      return res.status(401).json({
        error: 'Unauthorized: valid participant session token required to record notes',
      });
    }

    const { sourceTime, reactionTime, text } = req.body;
    const result = await partyManager.addNote(
      req.params.id,
      participantToken,
      parseFloat(sourceTime) || 0,
      parseFloat(reactionTime) || 0,
      text || ''
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json(result.note);
  } catch (err) {
    res.status(500).json({ error: 'Error adding note' });
  }
});

// Delete note (owner or host only)
app.delete('/api/parties/:id/notes/:noteId', async (req: Request, res: Response) => {
  try {
    const hostToken = extractHostToken(req);
    const participantToken = extractParticipantToken(req);

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
});

// Reassign host
app.post('/api/parties/:id/reassign-host', async (req: Request, res: Response) => {
  try {
    const currentHostToken = extractHostToken(req);
    const { targetParticipantId } = req.body;

    if (!currentHostToken) {
      return res.status(401).json({ error: 'Current host token is required' });
    }

    const result = await partyManager.reassignHost(
      req.params.id,
      currentHostToken,
      targetParticipantId
    );

    if (!result.success) {
      return res.status(403).json({ error: result.error });
    }

    res.json({ success: true, newHostToken: result.newHostToken });
  } catch (err) {
    res.status(500).json({ error: 'Error reassigning host' });
  }
});

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
  // Seed featured demo party if none exists
  try {
    const existing = await partyManager.getRoom('room-featured-demo');
    if (!existing) {
      await partyManager.createRoom({
        title: '🔥 Live Film Breakdown: Aethelgard Reveal',
        hostName: 'Marcus Vance',
        sourceVideo: SAMPLE_SOURCES[0],
        primaryReaction: SAMPLE_REACTIONS[0],
        additionalReactions: [SAMPLE_REACTIONS[1], SAMPLE_REACTIONS[2]],
      });
    }
  } catch (err) {
    console.warn('Initial room seed notice:', err);
  }

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
