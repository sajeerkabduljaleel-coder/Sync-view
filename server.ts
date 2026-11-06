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

// Seed an initial demo room so users immediately see an active watch party if they explore parties!
const initialParty = partyManager.createRoom({
  title: '🔥 Live Film Breakdown: Aethelgard Reveal',
  hostName: 'Marcus Vance',
  sourceVideo: SAMPLE_SOURCES[0],
  primaryReaction: SAMPLE_REACTIONS[0],
  additionalReactions: [SAMPLE_REACTIONS[1], SAMPLE_REACTIONS[2]],
});

// Helper to extract host token from Bearer header or request body
function extractHostToken(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return (req.body?.hostToken || req.query?.hostToken || '').toString().trim();
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

// Create a new room
app.post('/api/parties', (req: Request, res: Response) => {
  const { title, hostName, sourceId, reactionId } = req.body;

  const source = SAMPLE_SOURCES.find((s) => s.id === sourceId) || SAMPLE_SOURCES[0];
  const primaryReaction = SAMPLE_REACTIONS.find((r) => r.id === reactionId) || SAMPLE_REACTIONS[0];
  const additional = SAMPLE_REACTIONS.filter(
    (r) => r.sourceId === source.id && r.id !== primaryReaction.id
  ).slice(0, 4);

  const { room, hostToken } = partyManager.createRoom({
    title: title || `${primaryReaction.creator}'s Watch Party`,
    hostName: hostName || 'Host',
    sourceVideo: source,
    primaryReaction,
    additionalReactions: additional,
  });

  // Return both room and private hostToken ONLY to creator
  res.status(201).json({
    room,
    hostToken,
  });
});

// Get room details by ID or 6-digit Code (safe view - hostToken NEVER exposed)
app.get('/api/parties/:id', (req: Request, res: Response) => {
  const room = partyManager.getRoom(req.params.id);
  if (!room) {
    return res.status(404).json({ error: 'Watch party not found' });
  }

  // Calculate estimated current playback time for smooth catch-up
  const estimatedTime = partyManager.estimateCurrentSourceTime(room.playbackState);
  res.json({
    room,
    estimatedSourceTime: estimatedTime,
  });
});

// Join room as viewer
app.post('/api/parties/:id/join', (req: Request, res: Response) => {
  const { participantName } = req.body;
  const result = partyManager.joinRoom(req.params.id, participantName || 'Guest Viewer');
  if (!result) {
    return res.status(404).json({ error: 'Watch party not found' });
  }
  res.json(result);
});

// Execute authoritative host playback command (Host ONLY)
app.post('/api/parties/:id/command', (req: Request, res: Response) => {
  const token = extractHostToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Host authorization token is required' });
  }

  const { command, sourceTime, playbackRate } = req.body;
  const result = partyManager.executeHostCommand(req.params.id, token, {
    command,
    sourceTime,
    playbackRate,
  });

  if (!result.success) {
    return res.status(403).json({ error: result.error });
  }

  res.json({ success: true, playbackState: result.state });
});

// Send chat message
app.post('/api/parties/:id/chat', (req: Request, res: Response) => {
  const { senderId, senderName, text } = req.body;
  const token = extractHostToken(req);

  const result = partyManager.addChatMessage(
    req.params.id,
    senderId || 'anon',
    senderName || 'Viewer',
    text || '',
    token
  );

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.status(201).json(result.message);
});

// Add timestamped note
app.post('/api/parties/:id/notes', (req: Request, res: Response) => {
  const { userId, userName, sourceTime, reactionTime, text } = req.body;
  const result = partyManager.addNote(
    req.params.id,
    userId || 'anon',
    userName || 'Viewer',
    parseFloat(sourceTime) || 0,
    parseFloat(reactionTime) || 0,
    text || ''
  );

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.status(201).json(result.note);
});

// Delete note (owner or host only)
app.delete('/api/parties/:id/notes/:noteId', (req: Request, res: Response) => {
  const token = extractHostToken(req);
  const userId = (req.query.userId || req.body?.userId || '').toString();

  const result = partyManager.deleteNote(req.params.id, req.params.noteId, userId, token);
  if (!result.success) {
    return res.status(403).json({ error: result.error });
  }

  res.json({ success: true });
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
