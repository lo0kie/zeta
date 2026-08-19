// 通用缓存：TTL 过期、负缓存、容量 FIFO 淘汰、delete
import { TtlCache } from '@/core/ttl-cache';
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

test('get/has 命中与 TTL 过期', () => {
  // TtlCache 用 Date.now() 判过期，用假定时器推进时间，避免真实等待 60ms
  vi.useFakeTimers();
  try {
    const cache = new TtlCache(50, 3);
    cache.set('a', 1);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.has('a'), true);
    vi.advanceTimersByTime(60);
    assert.equal(cache.get('a'), undefined, 'TTL 过期后 get 返回 undefined');
    assert.equal(cache.has('a'), false, 'TTL 过期后 has 返回 false');
  } finally {
    vi.useRealTimers();
  }
});

test('负缓存：undefined 值可被 has 区分', () => {
  const neg = new TtlCache(1000);
  neg.set('missing', undefined);
  assert.equal(neg.has('missing'), true);
  assert.equal(neg.get('missing'), undefined);
});

test('超容量 FIFO 淘汰（硬上限）', () => {
  const cap = new TtlCache(10000, 2);
  cap.set('a', 1);
  cap.set('b', 2);
  cap.set('c', 3);
  assert.equal(cap.get('a'), undefined, '最旧条目被淘汰');
  assert.equal(cap.get('c'), 3);
});

test('delete / clear', () => {
  const cache = new TtlCache(10000);
  cache.set('a', 1);
  cache.delete('a');
  assert.equal(cache.get('a'), undefined);
  cache.set('b', 2);
  cache.clear();
  assert.equal(cache.get('b'), undefined);
});
