import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import { AdminUsers } from './admin-users';
import './styles.css';

const API = import.meta.env.VITE_API_BASE || '';
type View = 'dash' | 'customers' | 'detail' | 'alerts' | 'invites' | 'staff' | 'settings' | 'adminStats' | 'adminPharmacies' | 'adminUsers';

function isStrongPassword(password: string) {
  return password.length >= 12 && password.length <= 128 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function token() { return localStorage.getItem('tangji_console_token') || ''; }
function aud() { return localStorage.getItem('tangji_console_aud') || 'pharmacy'; }

function clearConsoleSession() {
  for (const key of ['tangji_console_token', 'tangji_console_aud', 'tangji_console_staff', 'tangji_console_pharmacy']) {
    localStorage.removeItem(key);
  }
}

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const t = token();
  if (t) headers.set('authorization', `Bearer ${t}`);
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (res.status === 401) clearConsoleSession();
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || res.statusText);
  if (res.status === 204) return null;
  return res.json();
}

function App() {
  const [logged, setLogged] = useState(Boolean(token()));
  const [view, setView] = useState<View>(aud() === 'admin' ? 'adminUsers' : 'dash');
  const [staff, setStaff] = useState<any>(JSON.parse(localStorage.getItem('tangji_console_staff') || 'null'));
  const [pharmacy, setPharmacy] = useState<any>(JSON.parse(localStorage.getItem('tangji_console_pharmacy') || 'null'));
  const [toast, setToast] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [loginNotice, setLoginNotice] = useState('');
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    if (!logged) {
      setSessionReady(false);
      return;
    }
    let active = true;
    const validationPath = aud() === 'admin' ? '/api/admin/stats' : '/api/pharmacy/dashboard';
    api(validationPath)
      .then(() => { if (active) setSessionReady(true); })
      .catch(() => {
        if (!active) return;
        clearConsoleSession();
        setStaff(null);
        setPharmacy(null);
        setPasswordOpen(false);
        setLoginNotice('登录状态已失效，请重新登录');
        setLogged(false);
      });
    return () => { active = false; };
  }, [logged]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2000);
  }

  if (!logged) return <Login notice={loginNotice} onLogin={(payload: any, kind: 'pharmacy' | 'admin') => {
    setLoginNotice('');
    localStorage.setItem('tangji_console_token', payload.token);
    localStorage.setItem('tangji_console_aud', kind);
    if (kind === 'pharmacy') {
      localStorage.setItem('tangji_console_staff', JSON.stringify(payload.staff));
      localStorage.setItem('tangji_console_pharmacy', JSON.stringify(payload.pharmacy));
      setStaff(payload.staff);
      setPharmacy(payload.pharmacy);
      setView('dash');
    } else {
      setStaff({ name: '平台管理员', role: 'admin' });
      setPharmacy({ name: '平台后台' });
      setView('adminUsers');
    }
    setSessionReady(false);
    setLogged(true);
  }} />;

  if (!sessionReady) {
    return <div className="console-stage"><div className="bshell"><div className="blogin"><div className="lc session-check" role="status">正在验证登录状态…</div></div></div></div>;
  }

  const isAdmin = aud() === 'admin';
  return (
    <div className="console-stage">
      <div className="bshell">
        <aside className="bside">
          <div className="blogo">💧 糖迹 · {isAdmin ? '平台后台' : '药房工作台'}</div>
          <nav className="bmenu">
            {(isAdmin ? [['adminStats','平台概览'],['adminUsers','用户与记录'],['adminPharmacies','药房管理']] : [['dash','工作台'],['customers','客户管理'],['alerts','预警中心'],['invites','邀请管理'], ...(staff?.role === 'owner' ? [['staff','员工管理']] : []), ['settings','药房设置']] as any).map(([k, n]: any) => <button key={k} className={view === k || (k === 'customers' && view === 'detail') ? 'on' : ''} onClick={() => setView(k)}>{n}</button>)}
          </nav>
          <div className="bme"><div className="bn">{staff?.name}</div><div className="br">{staff?.role === 'owner' ? '店长' : staff?.role === 'admin' ? '平台管理员' : '店员'} · {pharmacy?.name}</div><div className="bme-actions"><button onClick={() => setPasswordOpen(true)}>修改密码</button><button onClick={() => { clearConsoleSession(); setLoginNotice(''); setSessionReady(false); setLogged(false); }}>退出登录</button></div></div>
        </aside>
        <main className="bmain">
          <div className="btop"><span className="bt-title">{title(view)}</span><span className="bt-ph">{pharmacy?.name}</span></div>
          <div className="bbody"><Router view={view} setView={setView} showToast={showToast} setPharmacy={setPharmacy} /></div>
        </main>
        {passwordOpen && <ChangePasswordModal close={() => setPasswordOpen(false)} changed={() => {
          clearConsoleSession();
          setPasswordOpen(false);
          setLoginNotice('密码已修改，请使用新密码重新登录');
          setSessionReady(false);
          setLogged(false);
        }} />}
        <div className={`btoast ${toast ? 'on' : ''}`}>{toast}</div>
      </div>
    </div>
  );
}

function title(view: View) {
  return ({ dash: '工作台', customers: '客户管理', detail: '客户详情', alerts: '预警中心', invites: '邀请管理', staff: '员工管理', settings: '药房设置', adminStats: '平台概览', adminPharmacies: '药房管理', adminUsers: '用户与记录' } as Record<View, string>)[view];
}

function Login({ onLogin, notice }: any) {
  const initialKind = new URLSearchParams(location.search).has('admin') ? 'admin' : 'pharmacy';
  const [kind, setKind] = useState<'pharmacy' | 'admin'>(initialKind);
  const [username, setUsername] = useState(import.meta.env.DEV ? (initialKind === 'admin' ? 'admin' : 'kn_li') : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? (initialKind === 'admin' ? 'Admin@123456' : 'Kn@123456') : '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function switchKind(nextKind: 'pharmacy' | 'admin') {
    setKind(nextKind);
    setError('');
    setUsername(import.meta.env.DEV ? (nextKind === 'admin' ? 'admin' : 'kn_li') : '');
    setPassword(import.meta.env.DEV ? (nextKind === 'admin' ? 'Admin@123456' : 'Kn@123456') : '');
  }

  async function submit() {
    try {
      setSubmitting(true);
      setError('');
      const res = await fetch(`${API}/api/${kind}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
      if (!res.ok) throw new Error('用户名或密码不正确');
      onLogin(await res.json(), kind);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }
  return <div className="console-stage"><div className="bshell"><div className="blogin"><div className="lc"><div className="lt">💧 糖迹 · 药房工作台</div><div className="ls">慢病客户健康管理与异常预警</div>{notice && <div className="login-notice" role="status">{notice}</div>}<div className="itab" style={{ marginBottom: 12 }}><button className={kind === 'pharmacy' ? 'on' : ''} onClick={() => switchKind('pharmacy')}>药房账号</button><button className={kind === 'admin' ? 'on' : ''} onClick={() => switchKind('admin')}>平台管理员</button></div><input aria-label="用户名" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /><input aria-label="密码" autoComplete="current-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /><button className="btn primary" disabled={submitting || !username || !password} onClick={submit}>{submitting ? '登录中…' : '登录'}</button>{error && <div className="form-error" role="alert">{error}</div>}{import.meta.env.DEV && <div className="bfoot" style={{ textAlign: 'center', marginTop: 12 }}>演示账号可直接登录</div>}</div></div></div></div>;
}

function ChangePasswordModal({ close, changed }: { close: () => void; changed: () => void }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = Boolean(form.currentPassword) && isStrongPassword(form.newPassword) && form.newPassword === form.confirmPassword;

  async function submit() {
    if (!valid || saving) return;
    try {
      setSaving(true);
      setError('');
      await api(`/api/${aud()}/auth/change-password`, {
        method: 'POST',
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword })
      });
      changed();
    } catch (e: any) {
      setError(e.message || '密码修改失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bmodal-mask on" onClick={close}>
      <div className="bmodal" role="dialog" aria-modal="true" aria-labelledby="change-password-title" onClick={(event) => event.stopPropagation()}>
        <div className="mt" id="change-password-title">修改登录密码</div>
        <div className="password-form">
          <label className="form-field"><span>当前密码</span><input autoComplete="current-password" type="password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} /></label>
          <label className="form-field"><span>新密码</span><input autoComplete="new-password" type="password" placeholder="至少 12 位，含大小写字母、数字和符号" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} /></label>
          <label className="form-field"><span>确认新密码</span><input autoComplete="new-password" type="password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} /></label>
        </div>
        {form.confirmPassword && form.newPassword !== form.confirmPassword && <div className="form-error" role="alert">两次输入的新密码不一致</div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="macts"><button className="bbtn line" onClick={close}>取消</button><button className="bbtn" disabled={!valid || saving} onClick={submit}>{saving ? '修改中…' : '确认修改'}</button></div>
      </div>
    </div>
  );
}

function Router({ view, setView, showToast, setPharmacy }: any) {
  if (view === 'dash') return <Dashboard setView={setView} />;
  if (view === 'customers') return <Customers setView={setView} />;
  if (view === 'detail') return <CustomerDetail setView={setView} showToast={showToast} />;
  if (view === 'alerts') return <Alerts showToast={showToast} />;
  if (view === 'invites') return <Invites showToast={showToast} />;
  if (view === 'staff') return <Staff showToast={showToast} />;
  if (view === 'settings') return <Settings showToast={showToast} setPharmacy={setPharmacy} />;
  if (view === 'adminStats') return <AdminStats />;
  if (view === 'adminUsers') return <AdminUsers api={api} showToast={showToast} />;
  return <AdminPharmacies showToast={showToast} />;
}

function Dashboard({ setView }: any) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api('/api/pharmacy/dashboard').then(setData); }, []);
  return <>{data && <><div className="bstats">{[['客户总数', data.customerTotal], ['本周新增', data.weekNew], ['近 7 天活跃', data.activeIn7d], ['待跟进预警', data.pendingAlerts]].map(([k, v]) => <div className="bstat" key={k as string} onClick={() => k === '待跟进预警' && setView('alerts')}><div className="k">{k}</div><div className={`v num ${k === '待跟进预警' ? 'alert' : ''}`}>{v as any}</div></div>)}</div><div className="bcols"><div className="bcard"><div className="bh"><span className="t">最新预警</span><span className="more" onClick={() => setView('alerts')}>全部 ›</span></div>{data.latestAlerts?.length ? <SimpleTable rows={data.latestAlerts.map((a: any) => [a.occurredAt.slice(5,16), a.customer.nickname, a.metric, a.record.status.label])} /> : <div className="empty">近 7 天没有待跟进的异常读数</div>}</div><div className="bcard"><div className="bh"><span className="t">最近绑定</span><span className="more" onClick={() => setView('customers')}>全部 ›</span></div><SimpleTable rows={(data.latestBindings || []).map((b: any) => [b.nickname, b.boundAt.slice(0,10)])} /></div></div></>}</>;
}

function SimpleTable({ rows }: { rows: any[][] }) {
  return <table className="btab"><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>;
}

function Customers({ setView }: any) {
  const [items, setItems] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  useEffect(() => { const id = window.setTimeout(() => api(`/api/pharmacy/customers?filter=${filter}&search=${encodeURIComponent(search)}`).then((d) => setItems(d.items)), 300); return () => clearTimeout(id); }, [filter, search]);
  const filters = [['all','全部'],['alert','有预警'],['inactive7d','7 天未记录']] as const;
  return <><div className="btools"><input className="bsearch" placeholder="搜索客户昵称…" value={search} onChange={(e) => setSearch(e.target.value)} /><div className="itab">{filters.map(([k,n]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{n}</button>)}</div></div><div className="bcard" style={{ padding: '4px 10px' }}><table className="btab"><thead><tr><th>客户</th><th>绑定时间</th><th>最近记录</th><th>指标状态</th><th></th></tr></thead><tbody>{items.map((u) => <tr key={u.userId} className="click" onClick={() => { sessionStorage.setItem('customerId', u.userId); setView('detail'); }}><td><span className="avatar-s">{u.nickname[0]}</span>{u.nickname}</td><td>{u.boundAt.slice(0,10)}</td><td>{u.lastRecordAt ? `${u.lastRecordAt.slice(5,16)} · ${u.lastRecordMetric}` : '—'}</td><td><span className="dotset">{['glucose','bp','lipid','uric'].map((m) => <span key={m} className="sdot" style={{ background: dotColor(u.dots[m]) }} />)}</span></td><td><button className="bbtn sm line">查看</button></td></tr>)}</tbody></table></div></>;
}

function dotColor(k: string | null) { return k ? ({ ok: 'var(--ok)', hi: 'var(--hi)', lo: 'var(--lo)', dhigh: 'var(--danger)', dlow: 'var(--danger)' } as any)[k] : '#D5DDD9'; }

function CustomerDetail({ setView }: any) {
  const id = sessionStorage.getItem('customerId');
  const [head, setHead] = useState<any>(null);
  const [metric, setMetric] = useState('glucose');
  const [stats, setStats] = useState<any>(null);
  const [records, setRecords] = useState<any[]>([]);
  useEffect(() => { api(`/api/pharmacy/customers/${id}`).then(setHead).catch(() => setHead({ forbidden: true })); }, [id]);
  useEffect(() => {
    if (!id) return;
    Promise.all([
      api(`/api/pharmacy/customers/${id}/records?metric=${metric}&limit=200`),
      api(`/api/pharmacy/customers/${id}/stats?metric=${metric}&range=30`)
    ])
      .then(([recordData, statsData]) => {
        setRecords(recordData.items);
        setStats(statsData);
      })
      .catch(() => {
        setRecords([]);
        setStats(null);
      });
  }, [id, metric]);
  if (head?.forbidden) return <div className="bcard" style={{ textAlign: 'center', padding: 46 }}>无权查看该客户(可能已解绑)</div>;
  return <><button className="bbtn sm line" onClick={() => setView('customers')}>‹ 返回列表</button>{head && <div className="bcard"><span className="avatar-s">{head.nickname?.[0]}</span><b>{head.nickname}</b><span className="admin-note"> · 绑定于 {head.boundAt?.slice(0,10)}</span>{head.pendingAlerts > 0 && <span className="alertbar">近 7 天 {head.pendingAlerts} 条异常读数待跟进</span>}</div>}<div className="itab">{metricTabs.map(([k, n]) => <button key={k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>{n}</button>)}</div><StatsPanel metric={metric} stats={stats} records={records} /><div className="bcard"><div className="bh"><span className="t">记录明细</span><span className="more">只读</span></div><table className="btab"><tbody>{records.map((r) => <tr key={r.id}><td>{r.measuredAt.slice(0,16).replace('T',' ')}</td><td className="num" style={{ color: dotColor(r.status.key), fontWeight: 700 }}>{readRecord(r)}</td><td><span className={`pill ${r.status.key === 'ok' ? 'ok' : r.status.key === 'hi' ? 'hi' : 'danger'}`}>{r.status.label}</span></td><td>{r.note || '—'}</td></tr>)}</tbody></table><div className="bfoot">以上数据由客户本人记录并授权查看，仅供健康管理参考，不构成诊疗依据；请勿据此指导用药，医疗问题请建议客户及时就医</div></div></>;
}

function readRecord(r: any) { if (r.metric === 'bp') return `${r.sbp}/${r.dbp}`; if (r.metric === 'uric') return r.value; if (r.metric === 'lipid') return ['tc','tg','ldl','hdl'].map((k) => r[k] ?? '—').join(' / '); return r.displayValue; }

const metricTabs = [['glucose', '血糖'], ['bp', '血压'], ['lipid', '血脂'], ['uric', '尿酸']] as const;

function StatsPanel({ metric, stats, records }: any) {
  if (!stats) return <div className="bcard"><div className="empty">暂无统计数据</div></div>;
  return (
    <div className="bcard">
      <div className="bh"><span className="t">趋势与概览</span><span className="more">复用同一序列口径</span></div>
      <div className="console-metrics">{metricSummary(metric, stats).map(([k, v]) => <div className="metric" key={k}><div className="k">{k}</div><div className="v num">{v}</div></div>)}</div>
      <ConsoleTrend metric={metric} records={records} />
    </div>
  );
}

function metricSummary(metric: string, stats: any) {
  if (metric === 'glucose') return [['平均血糖', stats.avg?.toFixed?.(1) ?? '-'], ['达标率', `${Math.round((stats.okRate || 0) * 100)}%`], ['最高', stats.max ?? '-'], ['最低', stats.min ?? '-']];
  if (metric === 'bp') return [['平均收缩压', `${stats.avgSbp || 0}`], ['平均舒张压', `${stats.avgDbp || 0}`], ['达标率', `${Math.round((stats.okRate || 0) * 100)}%`], ['平均脉搏', `${stats.avgPulse || 0}`]];
  if (metric === 'lipid') return [['化验次数', `${stats.n || 0}`], ['最近 TC', stats.latest?.tc ?? '-'], ['最近 LDL-C', stats.latest?.ldl ?? '-'], ['整体状态', stats.latest?.status?.label ?? '-']];
  return [['最近一次', stats.latest?.value ?? '-'], ['平均', stats.avg ?? '-'], ['达标率', `${Math.round((stats.okRate || 0) * 100)}%`], ['参考上限', stats.threshold ?? '-']];
}

function ConsoleTrend({ metric, records }: any) {
  const points = records.slice().reverse().slice(-18);
  if (!points.length) return <div className="empty">暂无趋势数据</div>;
  return <div className="console-trend">{points.map((r: any) => {
    const value = metric === 'bp' ? r.sbp : metric === 'uric' ? r.value : metric === 'lipid' ? (r.ldl ?? r.tc ?? r.tg ?? r.hdl ?? 0) : r.valueMmol;
    const h = Math.max(12, Math.min(118, Number(value) * (metric === 'bp' ? .55 : metric === 'uric' ? .18 : metric === 'lipid' ? 22 : 9)));
    return <span key={r.id} title={readRecord(r)} style={{ height: h, background: dotColor(r.status.key) }} />;
  })}</div>;
}

function Alerts({ showToast }: any) {
  const [items, setItems] = useState<any[]>([]);
  const load = () => api('/api/pharmacy/alerts?days=7&status=all').then((d) => setItems(d.items));
  useEffect(() => { void load(); }, []);
  async function follow(a: any) { await api('/api/pharmacy/alerts/follow-up', { method: 'POST', body: JSON.stringify({ metric: a.metric, recordId: a.record.id, note: '已电话提醒复测' }) }); showToast('已标记跟进'); load(); }
  return <div className="bcard" style={{ padding: '4px 10px' }}><table className="btab"><thead><tr><th>发生时间</th><th>客户</th><th>指标</th><th>读数</th><th>状态</th><th></th></tr></thead><tbody>{items.map((a) => <tr key={`${a.metric}-${a.record.id}`}><td>{a.occurredAt.slice(0,16).replace('T',' ')}</td><td>{a.customer.nickname}</td><td>{a.metric}</td><td style={{ color: dotColor(a.record.status.key), fontWeight: 700 }}>{readRecord(a.record)}</td><td>{a.followUp ? <span className="pill ok">已跟进</span> : <span className="pill hi">未跟进</span>}</td><td>{!a.followUp && <button className="bbtn sm" onClick={() => follow(a)}>标记跟进</button>}</td></tr>)}</tbody></table></div>;
}

function Invites({ showToast }: any) {
  const [items, setItems] = useState<any[]>([]);
  const [qr, setQr] = useState('');
  const load = () => api('/api/pharmacy/invites').then((d) => setItems(d.items));
  useEffect(() => { void load(); }, []);
  async function create() { const d = await api('/api/pharmacy/invites', { method: 'POST', body: '{}' }); setQr(await QRCode.toDataURL(d.qrContent)); showToast(`邀请码 ${d.code}`); load(); }
  return <><div className="btools"><button className="bbtn" onClick={create}>＋ 生成邀请码</button></div>{qr && <div className="bcard" style={{ textAlign: 'center' }}><img className="qr" src={qr} /><div className="bfoot">二维码内容为真实绑定链接</div></div>}<div className="bcard" style={{ padding: '4px 10px' }}><table className="btab"><tbody>{items.map((i) => <tr key={i.id}><td className="num" style={{ fontWeight: 700 }}>{i.code}</td><td>{i.createdAt.slice(0,10)}</td><td>{i.boundCount} 人</td><td>{i.disabledAt ? '已停用' : '有效'}</td></tr>)}</tbody></table><div className="bfoot">发展客户时请当面告知：绑定后本药房可查看其健康记录，客户可随时自行解绑</div></div></>;
}

function Staff({ showToast }: any) {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'staff' });
  const load = () => api('/api/pharmacy/staff').then((d) => setItems(d.items));
  useEffect(() => { void load(); }, []);
  async function create() {
    try {
      await api('/api/pharmacy/staff', { method: 'POST', body: JSON.stringify(form) });
      showToast('已新增员工');
      setForm({ username: '', name: '', password: '', role: 'staff' });
      load();
    } catch (error: any) {
      showToast(error.message);
    }
  }
  async function toggle(s: any) {
    await api(`/api/pharmacy/staff/${s.id}`, { method: 'PATCH', body: JSON.stringify({ disabledAt: s.disabledAt ? null : new Date().toISOString() }) });
    showToast(s.disabledAt ? '已启用员工' : '已停用员工');
    load();
  }
  return <><div className="bcard"><div className="bh"><span className="t">新增员工</span></div><div className="staff-form"><input className="bsearch" placeholder="用户名" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /><input className="bsearch" placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input className="bsearch" type="password" autoComplete="new-password" placeholder="12 位以上强密码" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><select className="bsearch" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="staff">店员</option><option value="owner">店长</option></select><button className="bbtn" disabled={!form.username.trim() || !form.name.trim() || !isStrongPassword(form.password)} onClick={create}>新增员工</button></div></div><div className="bcard"><table className="btab"><thead><tr><th>姓名</th><th>用户名</th><th>角色</th><th>状态</th><th></th></tr></thead><tbody>{items.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.username}</td><td>{s.role === 'owner' ? '店长' : '店员'}</td><td>{s.disabledAt ? <span className="pill danger">停用</span> : <span className="pill ok">在职</span>}</td><td><button className="bbtn sm line" onClick={() => toggle(s)}>{s.disabledAt ? '启用' : '停用'}</button></td></tr>)}</tbody></table></div></>;
}

function Settings({ showToast, setPharmacy }: any) {
  const currentStaff = JSON.parse(localStorage.getItem('tangji_console_staff') || 'null');
  const canEdit = currentStaff?.role === 'owner';
  const [form, setForm] = useState({ name: '', address: '', phone: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/api/pharmacy/profile')
      .then((profile) => setForm({ name: profile.name || '', address: profile.address || '', phone: profile.phone || '' }))
      .catch((error) => showToast(error.message));
  }, []);

  async function save() {
    if (!canEdit || saving) return;
    try {
      setSaving(true);
      const profile = await api('/api/pharmacy/profile', { method: 'PATCH', body: JSON.stringify(form) });
      const nextPharmacy = { name: profile.name };
      localStorage.setItem('tangji_console_pharmacy', JSON.stringify(nextPharmacy));
      setPharmacy(nextPharmacy);
      setForm({ name: profile.name || '', address: profile.address || '', phone: profile.phone || '' });
      showToast('药房资料已保存');
    } catch (error: any) {
      showToast(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bcard" style={{ maxWidth: 520 }}>
      <div className="bh"><span className="t">药房资料</span></div>
      <input className="bsearch" style={{ width: '100%', marginBottom: 10 }} placeholder="药房名称" value={form.name} disabled={!canEdit} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      <input className="bsearch" style={{ width: '100%', marginBottom: 10 }} placeholder="门店地址" value={form.address} disabled={!canEdit} onChange={(event) => setForm({ ...form, address: event.target.value })} />
      <input className="bsearch" style={{ width: '100%', marginBottom: 10 }} placeholder="联系电话" value={form.phone} disabled={!canEdit} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
      {canEdit && <button className="bbtn" disabled={saving || !form.name.trim()} onClick={save}>{saving ? '保存中…' : '保存'}</button>}
    </div>
  );
}

function AdminStats() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api('/api/admin/stats').then(setData); }, []);
  return <div className="bstats">{data && [['药房总数', data.pharmacyTotal], ['药房绑定客户数', data.customerTotal], ['今日测量记录数', data.recordsToday]].map(([k,v]) => <div className="bstat" key={k as string}><div className="k">{k}</div><div className="v num">{v as any}</div></div>)}</div>;
}

function secureInitialPassword() {
  const pools = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*-_'];
  const all = pools.join('');
  const length = 16;
  const random = new Uint32Array(length * 2);
  crypto.getRandomValues(random);
  const chars = pools.map((pool, index) => pool[random[index]! % pool.length]!);
  for (let index = chars.length; index < length; index += 1) chars.push(all[random[index]! % all.length]!);
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = random[length + index]! % (index + 1);
    const current = chars[index]!;
    chars[index] = chars[swapIndex]!;
    chars[swapIndex] = current;
  }
  return chars.join('');
}

function AdminPharmacies({ showToast }: any) {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', address: '', phone: '', ownerUsername: '', ownerPassword: '' });
  const [createdAccount, setCreatedAccount] = useState<{ username: string; password: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const load = () => api('/api/admin/pharmacies').then((d) => setItems(d.items));
  useEffect(() => { void load(); }, []);
  const valid = Boolean(form.name.trim() && form.address.trim() && form.phone.trim() && form.ownerUsername.trim().length >= 3 && isStrongPassword(form.ownerPassword));

  async function create() {
    if (!valid || saving) return;
    const payload = {
      name: form.name.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      ownerUsername: form.ownerUsername.trim(),
      ownerPassword: form.ownerPassword
    };
    try {
      setSaving(true);
      await api('/api/admin/pharmacies', { method: 'POST', body: JSON.stringify(payload) });
      setCreatedAccount({ username: payload.ownerUsername, password: payload.ownerPassword });
      setForm({ name: '', address: '', phone: '', ownerUsername: '', ownerPassword: '' });
      showToast('药房和店长账号已创建');
      await load();
    } catch (error: any) {
      showToast(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function copyCreatedAccount() {
    if (!createdAccount) return;
    try {
      await navigator.clipboard.writeText(`用户名：${createdAccount.username}\n初始密码：${createdAccount.password}`);
      showToast('登录信息已复制');
    } catch {
      showToast('复制失败，请手动记录登录信息');
    }
  }

  return <>
    <div className="bcard">
      <div className="bh"><span className="t">新增药房</span></div>
      <div className="pharmacy-form">
        <label className="form-field"><span>药房名称</span><input className="bsearch" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="form-field"><span>联系电话</span><input className="bsearch" type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <label className="form-field full"><span>门店地址</span><input className="bsearch" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
        <label className="form-field"><span>店长用户名</span><input className="bsearch" autoComplete="off" value={form.ownerUsername} onChange={(event) => setForm({ ...form, ownerUsername: event.target.value })} /></label>
        <label className="form-field"><span>初始密码</span><div className="password-row"><input className="bsearch" autoComplete="new-password" spellCheck={false} value={form.ownerPassword} onChange={(event) => setForm({ ...form, ownerPassword: event.target.value })} /><button className="bbtn line" onClick={() => setForm({ ...form, ownerPassword: secureInitialPassword() })}>生成</button></div></label>
      </div>
      <div className="form-actions"><button className="bbtn" disabled={!valid || saving} onClick={create}>{saving ? '创建中…' : '创建药房'}</button></div>
    </div>
    {createdAccount && <div className="credential-note" role="status"><div><b>店长账号已创建</b><span>用户名 {createdAccount.username} · 初始密码 <code>{createdAccount.password}</code></span></div><button className="bbtn sm line" onClick={copyCreatedAccount}>复制登录信息</button></div>}
    <div className="bcard"><table className="btab"><thead><tr><th>药房</th><th>地址</th><th>店长账号</th><th>客户数</th><th>状态</th></tr></thead><tbody>{items.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.address}</td><td>{p.ownerUsername}</td><td>{p.customerCount}</td><td>{p.disabledAt ? '停用' : '启用'}</td></tr>)}</tbody></table></div>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
