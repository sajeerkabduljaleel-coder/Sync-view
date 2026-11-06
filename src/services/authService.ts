/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserAccount } from '../types';

export interface AuthSession {
  token: string;
  user: UserAccount;
  expiresAt: number;
}

export interface AuthCredentials {
  email: string;
  password?: string;
  name?: string;
  role?: 'viewer' | 'reactor';
}

export interface IAuthProvider {
  readonly id: string;
  readonly name: string;
  readonly isProductionReady: boolean;
  signIn(credentials: AuthCredentials): Promise<AuthSession>;
  signUp(credentials: AuthCredentials): Promise<AuthSession>;
  signOut(token: string): Promise<void>;
  restoreSession(token?: string): Promise<UserAccount | null>;
  requestPasswordReset(email: string): Promise<{ success: boolean; message: string }>;
}

/**
 * Development & Prototype Authentication Provider.
 * Stores session tokens locally in browser storage without simulating fake cloud security.
 * Clearly documents that production environments require OAuth or Firebase Auth.
 */
export class DevelopmentAuthProvider implements IAuthProvider {
  public readonly id = 'dev-local';
  public readonly name = 'Development Local Provider';
  public readonly isProductionReady = false;

  private storageKey = 'syncview_dev_auth_session';

  public async signIn(credentials: AuthCredentials): Promise<AuthSession> {
    if (!credentials.email || !credentials.email.includes('@')) {
      throw new Error('A valid email address is required.');
    }

    const emailPrefix = credentials.email.split('@')[0];
    const user: UserAccount = {
      id: `usr_${btoa(credentials.email).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`,
      name: credentials.name || emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1),
      email: credentials.email.toLowerCase().trim(),
      role: credentials.role || 'viewer',
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(credentials.email)}`,
      savedReactions: ['rx-scifi-marcus', 'rx-gaming-leo'],
      recentHistory: [],
      drafts: [],
    };

    const session: AuthSession = {
      token: `dev_token_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
      user,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
    };

    try {
      localStorage.setItem(this.storageKey, JSON.stringify(session));
    } catch {}

    return session;
  }

  public async signUp(credentials: AuthCredentials): Promise<AuthSession> {
    if (!credentials.name || credentials.name.trim().length < 2) {
      throw new Error('Name must be at least 2 characters.');
    }
    return this.signIn(credentials);
  }

  public async signOut(_token: string): Promise<void> {
    try {
      localStorage.removeItem(this.storageKey);
    } catch {}
  }

  public async restoreSession(token?: string): Promise<UserAccount | null> {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return null;
      const session: AuthSession = JSON.parse(stored);
      if (Date.now() > session.expiresAt) {
        localStorage.removeItem(this.storageKey);
        return null;
      }
      if (token && session.token !== token) {
        return null;
      }
      return session.user;
    } catch {
      return null;
    }
  }

  public async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    if (!email || !email.includes('@')) {
      throw new Error('Enter a valid email address.');
    }
    // Transparently disclose that cloud auth/SMTP is required for live password emails
    return {
      success: true,
      message: `Password reset request received for ${email}. (Note: In development mode, email dispatch requires a configured OAuth or Firebase provider).`,
    };
  }
}

/**
 * Singleton authentication service orchestrating sessions, permissions, and listeners.
 */
export class AuthService {
  private provider: IAuthProvider;
  private currentUser: UserAccount | null = null;
  private sessionToken: string | null = null;
  private listeners: Set<(user: UserAccount | null) => void> = new Set();
  private isInitialized = false;

  constructor(provider: IAuthProvider = new DevelopmentAuthProvider()) {
    this.provider = provider;
  }

  public setProvider(provider: IAuthProvider): void {
    this.provider = provider;
    this.init();
  }

  public getProviderInfo() {
    return {
      id: this.provider.id,
      name: this.provider.name,
      isProductionReady: this.provider.isProductionReady,
    };
  }

  public async init(): Promise<UserAccount | null> {
    if (this.isInitialized && this.currentUser) {
      return this.currentUser;
    }
    try {
      const savedToken = localStorage.getItem('syncview_active_token') || undefined;
      const restored = await this.provider.restoreSession(savedToken);
      this.currentUser = restored;
      this.isInitialized = true;
      this.notify();
      return restored;
    } catch {
      this.currentUser = null;
      this.isInitialized = true;
      this.notify();
      return null;
    }
  }

  public getUser(): UserAccount | null {
    return this.currentUser;
  }

  public isAuthenticated(): boolean {
    return this.currentUser !== null;
  }

  public getToken(): string | null {
    return this.sessionToken || localStorage.getItem('syncview_active_token');
  }

  public async signIn(credentials: AuthCredentials): Promise<UserAccount> {
    const session = await this.provider.signIn(credentials);
    this.currentUser = session.user;
    this.sessionToken = session.token;
    try {
      localStorage.setItem('syncview_active_token', session.token);
    } catch {}
    this.notify();
    return session.user;
  }

  public async signUp(credentials: AuthCredentials): Promise<UserAccount> {
    const session = await this.provider.signUp(credentials);
    this.currentUser = session.user;
    this.sessionToken = session.token;
    try {
      localStorage.setItem('syncview_active_token', session.token);
    } catch {}
    this.notify();
    return session.user;
  }

  public async signOut(): Promise<void> {
    if (this.sessionToken) {
      await this.provider.signOut(this.sessionToken);
    }
    this.currentUser = null;
    this.sessionToken = null;
    try {
      localStorage.removeItem('syncview_active_token');
    } catch {}
    this.notify();
  }

  public async resetPassword(email: string): Promise<{ success: boolean; message: string }> {
    return this.provider.requestPasswordReset(email);
  }

  public subscribe(listener: (user: UserAccount | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentUser);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Protected action checks. Returns true if authorized, false otherwise.
   */
  public checkActionPermission(action: 'publish_reaction' | 'manage_drafts' | 'create_persistent_party' | 'edit_reaction'): {
    allowed: boolean;
    reason?: string;
  } {
    if (!this.isAuthenticated()) {
      return {
        allowed: false,
        reason: 'Sign in to access creator publishing, drafts, and persistent rooms.',
      };
    }

    if ((action === 'publish_reaction' || action === 'manage_drafts') && this.currentUser?.role !== 'reactor' && this.currentUser?.role !== 'admin') {
      return {
        allowed: false,
        reason: 'Reactor or Creator account privileges required. You can switch your account role in settings.',
      };
    }

    return { allowed: true };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.currentUser);
    }
  }
}

export const authService = new AuthService();
