import React, { useEffect, useState } from 'react';

type Api = (path: string, init?: RequestInit) => Promise<any>;
type UserSummary = { id: string; nickname: string; adminNote: string; createdAt: string; lastRecordedAt: string | null; totalRecords: number; records7d: number; records30d: number };
type UserList = { items: UserSummary[]; page: number; limit: number; total: number; period: { from7: string; from30: string; to: string } };
type RecordItem = { id: string; metric: string; measuredAt: string; createdAt: string; note: string; periodName?: string; fasting?: boolean; displayValue?: string; displayUnit?: string; sbp?: number; dbp?: number; pulse?: number | null; tc?: number | null; tg?: number | null; ldl?: number | null; hdl?: number | null; value?: number };
const metricNames: Record<string, string> = { all: '全部指标', glucose: '血糖', bp: '血压', lipid: '血脂', uric: '尿酸' };

function formatTime(value: string | null) {
  if (!value) return '暂无有效记录';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

function Pagination({ page, limit, total, loading, change }: { page: number; limit: number; total: number; loading: boolean; change: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return <div className="admin-pagination"><span>共 {total} 条 · 第 {page} / {pages} 页</span><div><button className="bbtn line" disabled={loading || page <= 1} onClick={() => change(page - 1)}>上一页</button><button className="bbtn line" disabled={loading || page >= pages} onClick={() => change(page + 1)}>下一页</button></div></div>;
}

export function AdminUsers({ api, showToast }: { api: Api; showToast: (message: string) => void }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [activity, setActivity] = useState('all');
  const [days, setDays] = useState(7);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UserList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const params = new URLSearchParams({ q: query, activity, days: String(days), page: String(page), limit: '20' });
    api(`/api/admin/users?${params}`, { signal: controller.signal }).then((result: UserList) => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(result.total / result.limit));
      if (page > lastPage) { setPage(lastPage); return; }
      setData(result);
    }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message || '用户列表加载失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, query, activity, days, page, revision]);

  if (selectedId) return <AdminUserDetail key={selectedId} api={api} userId={selectedId} back={() => { setSelectedId(''); setRevision((value) => value + 1); }} showToast={showToast} />;

  const explanation = activity === 'new_without_records' ? `近 ${days} 天注册，当前四项指标均无有效记录。`
    : activity === 'with_records' ? '当前至少有一条有效记录，注册时间不限。'
      : activity === 'inactive' ? `当前有历史有效记录，但近 ${days} 天没有新增有效记录。` : '全部未注销用户，包括未绑定药房的用户。';
  return <section className="admin-users">
    <div className="admin-intro"><h2>用户与记录</h2><p>查看小程序及网页用户的记录情况。管理员备注仅在后台使用，不修改用户昵称。</p></div>
    <div className="bcard">
      <form className="admin-user-filters" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); setPage(1); }}>
        <input className="bsearch" aria-label="搜索昵称、管理员备注或用户编号" placeholder="搜索昵称、备注或用户编号" maxLength={80} value={search} onChange={(event) => setSearch(event.target.value)} />
        <button className="bbtn" type="submit">搜索</button>
        <select aria-label="录入情况" value={activity} onChange={(event) => { setActivity(event.target.value); setPage(1); }}>
          <option value="all">全部用户</option><option value="new_without_records">新注册 · 暂无有效记录</option><option value="with_records">有有效记录</option><option value="inactive">近期未录入</option>
        </select>
        <select aria-label="筛选时间范围" value={days} onChange={(event) => { setDays(Number(event.target.value)); setPage(1); }} disabled={activity === 'all' || activity === 'with_records'}><option value={7}>近 7 天</option><option value={30}>近 30 天</option></select>
        <button className="bbtn line" type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)}>刷新</button>
      </form>
      <p className="admin-filter-note">{explanation}次数与最近录入时间按保存到系统的时间统计，排除已删除记录。所有时间为北京时间。</p>
      {data && <p className="admin-period-note">统计截至 {formatTime(data.period.to)}；近 7 天从 {formatTime(data.period.from7)} 起，近 30 天从 {formatTime(data.period.from30)} 起。</p>}
      {error && <div className="form-error" role="alert">{error} <button className="admin-text-button" onClick={() => setRevision((value) => value + 1)}>重试</button></div>}
      {loading ? <div className="empty" role="status">正在加载用户…</div> : !error && data && <>
        <div className="admin-table-scroll"><table className="btab admin-user-table"><thead><tr><th>用户 / 管理员备注</th><th>注册时间</th><th>最近录入</th><th>近 7 天</th><th>近 30 天</th><th>全部有效记录</th><th>操作</th></tr></thead><tbody>
          {data.items.map((user) => <tr key={user.id}><td><div className="admin-user-cell"><span className="admin-user-avatar">{Array.from(user.nickname || '微')[0]}</span><div><strong>{user.nickname || '未设置昵称'}</strong><small>{user.adminNote || '未添加管理员备注'}</small><small title={user.id}>编号：{user.id.slice(-6)}</small></div></div></td><td>{formatTime(user.createdAt)}</td><td>{formatTime(user.lastRecordedAt)}</td><td className="num">{user.records7d}</td><td className="num">{user.records30d}</td><td className="num">{user.totalRecords}</td><td><button className="bbtn line" onClick={() => setSelectedId(user.id)}>查看记录</button></td></tr>)}
        </tbody></table></div>
        {!data.items.length && <div className="empty">没有符合条件的用户</div>}
        <Pagination page={page} limit={data.limit} total={data.total} loading={loading} change={setPage} />
      </>}
    </div>
  </section>;
}

function reading(record: RecordItem) {
  if (record.metric === 'glucose') return `${record.displayValue} ${record.displayUnit}`;
  if (record.metric === 'bp') return `${record.sbp}/${record.dbp} mmHg${record.pulse == null ? '' : ` · 脉搏 ${record.pulse} 次/分`}`;
  if (record.metric === 'uric') return `${record.value} μmol/L`;
  return ([['tc', '总胆固醇'], ['tg', '甘油三酯'], ['ldl', '低密度脂蛋白'], ['hdl', '高密度脂蛋白']] as const)
    .filter(([key]) => record[key] != null).map(([key, name]) => `${name} ${record[key]} mmol/L`).join('；');
}

function AdminUserDetail({ api, userId, back, showToast }: { api: Api; userId: string; back: () => void; showToast: (message: string) => void }) {
  const [metric, setMetric] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ user: { id: string; nickname: string; adminNote: string; avatarUrl: string | null; createdAt: string }; items: RecordItem[]; total: number; limit: number } | null>(null);
  const [note, setNote] = useState('');
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noteError, setNoteError] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const params = new URLSearchParams({ metric, page: String(page), limit: '20' });
    api(`/api/admin/users/${encodeURIComponent(userId)}/records?${params}`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(result.total / result.limit));
      if (page > lastPage) { setPage(lastPage); return; }
      setData(result);
      if (!noteLoaded) { setNote(result.user.adminNote); setNoteLoaded(true); }
    }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message || '记录加载失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, userId, metric, page, revision]);

  async function saveNote() {
    if (saving || !data) return;
    setSaving(true); setNoteError('');
    try {
      const result = await api(`/api/admin/users/${encodeURIComponent(userId)}/note`, { method: 'PATCH', body: JSON.stringify({ adminNote: note.trim() }) });
      setNote(result.adminNote);
      setData((current) => current ? { ...current, user: { ...current.user, adminNote: result.adminNote } } : current);
      showToast('管理员备注已保存');
    } catch (err: any) { setNoteError(err.message || '备注保存失败'); } finally { setSaving(false); }
  }

  return <section className="admin-users">
    <button className="bbtn line" onClick={back}>‹ 返回用户列表</button>
    {data && <div className="bcard admin-user-profile"><div className="admin-user-cell"><span className="admin-user-avatar large">{data.user.avatarUrl ? <img src={data.user.avatarUrl} alt={`${data.user.nickname}的头像`} /> : Array.from(data.user.nickname || '微')[0]}</span><div><h2>{data.user.nickname || '未设置昵称'}</h2><small>注册：{formatTime(data.user.createdAt)}（北京时间）</small><small>用户编号：{data.user.id}</small></div></div>
      <form className="admin-note-form" onSubmit={(event) => { event.preventDefault(); void saveNote(); }}><label htmlFor="admin-user-note">管理员备注</label><div><input id="admin-user-note" className="bsearch" value={note} maxLength={100} onChange={(event) => setNote(event.target.value)} placeholder="例如：爸爸、妈妈，仅后台可见" /><button className="bbtn" disabled={saving || note.trim() === data.user.adminNote}>{saving ? '保存中…' : '保存备注'}</button></div><small>最多 100 字，不修改用户在小程序中显示的昵称。</small>{noteError && <p className="form-error" role="alert">{noteError}</p>}</form>
    </div>}
    <div className="bcard"><div className="admin-record-tabs">{Object.entries(metricNames).map(([key, name]) => <button key={key} className={`bbtn ${metric === key ? '' : 'line'}`} onClick={() => { setMetric(key); setPage(1); }}>{name}</button>)}<button className="bbtn line" disabled={loading} onClick={() => setRevision((value) => value + 1)}>刷新</button></div>
      <p className="admin-filter-note">按录入时间从新到旧排列，仅显示有效记录。“测量时间”由用户填写，“录入时间”为保存到系统的时间；补录的两者可能不同。以下均为北京时间。</p>
      {error && <div className="form-error" role="alert">{error} <button className="admin-text-button" onClick={() => setRevision((value) => value + 1)}>重试</button></div>}
      {loading ? <div className="empty" role="status">正在加载记录…</div> : !error && data && <>
        <div className="admin-table-scroll"><table className="btab admin-record-table"><thead><tr><th>指标</th><th>数值</th><th>时段 / 空腹</th><th>测量时间</th><th>录入时间</th><th>用户备注</th></tr></thead><tbody>{data.items.map((record) => <tr key={`${record.metric}:${record.id}`}><td>{metricNames[record.metric]}</td><td className="num admin-reading">{reading(record)}</td><td>{record.periodName || (record.fasting === true ? '空腹' : record.fasting === false ? '非空腹' : '—')}</td><td>{formatTime(record.measuredAt)}</td><td>{formatTime(record.createdAt)}</td><td className="admin-record-note">{record.note || '—'}</td></tr>)}</tbody></table></div>
        {!data.items.length && <div className="empty">该用户暂无{metric === 'all' ? '' : metricNames[metric]}有效记录</div>}
        <Pagination page={page} limit={data.limit} total={data.total} loading={loading} change={setPage} />
      </>}
    </div>
  </section>;
}
