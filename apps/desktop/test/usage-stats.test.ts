import assert from 'node:assert/strict';
import test from 'node:test';
import { cacheHitPercent, outputPerSecond } from '../src/shared/usage-stats.ts';

test('cache hit percentage uses only the reported prompt side', () => {
  assert.equal(cacheHitPercent(800, 200), 80);
  assert.equal(cacheHitPercent(100, 0), 100);
  assert.equal(cacheHitPercent(0, 100), undefined, 'no cached tokens means no rate to show');
});

test('cache hit percentage is undefined when a provider reports nothing usable', () => {
  assert.equal(cacheHitPercent(undefined, 100), undefined);
  assert.equal(cacheHitPercent(100, undefined), undefined);
  assert.equal(cacheHitPercent(undefined, undefined), undefined);
  assert.equal(cacheHitPercent(-5, 100), undefined);
  assert.equal(Number.isFinite(cacheHitPercent(0.0001, 0.0001)!), true);
});

test('output speed divides this run by its own duration and rounds to one decimal', () => {
  assert.equal(outputPerSecond(120, 4000), 30);
  assert.equal(outputPerSecond(10, 3000), 3.3);
  assert.equal(outputPerSecond(1, 60000), 0);
});

test('output speed never reports NaN or Infinity', () => {
  assert.equal(outputPerSecond(0, 1000), undefined, 'no output yet');
  assert.equal(outputPerSecond(100, 0), undefined, 'a zero-length run has no speed');
  assert.equal(outputPerSecond(undefined, 1000), undefined);
  assert.equal(outputPerSecond(100, undefined), undefined);
  assert.equal(outputPerSecond(-3, 1000), undefined);
});
