import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareNetworkProcesses,
  hasActiveBandwidthLimit,
  normalizeLimiterPath,
} from './networkUsage.mjs';

test('matches active limits using normalized executable paths', () => {
  const path = 'C:\\Program Files\\Example\\App.exe';
  const rules = new Map([
    [normalizeLimiterPath(path), { enabled: true, downloadLimitBps: 1_000_000 }],
  ]);

  assert.equal(hasActiveBandwidthLimit(['c:/program files/example/app.exe'], rules), true);
  assert.equal(hasActiveBandwidthLimit(['C:\\Apps\\Other.exe'], rules), false);
});

test('limited-first prioritizes a limited process before connection count', () => {
  const processes = [
    { name: 'Browser', connections: 30, hasBandwidthLimit: false },
    { name: 'Downloader', connections: 2, hasBandwidthLimit: true },
    { name: 'Chat', connections: 5, hasBandwidthLimit: true },
  ];

  processes.sort((left, right) => compareNetworkProcesses('limited-first', left, right));

  assert.deepEqual(processes.map((process) => process.name), ['Chat', 'Downloader', 'Browser']);
});
