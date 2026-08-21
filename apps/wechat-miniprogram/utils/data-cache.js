const DEFAULT_TTL_MS = 2 * 60 * 1000;

let generation = 0;
let activeToken = '';
let hasActiveToken = false;
let meEpoch = 0;
let meCache = null;
let meInflight = null;
let pageFreshness = new WeakMap();
let versions = createVersions();

function createVersions() {
  return { records: 0, profile: 0 };
}

function normalizeToken(token) {
  return String(token || '');
}

function normalizeTtl(value) {
  const candidate = typeof value === 'number'
    ? value
    : value && (value.ttlMs !== undefined ? value.ttlMs : value.ttl);
  if (candidate === Infinity) return Infinity;
  return Number.isFinite(candidate) && candidate >= 0 ? candidate : DEFAULT_TTL_MS;
}

function activateToken(token) {
  const normalized = normalizeToken(token);
  if (!hasActiveToken) {
    activeToken = normalized;
    hasActiveToken = true;
    return normalized;
  }
  if (activeToken !== normalized) {
    generation += 1;
    activeToken = normalized;
    meEpoch += 1;
    meCache = null;
    meInflight = null;
    pageFreshness = new WeakMap();
    versions = createVersions();
  }
  return normalized;
}

function currentVersionSnapshot() {
  return { records: versions.records, profile: versions.profile };
}

function versionsMatch(snapshot) {
  return snapshot
    && snapshot.records === versions.records
    && snapshot.profile === versions.profile;
}

function cacheMe(token, value, loadedAt = Date.now()) {
  meCache = {
    token,
    value,
    loadedAt,
    generation,
    meEpoch,
    versions: currentVersionSnapshot()
  };
  return value;
}

function isMeFresh(token, ttl) {
  return Boolean(
    meCache
      && meCache.token === token
      && meCache.generation === generation
      && meCache.meEpoch === meEpoch
      && versionsMatch(meCache.versions)
      && Date.now() - meCache.loadedAt < ttl
  );
}

function getMeCached(token, loader, options = {}) {
  const normalized = activateToken(token);
  const ttl = normalizeTtl(options);
  const force = Boolean(options && typeof options === 'object' && options.force);

  if (!force && isMeFresh(normalized, ttl)) {
    return Promise.resolve(meCache.value);
  }

  if (
    meInflight
      && meInflight.token === normalized
      && meInflight.generation === generation
      && meInflight.meEpoch === meEpoch
      && versionsMatch(meInflight.versions)
  ) {
    return meInflight.promise;
  }

  if (typeof loader !== 'function') {
    return Promise.reject(new TypeError('getMeCached requires a loader when the cache is stale'));
  }

  const requestState = {
    token: normalized,
    generation,
    meEpoch,
    versions: currentVersionSnapshot(),
    promise: null
  };
  const promise = Promise.resolve()
    .then(() => loader())
    .then((value) => {
      if (
        requestState.generation === generation
          && requestState.meEpoch === meEpoch
          && hasActiveToken
          && activeToken === normalized
          && versionsMatch(requestState.versions)
      ) {
        cacheMe(normalized, value);
      }
      return value;
    })
    .finally(() => {
      if (meInflight === requestState) meInflight = null;
    });

  requestState.promise = promise;
  meInflight = requestState;
  return promise;
}

function setCachedMe(token, value) {
  const normalized = activateToken(token);
  return cacheMe(normalized, value);
}

function invalidateMe() {
  meEpoch += 1;
  meCache = null;
  meInflight = null;
}

function markRecordsChanged() {
  versions.records += 1;
  invalidateMe();
  return versions.records;
}

function markProfileChanged(token, updatedMe) {
  const normalized = activateToken(token);
  const previous = meCache
    && meCache.token === normalized
    && meCache.generation === generation
    ? meCache
    : null;

  versions.profile += 1;
  invalidateMe();

  if (updatedMe !== undefined) {
    const value = previous
      && previous.value
      && typeof previous.value === 'object'
      && updatedMe
      && typeof updatedMe === 'object'
      ? Object.assign({}, previous.value, updatedMe)
      : updatedMe;
    cacheMe(normalized, value, previous ? previous.loadedAt : Date.now());
    return value;
  }
  return undefined;
}

function resetSessionData() {
  generation += 1;
  activeToken = '';
  hasActiveToken = false;
  meEpoch += 1;
  meCache = null;
  meInflight = null;
  pageFreshness = new WeakMap();
  versions = createVersions();
}

function normalizeDomains(domains) {
  const values = Array.isArray(domains) ? domains : domains == null ? [] : [domains];
  const normalized = [];
  for (const domain of values) {
    if ((domain === 'records' || domain === 'profile') && !normalized.includes(domain)) {
      normalized.push(domain);
    }
  }
  return normalized;
}

function validPage(page) {
  return page !== null && (typeof page === 'object' || typeof page === 'function');
}

function captureDataLease(token, domains) {
  const normalizedToken = activateToken(token);
  const domainList = normalizeDomains(domains);
  const snapshot = {};
  for (const domain of domainList) snapshot[domain] = versions[domain];
  return {
    token: normalizedToken,
    generation,
    domains: domainList,
    versions: snapshot
  };
}

function isDataLeaseCurrent(lease, token) {
  if (!lease || typeof lease !== 'object') return false;
  const normalizedToken = normalizeToken(token);
  if (
    lease.generation !== generation
      || lease.token !== normalizedToken
      || !hasActiveToken
      || activeToken !== normalizedToken
  ) {
    return false;
  }
  const domainList = normalizeDomains(lease.domains);
  return domainList.every((domain) => (
    lease.versions
      && lease.versions[domain] === versions[domain]
  ));
}

function isPageFresh(page, key, domains, token, ttl = DEFAULT_TTL_MS) {
  if (!validPage(page)) return false;
  const pageState = pageFreshness.get(page);
  const marker = pageState && pageState.get(String(key));
  const normalizedToken = normalizeToken(token);
  const domainList = normalizeDomains(domains);
  const ttlMs = normalizeTtl(ttl);
  if (
    !marker
      || marker.generation !== generation
      || marker.token !== normalizedToken
      || (hasActiveToken && activeToken !== normalizedToken)
      || Date.now() - marker.markedAt >= ttlMs
  ) {
    return false;
  }
  return domainList.every((domain) => marker.versions[domain] === versions[domain]);
}

function markPageFresh(page, key, domains, token) {
  if (!validPage(page)) return false;
  const normalizedToken = activateToken(token);
  const domainList = normalizeDomains(domains);
  let pageState = pageFreshness.get(page);
  if (!pageState) {
    pageState = new Map();
    pageFreshness.set(page, pageState);
  }
  const snapshot = {};
  for (const domain of domainList) snapshot[domain] = versions[domain];
  pageState.set(String(key), {
    token: normalizedToken,
    generation,
    markedAt: Date.now(),
    versions: snapshot
  });
  return true;
}

module.exports = {
  DEFAULT_TTL_MS,
  captureDataLease,
  getMeCached,
  invalidateMe,
  isDataLeaseCurrent,
  isPageFresh,
  markPageFresh,
  markProfileChanged,
  markRecordsChanged,
  resetSessionData,
  setCachedMe
};
