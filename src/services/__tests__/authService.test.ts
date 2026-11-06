/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentAuthProvider, AuthService } from '../authService';

test('authService: DevelopmentAuthProvider validates credentials, creates user and session token', async () => {
  const provider = new DevelopmentAuthProvider();
  assert.equal(provider.isProductionReady, false);

  // Invalid email throws
  await assert.rejects(
    () => provider.signIn({ email: 'invalid-email' }),
    /valid email/
  );

  // Valid sign up
  const session = await provider.signUp({
    email: 'creator@syncview.tv',
    name: 'Sajeer Studio',
    role: 'reactor',
  });

  assert.ok(session.token.startsWith('dev_token_'));
  assert.equal(session.user.name, 'Sajeer Studio');
  assert.equal(session.user.role, 'reactor');
  assert.equal(session.user.email, 'creator@syncview.tv');

  // Password reset returns clear development mode disclosure
  const reset = await provider.requestPasswordReset('creator@syncview.tv');
  assert.equal(reset.success, true);
  assert.match(reset.message, /development mode/);
});

test('authService: AuthService checks action permissions accurately', async () => {
  const auth = new AuthService(new DevelopmentAuthProvider());

  // Anonymous guest state
  assert.equal(auth.isAuthenticated(), false);
  const guestCheck = auth.checkActionPermission('publish_reaction');
  assert.equal(guestCheck.allowed, false);
  assert.match(guestCheck.reason || '', /Sign in/);

  // Sign in as viewer
  await auth.signIn({
    email: 'viewer@example.com',
    name: 'Viewer Bob',
    role: 'viewer',
  });
  assert.equal(auth.isAuthenticated(), true);

  // Viewer role cannot publish creator reactions without reactor role
  const viewerPublishCheck = auth.checkActionPermission('publish_reaction');
  assert.equal(viewerPublishCheck.allowed, false);
  assert.match(viewerPublishCheck.reason || '', /Reactor or Creator/);

  // Sign in as reactor
  await auth.signIn({
    email: 'creator@example.com',
    name: 'Creator Alice',
    role: 'reactor',
  });
  const creatorPublishCheck = auth.checkActionPermission('publish_reaction');
  assert.equal(creatorPublishCheck.allowed, true);

  // Sign out resets auth state
  await auth.signOut();
  assert.equal(auth.isAuthenticated(), false);
});
