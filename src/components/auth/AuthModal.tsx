/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { UserAccount } from '../../types';
import { authService } from '../../services/authService';
import {
  User,
  Lock,
  Mail,
  Shield,
  Check,
  X,
  LogOut,
  Download,
  AlertCircle,
  KeyRound,
  Info,
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'signin' | 'register' | 'profile' | 'forgot';
  onSuccess?: (user: UserAccount) => void;
}

export function AuthModal({
  isOpen,
  onClose,
  initialTab = 'signin',
  onSuccess,
}: AuthModalProps) {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(authService.getUser());
  const [tab, setTab] = useState<'signin' | 'register' | 'profile' | 'forgot'>(
    authService.isAuthenticated() ? 'profile' : initialTab
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'viewer' | 'reactor'>('viewer');

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const providerInfo = authService.getProviderInfo();

  useEffect(() => {
    const unsub = authService.subscribe((user) => {
      setCurrentUser(user);
      if (user && tab !== 'profile') {
        // Switch to profile or close if successful
      }
    });
    return unsub;
  }, [tab]);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setNotice(null);
      if (authService.isAuthenticated()) {
        setTab('profile');
      } else {
        setTab(initialTab === 'profile' ? 'signin' : initialTab);
      }
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await authService.signIn({ email, password });
      setNotice(`Welcome back, ${user.name}!`);
      setTimeout(() => {
        onSuccess?.(user);
        onClose();
        setNotice(null);
      }, 700);
    } catch (err: any) {
      setError(err?.message || 'Failed to sign in. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await authService.signUp({ email, password, name, role });
      setNotice(`Account created successfully for ${user.name}!`);
      setTimeout(() => {
        onSuccess?.(user);
        onClose();
        setNotice(null);
      }, 700);
    } catch (err: any) {
      setError(err?.message || 'Failed to create account.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await authService.resetPassword(email);
      setNotice(result.message);
    } catch (err: any) {
      setError(err?.message || 'Failed to request password reset.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await authService.signOut();
    setNotice('You have been signed out.');
    setTab('signin');
    setTimeout(() => {
      setNotice(null);
    }, 1500);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full flex flex-col gap-4 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label="Close authentication modal"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Tab switch */}
        <div className="flex items-center gap-1.5 border-b border-slate-800 pb-2 overflow-x-auto">
          {currentUser ? (
            <button
              onClick={() => setTab('profile')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                tab === 'profile' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              My Account
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  setTab('signin');
                  setError(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  tab === 'signin' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => {
                  setTab('register');
                  setError(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  tab === 'register' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Create Account
              </button>
              <button
                onClick={() => {
                  setTab('forgot');
                  setError(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  tab === 'forgot' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Reset Password
              </button>
            </>
          )}
        </div>

        {/* Notifications / Errors */}
        {notice && (
          <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Active Provider Disclosure */}
        <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
          <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <div className="leading-snug">
            <span className="text-slate-300 font-semibold">{providerInfo.name}: </span>
            {providerInfo.isProductionReady
              ? 'Connected to production cloud identity provider.'
              : 'Local session provider active. For full multi-device persistence in production, integrate OAuth or Firebase Auth.'}
          </div>
        </div>

        {/* Profile Tab */}
        {tab === 'profile' && currentUser && (
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
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded font-semibold uppercase">
                    {currentUser.role}
                  </span>
                  <span className="text-[10px] text-slate-500">ID: {currentUser.id.slice(0, 10)}</span>
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl text-slate-300 space-y-2">
              <div className="font-semibold text-white flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-indigo-400" />
                <span>Protected Account Capabilities</span>
              </div>
              <ul className="list-disc list-inside text-[11px] text-slate-400 space-y-1">
                <li>Create and host real-time synchronized watch parties</li>
                <li>Write and moderate public timestamped notes</li>
                <li>Publish and calibrate reactions in Creator Studio</li>
                <li>Save reactions to your private library</li>
              </ul>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSignOut}
                className="flex-1 py-2 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 hover:text-white rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
              <button
                onClick={onClose}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
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
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-300 font-medium block">Password</label>
                <button
                  type="button"
                  onClick={() => setTab('forgot')}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
                >
                  Forgot?
                </button>
              </div>
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
              disabled={loading}
              className="w-full py-2.5 mt-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-semibold text-xs shadow-md shadow-indigo-600/30 cursor-pointer transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign In to SyncView'}
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
                placeholder="Your Name or Channel"
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
            <div>
              <label className="text-slate-300 font-medium block mb-1">Role Preference</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRole('viewer')}
                  className={`p-2 rounded-lg border text-xs font-medium text-center cursor-pointer transition-colors ${
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
                  className={`p-2 rounded-lg border text-xs font-medium text-center cursor-pointer transition-colors ${
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
              disabled={loading}
              className="w-full py-2.5 mt-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-semibold text-xs shadow-md shadow-indigo-600/30 cursor-pointer transition-colors"
            >
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>
        )}

        {/* Forgot Password Tab */}
        {tab === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="flex flex-col gap-3 text-xs">
            <div className="text-slate-300 text-xs">
              Enter your account email address. We will verify your identity and send recovery instructions.
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
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 mt-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-semibold text-xs shadow-md shadow-indigo-600/30 cursor-pointer transition-colors"
            >
              {loading ? 'Sending Request...' : 'Send Reset Link'}
            </button>
            <button
              type="button"
              onClick={() => setTab('signin')}
              className="text-slate-400 hover:text-white text-center mt-1 cursor-pointer"
            >
              Return to Sign In
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
