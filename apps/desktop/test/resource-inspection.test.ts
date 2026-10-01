import assert from 'node:assert/strict';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from './fixtures/node-temp.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectResources } from '../src/main/resource-inspection.ts';
import { discoverSharedSkills, updateIgnoredSkills } from '../src/main/skills.ts';
import { providerSchema, requestSchema, resourceInspectionSchema, settingsSchema, threadSchema } from '../src/shared/contracts.ts';
import type { WorkerEvent } from '../src/shared/worker-protocol.ts';
import { workerEventSchema } from '../src/shared/worker-protocol.ts';
import { DesktopAgent } from '../src/worker/agent.ts';

test('source inspection exposes invalid shared skills, missing imports and nonexecuting extension checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-resource-inspection-'));
  try {
    const invalid = join(root, 'invalid', 'SKILL.md');
    await mkdir(join(root, 'invalid'));
    await writeFile(invalid, '---\nname: invalid\n---\nNo description');
    const missing = join(root, 'missing', 'SKILL.md');
    const extension = join(root, 'never-run.mjs');
    const marker = join(root, 'executed.txt');
    await writeFile(extension, 'import { writeFileSync } from "node:fs"; writeFileSync(' + JSON.stringify(marker) + ', "executed"); export default () => {};');
    const settings = settingsSchema.parse({ resources: [
      { id: 'missing', kind: 'skill', path: missing, name: 'Missing', enabled: true },
      { id: 'extension', kind: 'extension', path: extension, name: 'Extension', enabled: true },
      { id: 'directory', kind: 'extension', path: root, name: 'Directory', enabled: false },
    ] });
    const original = structuredClone(settings);
    const result = inspectResources(settings, root);
    assert.ok(result.diagnostics.some(item => item.path === invalid && item.message.includes('description')));
    assert.ok(result.diagnostics.some(item => item.path === missing && item.message.includes('does not exist')));
    assert.ok(result.diagnostics.some(item => item.path === root && item.kind === 'extension'));
    assert.ok(!result.diagnostics.some(item => item.path === extension));
    await assert.rejects(access(marker));
    assert.deepEqual(settings, original);
    assert.equal(resourceInspectionSchema.safeParse(result).success, true);
    assert.equal(requestSchema.safeParse({ op: 'resource.inspect', path: root }).success, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('inspection reports enabled name collisions, deduplicates warnings and respects removal exclusions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-resource-collision-'));
  try {
    for (const name of ['first', 'second', 'warning']) {
      await mkdir(join(root, name));
      await writeFile(join(root, name, 'SKILL.md'), '---\nname: ' + (name === 'warning' ? 'Invalid_Name' : 'shared-name') + '\ndescription: ' + name + ' description\n---\nBody');
    }
    const settings = settingsSchema.parse({});
    discoverSharedSkills(settings, root);
    const result = inspectResources(settings, root);
    assert.equal(result.diagnostics.filter(item => item.type === 'collision').length, 1);
    assert.equal(result.diagnostics.filter(item => item.path === join(root, 'warning', 'SKILL.md')).length, 1);
    assert.ok(Object.values(result.descriptions).includes('first description'));
    const second = settings.resources.find(item => item.path === join(root, 'second', 'SKILL.md'))!;
    second.enabled = false;
    assert.equal(inspectResources(settings, root).diagnostics.filter(item => item.type === 'collision').length, 0);
    const removed = settingsSchema.parse({ ...settings, resources: settings.resources.filter(item => item.path !== join(root, 'warning', 'SKILL.md')) });
    updateIgnoredSkills(settings, removed);
    assert.ok(!inspectResources(removed, root).diagnostics.some(item => item.path === join(root, 'warning', 'SKILL.md')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('source checks recover after repair and distinguish an absent shared directory from an invalid one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-resource-repair-'));
  try {
    const path = join(root, 'SKILL.md');
    await writeFile(path, '---\nname: repair\n---\nBroken');
    const settings = settingsSchema.parse({ resources: [{ id: 's', kind: 'skill', path, name: 'Repair', enabled: true }] });
    assert.ok(inspectResources(settings, root).diagnostics.length > 0);
    await writeFile(path, '---\nname: repair\ndescription: Repaired description\n---\nBody');
    const result = inspectResources(settings, root);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.descriptions.s, 'Repaired description');
    assert.deepEqual(inspectResources(settingsSchema.parse({}), join(root, 'absent')).diagnostics, []);
    assert.ok(inspectResources(settingsSchema.parse({}), path).diagnostics.some(item => item.path === path && item.type === 'error'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real worker publishes typed skill and extension load failures and replaces them after repair', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-resource-load-'));
  const events: WorkerEvent[] = [];
  let agent: DesktopAgent | undefined;
  const receive = (event: WorkerEvent) => {
    events.push(workerEventSchema.parse(event));
    if (event.type === 'approval') {
      // Only this local fixture's extension loading is authorized; keep the actual approval path.
      assert.equal(event.approval.scope, 'external-tools');
      agent!.answer(event.approval.id, true);
    }
  };
  try {
    const skill = join(root, 'SKILL.md');
    const extension = join(root, 'broken.mjs');
    await writeFile(skill, '---\nname: broken\n---\nNo description');
    await writeFile(extension, 'export default () => { throw new Error("RESOURCE_LOAD_FAILURE"); };');
    const config = {
      thread: threadSchema.parse({ id: 'test', projectId: 'p', title: 'Task', cwd: root, createdAt: 1, updatedAt: 1, providerId: 'fake', thinking: 'off', policy: 'auto' }),
      provider: providerSchema.parse({ id: 'fake', name: 'Fake', provider: 'resource-test', model: 'fake', custom: true, baseUrl: 'http://127.0.0.1:9/v1', reasoning: false }),
      settings: settingsSchema.parse({ resources: [{ id: 's', name: 'Skill', path: skill, kind: 'skill', enabled: true }, { id: 'e', name: 'Extension', path: extension, kind: 'extension', enabled: true }] }),
      agentDir: join(root, '.agent'), trusted: true, testMode: true, mcp: [],
    };
    agent = new DesktopAgent(receive);
    await agent.init(config);
    const initial = events.findLast(event => event.type === 'resources');
    assert.ok(initial?.type === 'resources');
    assert.ok(initial.report.diagnostics.some(item => item.kind === 'skill' && item.path === skill));
    assert.ok(initial.report.diagnostics.some(item => item.kind === 'extension' && item.message.includes('RESOURCE_LOAD_FAILURE')));
    const saved = threadSchema.parse({ ...config.thread, resourceLoad: initial.report });
    assert.deepEqual(threadSchema.parse(JSON.parse(JSON.stringify(saved))).resourceLoad, initial.report);
    await agent.dispose();
    await writeFile(skill, '---\nname: repaired\ndescription: Repaired\n---\nBody');
    // Use a new source path to avoid the Node module cache within this single-process unit test.
    const repaired = join(root, 'repaired.mjs');
    await writeFile(repaired, 'export default () => {};');
    agent = new DesktopAgent(receive);
    await agent.init({ ...config, settings: settingsSchema.parse({ resources: [{ ...config.settings.resources[0] }, { ...config.settings.resources[1], path: repaired }] }) });
    const latest = events.findLast(event => event.type === 'resources');
    assert.ok(latest?.type === 'resources');
    assert.deepEqual(latest.report.diagnostics, []);
  } finally { await agent?.dispose(); await rm(root, { recursive: true, force: true }); }
});
