import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampLayout, layoutBounds, resizeStep, summaryPlacement, workspaceSizes } from '../src/renderer/src/lib/layout.ts';

test('sidebar honours the reference clamp against the live viewport', () => {
  assert.equal(clampLayout('sidebarWidth', 275, 1440), 275);
  assert.equal(clampLayout('sidebarWidth', 120, 1440), 240);
  assert.equal(clampLayout('sidebarWidth', 900, 1440), 520);
  assert.equal(clampLayout('sidebarWidth', 900, 700), 380);
  assert.equal(clampLayout('sidebarWidth', 100, 400), 240);
});

test('review and terminal keep their own bounds regardless of viewport', () => {
  assert.deepEqual(layoutBounds('reviewWidth', 800), { min: 280, max: 1920 });
  assert.equal(clampLayout('reviewWidth', 90, 1440), 280);
  assert.equal(clampLayout('terminalHeight', 4000, 1440), 800);
});

test('keyboard steps stay inside the clamp', () => {
  assert.equal(resizeStep('sidebarWidth', 241, -1, 1440), 240);
  assert.equal(resizeStep('sidebarWidth', 515, 1, 1440), 520);
});

test('small windows use a drawer without shrinking saved sidebar preferences', () => {
  const small = workspaceSizes(1000, 640, 520, 760, 800);
  assert.equal(small.sidebarWidth, 520);
  assert.equal(small.reviewWidth, 455);
  assert.equal(small.reviewOverlay, true);
  assert.ok(1000 - small.sidebarWidth >= 320);
  assert.equal(640 - 36 - 46 - small.terminalHeight, 240);
  assert.deepEqual(workspaceSizes(1440, 940, 275, 390, 240), {
    sidebarWidth: 275,
    reviewWidth: 390,
    terminalHeight: 240,
    reviewOverlay: false,
  });
  assert.equal(workspaceSizes(1000, 640, 0, 760, 240).reviewWidth, 679);
  const docked = workspaceSizes(1280, 800, 520, 760, 240);
  assert.equal(1280 - docked.sidebarWidth - docked.reviewWidth - 1, 320);
});

test('1000px reference docks review without covering the conversation or changing saved sizes', () => {
  const sizes = workspaceSizes(1000, 700, 240, 407, 240);
  assert.equal(sizes.sidebarWidth, 240);
  assert.equal(sizes.reviewWidth, 407);
  assert.equal(sizes.reviewOverlay, false);
  assert.equal(1000 - sizes.sidebarWidth - sizes.reviewWidth - 1, 352);
  const large = workspaceSizes(1440, 940, 240, 847, 240);
  assert.equal(large.reviewWidth, 847);
  assert.equal(clampLayout('reviewWidth', 847, 1440), 847);
});

test('summary and tools coexist without squeezing the conversation', () => {
  const wide = workspaceSizes(1920, 940, 275, 390, 240, true);
  assert.deepEqual(summaryPlacement(1644, wide.reviewWidth, wide.reviewOverlay), { overlay: false, stacked: false, right: 390 });
  const medium = workspaceSizes(1280, 800, 275, 390, 240, true);
  assert.equal(medium.reviewOverlay, false);
  assert.ok(1280 - medium.sidebarWidth - medium.reviewWidth - 1 >= 560);
  assert.deepEqual(summaryPlacement(1004, medium.reviewWidth, false), { overlay: true, stacked: false, right: 390 });
  const narrow = workspaceSizes(1000, 700, 520, 760, 240, true);
  assert.equal(narrow.reviewOverlay, true);
  assert.deepEqual(summaryPlacement(479, narrow.reviewWidth, true), { overlay: true, stacked: true, right: 0 });
});
