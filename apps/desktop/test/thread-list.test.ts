import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Project, type Thread, projectSchema, threadSchema } from '../src/shared/contracts.ts';
import { groupThreadList, matchesSearch } from '../src/renderer/src/hooks/use-thread-list.ts';

function project(id: string): Project {
  return projectSchema.parse({ id, name: `项目 ${id}`, path: `C:/work/${id}`, trusted: true, createdAt: 1 });
}

function thread(id: string, projectId: string, title: string, updatedAt: number, archived = false): Thread {
  return threadSchema.parse({
    id,
    projectId,
    title,
    cwd: `C:/work/${projectId}`,
    createdAt: 1,
    updatedAt,
    archived,
    providerId: 'fake',
    thinking: 'off',
    policy: 'ask',
  });
}

const projectA = project('a');
const projectB = project('b');
const input = (threads: Thread[], overrides: { showArchived?: boolean; search?: string } = {}) =>
  groupThreadList({
    projects: [projectA, projectB],
    threads,
    showArchived: overrides.showArchived ?? false,
    search: overrides.search ?? '',
  });

const ids = (groups: { threads: Thread[] }[]) => groups.map((group) => group.threads.map((item) => item.id));

test('active and archived tasks partition instead of mixing', () => {
  const active = thread('active', 'a', '进行中的任务', 100);
  const archived = thread('archived', 'a', '已归档的任务', 200, true);
  assert.deepEqual(ids(input([active, archived])), [['active'], []]);
  assert.deepEqual(ids(input([active, archived], { showArchived: true })), [['archived'], []]);
});

test('child agents remain absent from project lists, recents and archived search', () => {
  const parent = thread('parent', 'a', 'Main task', 100);
  const child = { ...thread('child', 'a', 'Child task', 200), subtaskId: crypto.randomUUID() };
  assert.deepEqual(ids(input([parent, child])), [['parent'], []]);
  assert.deepEqual(ids(input([parent, child], { search: 'Child' })), []);
  assert.deepEqual(ids(input([{ ...child, archived: true }], { showArchived: true })), [[], []]);
});

test('search matches a title substring regardless of case', () => {
  const hit = thread('hit', 'a', 'Fix The Login Flow', 100);
  const miss = thread('miss', 'a', 'Rebuild sidebar', 200);
  assert.deepEqual(ids(input([hit, miss], { search: 'the login' })), [['hit']]);
  assert.deepEqual(ids(input([hit, miss], { search: 'SIDEBAR' })), [['miss']]);
  assert.deepEqual(ids(input([hit, miss], { search: 'nothing here' })), []);
  assert.equal(matchesSearch(hit, '   '), true);
});

test('whitespace-only search is not a filter and keeps empty projects listed', () => {
  const only = thread('only', 'a', '任务', 100);
  const groups = groupThreadList({
    projects: [projectA, projectB],
    threads: [only],
    showArchived: false,
    search: '  ',
  });
  assert.deepEqual(ids(groups), [['only'], []]);
});

test('newest update wins inside every project', () => {
  const older = thread('older', 'a', '旧', 100);
  const newer = thread('newer', 'a', '新', 300);
  const middle = thread('middle', 'a', '中', 200);
  const groups = input([older, newer, middle]);
  assert.deepEqual(
    groups[0].threads.map((item) => item.id),
    ['newer', 'middle', 'older'],
  );
});

test('tasks group under their own project, in project order', () => {
  const groups = input([
    thread('b2', 'b', 'B 的第二条', 200),
    thread('a1', 'a', 'A 的第一条', 300),
    thread('b1', 'b', 'B 的第一条', 100),
  ]);
  assert.deepEqual(
    groups.map((group) => [group.project.id, group.threads.map((item) => item.id)]),
    [
      ['a', ['a1']],
      ['b', ['b2', 'b1']],
    ],
  );
});

test('no projects means no groups', () => {
  const groups = groupThreadList({
    projects: [],
    threads: [thread('orphan', 'a', '没有项目', 100)],
    showArchived: false,
    search: '',
  });
  assert.deepEqual(groups, []);
});

test('an empty project stays listed until a search excludes it', () => {
  const listed = groupThreadList({
    projects: [projectA, projectB],
    threads: [thread('a1', 'a', '任务', 100)],
    showArchived: false,
    search: '',
  });
  assert.deepEqual(
    listed.map((group) => group.project.id),
    ['a', 'b'],
  );
  const filtered = groupThreadList({
    projects: [projectA, projectB],
    threads: [thread('a1', 'a', '任务', 100)],
    showArchived: false,
    search: '任务',
  });
  assert.deepEqual(
    filtered.map((group) => group.project.id),
    ['a'],
  );
});

test("the caller's arrays are not reordered or filtered in place", () => {
  const threads = [thread('older', 'a', '旧', 100), thread('newer', 'a', '新', 300)];
  const projects = [projectA, projectB];
  groupThreadList({ projects, threads, showArchived: false, search: '' });
  assert.deepEqual(
    threads.map((item) => item.id),
    ['older', 'newer'],
  );
  assert.equal(projects.length, 2);
});
