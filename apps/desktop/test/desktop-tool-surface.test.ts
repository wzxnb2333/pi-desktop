import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopToolCatalog, desktopToolCatalogFor, forbiddenDesktopFields, forbiddenDesktopOps, implementedDesktopWave } from '../src/shared/desktop-tools.ts';
import { desktopToolSchema } from '../src/shared/worker-protocol.ts';
import { manageMessagesToolSchema, manageProjectsToolSchema, manageSessionsToolSchema, manageUiToolSchema, readSessionsToolSchema, sendToSessionToolSchema } from '../src/shared/session-tools.ts';
import { allowedSettingsKeys, deniedSettingsKeys, manageSettingsToolSchema } from '../src/shared/settings-tools.ts';

/** Minimal, valid request per catalog action: proves the catalog and the wire protocol cannot drift. */
const minimalRequests: Record<string, Record<string, unknown>> = {
  'sessions.list': { action: 'sessions.list' },
  'sessions.read': { action: 'sessions.read', threadId: 't' },
  'sessions.search': { action: 'sessions.search', query: 'x' },
  'sessions.create': { action: 'sessions.create', projectId: 'p' },
  'sessions.select': { action: 'sessions.select', threadId: 't' },
  'sessions.rename': { action: 'sessions.rename', threadId: 't', title: 'n' },
  'sessions.pin': { action: 'sessions.pin', threadId: 't', pinned: true },
  'sessions.archive': { action: 'sessions.archive', threadId: 't', archived: true },
  'sessions.markRead': { action: 'sessions.markRead', threadId: 't', read: true },
  'sessions.stop': { action: 'sessions.stop', threadId: 't' },
  'sessions.resume': { action: 'sessions.resume', threadId: 't' },
  'sessions.fork': { action: 'sessions.fork', threadId: 't' },
  'sessions.delete': { action: 'sessions.delete', threadId: 't' },
  'sessions.send': { action: 'sessions.send', threadId: 't', text: 'hi' },
  'projects.list': { action: 'projects.list' },
  'projects.add': { action: 'projects.add' },
  'projects.trust': { action: 'projects.trust', projectId: 'p', trusted: true },
  'projects.directoryAdd': { action: 'projects.directoryAdd', projectId: 'p' },
  'projects.directoryRemove': { action: 'projects.directoryRemove', projectId: 'p', directoryId: 'd' },
  'projects.directoryUpdate': { action: 'projects.directoryUpdate', projectId: 'p', directoryId: 'd', primary: true },
  'ui.collapseProject': { action: 'ui.collapseProject', projectId: 'p', collapsed: true },
  'ui.summary': { action: 'ui.summary', open: true },
  'ui.openPanel': { action: 'ui.openPanel', panel: 'changes' },
  'ui.closePanel': { action: 'ui.closePanel' },
  'ui.selectFile': { action: 'ui.selectFile', path: 'a.ts' },
  'ui.selectDirectory': { action: 'ui.selectDirectory', directoryId: 'd' },
  'messages.copy': { action: 'messages.copy', itemId: 'm1' },
  'messages.revise': { action: 'messages.revise', itemId: 'm1', kind: 'regenerate' },
  'messages.setModel': { action: 'messages.setModel', modelId: 'model-1' },
  'messages.setThinking': { action: 'messages.setThinking', thinking: 'high' },
  'messages.createSidechat': { action: 'messages.createSidechat' },
  // Wave 3 — workbench families.
  'review.start': { action: 'review.start' },
  'review.cancel': { action: 'review.cancel' },
  'review.inspect': { action: 'review.inspect' },
  'review.read': { action: 'review.read', path: 'a.ts' },
  'review.finding': { action: 'review.finding', findingId: 'f1' },
  'review.locate': { action: 'review.locate', findingId: 'f1' },
  'git.status': { action: 'git.status' },
  'git.inspect': { action: 'git.inspect' },
  'git.diff': { action: 'git.diff' },
  'git.range': { action: 'git.range', mode: 'turn' },
  'git.commitInfo': { action: 'git.commitInfo', ref: 'abcdef1' },
  'git.recoveries': { action: 'git.recoveries' },
  'git.processProblems': { action: 'git.processProblems' },
  'git.hunkVersion': { action: 'git.hunkVersion', path: 'a.ts' },
  'git.run': { action: 'git.run', operation: 'fetch' },
  'git.commit': { action: 'git.commit', message: 'm', paths: ['a.ts'] },
  'git.apply': { action: 'git.apply' },
  'git.revert': { action: 'git.revert', path: 'a.ts' },
  'git.hunkRevert': { action: 'git.hunkRevert', path: 'a.ts', patch: 'p', version: 'v', mode: 'all' },
  'git.hunkRestore': { action: 'git.hunkRestore', recoveryId: '11111111-1111-4111-8111-111111111111' },
  'git.conflict': { action: 'git.conflict', path: 'a.ts' },
  'git.retryStop': { action: 'git.retryStop', processId: '11111111-1111-4111-8111-111111111111' },
  'worktrees.create': { action: 'worktrees.create' },
  'worktrees.migrate': { action: 'worktrees.migrate' },
  'worktrees.manage': { action: 'worktrees.manage', worktreeId: '11111111-1111-4111-8111-111111111111', operation: 'usage' },
  'worktrees.recycle': { action: 'worktrees.recycle' },
  'worktrees.recovery': { action: 'worktrees.recovery', recoveryId: 'r1' },
  'worktrees.creationRecovery': { action: 'worktrees.creationRecovery', recoveryId: 'r1' },
  'terminal.open': { action: 'terminal.open' },
  'terminal.rename': { action: 'terminal.rename', terminalId: 't1', title: 'n' },
  'terminal.close': { action: 'terminal.close', terminalId: 't1' },
  'settings.read': { action: 'settings.read' },
  'settings.models': { action: 'settings.models' },
  'settings.inputCatalog': { action: 'settings.inputCatalog' },
  'settings.apply': { action: 'settings.apply', patch: { theme: 'dark' } },
  'terminal.resize': { action: 'terminal.resize', terminalId: 't1', cols: 80, rows: 24 },
  'git.cancel': { action: 'git.cancel', requestId: '11111111-1111-4111-8111-111111111111' },
  'files.list': { action: 'files.list' },
  'files.read': { action: 'files.read', path: 'a.ts' },
  'files.write': { action: 'files.write', path: 'a.ts', content: 'x', version: 'v' },
  'files.open': { action: 'files.open' },
  'files.reveal': { action: 'files.reveal', path: 'a.ts' },
  'files.search': { action: 'files.search', query: 'x' },
  'files.searchCancel': { action: 'files.searchCancel' },
  'comments.list': { action: 'comments.list' },
  'comments.add': { action: 'comments.add', path: 'a.ts', version: 'v', line: 1, endLine: 1, body: 'b' },
  'comments.remove': { action: 'comments.remove', commentId: 'c1' },
  'comments.locate': { action: 'comments.locate', commentId: 'c1' },
  // Wave 4c — browser data, PR, resources, MCP.
  'browser.history': { action: 'browser.history' },
  'browser.downloads': { action: 'browser.downloads' },
  'browser.download': { action: 'browser.download', downloadId: 'd1', operation: 'reveal' },
  'browser.find': { action: 'browser.find', text: 'x' },
  'browser.annotation': { action: 'browser.annotation', annotationId: '11111111-1111-4111-8111-111111111111', operation: 'read' },
  'pr.status': { action: 'pr.status' },
  'pr.start': { action: 'pr.start', operation: 'view' },
  'resources.inspect': { action: 'resources.inspect' },
  'resources.refresh': { action: 'resources.refresh' },
  'resources.open': { action: 'resources.open', resourceId: 'r1' },
  'mcp.list': { action: 'mcp.list' },
  'mcp.test': { action: 'mcp.test', serverId: 's1' },
  'mcp.testCancel': { action: 'mcp.testCancel', requestId: '11111111-1111-4111-8111-111111111111' },
  'mcp.retry': { action: 'mcp.retry' },
  'mcp.resource': { action: 'mcp.resource', itemId: 'i1', index: 0 },
  'sessions.quickChat': { action: 'sessions.quickChat' },
  'sessions.bindProject': { action: 'sessions.bindProject', projectId: 'p' },
  'sessions.keepSidechat': { action: 'sessions.keepSidechat', threadId: 't' },
  'sessions.appendSidechat': { action: 'sessions.appendSidechat', threadId: 't', itemId: 'i' },
  'ui.openExternal': { action: 'ui.openExternal', url: 'https://example.com' },
  // Wave 5 — windows and previews.
  'windows.open': { action: 'windows.open' },
  'windows.minimize': { action: 'windows.minimize' },
  'windows.maximize': { action: 'windows.maximize' },
  'windows.close': { action: 'windows.close' },
  'windows.retryShortcut': { action: 'windows.retryShortcut' },
  'windows.revealWorktreePath': { action: 'windows.revealWorktreePath', projectId: 'p', path: 'a.ts' },
  'previews.open': { action: 'previews.open', url: 'http://127.0.0.1:5173/' },
  'previews.close': { action: 'previews.close' },
  'previews.refresh': { action: 'previews.refresh' },
  'artifacts.open': { action: 'artifacts.open', directoryId: 'd', path: 'a.html' },
  'artifacts.close': { action: 'artifacts.close', previewId: '11111111-1111-4111-8111-111111111111' },
  'artifacts.status': { action: 'artifacts.status', previewId: '11111111-1111-4111-8111-111111111111' },
  'artifacts.stop': { action: 'artifacts.stop', previewId: '11111111-1111-4111-8111-111111111111' },
  'artifacts.capture': { action: 'artifacts.capture', previewId: '11111111-1111-4111-8111-111111111111' },
  'artifacts.annotation': { action: 'artifacts.annotation', annotationId: '11111111-1111-4111-8111-111111111111', operation: 'read' },
};

test('every implemented catalog action is a request the worker protocol accepts', () => {
  const implemented = desktopToolCatalog.filter(entry => entry.wave <= implementedDesktopWave);
  assert.ok(implemented.length >= 20, 'wave 1 should carry the session/project/view families');
  for (const entry of implemented) {
    const minimal = minimalRequests[entry.action];
    assert.ok(minimal, `${entry.action} needs a minimal request in this test`);
    assert.equal(desktopToolSchema.safeParse(minimal).success, true, `${entry.action} must parse as a desktop tool request`);
  }
  // Every family in the catalog is one the wiring can actually enable, and each tool name is unique.
  assert.deepEqual([...new Set(implemented.map(entry => entry.family))].sort(), ['artifact', 'browser', 'file', 'git', 'mcp', 'message', 'pr', 'project', 'resource', 'review', 'session', 'settings', 'terminal', 'ui', 'window', 'worktree']);
  assert.equal(new Set(implemented.map(entry => entry.tool)).size, 19);
  assert.equal(desktopToolCatalogFor(['session']).every(entry => entry.family === 'session'), true);
  // Wave 2 stays on the caller's own chat: no action may carry a threadId it could point elsewhere.
  const waveTwo = implemented.filter(entry => entry.wave === 2);
  assert.ok(waveTwo.length >= 5 && waveTwo.every(entry => entry.tool === 'manage_messages'));
  for (const entry of waveTwo)
    assert.equal(manageMessagesToolSchema.safeParse({ ...minimalRequests[entry.action], threadId: 'other' }).success, false,
      `${entry.action} must not accept a threadId`);
});

test('settings: the writable whitelist is exactly the harmless keys, and every denied key is refused with a reason', () => {
  for (const key of allowedSettingsKeys)
    assert.equal(manageSettingsToolSchema.safeParse({ action: 'settings.apply', patch: { [key]: 'probe' } }).success, true,
      `${key} should be patchable`);
  for (const [key, why] of Object.entries(deniedSettingsKeys)) {
    assert.ok(why.length > 0, `${key} needs a documented reason`);
    assert.equal(allowedSettingsKeys.includes(key as never), false, `${key} must not be on the writable list`);
    const attempt = manageSettingsToolSchema.safeParse({ action: 'settings.apply', patch: { [key]: {} } });
    assert.equal(attempt.success, false, `${key} must be refused`);
    if (!attempt.success) assert.match(attempt.error.issues.map(issue => issue.message).join(' '), new RegExp(why));
  }
  // The permission plane keys the whole surface promises to keep away from the model.
  for (const key of ['policy', 'planMode', 'toolPolicies', 'sandbox', 'modelProviders', 'mcpServers', 'pluginSources'])
    assert.equal(manageSettingsToolSchema.safeParse({ action: 'settings.apply', patch: { [key]: {} } }).success, false, `${key} must be refused`);
  assert.equal(manageSettingsToolSchema.safeParse({ action: 'settings.apply', patch: {} }).success, false, 'an empty patch is a mistake, not a no-op');
});

test('the permission plane stays unreachable: no schema accepts policy, plan mode, sandbox, approval or credential fields', () => {
  const schemas = [readSessionsToolSchema, manageSessionsToolSchema, sendToSessionToolSchema, manageProjectsToolSchema, manageUiToolSchema, manageMessagesToolSchema];
  const probes: Record<string, unknown>[] = [
    { action: 'sessions.list', policy: 'full' },
    { action: 'sessions.select', threadId: 't', planMode: true },
    { action: 'projects.list', sandbox: 'none' },
    { action: 'ui.summary', open: true, approval: { id: 'x', approved: true } },
    { action: 'sessions.send', threadId: 't', text: 'x', apiKey: 'sk-x' },
    { action: 'sessions.list', toolPolicies: {} },
    { action: 'sessions.list', secret: 'x' },
    { action: 'messages.setThinking', thinking: 'high', policy: 'full' },
  ];
  for (const schema of schemas)
    for (const probe of probes) assert.equal(schema.safeParse(probe).success, false, `${probe.action} must reject ${Object.keys(probe).filter(key => key !== 'action' && key !== 'threadId' && key !== 'text' && key !== 'open' && key !== 'id' && key !== 'approved').join(',')}`);

  // The guard lists exist so later waves keep the same promise; they must not be empty or stale.
  assert.ok(forbiddenDesktopFields.includes('policy') && forbiddenDesktopFields.includes('planMode') && forbiddenDesktopFields.includes('sandbox'));
  assert.ok(forbiddenDesktopOps.includes('approval.reply') && forbiddenDesktopOps.includes('provider.key') && forbiddenDesktopOps.includes('terminal.input'));
  for (const entry of desktopToolCatalog)
    assert.equal(forbiddenDesktopOps.includes(entry.action as never), false, `${entry.action} is not part of the model surface`);
});
