import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  GLUCOSE_PERIOD_MAP,
  bpStatus,
  displayGlucose,
  glucoseStatus,
  inferBpPeriod,
  inferGlucosePeriod,
  lipidOverallStatus,
  lipidStatus,
  toMmol,
  uricStatus,
  uricThreshold,
  type Metric,
  type Unit
} from '@tangji/shared';
import './styles.css';

const API = import.meta.env.VITE_API_BASE || '';

type Tab = 'home' | 'history' | 'stats' | 'mine';
type Sub = 'bind' | 'recycle' | 'report' | null;
type ExportMetric = Metric | 'all';
type Status = { key: string; label: string };
type RecordAny = any;

const metrics: Array<{ k: Metric; n: string; u: string; c: string; soft: string }> = [
  { k: 'glucose', n: '血糖', u: 'mmol/L', c: 'var(--m-glucose)', soft: 'var(--m-glucose-soft)' },
  { k: 'bp', n: '血压', u: 'mmHg', c: 'var(--m-bp)', soft: 'var(--m-bp-soft)' },
  { k: 'lipid', n: '血脂', u: 'mmol/L', c: 'var(--m-lipid)', soft: 'var(--m-lipid-soft)' },
  { k: 'uric', n: '尿酸', u: 'μmol/L', c: 'var(--m-uric)', soft: 'var(--m-uric-soft)' }
];

const periodNames: Record<string, string> = {
  fasting: '空腹',
  after_breakfast: '早餐后',
  before_lunch: '午餐前',
  after_lunch: '午餐后',
  random: '随机',
  before_dinner: '晚餐前',
  after_dinner: '晚餐后',
  bedtime: '睡前',
  dawn: '凌晨',
  morning: '晨起',
  daytime: '白天',
  evening: '晚间',
  night: '夜间'
};

const glucosePeriods = ['fasting', 'after_breakfast', 'before_lunch', 'after_lunch', 'before_dinner', 'after_dinner', 'bedtime', 'dawn', 'random'];
const bpPeriods = ['morning', 'daytime', 'evening', 'night'];
const glucoseTags = ['运动后', '聚餐', '加餐', '感冒', '熬夜', '情绪波动'];
const bpTags = ['服药前', '服药后', '运动后', '情绪波动'];
const lipidItems = [
  ['tc', '总胆固醇', 'TC', '<5.2'],
  ['tg', '甘油三酯', 'TG', '<1.7'],
  ['ldl', '低密度脂蛋白', 'LDL-C', '<3.4'],
  ['hdl', '高密度脂蛋白', 'HDL-C', '≥1.0']
] as const;

const statusColor: Record<string, string> = {
  ok: 'var(--ok)',
  hi: 'var(--hi)',
  lo: 'var(--lo)',
  dhigh: 'var(--danger)',
  dlow: 'var(--danger)'
};

const exportOptions: Array<{ k: ExportMetric; n: string }> = [
  { k: 'glucose', n: '血糖（CSV）' },
  { k: 'bp', n: '血压（CSV）' },
  { k: 'lipid', n: '血脂（CSV）' },
  { k: 'uric', n: '尿酸（CSV）' },
  { k: 'all', n: '全部（ZIP）' }
];

function getToken() {
  return localStorage.getItem('tangji_app_token') || '';
}

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (res.status === 401) localStorage.removeItem('tangji_app_token');
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || res.statusText);
  if (res.status === 204) return null;
  return res.json();
}

async function downloadExport(metric: ExportMetric) {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(`${API}/api/app/export/csv?metric=${metric}`, { headers });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || res.statusText);
  const blob = await res.blob();
  const fallback = metric === 'all' ? `糖迹-健康记录-${downloadStamp()}.zip` : `糖迹-${metrics.find((m) => m.k === metric)?.n}记录-${downloadStamp()}.csv`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fallback;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function DropIcon({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="micon">
      <path d="M12 3.4S6.4 9.5 6.4 13.8a5.6 5.6 0 0 0 11.2 0C17.6 9.5 12 3.4 12 3.4z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function InlineDrop({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ display: 'inline-block', verticalAlign: '-3px' }}>
      <path d="M12 2.8S5.6 9.7 5.6 14.4a6.4 6.4 0 0 0 12.8 0C18.4 9.7 12 2.8 12 2.8z" fill={color} />
    </svg>
  );
}

function MetricIcon({ metric }: { metric: Metric }) {
  if (metric === 'glucose') return <DropIcon />;
  if (metric === 'bp') return <svg viewBox="0 0 24 24" fill="none" className="micon" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2.4-5.5L13 17l2.3-5H21" /></svg>;
  if (metric === 'lipid') return <svg viewBox="0 0 24 24" fill="none" className="micon" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5s-3 3.4-3 5.6a3 3 0 0 0 6 0c0-2.2-3-5.6-3-5.6z" /><path d="M6.5 13s-2 2.3-2 3.8a2 2 0 0 0 4 0c0-1.5-2-3.8-2-3.8zM17.5 13s-2 2.3-2 3.8a2 2 0 0 0 4 0c0-1.5-2-3.8-2-3.8z" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" className="micon" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 3l7 4v8l-7 4-7-4V7z" /><circle cx="12" cy="11.5" r="2.2" /></svg>;
}

function SheetTimeIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></svg>;
}

function DeleteKeyIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ink-2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 5h11A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-11L3 12l5.5-7z" /><path d="M12 9.5l5 5M17 9.5l-5 5" /></svg>;
}

function pill(status?: Status | null, withDot = false) {
  if (!status) return <span className="pill mut">无数据</span>;
  const cls = status.key === 'dhigh' || status.key === 'dlow' ? 'danger' : status.key;
  return <span className={`pill ${cls}`}>{withDot ? `● ${status.label}` : status.label}</span>;
}

function fmtTime(value: string | Date) {
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtMD(value: string | Date) {
  const d = new Date(value);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function dayLabel(value: string | Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - date.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${fmtMD(value)} ${weekdays[new Date(value).getDay()]}`;
}

function greetingAt(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return '夜深了';
  if (h < 9) return '早上好';
  if (h < 12) return '上午好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function localDateLine(d = new Date()) {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${fmtMD(d)} ${weekdays[d.getDay()]}`;
}

function downloadStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function toLocalInput(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function App() {
  const [token, setToken] = useState(getToken());
  const [tab, setTab] = useState<Tab>('home');
  const [me, setMe] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [records, setRecords] = useState<Record<Metric, RecordAny[]>>({ glucose: [], bp: [], lipid: [], uric: [] });
  const [metric, setMetric] = useState<Metric>('glucose');
  const [histMetric, setHistMetric] = useState<Metric>('glucose');
  const [statMetric, setStatMetric] = useState<Metric>('glucose');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<any>(null);
  const [sub, setSub] = useState<Sub>(null);
  const [exportSheet, setExportSheet] = useState(false);
  const [recordAction, setRecordAction] = useState<{ metric: Metric; record: any } | null>(null);

  async function login() {
    const res = await api('/api/app/auth/wechat', { method: 'POST', body: JSON.stringify({ code: 'seed_demo' }) });
    localStorage.setItem('tangji_app_token', res.token);
    setToken(res.token);
  }

  async function refresh() {
    if (!getToken()) return;
    const [meData, ov, g, b, l, u] = await Promise.all([
      api('/api/app/me'),
      api('/api/app/overview'),
      api('/api/app/records/glucose?limit=200'),
      api('/api/app/records/bp?limit=200'),
      api('/api/app/records/lipid?limit=200'),
      api('/api/app/records/uric?limit=200')
    ]);
    setMe(meData);
    setOverview(ov);
    setRecords({ glucose: g.items, bp: b.items, lipid: l.items, uric: u.items });
  }

  useEffect(() => {
    refresh().catch(() => setToken(''));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (location.pathname.includes('bind-pharmacy')) setSub('bind');
    if (location.pathname.includes('report')) setSub('report');
    if (location.pathname.includes('recycle-bin')) setSub('recycle');
  }, [token]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2100);
  }

  async function handleExport(metric: ExportMetric) {
    try {
      await downloadExport(metric);
      showToast(metric === 'all' ? '已打包导出全部记录（ZIP）' : `已导出 ${(records[metric] || []).length} 条记录（CSV）`);
    } catch (e: any) {
      showToast(e.message);
    }
  }

  async function deleteRecord(metric: Metric, record: any) {
    await api(`/api/app/records/${metric}/${record.id}`, { method: 'DELETE' });
    setRecordAction(null);
    showToast('已删除 · 7 天内可在回收站找回');
    await refresh();
  }

  if (!token) {
    return (
      <div className="app-stage">
        <div className="device">
          <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <div className="login-card">
              <div className="me-head" style={{ padding: 0, marginBottom: 18 }}>
                <div className="avatar"><DropIcon color="#fff" /></div>
                <div><div className="n">糖迹</div><div className="d">5 秒记一次健康数据</div></div>
              </div>
              <button className="btn primary" onClick={login}>微信一键登录</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-stage">
      <div className="device">
        <div className="screen" id="screen">
          <StatusBar />
          <div className="navbar"><div className="title">{tabTitle(tab)}</div><Capsule /></div>
          <div className="pages">
            <section className={`page ${tab === 'home' ? 'on' : ''}`}><Home overview={overview} me={me} setTab={setTab} setStatMetric={setStatMetric} /></section>
            <section className={`page ${tab === 'history' ? 'on' : ''}`}><History records={records} metric={histMetric} setMetric={setHistMetric} openRecord={(metric: Metric, record: any) => setRecordAction({ metric, record })} /></section>
            <section className={`page ${tab === 'stats' ? 'on' : ''}`}><Stats records={records} metric={statMetric} setMetric={setStatMetric} me={me} openReport={() => setSub('report')} /></section>
            <section className={`page ${tab === 'mine' ? 'on' : ''}`}><Mine me={me} refresh={refresh} showToast={showToast} openBind={() => setSub('bind')} openRecycle={() => setSub('recycle')} openExport={() => setExportSheet(true)} setModal={setModal} /></section>
            {sub === 'bind' && <BindSub close={() => setSub(null)} refresh={refresh} showToast={showToast} setModal={setModal} />}
            {sub === 'report' && <ReportSub close={() => setSub(null)} showToast={showToast} openExport={() => setExportSheet(true)} />}
            {sub === 'recycle' && <RecycleSub close={() => setSub(null)} refresh={refresh} showToast={showToast} />}
          </div>
          <TabBar tab={tab} setTab={setTab} openSheet={() => { setMetric(metric); setSheetOpen(true); }} />
          <div className={`mask ${sheetOpen || modal || exportSheet || recordAction ? 'on' : ''}`} onClick={() => { setSheetOpen(false); setModal(null); setExportSheet(false); setRecordAction(null); }} />
          <RecordSheet open={sheetOpen} metric={metric} setMetric={setMetric} me={me} refresh={refresh} close={() => setSheetOpen(false)} showToast={showToast} setModal={setModal} />
          <ActionSheet open={exportSheet} close={() => setExportSheet(false)} items={exportOptions.map((item) => ({ label: item.n, action: () => handleExport(item.k) }))} />
          <ActionSheet open={Boolean(recordAction)} close={() => setRecordAction(null)} items={[{ label: '删除记录', warn: true, action: () => { if (recordAction) return deleteRecord(recordAction.metric, recordAction.record); } }]} />
          {modal && <SafetyModal modal={modal} close={() => setModal(null)} />}
          <div className={`toast ${toast ? 'on' : ''}`}>{toast}</div>
        </div>
      </div>
    </div>
  );
}

function tabTitle(tab: Tab) {
  if (tab === 'home') return <><InlineDrop color="var(--brand)" /><span>糖迹</span></>;
  return { history: '历史记录', stats: '健康统计', mine: '我的' }[tab];
}

function StatusBar() {
  return <div className="statusbar"><span className="num">9:41</span><span className="icons"><svg width="17" height="12" viewBox="0 0 17 12"><g fill="var(--ink)"><rect x="0" y="7" width="3" height="5" rx="1"/><rect x="4.5" y="5" width="3" height="7" rx="1"/><rect x="9" y="2.5" width="3" height="9.5" rx="1"/><rect x="13.5" y="0" width="3" height="12" rx="1"/></g></svg><svg width="25" height="12" viewBox="0 0 25 12"><rect x="0.5" y="0.5" width="21" height="11" rx="3.2" fill="none" stroke="var(--ink)" strokeOpacity=".4"/><rect x="2" y="2" width="14" height="8" rx="1.8" fill="var(--ink)"/></svg></span></div>;
}

function Capsule() {
  return <div className="capsule"><span className="dots"><i /><i /><i /></span><span className="sep" /><span className="target" /></div>;
}

function TabBar({ tab, setTab, openSheet }: { tab: Tab; setTab: (tab: Tab) => void; openSheet: () => void }) {
  const item = (id: Tab, label: string, icon: React.ReactNode) => <button className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}><svg viewBox="0 0 24 24">{icon}</svg>{label}</button>;
  return (
    <nav className="tabbar">
      {item('home', '首页', <path d="M3.5 10.5 12 3.5l8.5 7v9a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5a1.5 1.5 0 0 1-1.5-1.5z" />)}
      {item('history', '历史', <path d="M4 5.5h16M4 12h16M4 18.5h10" />)}
      <div className="fab-slot"><button className="fab" onClick={openSheet}><svg viewBox="0 0 24 24" fill="none"><path d="M12 2.8S5.6 9.7 5.6 14.4a6.4 6.4 0 0 0 12.8 0C18.4 9.7 12 2.8 12 2.8z" fill="#fff" fillOpacity=".22" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" /><path d="M12 9.2v6.4M8.8 12.4h6.4" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" /></svg></button><span className="fab-label">记一笔</span></div>
      {item('stats', '统计', <path d="M4 19.5h16M7 16v-5M12 16V7.5M17 16v-3" />)}
      {item('mine', '我的', <><circle cx="12" cy="8.2" r="3.6" /><path d="M4.8 20a7.6 7.6 0 0 1 14.4 0" /></>)}
    </nav>
  );
}

function Home({ overview, me, setTab, setStatMetric }: any) {
  const latest = overview?.glucose?.latest;
  const target = me?.target || { fastingLow: 4.4, fastingHigh: 7.0, postMealHigh: 10.0 };
  const unit = (me?.unit || 'mmol') as Unit;
  const targetHigh = latest && GLUCOSE_PERIOD_MAP[latest.period as keyof typeof GLUCOSE_PERIOD_MAP]?.type === 'fast' ? target.fastingHigh : target.postMealHigh;
  const dotLeft = latest ? Math.max(0, Math.min(100, ((latest.valueMmol - 2) / 18) * 100)) : 0;
  const tirBandLeft = ((3.9 - 2) / 18) * 100;
  const tirBandWidth = ((10 - 3.9) / 18) * 100;
  const now = new Date();
  return (
    <>
      <div className="greet"><div><h2>{greetingAt(now)}</h2><div className="date">{localDateLine(now)} · 今天已记 {overview?.todayCount ?? 0} 笔</div></div><div className="streak">🔥 连续记录 {overview?.streak ?? 0} 天</div></div>
      <div className="hero">
        {latest ? (
          <>
            <div className="lab"><span>血糖 · 最近一次 · {latest.periodName}</span><span className="num">{dayLabel(latest.measuredAt)} {fmtTime(latest.measuredAt)}</span></div>
            <div className="read"><span className="v num">{displayGlucose(latest.valueMmol, unit)}</span><span className="u">{unit === 'mgdl' ? 'mg/dL' : 'mmol/L'}</span></div>
            <div className="meta">{pill(latest.status, true)}<span>目标 {displayGlucose(target.fastingLow, unit)}–{displayGlucose(targetHigh, unit)} {unit === 'mgdl' ? 'mg/dL' : 'mmol/L'}</span></div>
            <div className="gauge"><span className="band" style={{ left: `${tirBandLeft}%`, width: `${tirBandWidth}%` }} /><span className="dot" style={{ left: `${dotLeft}%`, background: statusColor[latest.status.key] }} /></div>
            <div className="gx num"><span>2.0</span><span>10.0</span><span>20.0</span></div>
          </>
        ) : <div className="hero-empty">还没有记录{'\n'}点下方水滴按钮，记下第一条血糖</div>}
      </div>
      {(['bp', 'lipid', 'uric'] as Metric[]).map((m) => <MetricCard key={m} metric={m} overview={overview} setTab={setTab} setStatMetric={setStatMetric} me={me} />)}
      <div className="foot-note">点击任意指标卡查看统计详情</div>
    </>
  );
}

function MetricCard({ metric, overview, setTab, setStatMetric, me }: any) {
  const meta = metrics.find((m) => m.k === metric)!;
  const latest = overview?.[metric]?.latest;
  const dateLabel = latest ? (metric === 'lipid' ? `${fmtMD(latest.measuredAt)} 化验` : metric === 'bp' ? `最近一次 · ${latest.periodName}` : '最近一次') : '';
  return (
    <div className="mcard" onClick={() => { setStatMetric(metric); setTab('stats'); }}>
      <div className="brow"><span className="mic" style={{ background: meta.soft, color: meta.c }}><MetricIcon metric={metric} /></span><span className="bt">{meta.n}</span><span>{dateLabel}</span><span className={`when ${latest && metric !== 'lipid' ? 'num' : ''}`}>{latest ? (metric === 'lipid' ? pill(latest.status) : `${dayLabel(latest.measuredAt)} ${fmtTime(latest.measuredAt)}`) : ''}</span></div>
      {!latest ? <div className="empty" style={{ padding: '8px 0' }}>还没有{meta.n}记录 · 点下方按钮记一笔</div> : metric === 'bp' ? (
        <><div className="mainrow"><span className="mv bpv num" style={{ color: statusColor[latest.status.key] }}>{latest.sbp}/{latest.dbp}</span><span className="mu">mmHg</span><span className="mu">♥ {latest.pulse || '-'}</span><span style={{ marginLeft: 'auto' }}>{pill(latest.status)}</span></div><div className="sub">家庭自测参考 &lt;135/85</div></>
      ) : metric === 'lipid' ? (
        <div className="lgrid">{lipidItems.map(([k, , ab]) => <div className="li" key={k}><span>{ab}</span><b className="num" style={{ color: latest.itemStatus[k] ? statusColor[latest.itemStatus[k]] : 'var(--ink-3)' }}>{latest[k] ?? '—'}</b></div>)}</div>
      ) : (
        <><div className="mainrow"><span className="mv num" style={{ color: statusColor[latest.status.key] }}>{latest.value}</span><span className="mu">μmol/L</span><span style={{ marginLeft: 'auto' }}>{pill(latest.status)}</span></div><div className="sub">参考上限 &lt;{uricThreshold(me?.sex)}{me?.sex === 'male' ? '（男）' : me?.sex === 'female' ? '（女）' : ''}</div></>
      )}
    </div>
  );
}

function History({ records, metric, setMetric, openRecord }: any) {
  return (
    <>
      <div className="msg" style={{ margin: '4px 0 10px' }}>{metrics.map((m) => <button key={m.k} className={metric === m.k ? 'on' : ''} onClick={() => setMetric(m.k)}>{m.n}</button>)}</div>
      {metric === 'glucose' && <div className="chiprow"><button className="chip on">全部</button>{glucosePeriods.map((p) => <button className="chip" key={p}>{periodNames[p]}</button>)}</div>}
      {(records[metric] || []).length === 0 ? <div className="empty">暂无{metrics.find((m) => m.k === metric)?.n}记录</div> : records[metric].map((r: any) => <RecordRow key={r.id} metric={metric} record={r} onClick={() => openRecord(metric, r)} />)}
      <div className="foot-note">点击记录可编辑或删除 · 删除后 7 天内可在回收站找回</div>
    </>
  );
}

function RecordRow({ metric, record, onClick }: { metric: Metric; record: any; onClick?: () => void }) {
  const status = record.status;
  const read = readRecord(metric, record);
  return (
    <div className="rec" onClick={onClick}>
      <span className="bar" style={{ background: statusColor[status.key] }} />
      <div className="mid"><div className="l1">{periodNames[record.period] || (metric === 'lipid' ? '化验' : '')}<span className="tm num">{fmtMD(record.measuredAt)} {fmtTime(record.measuredAt)}</span>{pill(status)}</div><div className="l2">{record.note || '—'}</div></div>
      <div className="val num" style={{ color: statusColor[status.key] }}>{read}</div>
    </div>
  );
}

function readRecord(metric: Metric, record: any) {
  if (metric === 'glucose') return `${record.displayValue} mmol/L`;
  if (metric === 'bp') return `${record.sbp}/${record.dbp} mmHg${record.pulse ? ` · ♥${record.pulse}` : ''}`;
  if (metric === 'uric') return `${record.value} μmol/L`;
  return lipidItems.filter(([k]) => record[k] != null).map(([k, , ab]) => `${ab} ${record[k]}`).join(' · ');
}

function Stats({ records, metric, setMetric, me, openReport }: any) {
  const rs = records[metric] || [];
  const count = rs.length;
  return (
    <>
      <div className="msg" style={{ margin: '4px 0 10px' }}>{metrics.map((m) => <button key={m.k} className={metric === m.k ? 'on' : ''} onClick={() => setMetric(m.k)}>{m.n}</button>)}</div>
      {count === 0 ? <div className="empty">暂无数据</div> : <StatsBody metric={metric} records={rs} me={me} />}
      {metric === 'glucose' && <button className="btn primary" onClick={openReport}>生成健康周报</button>}
      <div className="foot-note">以上统计仅供参考，不构成诊疗建议，请遵医嘱。{metric === 'glucose' && <><br />GMI 基于 CGM 研究公式估算，请以静脉血 HbA1c 为准。</>}</div>
    </>
  );
}

function StatsBody({ metric, records, me }: any) {
  if (metric === 'glucose') {
    const vals = records.map((r: any) => r.valueMmol);
    const avg = vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
    return <><div className="mgrid"><MetricBox k="平均血糖" v={displayGlucose(avg, me?.unit || 'mmol')} u={me?.unit === 'mgdl' ? 'mg/dL' : 'mmol/L'} /><MetricBox k="达标率" v={`${Math.round(records.filter((r: any) => r.status.key === 'ok').length / records.length * 100)}`} u="%" /><MetricBox k="最高" v={displayGlucose(Math.max(...vals), me?.unit || 'mmol')} /><MetricBox k="最低" v={displayGlucose(Math.min(...vals), me?.unit || 'mmol')} /></div><div className="card"><div className="card-h"><span className="t">血糖趋势</span></div><MiniTrend records={records} metric={metric} /></div></>;
  }
  if (metric === 'bp') {
    const avgS = Math.round(records.reduce((s: number, r: any) => s + r.sbp, 0) / records.length);
    const avgD = Math.round(records.reduce((s: number, r: any) => s + r.dbp, 0) / records.length);
    return <><div className="mgrid"><MetricBox k="平均收缩压" v={avgS} u="mmHg" /><MetricBox k="平均舒张压" v={avgD} u="mmHg" /><MetricBox k="达标率" v={Math.round(records.filter((r: any) => r.status.key === 'ok').length / records.length * 100)} u="%" /><MetricBox k="平均脉搏" v={Math.round(records.reduce((s: number, r: any) => s + (r.pulse || 0), 0) / records.length)} /></div><div className="card"><div className="card-h"><span className="t">血压趋势</span></div><MiniTrend records={records} metric={metric} /></div></>;
  }
  if (metric === 'lipid') {
    const latest = records[0];
    return <div className="card"><div className="card-h"><span className="t">最近一次化验 · {fmtMD(latest.measuredAt)}</span>{pill(latest.status)}</div><div className="lgrid">{lipidItems.map(([k, n, , ref]) => <div className="li" key={k}><span>{n} <small>参考 {ref}</small></span><b className="num">{latest[k] ?? '—'}</b></div>)}</div></div>;
  }
  const latest = records[0];
  const avg = Math.round(records.reduce((s: number, r: any) => s + r.value, 0) / records.length);
  return <div className="mgrid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}><MetricBox k="最近一次" v={latest.value} u="μmol/L" /><MetricBox k="平均" v={avg} u="μmol/L" /><MetricBox k="达标率" v={Math.round(records.filter((r: any) => r.status.key === 'ok').length / records.length * 100)} u="%" /></div>;
}

function MetricBox({ k, v, u = '' }: any) {
  return <div className="metric"><div className="k">{k}</div><div className="v num">{v}<small>{u}</small></div></div>;
}

function MiniTrend({ records, metric }: any) {
  return <div style={{ height: 170, display: 'flex', alignItems: 'end', gap: 5, padding: '16px 4px' }}>{records.slice().reverse().slice(-24).map((r: any) => {
    const value = metric === 'bp' ? r.sbp : r.valueMmol;
    const h = Math.max(12, Math.min(130, value * (metric === 'bp' ? 0.7 : 9)));
    return <span key={r.id} title={fmtTime(r.measuredAt)} style={{ flex: 1, height: h, borderRadius: 8, background: statusColor[r.status.key], opacity: .8 }} />;
  })}</div>;
}

function Mine({ me, refresh, showToast, openBind, openRecycle, openExport, setModal }: any) {
  async function patch(data: any) {
    await api('/api/app/me', { method: 'PATCH', body: JSON.stringify(data) });
    await refresh();
  }
  async function unbind() {
    await api('/api/app/pharmacy/bind', { method: 'DELETE' });
    showToast('已解绑 · 该药房已无法查看你的记录');
    await refresh();
  }
  function confirmUnbind() {
    if (!me?.binding) return;
    setModal({
      title: `解除与「${me.binding.pharmacyName}」的绑定？`,
      ring: 'var(--danger-soft)',
      icon: '⚠️',
      body: '解绑后该药房将立即无法查看你的任何记录（含历史数据）。如需再次获得服务，可重新输入邀请码绑定。',
      actions: [{ t: '再想想' }, { t: '确认解绑', cb: unbind }]
    });
  }
  return (
    <>
      <div className="me-head"><div className="avatar"><DropIcon color="#fff" /></div><div><div className="n">{me?.nickname}</div><div className="d">已记录 {me?.stats?.totalRecords ?? 0} 条 · 覆盖 {me?.stats?.coveredDays ?? 0} 天</div></div></div>
      <div className="sec-label">健康档案</div>
      <div className="card" style={{ padding: '4px 16px' }}>
        <div className="cell"><div className="cm"><div className="ct">性别</div><div className="cs">影响尿酸参考上限</div></div><div className="seg"><button className={me?.sex === 'male' ? 'on' : ''} onClick={() => patch({ sex: 'male' }).then(() => showToast('已更新性别 · 尿酸参考上限按 <420 计算'))}>男</button><button className={me?.sex === 'female' ? 'on' : ''} onClick={() => patch({ sex: 'female' }).then(() => showToast('已更新性别 · 尿酸参考上限按 <360 计算'))}>女</button></div></div>
        <div className="cell"><div className="cm"><div className="ct">血糖单位</div><div className="cs">仅血糖支持单位切换</div></div><div className="seg"><button className={me?.unit === 'mmol' ? 'on' : ''} onClick={() => patch({ unit: 'mmol' }).then(() => showToast('已切换为 mmol/L · 全部数据自动换算'))}>mmol/L</button><button className={me?.unit === 'mgdl' ? 'on' : ''} onClick={() => patch({ unit: 'mgdl' }).then(() => showToast('已切换为 mg/dL · 全部数据自动换算'))}>mg/dL</button></div></div>
      </div>
      <div className="sec-label">服务药房</div>
      <div className="card">{me?.binding ? <div className="bound-cell"><div className="bi"><div className="bn">{me.binding.pharmacyName}</div><div className="bs">{fmtMD(me.binding.boundAt)} 起 · 该药房可查看你的健康记录</div></div><button className="danger-text" onClick={confirmUnbind}>解绑</button></div> : <div className="cell" onClick={openBind}><div className="cm"><div className="ct" style={{ color: 'var(--brand)' }}>＋ 绑定服务药房</div><div className="cs">输入药房邀请码，获得用药与健康管理服务</div></div></div>}</div>
      <div className="sec-label">数据与隐私</div>
      <div className="card" style={{ padding: '4px 16px' }}>
        <div className="cell" onClick={openExport}><div className="cm"><div className="ct">导出数据</div><div className="cs">按指标导出 CSV，可随时带走你的数据</div></div><span className="cv">›</span></div>
        <div className="cell" onClick={openRecycle}><div className="cm"><div className="ct">回收站</div><div className="cs">删除的记录保留 7 天</div></div><span className="cv">›</span></div>
      </div>
      <div className="foot-note">糖迹仅作记录工具，不提供诊断与用药建议，请遵医嘱</div>
    </>
  );
}

function BindSub({ close, refresh, showToast, setModal }: any) {
  const [code, setCode] = useState(new URLSearchParams(location.search).get('code') || '');
  const [preview, setPreview] = useState<any>(null);
  async function query() {
    try { setPreview(await api(`/api/app/pharmacy/invite/${code.toUpperCase()}`)); } catch { showToast('邀请码无效或已过期'); }
  }
  function bind() {
    setModal({ title: '授权数据查看', ring: 'var(--brand-soft)', icon: 'ℹ️', body: `绑定「${preview.pharmacyName}」后，该药房的工作人员将可以查看你在糖迹记录的全部健康数据（血糖、血压、血脂、尿酸），用于为你提供用药提醒与健康管理服务。你可以随时在「我的 → 服务药房」解绑，解绑后立即终止其全部访问（含历史数据）。`, actions: [{ t: '暂不' }, { t: '同意并绑定', cb: async () => { await api('/api/app/pharmacy/bind', { method: 'POST', body: JSON.stringify({ code }) }); showToast(`已绑定「${preview.pharmacyName}」· 可随时在本页解绑`); await refresh(); close(); } }] });
  }
  return <div className="subpage on"><div className="sub-nav"><button className="back" onClick={close}>‹</button><span className="t">绑定服务药房</span></div><div className="sub-body"><div className="code-in"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="如 KN23DEMO" maxLength={8} /><button onClick={query}>查询</button></div>{preview && <><div className="ph-card"><div className="pn">{preview.pharmacyName}</div><div className="pd">{preview.address} · 邀请店员：{preview.staffName}</div></div><button className="btn primary" onClick={bind}>同意授权并绑定</button></>}</div></div>;
}

function ReportSub({ close, showToast, openExport }: any) {
  const [report, setReport] = useState<any>(null);
  useEffect(() => { api('/api/app/report/weekly').then(setReport).catch((e) => showToast(e.message)); }, []);
  async function saveImage() {
    const node = document.getElementById('reportCard');
    if (!node) return;
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(node, { backgroundColor: cssVar('--paper'), scale: 2 });
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `糖迹-健康周报-${downloadStamp()}.png`;
    a.click();
    showToast('长图已保存');
  }
  const sections = report?.sections || {};
  return (
    <div className="subpage on">
      <div className="sub-nav"><button className="back" onClick={close}>‹</button><span className="t">健康周报</span></div>
      <div className="sub-body">
        {!report ? <div className="empty">正在生成健康周报…</div> : (
          <>
            <div className="report" id="reportCard">
              <div className="rp-head"><div className="brand"><DropIcon color="currentColor" /> 糖迹 · 健康周报</div><h3>{report.title}</h3><div className="rg num">{fmtMD(report.from)} – {fmtMD(report.to)}</div></div>
              {sections.glucose && <ReportGlucose data={sections.glucose} />}
              {sections.bp && <ReportBp data={sections.bp} />}
              {sections.lipid && <ReportLipid data={sections.lipid} />}
              {sections.uric && <ReportUric data={sections.uric} />}
              {!Object.keys(sections).length && <div className="rp-sec"><h4>本周暂无记录</h4><div className="empty">近 7 天内还没有健康记录</div></div>}
              <div className="rp-foot">血糖参考用户自设目标；血压参考家庭自测 &lt;135/85 mmHg；血脂、尿酸参考范围见各分节。<br />本报告由「糖迹」自动生成，仅作记录摘要，不构成诊疗建议，请遵医嘱。生成时间：{fmtMD(new Date())} {fmtTime(new Date())}</div>
            </div>
            <div className="rp-actions"><button className="btn ghost" onClick={saveImage}>保存长图</button><button className="btn primary" onClick={openExport}>导出数据</button></div>
            <div className="foot-note">长图可直接转发给医生或家人群 · 导出含全部明细</div>
          </>
        )}
      </div>
    </div>
  );
}

function ReportGlucose({ data }: any) {
  return (
    <>
      <div className="rp-grid">
        <div><div className="k">平均血糖</div><div className="v num">{data.avg?.toFixed?.(1) ?? '-'}</div></div>
        <div><div className="k">TIR</div><div className="v num" style={{ color: 'var(--ok)' }}>{Math.round((data.tirIn || 0) * 100)}%</div></div>
        <div><div className="k">最高</div><div className="v num" style={{ color: 'var(--hi)' }}>{data.max?.toFixed?.(1) ?? '-'}</div></div>
        <div><div className="k">最低</div><div className="v num" style={{ color: 'var(--lo)' }}>{data.min?.toFixed?.(1) ?? '-'}</div></div>
      </div>
      <div className="rp-sec"><h4>血糖趋势</h4><MiniTrend records={(data.series?.points || []).map((p: any, i: number) => ({ id: `${p.measuredAt || p.t || i}`, valueMmol: p.valueMmol ?? p.v ?? p.avg, status: p.status?.key ? p.status : { key: p.status || 'ok' }, measuredAt: p.measuredAt || p.t || p.date }))} metric="glucose" /></div>
    </>
  );
}

function ReportBp({ data }: any) {
  return <div className="rp-sec"><h4>血压</h4><div className="report-line">7 天均值 <b className="num">{data.avgSbp}/{data.avgDbp} mmHg</b> · 达标率 <b className="num">{Math.round((data.okRate || 0) * 100)}%</b> · 平均脉搏 <b className="num">{data.avgPulse}</b></div><MiniTrend records={data.series || []} metric="bp" /></div>;
}

function ReportLipid({ data }: any) {
  const latest = data.latest;
  if (!latest) return null;
  return <div className="rp-sec"><h4>血脂 · 最近化验（{fmtMD(latest.measuredAt)}）</h4><table className="rp-tab"><tbody>{lipidItems.map(([k, n, , ref]) => latest[k] == null ? null : <tr key={k}><td>{n}</td><td className="num"><b style={{ color: statusColor[latest.itemStatus[k]] }}>{latest[k]}</b></td><td>{ref}</td></tr>)}</tbody></table></div>;
}

function ReportUric({ data }: any) {
  const latest = data.latest;
  if (!latest) return null;
  return <div className="rp-sec"><h4>尿酸</h4><div className="report-line">最近一次 <b className="num" style={{ color: statusColor[latest.status.key] }}>{latest.value} μmol/L</b>（{fmtMD(latest.measuredAt)}）· 平均 <b className="num">{data.avg}</b> · 参考上限 &lt;{data.threshold}</div></div>;
}

function RecycleSub({ close, refresh, showToast }: any) {
  const [items, setItems] = useState<any[]>([]);
  async function load() {
    const res = await api('/api/app/records/recycle-bin');
    setItems(res.items);
  }
  useEffect(() => { void load(); }, []);
  async function restore(item: any) {
    await api(`/api/app/records/${item.metric}/${item.id}/restore`, { method: 'POST' });
    showToast('已恢复');
    await refresh();
    await load();
  }
  return (
    <div className="subpage on">
      <div className="sub-nav"><button className="back" onClick={close}>‹</button><span className="t">回收站</span></div>
      <div className="sub-body">
        {items.length === 0 ? <div className="empty">回收站为空 · 删除的记录会在这里保留 7 天</div> : items.map((item) => (
          <div className="rec recycle-rec" key={`${item.metric}-${item.id}`}>
            <span className="bar" style={{ background: statusColor[item.status.key] }} />
            <div className="mid"><div className="l1">{metrics.find((m) => m.k === item.metric)?.n}<span className="tm num">{fmtMD(item.measuredAt)} {fmtTime(item.measuredAt)}</span>{pill(item.status)}</div><div className="l2"><span>{readRecord(item.metric, item)}</span><span>剩余 {item.daysLeft} 天</span></div></div>
            <button className="restore-btn" onClick={() => restore(item)}>恢复</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionSheet({ open, close, items }: { open: boolean; close: () => void; items: Array<{ label: string; warn?: boolean; action: () => void | Promise<void> }> }) {
  if (!open) return null;
  async function run(action: () => void | Promise<void>) {
    close();
    await action();
  }
  return (
    <div className={`asheet ${open ? 'on' : ''}`}>
      <div className="grp">{items.map((item) => <button key={item.label} className={item.warn ? 'warn' : ''} onClick={() => run(item.action)}>{item.label}</button>)}</div>
      <button className="cancel" onClick={close}>取消</button>
    </div>
  );
}

function RecordSheet({ open, metric, setMetric, me, refresh, close, showToast, setModal }: any) {
  const [buf, setBuf] = useState('');
  const [time, setTime] = useState(toLocalInput());
  const [note, setNote] = useState('');
  const [period, setPeriod] = useState('fasting');
  const [tags, setTags] = useState<string[]>([]);
  const [bp, setBp] = useState({ f: 'sbp', sbp: '', dbp: '', pulse: '' });
  const [lipid, setLipid] = useState<any>({ tc: '', tg: '', ldl: '', hdl: '', fasting: true });
  const [fasting, setFasting] = useState(true);

  useEffect(() => { if (open) { const d = new Date(); setTime(toLocalInput(d)); setPeriod(metric === 'bp' ? inferBpPeriod(d) : inferGlucosePeriod(d)); setBuf(''); setNote(''); setTags([]); setBp({ f: 'sbp', sbp: '', dbp: '', pulse: '' }); } }, [open, metric]);

  const live = useMemo(() => liveStatus(metric, buf, period, me, bp, lipid), [metric, buf, period, me, bp, lipid]);

  function key(k: string) {
    if (metric === 'bp') {
      const order = ['sbp', 'dbp', 'pulse'];
      setBp((old) => {
        const next: any = { ...old };
        if (k === 'del') next[next.f] = next[next.f].slice(0, -1);
        else if (k === '.') next.f = order[Math.min(2, order.indexOf(next.f) + 1)];
        else if (next[next.f].length < 3) { next[next.f] += k; if (next[next.f].length >= 3) next.f = order[Math.min(2, order.indexOf(next.f) + 1)]; }
        return next;
      });
      return;
    }
    if (k === 'del') setBuf((b) => b.slice(0, -1));
    else if (k === '.') { if (metric === 'glucose' && me?.unit !== 'mgdl' && !buf.includes('.')) setBuf((b) => (b || '0') + '.'); }
    else setBuf((b) => b + k);
  }

  async function save() {
    try {
      const measuredAt = new Date(time).toISOString();
      let body: any;
      if (metric === 'glucose') {
        if (!buf) return showToast('请输入血糖值');
        body = { value: Number(buf), unit: me?.unit || 'mmol', period, measuredAt, tags, note };
      } else if (metric === 'bp') {
        if (!bp.sbp || !bp.dbp) return showToast('请输入血压值');
        if (Number(bp.sbp) <= Number(bp.dbp)) return showToast('收缩压应高于舒张压，请检查输入');
        body = { sbp: Number(bp.sbp), dbp: Number(bp.dbp), pulse: bp.pulse ? Number(bp.pulse) : undefined, period, measuredAt, tags, note };
      } else if (metric === 'lipid') {
        body = { ...Object.fromEntries(lipidItems.map(([k]) => [k, lipid[k] === '' ? undefined : Number(lipid[k])])), fasting: lipid.fasting, measuredAt, note };
      } else {
        if (!buf) return showToast('请输入尿酸值');
        body = { value: Number(buf), fasting, measuredAt, note };
      }
      const res = await api(`/api/app/records/${metric}`, { method: 'POST', body: JSON.stringify(body) });
      showToast(metric === 'glucose' ? `已记录 ${res.record.displayValue} ${me?.unit === 'mgdl' ? 'mg/dL' : 'mmol/L'}` : '已记录');
      close();
      await refresh();
      if (res.safetyAlert) window.setTimeout(() => setModal(safetyModal(metric, res.record, me)), 340);
    } catch (e: any) { showToast(e.message); }
  }

  return <div className={`sheet ${open ? 'on' : ''}`}><div className="sheet-h"><span className="t">记一笔</span><button className="x" onClick={close}>✕</button></div><div className="sheet-body"><div className="msg">{metrics.map((m) => <button className={metric === m.k ? 'on' : ''} key={m.k} onClick={() => setMetric(m.k)}><span className="seg-ic" style={{ color: metric === m.k ? m.c : 'inherit' }}><MetricIcon metric={m.k} /></span>{m.n}</button>)}</div><div className="time-row"><SheetTimeIcon /><input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} /></div>{metric === 'bp' ? <BpPanel bp={bp} setBp={setBp} live={live} period={period} setPeriod={setPeriod} tags={tags} setTags={setTags} /> : metric === 'lipid' ? <LipidPanel lipid={lipid} setLipid={setLipid} live={live} /> : <BigPanel metric={metric} buf={buf} live={live} unit={metric === 'glucose' ? (me?.unit === 'mgdl' ? 'mg/dL' : 'mmol/L') : 'μmol/L'} period={period} setPeriod={setPeriod} tags={tags} setTags={setTags} fasting={fasting} setFasting={setFasting} />}<div className="f-label">备注（选填）</div><input className="note-in" maxLength={50} value={note} onChange={(e) => setNote(e.target.value)} /></div>{metric !== 'lipid' ? <div className="keypad">{['1','2','3','save','4','5','6','7','8','9','.','0','del'].map((k) => k === 'save' ? <button key={k} className="key save" onClick={save}>保存记录</button> : <button key={k} className={`key ${k === '.' || k === 'del' ? 'fn' : ''}`} onClick={() => key(k)}>{k === 'del' ? <DeleteKeyIcon /> : metric === 'bp' && k === '.' ? '下一项' : k === '.' ? '·' : k}</button>)}</div> : <div id="lipidSaveBar"><button className="btn primary" onClick={save}>保存记录</button></div>}</div>;
}

function liveStatus(metric: Metric, buf: string, period: string, me: any, bp: any, lipid: any) {
  if (metric === 'glucose') {
    if (!buf) return { text: '输入血糖值', color: 'var(--ink-3)' };
    const value = toMmol(Number(buf), me?.unit || 'mmol' as Unit);
    const st = glucoseStatus(value, period as any, me?.target);
    return { text: st.label, color: statusColor[st.key] };
  }
  if (metric === 'bp') {
    if (!bp.sbp || !bp.dbp) return { text: bp.sbp || bp.dbp ? '继续输入…' : '输入血压值', color: 'var(--ink-3)' };
    const st = bpStatus(Number(bp.sbp), Number(bp.dbp));
    const bpText: Record<string, string> = { ok: '正常 · 家庭自测参考 <135/85', hi: '偏高 · 建议规律复测', dhigh: '明显偏高 · 保存后会给出建议', dlow: '偏低 · 保存后会给出建议', lo: '偏低 · 保存后会给出建议' };
    return { text: bpText[st.key], color: statusColor[st.key] };
  }
  if (metric === 'lipid') return { text: Object.values(lipid).some((v) => v !== '' && v !== true) ? '整体评估以已填项中最严重一档为准' : '至少填写一项即可保存', color: 'var(--ink-3)' };
  if (!buf) return { text: '输入尿酸值', color: 'var(--ink-3)' };
  const st = uricStatus(Number(buf), me?.sex);
  return { text: st.label, color: statusColor[st.key] };
}

function BigPanel({ metric, buf, live, unit, period, setPeriod, tags, setTags, fasting, setFasting }: any) {
  return <><div className="bignum"><span className="bv num" style={{ color: live.color }}>{buf}</span><span className="cursor" /><span className="bu">{unit}</span></div><div className="live-status" style={{ color: live.color }}>{live.text}</div>{metric === 'glucose' && <><div className="f-label">测量时段 <span className="hint">已按当前时间推荐</span></div><div className="pgrid">{glucosePeriods.map((p) => <button className={`chip ${period === p ? 'on' : ''}`} key={p} onClick={() => setPeriod(p)}>{periodNames[p]}</button>)}</div><div className="f-label">情景标签（选填）</div><div className="tagrow">{glucoseTags.map((t) => <button className={`chip ${tags.includes(t) ? 'on' : ''}`} key={t} onClick={() => setTags(tags.includes(t) ? tags.filter((x: string) => x !== t) : [...tags, t])}>{t}</button>)}</div></>}{metric === 'uric' && <div className="fast-row"><span>空腹采血</span><button className={`switch ${fasting ? 'on' : ''}`} onClick={() => setFasting(!fasting)} /></div>}</>;
}

function BpPanel({ bp, setBp, live, period, setPeriod, tags, setTags }: any) {
  const fields = [['sbp','收缩压','mmHg'],['dbp','舒张压','mmHg'],['pulse','脉搏 · 选填','次/分']] as const;
  return <><div className="bp-fields">{fields.map(([k,l,u]) => <div className={`bpf ${bp.f === k ? 'act' : ''}`} key={k} onClick={() => setBp({ ...bp, f: k })}><div className="fl">{l}</div><div className="fv num" style={{ color: live.color }}>{bp[k]}{bp.f === k && <span className="cursor" />}</div><div className="fu">{u}</div></div>)}</div><div className="live-status" style={{ color: live.color }}>{live.text}</div><div className="pgrid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>{bpPeriods.map((p) => <button className={`chip ${period === p ? 'on' : ''}`} key={p} onClick={() => setPeriod(p)}>{periodNames[p]}</button>)}</div><div className="tagrow">{bpTags.map((t) => <button className={`chip ${tags.includes(t) ? 'on' : ''}`} key={t} onClick={() => setTags(tags.includes(t) ? tags.filter((x: string) => x !== t) : [...tags, t])}>{t}</button>)}</div></>;
}

function LipidPanel({ lipid, setLipid, live }: any) {
  return <><div className="lp-rows">{lipidItems.map(([k,n,ab,ref]) => { const v = lipid[k]; const st = v === '' ? null : lipidStatus(k as any, Number(v)); return <div className="lp-row" key={k}><span className="ln">{n}<small>{ab} · 参考 {ref} mmol/L</small></span><input value={v} onChange={(e) => setLipid({ ...lipid, [k]: e.target.value })} /><span className="dot" style={{ background: st ? statusColor[st.key] : undefined }} /></div>; })}</div><div className="fast-row"><span>空腹采血</span><button className={`switch ${lipid.fasting ? 'on' : ''}`} onClick={() => setLipid({ ...lipid, fasting: !lipid.fasting })} /></div><div className="live-status" style={{ color: live.color }}>{live.text}</div></>;
}

function safetyModal(metric: Metric, record: any, me: any) {
  if (metric === 'bp') return { icon: '⚠️', ring: 'var(--hi-soft)', title: '本次血压偏高', body: `本次测量 ${record.sbp}/${record.dbp} mmHg，明显高于参考范围。建议静坐休息 5 分钟后复测；若仍明显偏高，或伴有剧烈头痛、胸闷、视物模糊等不适，请立即就医。`, actions: [{ t: '我已知晓' }] };
  if (metric === 'uric') return { icon: '⚠️', ring: 'var(--hi-soft)', title: '尿酸显著偏高', body: `本次测量 ${record.value} μmol/L，明显高于参考上限。建议注意多饮水，并尽快就医复查。`, actions: [{ t: '我已知晓' }] };
  if (record.status.key === 'dlow') return { icon: '⚠️', ring: 'var(--danger-soft)', title: '本次血糖偏低', body: `本次测量 ${record.displayValue} ${me?.unit === 'mgdl' ? 'mg/dL' : 'mmol/L'}，低于 3.9 mmol/L。建议立即进食 15–20g 速效碳水（如半杯果汁、3–4 块方糖），15 分钟后复测。若出现意识模糊或无法自行处理，请立即就医或呼叫急救。`, actions: [{ t: '我已知晓' }] };
  return { icon: '⚠️', ring: 'var(--hi-soft)', title: '血糖显著偏高', body: `本次测量 ${record.displayValue} ${me?.unit === 'mgdl' ? 'mg/dL' : 'mmol/L'}，明显高于目标范围。如伴有口渴、乏力、恶心等不适，建议尽快就医，并注意补充水分。`, actions: [{ t: '我已知晓' }] };
}

function SafetyModal({ modal, close }: any) {
  return <div className="modal on"><div className="m-ic"><div className="ring" style={{ background: modal.ring }}>{modal.icon}</div></div><div className="m-t">{modal.title}</div><div className="m-b">{modal.body}</div><div className="m-note">本程序不提供诊疗建议，请遵医嘱</div><div className="m-acts">{modal.actions.map((a: any, i: number) => <button key={i} onClick={() => { close(); a.cb?.(); }}>{a.t}</button>)}</div></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
