/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { UserAccount } from '../../types';
import { User, Lock, Mail, Shield, Check, X, LogOut, Download } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserAccount;
  onUpdateUser: (user: UserAccount) => void;
}

export function AuthModal({
  isOpen,
  onClose,
  currentUser,
  onUpdateUser,
}: AuthModalProps) {
  const [tab, setTab] = useState<'signin' | 'register' | 'profile'>('profile');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(currentUser.name);
  const [role, setRole] = useState<'viewer' | 'reactor'>(currentUser.role === 'reactor' ? 'reactor' : 'viewer');
  const [notice, setNotice] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    const updated: UserAccount = {
      ...currentUser,
      email: email.trim(),
      name: email.split('@')[0] || 'User',
      role,
    };
    onUpdateUser(updated);
    setNotice('Signed in successfully! Prototype session active.');
    setTimeout(() => {
      onClose();
      setNotice(null);
    }, 900);
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !name.trim()) return;
    const updated: UserAccount = {
      ...currentUser,
      email: email.trim(),
      name: name.trim(),
      role,
    };
    onUpdateUser(updated);
    setNotice('Account registered! Session ready.');
    setTimeout(() => {
      onClose();
      setNotice(null);
    }, 900);
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full flex flex-col gap-4 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Tab switch */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setTab('profile')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              tab === 'profile' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            My Profile
          </button>
          <button
            onClick={() => setTab('signin')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              tab === 'signin' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => setTab('register')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              tab === 'register' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Create Account
          </button>
        </div>

        {notice && (
          <div className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>{notice}</span>
          </div>
        )}

        {/* Profile Tab */}
        {tab === 'profile' && (
          <div className="flex flex-col gap-4 text-xs">
            <div className="flex items-center gap-3 p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
              <img
                src={currentUser.avatar}
                alt=""
                className="w-12 h-12 rounded-full object-cover ring-2 ring-indigo-500"
              />
              <div className="flex flex-col">
                <span className="font-bold text-white text-sm">{currentUser.name}</span>
                <span className="text-slate-400">{currentUser.email}</span>
                <span className="text-[10px] text-indigo-400 font-semibold uppercase mt-0.5">
                  Role: {currentUser.role}
                </span>
              </div>
            </div>

            <div className="p-3 bg-indigo-950/20 border border-indigo-500/20 rounded-xl text-slate-300 space-y-1.5">
              <div className="font-semibold text-white">Production Authentication Integration:</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                SyncView is configured with client-side prototype sessions for seamless testing.
                When published to production, actions requiring authentication include:
              </p>
              <ul className="list-disc list-inside text-[11px] text-slate-400 space-y-0.5">
                <li>Publishing and monetizing reaction videos</li>
                <li>Persistent cloud watch-party host keys</li>
                <li>Public timestamped community notes moderation</li>
              </ul>
            </div>

            <div className="pt-2">
              <a
                href="/api/download-source"
                download="syncview-source.zip"
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-indigo-300 hover:text-white rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <Download className="w-4 h-4 text-indigo-400" />
                <span>Download Source Code (.zip)</span>
              </a>
            </div>

            <button
              onClick={onClose}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        )}

        {/* Sign In Tab */}
        {tab === 'signin' && (
          <form onSubmit={handleSignIn} className="flex flex-col gap-3 text-xs">
            <div>
              <label className="text-slate-300 font-medium block mb-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-slate-300 font-medium block mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 mt-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold text-xs shadow-md shadow-indigo-600/30"
            >
              Sign In to SyncView
            </button>
          </form>
        )}

        {/* Register Tab */}
        {tab === 'register' && (
          <form onSubmit={handleRegister} className="flex flex-col gap-3 text-xs">
            <div>
              <label className="text-slate-300 font-medium block mb-1">Display Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your Name / Channel"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-slate-300 font-medium block mb-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-slate-300 font-medium block mb-1">Primary Role</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRole('viewer')}
                  className={`p-2 rounded-lg border text-xs font-medium text-center ${
                    role === 'viewer'
                      ? 'bg-indigo-600/20 border-indigo-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  Viewer
                </button>
                <button
                  type="button"
                  onClick={() => setRole('reactor')}
                  className={`p-2 rounded-lg border text-xs font-medium text-center ${
                    role === 'reactor'
                      ? 'bg-indigo-600/20 border-indigo-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  Reactor / Creator
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 mt-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold text-xs shadow-md shadow-indigo-600/30"
            >
              Create Account
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
