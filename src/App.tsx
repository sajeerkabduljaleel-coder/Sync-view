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
  } | null>(null);

  // Active reaction for Creator Studio calibration
  const [activeStudioReaction, setActiveStudioReaction] = useState<ReactionVideo | null>(null);

  // User Profile from AuthService (No hardcoded demo user!)
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(authService.getUser());
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authInitialTab, setAuthInitialTab] = useState<'signin' | 'register' | 'profile'>('signin');

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

    setTheatreState({
      active: true,
      source,
      primaryReaction: reaction,
      extraReactions: extras,
      isHost: true,
    });
  };

  const handleJoinParty = async (roomCode: string) => {
    try {
      const res = await fetch(`/api/parties/${roomCode}`);
      if (res.ok) {
        const data = await res.json();
        const party = data.room;
        setTheatreState({
          active: true,
          source: party.sourceVideo,
          primaryReaction: party.primaryReaction,
          extraReactions: party.additionalReactions || [],
          isHost: false,
          roomCode: party.roomCode,
        });
        return;
      }
    } catch {}

    // Fallback if network call fails in offline demo
    if (sources.length > 0 && reactions.length > 0) {
      setTheatreState({
        active: true,
        source: sources[0],
        primaryReaction: reactions[0],
        extraReactions: reactions.slice(1, 3),
        isHost: false,
        roomCode,
      });
    }
  };

  const handleCreateParty = async (source: VideoSource, reaction: ReactionVideo) => {
    const hostName = currentUser ? currentUser.name : 'Host';
    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${reaction.creator}'s Watch Party`,
          hostName,
          sourceId: source.id,
          reactionId: reaction.id,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTheatreState({
          active: true,
          source,
          primaryReaction: reaction,
          extraReactions: data.room.additionalReactions || [],
          isHost: true,
          roomCode: data.room.roomCode,
        });
        return;
      }
    } catch {}

    // Fallback local party code
    const mockCode = 'SYNC99';
    setTheatreState({
      active: true,
      source,
      primaryReaction: reaction,
      extraReactions: reactions.filter((r) => r.sourceId === source.id && r.id !== reaction.id).slice(0, 2),
      isHost: true,
      roomCode: mockCode,
    });
  };

  const handleSaveCalibratedReaction = async (updated: ReactionVideo) => {
    await catalogueService.saveReaction(updated);
    setReactions((prev) =>
      prev.map((r) => (r.id === updated.id ? updated : r))
    );
    setActiveStudioReaction(updated);
  };

  const handleWizardComplete = async (newReaction: ReactionVideo, _source: VideoSource) => {
    await catalogueService.saveReaction(newReaction);
    setReactions((prev) => [newReaction, ...prev]);
    setActiveStudioReaction(newReaction);
    setReactorTab('studio');
  };

  // Protected action helper
  const handleStartCreateReaction = () => {
    if (!authService.isAuthenticated()) {
      setAuthInitialTab('signin');
      setIsAuthOpen(true);
      return;
    }
    setReactorTab('create');
  };

  // If Theatre is active, it takes over the viewport for focused viewing
  if (theatreState?.active) {
    return (
      <Theatre
        sourceVideo={theatreState.source}
        primaryReaction={theatreState.primaryReaction}
        extraReactions={theatreState.extraReactions}
        isHost={theatreState.isHost}
        roomCode={theatreState.roomCode}
        onExit={() => setTheatreState(null)}
        onOpenCreatorStudio={(rx) => {
          setActiveStudioReaction(rx);
          setTheatreState(null);
          setMode('reactor');
          setReactorTab('studio');
        }}
      />
    );
  }

  const activeSourceForStudio = activeStudioReaction
    ? sources.find((s) => s.id === activeStudioReaction.sourceId) || sources[0]
    : sources[0];

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
          setAuthInitialTab(tab || (currentUser ? 'profile' : 'signin'));
          setIsAuthOpen(true);
        }}
      />

      {/* Main View Router */}
      <main className="flex-1 flex flex-col">
        {mode === 'viewer' ? (
          <>
            {viewerTab === 'home' && (
              <ViewerHome
                sources={sources}
                reactions={reactions}
                onWatch={handleWatchInTheatre}
                onJoinPartyByCode={handleJoinParty}
                onCreateParty={handleCreateParty}
                onSwitchToReactor={() => handleSwitchMode('reactor')}
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
              />
            )}
            {viewerTab === 'library' && (
              <UserLibrary
                sources={sources}
                reactions={reactions}
                onWatch={handleWatchInTheatre}
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
                  const src = sources.find((s) => s.id === rx.sourceId) || sources[0];
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
                  const src = sources.find((s) => s.id === rx.sourceId) || sources[0];
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
            {reactorTab === 'studio' && activeStudioReaction && activeSourceForStudio && (
              <CreatorStudio
                sourceVideo={activeSourceForStudio}
                reaction={activeStudioReaction}
                onSave={handleSaveCalibratedReaction}
                onBack={() => setReactorTab('home')}
                onOpenInTheatre={(rx) => {
                  const src = sources.find((s) => s.id === rx.sourceId) || sources[0];
                  handleWatchInTheatre(src, rx);
                }}
              />
            )}
          </>
        )}
      </main>

      {/* Account / Authentication Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        initialTab={authInitialTab}
        onSuccess={(user) => {
          setCurrentUser(user);
        }}
      />
    </div>
  );
}
