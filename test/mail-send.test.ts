// The outbound path is the one place this repo can email a stranger, so its guard is pinned here:
// a non-loopback SMTP host must be refused before any transport is built.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { smtpSender } from '../src/mail-send.js';

test('a remote SMTP host is refused: the sandbox may only deliver locally', () => {
  assert.throws(
    () => smtpSender({ endpoint: 'smtp.example.com:587' }),
    /SANDBOX_SMTP_NOT_LOOPBACK/,
  );
});

test('the override is explicit, never implied by an address', () => {
  assert.doesNotThrow(() => smtpSender({ endpoint: 'smtp.example.com:587', allowRemote: true }));
});

test('a loopback endpoint builds a transport without connecting', () => {
  assert.doesNotThrow(() => smtpSender({ endpoint: '127.0.0.1:1025' }));
  assert.doesNotThrow(() => smtpSender({ endpoint: 'localhost:1025' }));
});
