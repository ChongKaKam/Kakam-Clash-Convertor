import test from 'node:test';
import assert from 'node:assert/strict';
import { profileUrl } from '../public/urls.js';

test('iOS subscription disables Clash Mi rule overwrite', () => {
  const item = { publicToken: 'public-token' };
  assert.equal(profileUrl('https://sub.example', item, 'ios'),
    'https://sub.example/sub/public-token/ios.yaml?overwrite=false');
  assert.equal(profileUrl('https://sub.example', item, 'tvos'),
    'https://sub.example/sub/public-token/tvos.yaml');
  assert.equal(profileUrl('https://sub.example', item, 'android'),
    'https://sub.example/sub/public-token/android.yaml');
});
