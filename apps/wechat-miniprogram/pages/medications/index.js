// 我的常用药 (docs/WECHAT-MEDICATION-SPEC.md §3.1–3.2). The list and the daily
// check-ins work without a configured template; the reminder helper text and
// subscription requests only appear when the server reports one.
const { getToken } = require('../../utils/api');
const { captureDataLease, isDataLeaseCurrent } = require('../../utils/data-cache');
const { doLogin, ensureLogin, friendlyErrorMessage, handleRequestError } = require('../../utils/page');
const {
  FOOTER_TEXT,
  MAX_MEDICATIONS,
  MAX_NAME_LENGTH,
  MAX_TIMES,
  MEDICATION_LIMIT_MESSAGE,
  checkin,
  loadMedications,
  medicationErrorMessage,
  normalizeTimes,
  removeMedication,
  saveMedication,
  slotId,
  validateName
} = require('../../utils/medications');
const {
  reminderErrorMessage,
  reportSubscriptions,
  requestSubscribe,
  savePlan
} = require('../../utils/reminders');

// Offered in this order when the user taps "加一个时间".
const SUGGESTED_TIMES = ['08:00', '12:00', '18:00', '20:00'];
const TAKEN_TEXT = '已吃';
const NOT_TAKEN_TEXT = '吃了吗？';
const REMINDER_ON_NOTE = '到点会按这些时间提醒您，全部打勾后就不再提醒。';
const REMINDER_OFF_NOTE = '服药提醒未开启，可在「我的 → 测量提醒」打开。';
const FIRST_SAVE_HELP = '保存后会开启服药提醒。弹出提示时请勾选「总是保持以上选择」，以后就不用每次确认';

let timeKeySeq = 0;

function nextTimeKey() {
  timeKeySeq += 1;
  return `t${timeKeySeq}`;
}

function timeEntries(times) {
  return times.map((value) => ({ key: nextTimeKey(), value }));
}

Page({
  data: {
    authed: true,
    loading: false,
    day: '',
    slots: [],
    medications: [],
    hasMedications: false,
    canAdd: true,
    reminderAvailable: false,
    reminderEnabled: false,
    reminderNote: '',
    busyKey: '',
    scrollTo: '',
    sheetOn: '',
    sheetTitle: '添加常用药',
    editingId: '',
    formName: '',
    formTimes: [],
    canAddTime: true,
    canRemoveTime: false,
    firstSaveHelp: '',
    saving: false,
    maxNameLength: MAX_NAME_LENGTH,
    footerText: FOOTER_TEXT,
    navStyle: ''
  },

  onLoad(options = {}) {
    this._state = null;
    this._targetSlot = typeof options.slot === 'string' ? options.slot : '';
    this.setData({ navStyle: getApp().globalData.navStyle });
  },

  onShow() {
    return this.load();
  },

  async login() {
    await doLogin(this, () => this.load());
  },

  async load(options = {}) {
    if (!(await ensureLogin(this))) return;
    const requestToken = getToken();
    const lease = captureDataLease(requestToken, []);
    try {
      this.setData({ loading: true });
      const state = await loadMedications(options);
      if (!isDataLeaseCurrent(lease, getToken())) return;
      this.applyState(state);
    } catch (error) {
      if (!isDataLeaseCurrent(lease, getToken())) return;
      if (handleRequestError(this, error, requestToken)) return;
      wx.showToast({ title: friendlyErrorMessage(error, '加载失败'), icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyState(state) {
    this._state = state;
    const reminderAvailable = Boolean(state.template);
    const hasMedications = state.medications.length > 0;
    const patch = {
      authed: true,
      medications: state.medications.map((item) => ({
        id: item.id,
        name: item.name,
        timesText: item.times.join('　')
      })),
      hasMedications,
      canAdd: state.medications.length < MAX_MEDICATIONS,
      reminderAvailable,
      reminderEnabled: state.reminder.enabled,
      reminderNote: reminderAvailable && hasMedications
        ? (state.reminder.enabled ? REMINDER_ON_NOTE : REMINDER_OFF_NOTE)
        : ''
    };
    Object.assign(patch, this.todayPatch(state.today));
    // Deep link from a reminder: jump to that slot once the list is rendered.
    const target = slotId(this._targetSlot);
    if (target && patch.slots.some((slot) => slot.id === target)) patch.scrollTo = target;
    this._targetSlot = '';
    this.setData(patch);
  },

  todayPatch(today) {
    return {
      day: today.day,
      slots: today.slots.map((slot) => ({
        time: slot.time,
        id: slotId(slot.time),
        items: slot.items.map((item) => ({
          medicationId: item.medicationId,
          name: item.name,
          taken: item.taken,
          key: `${slot.time}:${item.medicationId}`,
          stateClass: item.taken ? 'on' : '',
          stateText: item.taken ? TAKEN_TEXT : NOT_TAKEN_TEXT,
          stateIcon: item.taken ? '✓' : '○'
        }))
      }))
    };
  },

  reminderTemplates() {
    const state = this._state;
    return state && state.template ? { medication: state.template } : {};
  },

  // Spec §3.2: one tap toggles 吃了吗？ ↔ 已吃 ✓ and doubles as a quota
  // request. The dialog must open synchronously inside the tap.
  async toggleTaken(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const slot = String(dataset.slot || '');
    const medicationId = String(dataset.id || '');
    const key = `${slot}:${medicationId}`;
    const state = this._state;
    if (!slot || !medicationId || !state || this.data.busyKey) return;
    const current = this.findItem(slot, medicationId);
    if (!current) return;
    const subscribing = requestSubscribe(this.reminderTemplates(), ['medication']);
    const requestToken = getToken();
    const lease = captureDataLease(requestToken, []);
    this.setData({ busyKey: key });
    try {
      const today = await checkin({ day: this.data.day, slot, medicationId, taken: !current.taken });
      if (!isDataLeaseCurrent(lease, getToken())) return;
      state.today = today;
      this.setData(this.todayPatch(today));
      const result = await subscribing;
      await reportSubscriptions(result && result.accepted);
    } catch (error) {
      if (!isDataLeaseCurrent(lease, getToken())) return;
      if (handleRequestError(this, error, requestToken)) return;
      wx.showToast({ title: friendlyErrorMessage(error, '记录失败，请稍后重试'), icon: 'none' });
      // The day may have rolled over; reload so the buttons reflect today.
      this.load({ force: true });
    } finally {
      this.setData({ busyKey: '' });
    }
  },

  findItem(slot, medicationId) {
    const group = this.data.slots.find((item) => item.time === slot);
    return group ? group.items.find((item) => item.medicationId === medicationId) || null : null;
  },

  openAdd() {
    if (!this.data.canAdd) {
      wx.showToast({ title: MEDICATION_LIMIT_MESSAGE, icon: 'none' });
      return;
    }
    const state = this._state;
    const firstEver = Boolean(state && state.template && !state.reminder.enabled && !state.medications.length);
    this.openSheet({
      sheetTitle: '添加常用药',
      editingId: '',
      formName: '',
      formTimes: timeEntries([SUGGESTED_TIMES[0]]),
      firstSaveHelp: firstEver ? FIRST_SAVE_HELP : ''
    });
  },

  openEdit(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset.id;
    const state = this._state;
    const medication = state && state.medications.find((item) => item.id === id);
    if (!medication) return;
    this.openSheet({
      sheetTitle: '修改常用药',
      editingId: medication.id,
      formName: medication.name,
      formTimes: timeEntries(medication.times.length ? medication.times : [SUGGESTED_TIMES[0]]),
      firstSaveHelp: ''
    });
  },

  openSheet(patch) {
    this.setData(Object.assign({ sheetOn: 'on' }, patch, this.timeLimits(patch.formTimes)));
  },

  closeSheet() {
    if (this.data.saving) return;
    this.setData({ sheetOn: '' });
  },

  timeLimits(times) {
    return {
      canAddTime: times.length < MAX_TIMES,
      canRemoveTime: times.length > 1
    };
  },

  onNameInput(event) {
    const value = String((event && event.detail && event.detail.value) || '').slice(0, MAX_NAME_LENGTH);
    this.setData({ formName: value });
  },

  onTimeChange(event) {
    const index = Number(event && event.currentTarget && event.currentTarget.dataset.index);
    const value = event && event.detail && event.detail.value;
    const times = this.data.formTimes.slice();
    if (!times[index] || typeof value !== 'string') return;
    times[index] = { key: times[index].key, value };
    this.setData({ formTimes: times });
  },

  addTime() {
    const times = this.data.formTimes;
    if (times.length >= MAX_TIMES) return;
    const used = times.map((item) => item.value);
    const value = SUGGESTED_TIMES.find((time) => !used.includes(time)) || SUGGESTED_TIMES[0];
    const next = times.concat([{ key: nextTimeKey(), value }]);
    this.setData(Object.assign({ formTimes: next }, this.timeLimits(next)));
  },

  removeTime(event) {
    const index = Number(event && event.currentTarget && event.currentTarget.dataset.index);
    const times = this.data.formTimes;
    if (times.length <= 1) {
      wx.showToast({ title: '至少保留一个时间', icon: 'none' });
      return;
    }
    if (!times[index]) return;
    const next = times.filter((item, position) => position !== index);
    this.setData(Object.assign({ formTimes: next }, this.timeLimits(next)));
  },

  // Spec §3.1: saving the first medication is a tap, so it also opens the
  // subscription dialog (synchronously) and turns the reminder plan on.
  async saveForm() {
    if (this.data.saving) return;
    const state = this._state;
    if (!state) return;
    const name = validateName(this.data.formName);
    if (!name.ok) {
      wx.showToast({ title: name.message, icon: 'none' });
      return;
    }
    const times = normalizeTimes(this.data.formTimes.map((item) => item.value));
    if (!times.length) {
      wx.showToast({ title: '请选择每天什么时候吃', icon: 'none' });
      return;
    }
    const editingId = this.data.editingId;
    const firstEver = !editingId && Boolean(state.template) && !state.reminder.enabled && !state.medications.length;
    const subscribing = firstEver ? requestSubscribe(this.reminderTemplates(), ['medication']) : null;
    const requestToken = getToken();
    const lease = captureDataLease(requestToken, []);
    this.setData({ saving: true });
    try {
      await saveMedication(editingId, { name: name.value, times });
      if (!isDataLeaseCurrent(lease, getToken())) return;
      let reminderOn = false;
      if (firstEver) {
        try {
          const plan = await savePlan('medication', { enabled: true });
          reminderOn = Boolean(plan && plan.enabled);
        } catch (error) {
          // The medication is saved either way; the switch stays available
          // in 我的 → 测量提醒.
          wx.showToast({ title: reminderErrorMessage(error, '提醒开启失败，可稍后在测量提醒里打开'), icon: 'none' });
        }
        const result = await subscribing;
        await reportSubscriptions(result && result.accepted);
      }
      if (!isDataLeaseCurrent(lease, getToken())) return;
      this.setData({ sheetOn: '' });
      await this.load({ force: true });
      if (!isDataLeaseCurrent(lease, getToken())) return;
      if (!firstEver || !reminderOn) wx.showToast({ title: editingId ? '已修改' : '已添加', icon: 'none' });
      else wx.showToast({ title: '已添加，到点会提醒您', icon: 'none' });
    } catch (error) {
      if (!isDataLeaseCurrent(lease, getToken())) return;
      if (handleRequestError(this, error, requestToken)) return;
      wx.showToast({ title: medicationErrorMessage(error, friendlyErrorMessage(error, '保存失败，请稍后重试')), icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  removeItem(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset.id;
    const medication = this.data.medications.find((item) => item.id === id);
    if (!medication || this.data.saving) return;
    wx.showModal({
      title: `删除「${medication.name}」？`,
      content: '删除后不再提醒这一种，之前打勾的记录会保留。',
      cancelText: '再想想',
      confirmText: '删除',
      confirmColor: '#D6453D',
      success: (result) => {
        if (result.confirm) this.performRemove(id);
      }
    });
  },

  async performRemove(id) {
    const requestToken = getToken();
    const lease = captureDataLease(requestToken, []);
    this.setData({ saving: true });
    try {
      await removeMedication(id);
      if (!isDataLeaseCurrent(lease, getToken())) return;
      await this.load({ force: true });
      if (!isDataLeaseCurrent(lease, getToken())) return;
      wx.showToast({ title: '已删除', icon: 'none' });
    } catch (error) {
      if (!isDataLeaseCurrent(lease, getToken())) return;
      if (handleRequestError(this, error, requestToken)) return;
      wx.showToast({ title: friendlyErrorMessage(error, '删除失败，请稍后重试'), icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  goReminders() {
    wx.navigateTo({ url: '/pages/reminders/index' });
  },

  back() {
    wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/mine/index' }) });
  }
});
