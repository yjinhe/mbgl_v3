// Medication list, daily check-ins and the medication reminder plan
// (docs/WECHAT-MEDICATION-SPEC.md). Everything shown comes from the user's own
// input: this module never carries drug names, suggestions or advice.
const { getToken, request } = require('./api');

const MAX_MEDICATIONS = 8;
const MAX_TIMES = 4;
const MAX_NAME_LENGTH = 20;
const MEDICATION_LIMIT_MESSAGE = '常用药最多 8 种';
const FOOTER_TEXT = '用药请遵医嘱，本功能只帮您记录和提醒。';
const CACHE_TTL_MS = 60 * 1000;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

let cache = null;
let inflight = null;

function isTime(value) {
  return TIME_PATTERN.test(String(value || ''));
}

// Trimmed, 1–20 characters. Returns `{ ok, value, message }`.
function validateName(name) {
  const value = String(name == null ? '' : name).trim();
  if (!value) return { ok: false, value, message: '请填写药名' };
  if (value.length > MAX_NAME_LENGTH) return { ok: false, value, message: `药名最多 ${MAX_NAME_LENGTH} 个字` };
  return { ok: true, value, message: '' };
}

// Valid 'HH:mm' values only, de-duplicated, ascending, at most four.
function normalizeTimes(times) {
  const list = Array.isArray(times) ? times : [];
  const seen = {};
  const result = [];
  for (const item of list) {
    const value = String(item == null ? '' : item).trim();
    if (!isTime(value) || seen[value]) continue;
    seen[value] = true;
    result.push(value);
  }
  return result.sort().slice(0, MAX_TIMES);
}

function normalizeMedication(source) {
  const item = source && typeof source === 'object' ? source : {};
  return {
    id: String(item.id || ''),
    name: String(item.name || ''),
    times: normalizeTimes(item.times)
  };
}

function normalizeMedications(list) {
  return (Array.isArray(list) ? list : []).map(normalizeMedication).filter((item) => item.id);
}

function normalizeToday(source) {
  const today = source && typeof source === 'object' ? source : {};
  const slots = (Array.isArray(today.slots) ? today.slots : [])
    .filter((slot) => slot && isTime(slot.time))
    .map((slot) => ({
      time: slot.time,
      items: (Array.isArray(slot.items) ? slot.items : [])
        .filter((item) => item && item.medicationId)
        .map((item) => ({
          medicationId: String(item.medicationId),
          name: String(item.name || ''),
          taken: Boolean(item.taken)
        }))
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
  return { day: String(today.day || ''), slots };
}

function normalizeState(data) {
  const source = data && typeof data === 'object' ? data : {};
  const reminder = source.reminder && typeof source.reminder === 'object' ? source.reminder : {};
  const quota = Number(reminder.quota);
  return {
    medications: normalizeMedications(source.medications),
    today: normalizeToday(source.today),
    reminder: { enabled: Boolean(reminder.enabled), quota: Number.isFinite(quota) ? Math.max(0, quota) : 0 },
    template: typeof source.template === 'string' ? source.template : ''
  };
}

function emptyState() {
  return normalizeState(null);
}

function invalidateMedications() {
  cache = null;
  inflight = null;
}

function loadMedications(options = {}) {
  const token = getToken();
  if (!token) return Promise.resolve(emptyState());
  if (!options.force && cache && cache.token === token && cache.expiresAt > Date.now()) {
    return Promise.resolve(cache.data);
  }
  if (!options.force && inflight && inflight.token === token) return inflight.promise;
  const clear = () => {
    if (inflight && inflight.promise === promise) inflight = null;
  };
  const promise = request('/api/app/medications').then((data) => {
    clear();
    const state = normalizeState(data);
    if (getToken() === token) cache = { token, data: state, expiresAt: Date.now() + CACHE_TTL_MS };
    return state;
  }, (error) => {
    clear();
    throw error;
  });
  inflight = { token, promise };
  return promise;
}

// Creates (`id` empty) or updates a medication. Validation errors reject with
// a user-facing message so pages can toast them directly.
function saveMedication(id, body = {}) {
  const name = validateName(body.name);
  if (!name.ok) return Promise.reject(new Error(name.message));
  const times = normalizeTimes(body.times);
  if (!times.length) return Promise.reject(new Error('请选择每天什么时候吃'));
  const data = { name: name.value, times };
  const path = id ? `/api/app/medications/${encodeURIComponent(id)}` : '/api/app/medications';
  return request(path, { method: id ? 'PATCH' : 'POST', data }).then((result) => {
    invalidateMedications();
    return normalizeMedication(result && result.medication);
  });
}

function removeMedication(id) {
  if (!id) return Promise.reject(new Error('记录不存在或已删除'));
  return request(`/api/app/medications/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => {
    invalidateMedications();
    return true;
  });
}

// Marks one medication at one slot as taken (or not) for today. Resolves the
// refreshed `today` block and keeps the cached list in sync with it.
function checkin(body = {}) {
  const data = {
    day: String(body.day || ''),
    slot: String(body.slot || ''),
    medicationId: String(body.medicationId || ''),
    taken: Boolean(body.taken)
  };
  return request('/api/app/medications/checkins', { method: 'POST', data }).then((result) => {
    const today = normalizeToday(result && result.today);
    if (cache && cache.token === getToken()) cache.data = Object.assign({}, cache.data, { today });
    return today;
  });
}

// Number of (slot, medication) pairs still unticked today.
function pendingCount(today) {
  const normalized = normalizeToday(today);
  return normalized.slots.reduce((total, slot) => total + slot.items.filter((item) => !item.taken).length, 0);
}

function medicationSummary(list) {
  const count = normalizeMedications(list).length;
  return count ? `${count} 种` : '未添加';
}

function isMedicationLimitError(error) {
  return Boolean(error && (error.code === 'MEDICATION_LIMIT' || error.statusCode === 422 && /最多 8 种/.test(error.message || '')));
}

function medicationErrorMessage(error, fallback = '保存失败，请稍后重试') {
  if (isMedicationLimitError(error)) return MEDICATION_LIMIT_MESSAGE;
  return (error && error.message) || fallback;
}

// Element id used with scroll-into-view, e.g. '08:00' → 'slot-0800'.
function slotId(time) {
  return isTime(time) ? `slot-${time.replace(':', '')}` : '';
}

module.exports = {
  FOOTER_TEXT,
  MAX_MEDICATIONS,
  MAX_NAME_LENGTH,
  MAX_TIMES,
  MEDICATION_LIMIT_MESSAGE,
  checkin,
  invalidateMedications,
  isMedicationLimitError,
  isTime,
  loadMedications,
  medicationErrorMessage,
  medicationSummary,
  normalizeState,
  normalizeTimes,
  normalizeToday,
  pendingCount,
  removeMedication,
  saveMedication,
  slotId,
  validateName
};
