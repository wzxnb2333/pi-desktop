import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedWorkerSettingGroups, WORKER_SETTING_GROUPS } from '../src/main/settings-diff.ts';
import { type Provider, type Settings, settingsSchema } from '../src/shared/contracts.ts';

/*
 * `main/application.ts` cannot be imported from a plain node test — it pulls electron's
 * `utilityProcess` in through `main/agent-host.ts` — so the teardown decision lives in the pure
 * `main/settings-diff.ts` helper and is covered here. The call site is `changed(...).length > 0`.
 */

const provider: Provider = {
  id: 'p1',
  name: 'GPT',
  provider: 'openai',
  model: 'gpt-4.1',
  baseUrl: 'https://api.openai.com/v1',
  api: 'openai-responses',
  custom: false,
  reasoning: true,
  contextWindow: 128000,
  maxTokens: 8192,
  hasKey: true,
};
const second: Provider = {
  ...provider,
  id: 'p2',
  name: 'Claude',
  provider: 'anthropic',
  model: 'claude-sonnet-4',
};

const saved = settingsSchema.parse({
  providerId: 'p1',
  providers: [provider, second],
  resources: [{ id: 'r1', name: 'release', path: 'C:/skills/release/SKILL.md', kind: 'skill', enabled: true }],
  mcpServers: [
    {
      id: 'm1',
      name: 'files',
      enabled: true,
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      url: '',
    },
  ],
});

/** Re-runs a draft through the schema the way `settings.save` receives it, so defaults line up. */
const edit = (patch: Partial<Settings>): Settings => settingsSchema.parse({ ...saved, ...patch });
const editProvider = (patch: Partial<Provider>): Settings =>
  edit({ providers: [{ ...provider, ...patch }, second] });

test('the worker-scoped set includes model resources, MCP policies and explicitly enabled subtask tools', () => {
  assert.deepEqual(WORKER_SETTING_GROUPS, ['providers', 'resources', 'ignoredSkillPaths', 'mcpServers', 'mcpToolPolicies', 'subtasksEnabled']);
  assert.deepEqual(changedWorkerSettingGroups(saved, structuredClone(saved)), []);
  assert.deepEqual(changedWorkerSettingGroups(saved, edit({ subtasksEnabled: true })), ['subtasksEnabled']);
});

test('appearance and behaviour settings never ask for a teardown', () => {
  // A worker reads none of these: theme/fontSize/sendShortcut are consumed by the renderer, terminal
  // and editor by the main process at the `terminal.open` / `file.open` sites, and policy/thinking/
  // providerId are defaults for threads that do not exist yet — a live thread carries its own copy,
  // and `thread.update` already drops that one worker.
  const patches: Partial<Settings>[] = [
    { theme: 'dark' },
    { fontSize: 18 },
    { terminal: 'git-bash' },
    { editor: 'system' },
    { sendShortcut: 'ctrl-enter' },
    { keepInTray: false },
    { policy: 'auto' },
    { thinking: 'high' },
    { providerId: 'p2' },
    { voice: { ...saved.voice, speed: 1.2 } },
  ];
  for (const patch of patches) {
    const next = edit(patch);
    assert.notDeepEqual(next, saved, `fixture did not change: ${JSON.stringify(patch)}`);
    assert.deepEqual(changedWorkerSettingGroups(saved, next), [], `${JSON.stringify(patch)} must not tear down`);
  }
});

test('provider edits ask for a teardown', () => {
  assert.deepEqual(changedWorkerSettingGroups(saved, editProvider({ model: 'gpt-4.1-mini' })), ['providers']);
  const local = editProvider({ baseUrl: 'http://127.0.0.1:11434/v1', custom: true });
  assert.deepEqual(changedWorkerSettingGroups(saved, local), ['providers']);
  assert.deepEqual(changedWorkerSettingGroups(saved, editProvider({ maxTokens: 4096 })), ['providers']);
  assert.deepEqual(changedWorkerSettingGroups(saved, edit({ providers: [provider] })), ['providers']);
  assert.deepEqual(changedWorkerSettingGroups(saved, edit({ providers: [] })), ['providers']);
  assert.deepEqual(
    changedWorkerSettingGroups(saved, edit({ providers: [provider, second, { ...provider, id: 'p3' }] })),
    ['providers'],
  );
});

test('resource and mcp edits ask for a teardown', () => {
  // Resource changes replace idle workers; running workers keep their snapshot until the next run.
  const skillOff = edit({ resources: [{ ...saved.resources[0], enabled: false }] });
  assert.deepEqual(changedWorkerSettingGroups(saved, skillOff), ['resources']);
  const added = edit({ resources: [...saved.resources, { ...saved.resources[0], id: 'r2' }] });
  assert.deepEqual(changedWorkerSettingGroups(saved, added), ['resources']);
  assert.deepEqual(changedWorkerSettingGroups(saved, edit({ resources: [] })), ['resources']);
  assert.deepEqual(changedWorkerSettingGroups(saved, edit({ ignoredSkillPaths: [saved.resources[0].path] })), ['ignoredSkillPaths']);
  const mcpOff = edit({ mcpServers: saved.mcpServers.map((server) => ({ ...server, enabled: false })) });
  assert.deepEqual(changedWorkerSettingGroups(saved, mcpOff), ['mcpServers']);
  const mcpArgs = edit({ mcpServers: saved.mcpServers.map((server) => ({ ...server, args: [] })) });
  assert.deepEqual(changedWorkerSettingGroups(saved, mcpArgs), ['mcpServers']);
  assert.deepEqual(changedWorkerSettingGroups(saved, edit({ mcpServers: [] })), ['mcpServers']);
});

test('equality is by value, not by object identity or key order', () => {
  assert.deepEqual(changedWorkerSettingGroups(saved, structuredClone(saved)), []);
  // A draft that travelled through `JSON` can list a provider's keys in another order.
  const reordered = settingsSchema.parse(
    JSON.parse(
      JSON.stringify({
        ...saved,
        providers: saved.providers.map((p) => ({
          maxTokens: p.maxTokens,
          contextWindow: p.contextWindow,
          hasKey: p.hasKey,
          reasoning: p.reasoning,
          custom: p.custom,
          api: p.api,
          baseUrl: p.baseUrl,
          model: p.model,
          provider: p.provider,
          name: p.name,
          id: p.id,
        })),
      }),
    ),
  );
  assert.deepEqual(changedWorkerSettingGroups(saved, reordered), []);
  // A number is not its own string form, so a type slip is reported rather than ignored.
  const loose = settingsSchema.parse({
    ...saved,
    providers: [{ ...provider, contextWindow: 128001 }, second],
  });
  assert.deepEqual(changedWorkerSettingGroups(saved, loose), ['providers']);
});

test('reordered providers count as a change instead of being assumed harmless', () => {
  assert.deepEqual(changedWorkerSettingGroups(saved, edit({ providers: [second, provider] })), ['providers']);
});

test('a key written mid-session does not read as a provider edit once hasKey is resynced', () => {
  // `settings.save` re-derives every `hasKey` from the vault before comparing, and `provider.key` has
  // already updated the stored copy and dropped that provider's workers. Without the resync the stale
  // draft below would look like a provider edit and tear everything down.
  const stored = edit({ providers: [{ ...provider, hasKey: false }, second] });
  const staleDraft = saved;
  const fromVault = new Map(stored.providers.map((p) => [p.id, p.hasKey]));
  const resynced = settingsSchema.parse({
    ...staleDraft,
    providers: staleDraft.providers.map((p) => ({ ...p, hasKey: fromVault.get(p.id) ?? false })),
  });
  assert.deepEqual(changedWorkerSettingGroups(stored, staleDraft), ['providers']);
  assert.deepEqual(changedWorkerSettingGroups(stored, resynced), []);
});
