import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import './styles.css';

const API = import.meta.env.VITE_API_BASE || '';
type View = 'dash' | 'customers' | 'detail' | 'alerts' | 'invites' | 'staff' | 'settings' | 'adminStats' | 'adminPharmacies';

function token() { return localStorage.getItem('tangji_console_token') || ''; }
function aud() { return localStorage.getItem('tangji_console_aud') || 'pharmacy'; }

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const t = token();
  if (t) headers.set('authorization', `Bearer ${t}`);
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || res.statusText);
  if (res.status === 204) return null;
  return res.json();
}

function App() {
  const [logged, setLogged] = useState(Boolean(token()));
  const [view, setView] = useState<View>(aud() === 'admin' ? 'adminStats' : 'dash');
  const [staff, setStaff] = useState<any>(JSON.parse(localStorage.getItem('tangji_console_staff') || 'null'));
  const [pharmacy, setPharmacy] = useState<any>(JSON.parse(localStorage.getItem('tangji_console_pharmacy') || 'null'));
  const [toast, setToast] = useState('');

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2000);
  }

  if (!logged) return <Login onLogin={(payload: any, kind: 'pharmacy' | 'admin') => {
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
      setView('adminStats');
    }
    setLogged(true);
  }} showToast={showToast} />;

  const isAdmin = aud() === 'admin';
  return (
    <div className="console-stage">
      <div className="bshell">
        <aside className="bside">
          <div className="blogo">💧 糖迹 · {isAdmin ? '平台后台' : '药房工作台'}</div>
          <nav className="bmenu">
            {(isAdmin ? [['adminStats','平台概览'],['adminPharmacies','药房管理']] : [['dash','工作台'],['customers','客户管理'],['alerts','预警中心'],['invites','邀请管理'], ...(staff?.role === 'owner' ? [['staff','员工管理']] : []), ['settings','药房设置']] as any).map(([k, n]: any) => <button key={k} className={view === k || (k === 'customers' && view === 'detail') ? 'on' : ''} onClick={() => setView(k)}>{n}</button>)}
          </nav>
          <div className="bme"><div className="bn">{staff?.name}</div><div className="br">{staff?.role === 'owner' ? '店长' : staff?.role === 'admin' ? '平台管理员' : '店员'} · {pharmacy?.name}</div><button onClick={() => { localStorage.clear(); setLogged(false); }}>退出登录</button></div>
        </aside>
        <main className="bmain">
          <div className="btop"><span className="bt-title">{title(view)}</span><span className="bt-ph">{pharmacy?.name}</span></div>
          <div className="bbody"><Router view={view} setView={setView} showToast={showToast} /></div>
        </main>
        <div className={`btoast ${toast ? 'on' : ''}`}>{toast}</div>
      </div>
    </div>
  );
}

function title(view: View) {
  return ({ dash: '工作台', customers: '客户管理', detail: '客户详情', alerts: '预警中心', invites: '邀请管理', staff: '员工管理', settings: '药房设置', adminStats: '平台概览', adminPharmacies: '药房管理' } as Record<View, string>)[view];
}

function Login({ onLogin, showToast }: any) {
  const [username, setUsername] = useState(new URLSearchParams(location.search).get('admin') ? 'admin' : 'kn_li');
  const [password, setPassword] = useState(new URLSearchParams(location.search).get('admin') ? 'Admin@123456' : 'Kn@123456');
  async function submit() {
    try {
      const kind = username === 'admin' ? 'admin' : 'pharmacy';
      const res = await fetch(`${API}/api/${kind}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
      if (!res.ok) throw new Error('用户名或密码不正确');
      onLogin(await res.json(), kind);
    } catch (e: any) { showToast(e.message); }
  }
  return <div className="console-stage"><div className="bshell"><div className="blogin"><div className="lc"><div className="lt">💧 糖迹 · 药房工作台</div><div className="ls">慢病客户健康管理与异常预警</div><input value={username} onChange={(e) => setUsername(e.target.value)} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /><button className="btn primary" onClick={submit}>登录</button><div className="bfoot" style={{ textAlign: 'center', marginTop: 12 }}>演示账号可直接登录</div></div></div></div></div>;
}

function Router({ view, setView, showToast }: any) {
  if (view === 'dash') return <Dashboard setView={setView} />;
  if (view === 'customers') return <Customers setView={setView} />;
  if (view === 'detail') return <CustomerDetail setView={setView} showToast={showToast} />;
  if (view === 'alerts') return <Alerts showToast={showToast} />;
  if (view === 'invites') return <Invites showToast={showToast} />;
  if (view === 'staff') return <Staff showToast={showToast} />;
  if (view === 'settings') return <Settings showToast={showToast} />;
  if (view === 'adminStats') return <AdminStats />;
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
  const [records, setRecords] = useState<any[]>([]);
  useEffect(() => { api(`/api/pharmacy/customers/${id}`).then(setHead).catch(() => setHead({ forbidden: true })); }, [id]);
  useEffect(() => { if (id) api(`/api/pharmacy/customers/${id}/records?metric=${metric}`).then((d) => setRecords(d.items)).catch(() => setRecords([])); }, [id, metric]);
  if (head?.forbidden) return <div className="bcard" style={{ textAlign: 'center', padding: 46 }}>无权查看该客户(可能已解绑)</div>;
  return <><button className="bbtn sm line" onClick={() => setView('customers')}>‹ 返回列表</button>{head && <div className="bcard"><span className="avatar-s">{head.nickname?.[0]}</span><b>{head.nickname}</b><span className="admin-note"> · 绑定于 {head.boundAt?.slice(0,10)}</span></div>}<div className="itab">{['glucose','bp','lipid','uric'].map((m) => <button key={m} className={metric === m ? 'on' : ''} onClick={() => setMetric(m)}>{m}</button>)}</div><div className="bcard"><table className="btab"><tbody>{records.map((r) => <tr key={r.id}><td>{r.measuredAt.slice(0,16).replace('T',' ')}</td><td className="num" style={{ color: dotColor(r.status.key), fontWeight: 700 }}>{readRecord(r)}</td><td><span className="pill ok">{r.status.label}</span></td><td>{r.note || '—'}</td></tr>)}</tbody></table><div className="bfoot">以上数据由客户本人记录并授权查看，仅供健康管理参考，不构成诊疗依据；请勿据此指导用药，医疗问题请建议客户及时就医</div></div></>;
}

function readRecord(r: any) { if (r.metric === 'bp') return `${r.sbp}/${r.dbp}`; if (r.metric === 'uric') return r.value; if (r.metric === 'lipid') return ['tc','tg','ldl','hdl'].map((k) => r[k] ?? '—').join(' / '); return r.displayValue; }

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
  useEffect(() => { api('/api/pharmacy/staff').then((d) => setItems(d.items)); }, []);
  return <div className="bcard"><table className="btab"><tbody>{items.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.username}</td><td>{s.role}</td><td><span className="pill ok">在职</span></td></tr>)}</tbody></table></div>;
}

function Settings({ showToast }: any) {
  return <div className="bcard" style={{ maxWidth: 520 }}><div className="bh"><span className="t">药房资料</span></div><input className="bsearch" style={{ width: '100%', marginBottom: 10 }} placeholder="药房名称" /><input className="bsearch" style={{ width: '100%', marginBottom: 10 }} placeholder="门店地址" /><button className="bbtn" onClick={() => showToast('已保存')}>保存</button></div>;
}

function AdminStats() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api('/api/admin/stats').then(setData); }, []);
  return <div className="bstats">{data && [['药房总数', data.pharmacyTotal], ['客户总数', data.customerTotal], ['今日记录数', data.recordsToday]].map(([k,v]) => <div className="bstat" key={k as string}><div className="k">{k}</div><div className="v num">{v as any}</div></div>)}</div>;
}

function AdminPharmacies({ showToast }: any) {
  const [items, setItems] = useState<any[]>([]);
  const load = () => api('/api/admin/pharmacies').then((d) => setItems(d.items));
  useEffect(() => { void load(); }, []);
  async function create() { await api('/api/admin/pharmacies', { method: 'POST', body: JSON.stringify({ name: `新药房${Date.now().toString().slice(-4)}`, address: '人民路', phone: '123', ownerUsername: `owner${Date.now().toString().slice(-4)}`, ownerPassword: 'Owner@123' }) }); showToast('已新增药房'); load(); }
  return <><div className="btools"><button className="bbtn" onClick={create}>新增药房</button></div><div className="bcard"><table className="btab"><tbody>{items.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.address}</td><td>{p.ownerUsername}</td><td>{p.customerCount}</td><td>{p.disabledAt ? '停用' : '启用'}</td></tr>)}</tbody></table></div></>;
}

createRoot(document.getElementById('root')!).render(<App />);
