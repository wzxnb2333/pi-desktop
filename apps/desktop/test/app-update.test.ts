import assert from 'node:assert/strict';
import test from 'node:test';
import { checkGitHubUpdate, compareVersions } from '../src/main/app-update.ts';

test('compares release versions and reports available updates', async () => {
  assert.equal(compareVersions('v1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('preview', '1.0.0'), undefined);
  const result = await checkGitHubUpdate('1.0.0', async () => new Response(JSON.stringify({ tag_name: 'v1.2.0', html_url: 'https://github.com/wzxnb2333/pi-desktop/releases/tag/v1.2.0' }), { status: 200 }));
  assert.deepEqual(result, {
    status: 'available', currentVersion: '1.0.0', latestVersion: '1.2.0',
    url: 'https://github.com/wzxnb2333/pi-desktop/releases/tag/v1.2.0',
  });
});
