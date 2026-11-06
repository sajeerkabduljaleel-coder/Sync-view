/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { VideoSource, ReactionVideo, UserAccount } from './types';
import { SAMPLE_SOURCES, SAMPLE_REACTIONS } from './data/mockCatalogue';
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
  const [mode, setMode] = useState<'viewer' | 'reactor'>('viewer');
  const [viewerTab, setViewerTab] = useState<'home' | 'explore' | 'parties' | 'library'>('home');
  const [reactorTab, setReactorTab] = useState<'home' | 'my-reactions' | 'create' | 'studio'>('home');

  // App Content state
  const [sources, setSources] = useState<VideoSource[]>(SAMPLE_SOURCES);
  const [reactions, setReactions] = useState<ReactionVideo[]>(SAMPLE_REACTIONS);

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
  const [activeStudioReaction, setActiveStudioReaction] = useState<ReactionVideo>(SAMPLE_REACTIONS[0]);

  // User Profile
  const [currentUser, setCurrentUser] = useState<UserAccount>({
    id: 'user-default-1',
    name: 'Sajeer',
    email: 'sajeer@syncview.tv',
    role: 'viewer',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
    savedReactions: ['rx-scifi-marcus', 'rx-gaming-leo'],
    recentHistory: [],
    drafts: [],
  });

  const [isAuthOpen, setIsAuthOpen] = useState(false);

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
    setTheatreState({
      active: true,
      source: sources[0],
      primaryReaction: reactions[0],
      extraReactions: reactions.slice(1, 3),
      isHost: false,
      roomCode,
    });
  };

  const handleCreateParty = async (source: VideoSource, reaction: ReactionVideo) => {
    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${reaction.creator}'s Watch Party`,
          hostName: currentUser.name,
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

  const handleSaveCalibratedReaction = (updated: ReactionVideo) => {
    setReactions((prev) =>
      prev.map((r) => (r.id === updated.id ? updated : r))
    );
    setActiveStudioReaction(updated);
  };

  const handleWizardComplete = (newReaction: ReactionVideo, source: VideoSource) => {
    setReactions((prev) => [newReaction, ...prev]);
    // Prompt into studio or theatre
    setActiveStudioReaction(newReaction);
    setReactorTab('studio');
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

  const activeSourceForStudio =
    sources.find((s) => s.id === activeStudioReaction.sourceId) || sources[0];

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Navigation */}
      <Navigation
        currentMode={mode}
        onSwitchMode={(newMode) => {
          setMode(newMode);
          if (newMode === 'viewer') setViewerTab('home');
          else setReactorTab('home');
        }}
        viewerTab={viewerTab}
        onSelectViewerTab={(tab) => setViewerTab(tab)}
        reactorTab={reactorTab}
        onSelectReactorTab={(tab) => setReactorTab(tab)}
        currentUser={currentUser}
        onOpenAuth={() => setIsAuthOpen(true)}
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
                onSwitchToReactor={() => {
                  setMode('reactor');
                  setReactorTab('home');
                }}
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
                onStartCreate={() => setReactorTab('create')}
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
                onStartCreate={() => setReactorTab('create')}
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
            {reactorTab === 'studio' && (
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
        currentUser={currentUser}
        onUpdateUser={(updated) => setCurrentUser(updated)}
      />
    </div>
  );
}
