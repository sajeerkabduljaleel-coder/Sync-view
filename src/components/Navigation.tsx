/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { UserAccount } from '../types';
import {
  Film,
  Compass,
  Users,
  Bookmark,
  Plus,
  Sliders,
  User,
  Tv,
  Sparkles,
  Layers,
  Download,
  LogIn,
} from 'lucide-react';

interface NavigationProps {
  currentMode: 'viewer' | 'reactor';
  onSwitchMode: (mode: 'viewer' | 'reactor') => void;
  viewerTab: 'home' | 'explore' | 'parties' | 'library';
  onSelectViewerTab: (tab: 'home' | 'explore' | 'parties' | 'library') => void;
  reactorTab: 'home' | 'my-reactions' | 'create' | 'studio';
  onSelectReactorTab: (tab: 'home' | 'my-reactions' | 'create' | 'studio') => void;
  currentUser: UserAccount | null;
  onOpenAuth: (initialTab?: 'signin' | 'register' | 'profile') => void;
}

export function Navigation({
  currentMode,
  onSwitchMode,
  viewerTab,
  onSelectViewerTab,
  reactorTab,
  onSelectReactorTab,
  currentUser,
  onOpenAuth,
}: NavigationProps) {
  return (
    <header className="sticky top-0 z-40 bg-slate-950/85 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-6 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Left: Brand Logo & Mode Switcher */}
        <div className="flex items-center gap-4">
          <div
            onClick={() => {
              if (currentMode === 'viewer') onSelectViewerTab('home');
              else onSelectReactorTab('home');
            }}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 group-hover:scale-105 transition-transform">
              <Tv className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-base tracking-tight text-white flex items-center gap-1">
                SyncView
              </span>
              <span className="text-[9px] tracking-wider uppercase font-semibold text-indigo-400 -mt-1">
                Synced Reactions
              </span>
            </div>
          </div>

          {/* Mode Switcher Pill */}
          <div className="flex items-center bg-slate-900 border border-slate-800 p-0.5 rounded-full text-xs font-semibold ml-2">
            <button
              onClick={() => onSwitchMode('viewer')}
              className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
                currentMode === 'viewer'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Viewer
            </button>
            <button
              onClick={() => onSwitchMode('reactor')}
              className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
                currentMode === 'reactor'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Reactor
            </button>
          </div>
        </div>

        {/* Center: Navigation Links for Active Mode */}
        <nav className="hidden md:flex items-center gap-1 text-xs font-medium">
          {currentMode === 'viewer' ? (
            <>
              <button
                onClick={() => onSelectViewerTab('home')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  viewerTab === 'home'
                    ? 'text-white bg-slate-900 border border-slate-800 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Tv className="w-3.5 h-3.5 text-indigo-400" />
                <span>Viewing Canvas</span>
              </button>
              <button
                onClick={() => onSelectViewerTab('library')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  viewerTab === 'library'
                    ? 'text-white bg-slate-900 border border-slate-800 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5 text-slate-400" />
                <span>My Streams</span>
              </button>
              <button
                onClick={() => onSelectViewerTab('parties')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  viewerTab === 'parties'
                    ? 'text-white bg-slate-900 border border-slate-800 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-purple-400" />
                <span>Watch Parties</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onSelectReactorTab('home')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  reactorTab === 'home'
                    ? 'text-white bg-slate-900 border border-slate-800 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Creator Home
              </button>
              <button
                onClick={() => onSelectReactorTab('my-reactions')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  reactorTab === 'my-reactions'
                    ? 'text-white bg-slate-900 border border-slate-800 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                My Reactions
              </button>
              <button
                onClick={() => onSelectReactorTab('create')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  reactorTab === 'create'
                    ? 'text-white bg-slate-900 border border-slate-800 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span>Create Reaction</span>
              </button>
              <button
                onClick={() => onSelectReactorTab('studio')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  reactorTab === 'studio'
                    ? 'text-white bg-slate-900 border border-slate-800 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                <span>Creator Studio</span>
              </button>
            </>
          )}
        </nav>

        {/* Right: Download Source & User Profile or Sign In */}
        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href="/api/download-source"
            download="syncview-source.zip"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-semibold text-indigo-300 hover:text-indigo-200 transition-colors shadow-sm"
            title="Download full project source code as zip"
          >
            <Download className="w-3.5 h-3.5 text-indigo-400" />
            <span>Download Source</span>
          </a>

          {currentUser ? (
            <button
              onClick={() => onOpenAuth('profile')}
              className="flex items-center gap-2 p-1.5 px-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
              title="Account & Profile Settings"
            >
              <img
                src={currentUser.avatar}
                alt=""
                className="w-6 h-6 rounded-full object-cover ring-1 ring-slate-700"
              />
              <span className="text-xs font-semibold text-slate-200 hidden sm:inline">
                {currentUser.name}
              </span>
            </button>
          ) : (
            <button
              onClick={() => onOpenAuth('signin')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
