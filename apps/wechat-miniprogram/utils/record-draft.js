const RECORD_DRAFT_KEY = 'tangji_record_drafts_v1';
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function newRecordRequestId() {
  return `record-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

function clearRecordDrafts() {
  try {
    if (typeof wx !== 'undefined' && wx.removeStorageSync) wx.removeStorageSync(RECORD_DRAFT_KEY);
  } catch (_) { /* Storage may be unavailable; in-memory editing still works. */ }
}

function readRecordDrafts(ownerId) {
  if (!ownerId) return {};
  try {
    const saved = wx.getStorageSync(RECORD_DRAFT_KEY);
    if (!saved) return {};
    if (saved.ownerId !== ownerId || !Number.isFinite(saved.savedAt)
      || Date.now() - saved.savedAt > DRAFT_TTL_MS || !saved.drafts || typeof saved.drafts !== 'object') {
      clearRecordDrafts();
      return {};
    }
    return saved.drafts;
  } catch (_) {
    return {};
  }
}

function writeRecordDrafts(ownerId, drafts) {
  if (!ownerId) return false;
  try {
    if (!Object.keys(drafts).length) {
      clearRecordDrafts();
      return true;
    }
    wx.setStorageSync(RECORD_DRAFT_KEY, { ownerId, savedAt: Date.now(), drafts });
    return true;
  } catch (_) {
    return false;
  }
}

function removeRecordDraft(ownerId, metric) {
  const drafts = readRecordDrafts(ownerId);
  delete drafts[metric];
  writeRecordDrafts(ownerId, drafts);
}

module.exports = { clearRecordDrafts, newRecordRequestId, readRecordDrafts, removeRecordDraft, writeRecordDrafts };
