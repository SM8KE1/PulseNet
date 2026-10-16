import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSparklinePath,
  buildNetworkDownloadSegments,
  formatBandwidthLimit,
  formatBytes,
  getDefaultHosts,
  getNetworkProcessCategory,
  shouldGroupNetworkProcess,
} from './appCore.mjs';

test('returns independent default host collections', () => {
  const first = getDefaultHosts();
  const second = getDefaultHosts();
  first[0].label = 'Changed';
  assert.equal(second[0].label, 'Google DNS');
});

test('classifies user and system processes', () => {
  assert.equal(getNetworkProcessCategory({ name: 'chrome.exe' }), 'browsers');
  assert.equal(getNetworkProcessCategory({ name: 'svchost.exe' }), 'system');
  assert.equal(getNetworkProcessCategory({ name: 'telegram.exe' }), 'apps');
  assert.equal(shouldGroupNetworkProcess({ name: 'svchost.exe' }), true);
});

test('formats byte and bandwidth values', () => {
  assert.equal(formatBytes(1536), '1.50 KB');
  assert.equal(formatBandwidthLimit(2_500_000), '2.5 Mbps');
});

test('builds separate sparkline segments around missing samples', () => {
  const path = buildSparklinePath([
    { ratio: 0, value: 10 },
    { ratio: 0.5, value: Number.NaN },
    { ratio: 1, value: 20 },
  ], 100, 40, 4);
  assert.equal((path.match(/M /g) || []).length, 2);
});

test('builds normalized, non-overlapping download chart sectors from byte totals', () => {
  const segments = buildNetworkDownloadSegments([
    { id: 'large', downloadBytes: 480 },
    { id: 'second', downloadBytes: 470 },
    { id: 'small', downloadBytes: 50 },
  ]);
  assert.deepEqual(segments.map(({ share }) => share), [0.48, 0.47, 0.05]);
  assert.ok(segments.every(({ path }) => path.startsWith('M ') && path.endsWith(' Z')));
  assert.deepEqual(buildNetworkDownloadSegments([{ downloadBytes: 0 }]), []);
});
