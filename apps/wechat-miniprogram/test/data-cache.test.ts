import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type DataCache = {
  DEFAULT_TTL_MS: number;
  captureDataLease: (token: string, domains: string[]) => object;
  getMeCached: <T>(token: string, loader: () => T | Promise<T>, options?: { ttlMs?: number; force?: boolean }) => Promise<T>;
  setCachedMe: <T>(token: string, value: T) => T;
  invalidateMe: () => void;
  markRecordsChanged: () => number;
  markProfileChanged: <T>(token: string, value?: Partial<T>) => T | undefined;
  resetSessionData: () => void;
  isDataLeaseCurrent: (lease: object, token: string) => boolean;
  isPageFresh: (page: object, key: string, domains: string[], token: string, ttl?: number) => boolean;
  markPageFresh: (page: object, key: string, domains: string[], token: string) => boolean;
};

function loadCommonJsCache(): DataCache {
  const filename = path.resolve(__dirname, '../utils/data-cache.js');
  const source = fs.readFileSync(filename, 'utf8');
  const cjsModule: { exports: Partial<DataCache> } = { exports: {} };
  const execute = new Function('module', 'exports', source);
  execute(cjsModule, cjsModule.exports);
  return cjsModule.exports as DataCache;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('wechat mini-program data cache', () => {
  let cache: DataCache;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'));
    cache = loadCommonJsCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns fresh cached me data without calling the loader', async () => {
    const me = { id: 'user-a', nickname: '家人' };
    cache.setCachedMe('token-a', me);
    const loader = vi.fn(async () => ({ id: 'unexpected' }));

    await vi.advanceTimersByTimeAsync(cache.DEFAULT_TTL_MS - 1);

    await expect(cache.getMeCached('token-a', loader)).resolves.toBe(me);
    expect(loader).not.toHaveBeenCalled();
  });

  test('deduplicates concurrent me requests for the same session and versions', async () => {
    const pending = deferred<{ id: string }>();
    const loader = vi.fn(() => pending.promise);

    const first = cache.getMeCached('token-a', loader);
    const second = cache.getMeCached('token-a', loader);
    await Promise.resolve();

    expect(loader).toHaveBeenCalledTimes(1);
    pending.resolve({ id: 'user-a' });
    const [firstValue, secondValue] = await Promise.all([first, second]);
    expect(firstValue).toBe(secondValue);

    const hitLoader = vi.fn(async () => ({ id: 'unexpected' }));
    await expect(cache.getMeCached('token-a', hitLoader)).resolves.toBe(firstValue);
    expect(hitLoader).not.toHaveBeenCalled();
  });

  test('expires me and page freshness at the configured TTL boundary', async () => {
    cache.setCachedMe('token-a', { id: 'old' });
    const page = {};
    cache.markPageFresh(page, 'home', ['records', 'profile'], 'token-a');

    await vi.advanceTimersByTimeAsync(cache.DEFAULT_TTL_MS);
    expect(cache.isPageFresh(page, 'home', ['records', 'profile'], 'token-a')).toBe(false);

    const loader = vi.fn(async () => ({ id: 'fresh' }));
    await expect(cache.getMeCached('token-a', loader)).resolves.toEqual({ id: 'fresh' });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('invalidates only page markers that depend on the changed version domain', () => {
    const recordsPage = {};
    const profilePage = {};
    cache.markPageFresh(recordsPage, 'history', ['records'], 'token-a');
    cache.markPageFresh(profilePage, 'mine', ['profile'], 'token-a');

    cache.markRecordsChanged();
    expect(cache.isPageFresh(recordsPage, 'history', ['records'], 'token-a')).toBe(false);
    expect(cache.isPageFresh(profilePage, 'mine', ['profile'], 'token-a')).toBe(true);

    cache.markProfileChanged('token-a');
    expect(cache.isPageFresh(profilePage, 'mine', ['profile'], 'token-a')).toBe(false);
  });

  test('record changes invalidate cached me because it contains record totals', async () => {
    cache.setCachedMe('token-a', { id: 'user-a', stats: { totalRecords: 3 } });
    cache.markRecordsChanged();
    const loader = vi.fn(async () => ({ id: 'user-a', stats: { totalRecords: 4 } }));

    await expect(cache.getMeCached('token-a', loader)).resolves.toMatchObject({ stats: { totalRecords: 4 } });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('merges a successful profile update into cached me and advances profile version', async () => {
    const page = {};
    cache.setCachedMe('token-a', { id: 'user-a', nickname: '微信用户', stats: { totalRecords: 3 } });
    cache.markPageFresh(page, 'mine', ['profile'], 'token-a');

    const updated = cache.markProfileChanged<{ id: string; nickname: string; stats: { totalRecords: number } }>(
      'token-a',
      { nickname: '妈妈' }
    );

    expect(updated).toEqual({ id: 'user-a', nickname: '妈妈', stats: { totalRecords: 3 } });
    expect(cache.isPageFresh(page, 'mine', ['profile'], 'token-a')).toBe(false);
    const loader = vi.fn(async () => ({ id: 'unexpected' }));
    await expect(cache.getMeCached('token-a', loader)).resolves.toEqual(updated);
    expect(loader).not.toHaveBeenCalled();
  });

  test('does not let an old token response overwrite the active token cache', async () => {
    const oldPending = deferred<{ id: string }>();
    const oldRequest = cache.getMeCached('token-a', () => oldPending.promise);
    await Promise.resolve();

    const active = { id: 'user-b' };
    await expect(cache.getMeCached('token-b', async () => active)).resolves.toBe(active);
    oldPending.resolve({ id: 'user-a' });
    await expect(oldRequest).resolves.toEqual({ id: 'user-a' });

    const loader = vi.fn(async () => ({ id: 'unexpected' }));
    await expect(cache.getMeCached('token-b', loader)).resolves.toBe(active);
    expect(loader).not.toHaveBeenCalled();
  });

  test('resetSessionData prevents an obsolete in-flight response from refilling cache', async () => {
    const pending = deferred<{ id: string }>();
    const oldRequest = cache.getMeCached('token-a', () => pending.promise);
    await Promise.resolve();

    cache.resetSessionData();
    pending.resolve({ id: 'user-a' });
    await oldRequest;

    const loader = vi.fn(async () => ({ id: 'user-a-fresh' }));
    await expect(cache.getMeCached('token-a', loader)).resolves.toEqual({ id: 'user-a-fresh' });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('page freshness is isolated by token even before the TTL expires', () => {
    const page = {};
    cache.markPageFresh(page, 'stats:glucose:7', ['records', 'profile'], 'token-a');

    expect(cache.isPageFresh(page, 'stats:glucose:7', ['records', 'profile'], 'token-a')).toBe(true);
    expect(cache.isPageFresh(page, 'stats:glucose:7', ['records', 'profile'], 'token-b')).toBe(false);
  });

  test('data leases expire only when one of their selected domains changes', () => {
    const recordsLease = cache.captureDataLease('token-a', ['records']);
    const profileLease = cache.captureDataLease('token-a', ['profile']);

    cache.markProfileChanged('token-a');
    expect(cache.isDataLeaseCurrent(recordsLease, 'token-a')).toBe(true);
    expect(cache.isDataLeaseCurrent(profileLease, 'token-a')).toBe(false);

    cache.markRecordsChanged();
    expect(cache.isDataLeaseCurrent(recordsLease, 'token-a')).toBe(false);
  });

  test('data leases expire after token changes or the session generation resets', () => {
    const tokenLease = cache.captureDataLease('token-a', ['records', 'profile']);

    cache.captureDataLease('token-b', ['records', 'profile']);
    expect(cache.isDataLeaseCurrent(tokenLease, 'token-a')).toBe(false);
    expect(cache.isDataLeaseCurrent(tokenLease, 'token-b')).toBe(false);

    const generationLease = cache.captureDataLease('token-b', ['records']);
    expect(cache.isDataLeaseCurrent(generationLease, 'token-b')).toBe(true);
    cache.resetSessionData();
    expect(cache.isDataLeaseCurrent(generationLease, 'token-b')).toBe(false);
  });
});
