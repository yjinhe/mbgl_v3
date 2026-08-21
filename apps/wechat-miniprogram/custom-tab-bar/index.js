const {
  TAB_ITEMS,
  clearRecordReturnPath,
  currentRoute,
  selectedTabIndex,
  setRecordReturnPath
} = require('../utils/tabbar');

Component({
  data: {
    hidden: false,
    selected: 0,
    items: TAB_ITEMS
  },

  lifetimes: {
    attached() {
      this._switching = false;
      this.syncSelected();
    }
  },

  pageLifetimes: {
    show() {
      this.syncSelected();
    }
  },

  methods: {
    syncSelected() {
      const route = currentRoute();
      const hidden = route === 'pages/record/index';
      const selected = selectedTabIndex(route);
      const updates = {};

      if (hidden !== this.data.hidden) updates.hidden = hidden;
      if (selected >= 0 && selected !== this.data.selected) updates.selected = selected;
      if (Object.keys(updates).length) this.setData(updates);
    },

    switchTab(event) {
      if (this._switching) return;
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.items[index];
      const route = currentRoute();
      if (!item || route === item.pagePath) return;

      if (item.key === 'record' && route && route !== item.pagePath) {
        setRecordReturnPath(`/${route}`);
      }
      if (route === 'pages/record/index' && item.key !== 'record') {
        clearRecordReturnPath();
      }

      this._switching = true;
      wx.switchTab({
        url: item.url,
        fail: () => {
          if (item.key === 'record') clearRecordReturnPath();
          this.syncSelected();
        },
        complete: () => {
          this._switching = false;
        }
      });
    }
  }
});
