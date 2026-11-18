/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { VideoSource, ReactionVideo, UserAccount } from './types';
import { catalogueService } from './services/catalogueService';
import { authService } from './services/authService';
import { Navigation } from './components/Navigation';
import { ViewerHome } from './components/viewer/ViewerHome';
import { ExploreView } from './components/viewer/ExploreView';
import { WatchPartiesList } from './components/viewer/WatchPartiesList';
import { UserLibrary } from './components/viewer/UserLibrary';
import { ReactorHome } from './components/reactor/ReactorHome';
import { ReactionWizard } from './components/reactor/ReactionWizard';
import { CreatorStudio } from './components/reactor/CreatorStudio';
import { Theatre } from './components/theatre/Theatre';
import { AuthModal } from './components/auth/AuthModal';
import { AlertCircle, RefreshCw, Play, X } from 'lucide-react';

export default function App() {
  // Mode persistence (Viewer vs Reactor)
  const [mode, setMode] = useState<'viewer' | 'reactor'>(() => {
    try {
      const saved = localStorage.getItem('syncview_active_mode');
      return saved === 'reactor' ? 'reactor' : 'viewer';
    } catch {
      return 'viewer';
    }
  });

  const [viewerTab, setViewerTab] = useState<'home' | 'explore' | 'parties' | 'library'>('home');
  const [reactorTab, setReactorTab] = useState<'home' | 'my-reactions' | 'create' | 'studio'>('home');

  // App Content state loaded from CatalogueService
  const [sources, setSources] = useState<VideoSource[]>([]);
  const [reactions, setReactions] = useState<ReactionVideo[]>([]);

  // Theatre modal/screen state
  const [theatreState, setTheatreState] = useState<{
    active: boolean;
    source: VideoSource;
    primaryReaction: ReactionVideo;
    extraReactions: ReactionVideo[];
    isHost?: boolean;
    roomCode?: string;
    hostToken?: string;
    participantToken?: string;
  } | null>(null);

  // Watch party creation & join error states
  const [partyCreationError, setPartyCreationError] = useState<{
    message: string;
    source: VideoSource;
    reaction: ReactionVideo;
  } | null>(null);
  const [joinPartyError, setJoinPartyError] = useState<string | null>(null);
  const [isCreatingParty, setIsCreatingParty] = useState(false);

  // Active reaction for Creator Studio calibration
  const [activeStudioReaction, setActiveStudioReaction] = useState<ReactionVideo | null>(null);

  // User Profile from AuthService (No hardcoded demo user!)
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(authService.getUser());
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authInitialTab, setAuthInitialTab] = useState<'signin' | 'register' | 'profile'>('signin');
  const [pendingCreateAfterAuth, setPendingCreateAfterAuth] = useState(false);

  const readPartyCreds = (
    code: string
  ): { hostToken?: string; participantToken?: string } => {
    try {
      const raw = sessionStorage.getItem(`syncview_party_creds_${code.toUpperCase()}`);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return {
        hostToken: typeof parsed.hostToken === 'string' ? parsed.hostToken : undefined,
        participantToken:
          typeof parsed.participantToken === 'string' ? parsed.participantToken : undefined,
      };
    } catch {
      return {};
    }
  };

  const writePartyCreds = (
    code: string,
    creds: { hostToken?: string; participantToken?: string }
  ) => {
    try {
      sessionStorage.setItem(
        `syncview_party_creds_${code.toUpperCase()}`,
        JSON.stringify(creds)
      );
    } catch {}
  };

  const resolveSourceForReaction = (rx: ReactionVideo): VideoSource => {
    const found = sources.find((s) => s.id === rx.sourceId);
    if (found) return found;
    return {
      id: rx.sourceId || 'src-custom',
      title: 'Original Source Content',
      creator: 'Creator',
      duration: rx.duration || 300,
      url: '',
      thumbnail: rx.thumbnail || '',
      category: 'Movies & TV',
      description: 'Synchronized stream source',
    };
  };

  // Initialize Auth & Catalogue
  useEffect(() => {
    // Session restoration
    authService.init().then((user) => {
      setCurrentUser(user);
    });

    const unsub = authService.subscribe((user) => {
      setCurrentUser(user);
    });

    // Catalogue loading
    const loadCatalogue = async () => {
      const [srcs, rxs] = await Promise.all([
        catalogueService.getSources(),
        catalogueService.getReactions(),
      ]);
      setSources(srcs);
      setReactions(rxs);
      if (rxs.length > 0) {
        setActiveStudioReaction(rxs[0]);
      }
    };
    loadCatalogue();

    return unsub;
  }, []);

  // Persist Mode Changes
  const handleSwitchMode = (newMode: 'viewer' | 'reactor') => {
    setMode(newMode);
    try {
      localStorage.setItem('syncview_active_mode', newMode);
    } catch {}
    if (newMode === 'viewer') setViewerTab('home');
    else setReactorTab('home');
  };

  // Actions
  const handleWatchInTheatre = (
    source: VideoSource,
    reaction: ReactionVideo,
    extraReactions: ReactionVideo[] = []
  ) => {
    // If no extra reactions passed, auto-find other reactors reacting to the same source
    const extras =
      extraReactions.length > 0
        ? extraReactions
        : reactions.filter((r) => r.sourceId === source.id && r.id !== reaction.id).slice(0, 3);

    setJoinPartyError(null);
    setTheatreState({
      active: true,
      source,
      primaryReaction: reaction,
      extraReactions: extras,
      isHost: true,
    });
    setMode('viewer');
    setViewerTab('home');
  };

  const handleJoinParty = async (rawCode: string) => {
    const roomCode = rawCode.trim().toUpperCase();
    if (!roomCode) {
      setJoinPartyError('Please enter a valid Watch Party room code.');
      return;
    }

    setJoinPartyError(null);
    const participantName = currentUser ? currentUser.name : 'Guest Viewer';
    const existingCreds = readPartyCreds(roomCode);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (existingCreds.participantToken) {
        headers['x-participant-token'] = existingCreds.participantToken;
      }

      const joinRes = await fetch(`/api/parties/${roomCode}/join`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ participantName }),
      });

      const data = await joinRes.json().catch(() => ({}));
      if (joinRes.ok && data.room) {
        const party = data.room;
        const participantToken = data.participantToken || existingCreds.participantToken;
        const hostToken = existingCreds.hostToken;
        writePartyCreds(party.roomCode, { hostToken, participantToken });

        setTheatreState({
          active: true,
          source: party.sourceVideo,
          primaryReaction: party.primaryReaction,
          extraReactions: party.additionalReactions || [],
          isHost: Boolean(hostToken),
          roomCode: party.roomCode,
          hostToken,
          participantToken,
        });
        setMode('viewer');
        setViewerTab('home');
        return;
      }

      setJoinPartyError(
        data.error || `Watch party room "${roomCode}" was not found or has expired.`
      );
    } catch {
      setJoinPartyError(
        `Network error while attempting to join Watch Party "${roomCode}".`
      );
    }
  };

  const handleCreateParty = async (
    source: VideoSource,
    reaction: ReactionVideo,
    extraReactions: ReactionVideo[] = [],
    customTitle?: string
  ) => {
    setIsCreatingParty(true);
    setPartyCreationError(null);
    setJoinPartyError(null);
    const hostName = currentUser ? currentUser.name : 'Host';

    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: customTitle?.trim() || `${reaction.creator}'s Watch Party`,
          hostName,
          sourceId: source.id,
          reactionId: reaction.id,
          source,
          reaction,
          additionalReactions: extraReactions,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const createdRoomCode = data.room?.roomCode;
        if (createdRoomCode) {
          writePartyCreds(createdRoomCode, {
            hostToken: data.hostToken,
            participantToken: data.participantToken,
          });
        }
        setTheatreState({
          active: true,
          source: data.room?.sourceVideo || source,
          primaryReaction: data.room?.primaryReaction || reaction,
          extraReactions: data.room?.additionalReactions || extraReactions,
          isHost: true,
          roomCode: createdRoomCode,
          hostToken: data.hostToken,
          participantToken: data.participantToken,
        });
        setMode('viewer');
        setViewerTab('home');
        return;
      }
      const errData = await res.json().catch(() => ({}));
      const errorMsg =
        errData.error || `Unable to establish watch party room on server (HTTP ${res.status}).`;
      setPartyCreationError({
        message: errorMsg,
        source,
        reaction,
      });
    } catch (err: any) {
      setPartyCreationError({
        message:
          err?.message || 'Network connection failed while attempting to create watch party.',
        source,
        reaction,
      });
    } finally {
      setIsCreatingParty(false);
    }
  };

  const handleSaveCalibratedReaction = async (updated: ReactionVideo) => {
    await catalogueService.saveReaction(updated);
    setReactions((prev) =>
      prev.map((r) => (r.id === updated.id ? updated : r))
    );
    setActiveStudioReaction(updated);
  };

  const handleWizardComplete = async (newReaction: ReactionVideo, newSource: VideoSource) => {
    await Promise.all([
      catalogueService.saveSource(newSource),
      catalogueService.saveReaction(newReaction),
    ]);
    setSources((prev) => [newSource, ...prev.filter((s) => s.id !== newSource.id)]);
    setReactions((prev) => [newReaction, ...prev.filter((r) => r.id !== newReaction.id)]);
    setActiveStudioReaction(newReaction);
    setReactorTab('studio');
  };

  // Protected action helper
  const handleStartCreateReaction = () => {
    if (!authService.isAuthenticated()) {
      setPendingCreateAfterAuth(true);
      setAuthInitialTab('signin');
      setIsAuthOpen(true);
      return;
    }
    setReactorTab('create');
  };

  const activeSourceForStudio = activeStudioReaction
    ? resolveSourceForReaction(activeStudioReaction)
    : sources[0] || null;

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Navigation */}
      <Navigation
        currentMode={mode}
        onSwitchMode={handleSwitchMode}
        viewerTab={viewerTab}
        onSelectViewerTab={(tab) => setViewerTab(tab)}
        reactorTab={reactorTab}
        onSelectReactorTab={(tab) => setReactorTab(tab)}
        currentUser={currentUser}
        onOpenAuth={(tab) => {
          setPendingCreateAfterAuth(false);
          setAuthInitialTab(tab || (currentUser ? 'profile' : 'signin'));
          setIsAuthOpen(true);
        }}
      />

      {/* Main View Router */}
      <main className="flex-1 flex flex-col">
        {mode === 'viewer' ? (
          <>
            {viewerTab === 'home' && (
              <Theatre
                sourceVideo={theatreState?.source || null}
                primaryReaction={theatreState?.primaryReaction || null}
                extraReactions={theatreState?.extraReactions || []}
                isHost={theatreState?.isHost ?? true}
                roomCode={theatreState?.roomCode}
                hostToken={theatreState?.hostToken}
                participantToken={theatreState?.participantToken}
                onExit={() => setTheatreState(null)}
                onOpenCreatorStudio={(rx) => {
                  setActiveStudioReaction(rx);
                  setTheatreState(null);
                  setMode('reactor');
                  setReactorTab('studio');
                }}
                onStreamsChanged={(config) => {
                  setTheatreState({
                    active: true,
                    source: config.source,
                    primaryReaction: config.primaryReaction,
                    extraReactions: config.extraReactions,
                    isHost: true,
                  });
                }}
                onJoinPartyByCode={handleJoinParty}
                onCreateParty={handleCreateParty}
                joinPartyError={joinPartyError}
                onClearJoinPartyError={() => setJoinPartyError(null)}
              />
            )}
            {viewerTab === 'explore' && (
              <ExploreView
                sources={sources}
                reactions={reactions}
                onWatch={handleWatchInTheatre}
              />
            )}
            {viewerTab === 'parties' && (
              <WatchPartiesList
                sources={sources}
                reactions={reactions}
                onJoinRoom={handleJoinParty}
                onCreateParty={handleCreateParty}
                joinError={joinPartyError}
                onClearJoinError={() => setJoinPartyError(null)}
              />
            )}
            {viewerTab === 'library' && (
              <UserLibrary
                sources={sources}
                reactions={reactions}
                onWatch={handleWatchInTheatre}
                onOpenStreamChooser={() => {
                  setViewerTab('home');
                  setTheatreState(null);
                }}
              />
            )}
          </>
        ) : (
          <>
            {reactorTab === 'home' && (
              <ReactorHome
                reactions={reactions}
                sources={sources}
                onStartCreate={handleStartCreateReaction}
                onOpenStudio={(rx) => {
                  setActiveStudioReaction(rx);
                  setReactorTab('studio');
                }}
                onOpenTheatre={(rx) => {
                  const src = resolveSourceForReaction(rx);
                  handleWatchInTheatre(src, rx);
                }}
              />
            )}
            {reactorTab === 'my-reactions' && (
              <ReactorHome
                reactions={reactions}
                sources={sources}
                onStartCreate={handleStartCreateReaction}
                onOpenStudio={(rx) => {
                  setActiveStudioReaction(rx);
                  setReactorTab('studio');
                }}
                onOpenTheatre={(rx) => {
                  const src = resolveSourceForReaction(rx);
                  handleWatchInTheatre(src, rx);
                }}
              />
            )}
            {reactorTab === 'create' && (
              <ReactionWizard
                onComplete={handleWizardComplete}
                onCancel={() => setReactorTab('home')}
              />
            )}
            {reactorTab === 'studio' && (
              activeStudioReaction && activeSourceForStudio ? (
                <CreatorStudio
                  key={activeStudioReaction.id}
                  sourceVideo={activeSourceForStudio}
                  reaction={activeStudioReaction}
                  onSave={handleSaveCalibratedReaction}
                  onBack={() => setReactorTab('home')}
                  onOpenInTheatre={(rx) => {
                    const src = resolveSourceForReaction(rx);
                    handleWatchInTheatre(src, rx);
                  }}
                />
              ) : (
                <div className="max-w-xl mx-auto my-12 p-6 bg-slate-900/70 border border-slate-800 rounded-2xl text-center flex flex-col items-center gap-3">
                  <AlertCircle className="w-8 h-8 text-indigo-400" />
                  <h3 className="text-base font-bold text-white">No Reaction Selected for Studio</h3>
                  <p className="text-xs text-slate-400">
                    Create a new reaction or pick an existing reaction from Creator Home to calibrate timing anchors and chapters.
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => setReactorTab('home')}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200"
                    >
                      Back to Creator Home
                    </button>
                    <button
                      onClick={handleStartCreateReaction}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
                    >
                      Create Reaction
                    </button>
                  </div>
                </div>
              )
            )}
          </>
        )}
      </main>

      {/* Account / Authentication Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => {
          setIsAuthOpen(false);
          setPendingCreateAfterAuth(false);
        }}
        initialTab={authInitialTab}
        onSuccess={(user) => {
          setCurrentUser(user);
          if (pendingCreateAfterAuth) {
            setPendingCreateAfterAuth(false);
            setMode('reactor');
            setReactorTab('create');
          }
        }}
      />

      {/* Watch Party Creation Error Modal */}
      {partyCreationError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Party Creation Failed</h3>
                  <p className="text-xs text-zinc-400">Server could not initialize synchronized room</p>
                </div>
              </div>
              <button
                onClick={() => setPartyCreationError(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800 text-sm text-zinc-300">
              <p className="font-medium text-red-300 mb-1">Reason:</p>
              <p className="text-xs text-zinc-400 leading-relaxed">{partyCreationError.message}</p>
            </div>

            <div className="text-xs text-zinc-400 bg-zinc-800/40 p-3 rounded-lg border border-zinc-800">
              <span className="text-zinc-300 font-semibold">Preserved Selection:</span>{' '}
              {partyCreationError.source.title} + {partyCreationError.reaction.creator}&apos;s reaction
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <button
                onClick={() => {
                  const { source, reaction } = partyCreationError;
                  handleCreateParty(source, reaction);
                }}
                disabled={isCreatingParty}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition"
              >
                <RefreshCw className={`w-4 h-4 ${isCreatingParty ? 'animate-spin' : ''}`} />
                Retry Room Creation
              </button>

              <button
                onClick={() => {
                  const { source, reaction } = partyCreationError;
                  setTheatreState({
                    active: true,
                    source,
                    primaryReaction: reaction,
                    extraReactions: [],
                    isHost: true,
                    roomCode: undefined,
                  });
                  setPartyCreationError(null);
                  setMode('viewer');
                  setViewerTab('home');
                }}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium rounded-xl transition"
              >
                <Play className="w-4 h-4 text-emerald-400" />
                Watch Privately
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
