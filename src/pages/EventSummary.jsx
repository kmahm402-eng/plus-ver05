import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { STORES, storeName, MAIN_CAT, midName, OUTSOURCERS } from '../data/masters';
import { linePoints, POINT_ITEMS } from '../lib/points';

const EVENT_STORES = STORES.filter(s => s.isEvent);
const EVENT_HOST = { STORE_007: 'STORE_002', STORE_008: 'STORE_003', STORE_009: 'STORE_001' };
const SHIN_MNP = ['MAIN_001', 'MAIN_002'];
const LTV_KEYS = Object.keys(POINT_ITEMS).filter(k => POINT_ITEMS[k].grp === 'LTV');
const mainName = (id) => MAIN_CAT.find(m => m.id === id)?.name || id;
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const yen = (n) => '¥' + Number(n || 0).toLocaleString();
const actorOf = (r) => (r.acqType === 'proxy' ? r.proxyStaff : r.staffName) || '?';
const isOut = (name) => OUTSOURCERS.includes(name);
const COST_KEYS = [['venue', '🏢 会場費'], ['labor', '👷 人件費'], ['supplies', '📦 備品・販促費'], ['prize', '🎁 景品代'], ['other', '📋 その他']];
const C = { gold: '#FBBF24', green: '#34D399', purple: '#A78BFA', red: '#F87171', blue: '#38BDF8', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };
const inp = { width: '100%', padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const lbl = { fontSize: 11, color: '#94A3B8', marginBottom: 5, display: 'block' };

function aggEvent(ev, reports) {
  const reps = reports.filter(r => {
    const d = r.createdAt?.toDate?.(); if (!d) return false;
    const ds = ymd(d);
    return r.storeId === ev.storeId && ds >= ev.start && ds <= ev.end;
  });
  const lines = []; const item = {};
  reps.forEach(r => (r.lines || []).forEach(l => {
    lines.push({ date: ymd(r.createdAt.toDate()), actor: actorOf(r), midCat: l.midCat, mainCat: l.mainCat, plus1c: Number(l.plus1c) || 0 });
    const add = linePoints(l, r); for (const k in add) item[k] = (item[k] || 0) + add[k];
  }));
  const total = lines.length;
  // タブレット新規(MID_016)は「新規」「新規+MNP」に数えない（総件数には含む）
  const shinMnp = lines.filter(l => SHIN_MNP.includes(l.mainCat) && l.midCat !== 'MID_016').length;
  const shin = lines.filter(l => l.mainCat === 'MAIN_001' && l.midCat !== 'MID_016').length;
  const mnp = lines.filter(l => l.mainCat === 'MAIN_002').length;
  const byMain = {}; lines.forEach(l => byMain[l.mainCat] = (byMain[l.mainCat] || 0) + 1);
  const byStaff = {}; const byOut = {};
  lines.forEach(l => { if (isOut(l.actor)) byOut[l.actor] = (byOut[l.actor] || 0) + 1; else byStaff[l.actor] = (byStaff[l.actor] || 0) + 1; });
  const plus1cSum = lines.reduce((s, l) => s + l.plus1c, 0);
  const costs = ev.costs || {};
  const costSum = COST_KEYS.reduce((s, [k]) => s + (Number(costs[k]) || 0), 0);
  const g = shinMnp > 0 ? Math.round(costSum / shinMnp) : 0;
  return { lines, total, shinMnp, shin, mnp, byMain, byStaff, byOut, plus1cSum, item, costSum, g };
}
function daysBetween(start, end) {
  const out = []; let d = new Date(start + 'T00:00:00'); const e = new Date(end + 'T00:00:00');
  while (d <= e) { out.push(ymd(d)); d = new Date(d.getTime() + 86400000); }
  return out;
}
function countPeriod(reports, storeIds, start, end) {
  let total = 0, shin = 0, mnp = 0;
  reports.forEach(r => {
    const d = r.createdAt?.toDate?.(); if (!d) return;
    const ds = ymd(d);
    if (!storeIds.includes(r.storeId) || ds < start || ds > end) return;
    (r.lines || []).forEach(l => { total++; if (l.mainCat === 'MAIN_001' && l.midCat !== 'MID_016') shin++; else if (l.mainCat === 'MAIN_002') mnp++; });
  });
  return { total, shin, mnp, shinMnp: shin + mnp };
}

export default function EventSummary() {
  const { user } = useAuth();
  const [reports, setReports] = useState([]);
  const [events, setEvents] = useState([]);
  const [cfg, setCfg] = useState({ revenuePerAcq: 0 });
  const [revDraft, setRevDraft] = useState('');
  const [month, setMonth] = useState(() => ym(new Date()));
  const [topTab, setTopTab] = useState('summary');
  const [storeFilter, setStoreFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [subTab, setSubTab] = useState('agg');
  const [dayFilter, setDayFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', storeId: EVENT_STORES[0]?.id || '', start: '', end: '' });
  const [draft, setDraft] = useState(null);
  const [funnels, setFunnels] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [fDraft, setFDraft] = useState(null);
  const [follow, setFollow] = useState({ customer: '', owner: '', nextDate: '', stage: '見込み', note: '' });

  useEffect(() => {
    if (!user) return;
    const u1 = onSnapshot(query(collection(db, 'reports')), s => setReports(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(query(collection(db, 'events')), s => setEvents(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u3 = onSnapshot(doc(db, 'eventConfig', 'main'), s => { const d = s.exists() ? s.data() : {}; setCfg({ revenuePerAcq: d.revenuePerAcq || 0 }); setRevDraft(String(d.revenuePerAcq || '')); });
    const u4 = onSnapshot(query(collection(db, 'eventFunnel')), s => setFunnels(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u5 = onSnapshot(query(collection(db, 'pipeline')), s => setPipeline(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [user]);

  const rev = cfg.revenuePerAcq || 0;
  const monthEvents = useMemo(() => events.filter(e => (e.start || '').slice(0, 7) === month).sort((a, b) => (b.start || '').localeCompare(a.start || '')), [events, month]);
  const aggMap = useMemo(() => { const m = {}; monthEvents.forEach(e => m[e.id] = aggEvent(e, reports)); return m; }, [monthEvents, reports]);
  const filtered = storeFilter === 'all' ? monthEvents : monthEvents.filter(e => e.storeId === storeFilter);

  const totals = useMemo(() => {
    let orders = 0, sm = 0, cost = 0;
    filtered.forEach(e => { const a = aggMap[e.id]; orders += a.total; sm += a.shinMnp; cost += a.costSum; });
    return { orders, sm, cost, g: sm > 0 ? Math.round(cost / sm) : 0, income: sm * rev, profit: sm * rev - cost };
  }, [filtered, aggMap, rev]);

  const storeChips = useMemo(() => EVENT_STORES.map(s => ({ ...s, count: monthEvents.filter(e => e.storeId === s.id).reduce((n, e) => n + aggMap[e.id].total, 0) })), [monthEvents, aggMap]);

  // 外注 生産性（当月・絞り込み内：新規+MNP件数）
  const outRank = useMemo(() => {
    const m = {};
    filtered.forEach(e => { aggMap[e.id].lines.forEach(l => { if (isOut(l.actor)) { m[l.actor] = m[l.actor] || { total: 0, sm: 0 }; m[l.actor].total++; if (SHIN_MNP.includes(l.mainCat)) m[l.actor].sm++; } }); });
    return Object.entries(m).map(([nm, d]) => ({ nm, ...d })).sort((a, b) => b.sm - a.sm);
  }, [filtered, aggMap]);

  const races = useMemo(() => {
    const g = {};
    monthEvents.forEach(e => { const k = e.start + '〜' + e.end; (g[k] = g[k] || []).push(e); });
    return Object.entries(g).sort((a, b) => b[0].localeCompare(a[0])).map(([period, evs]) => ({
      period,
      rows: evs.map(e => {
        const ids = [e.storeId, EVENT_HOST[e.storeId]].filter(Boolean);
        return { name: storeName(e.storeId).replace('イベント', ''), ...countPeriod(reports, ids, e.start, e.end) };
      }).sort((a, b) => b.shinMnp - a.shinMnp),
    }));
  }, [monthEvents, reports]);

  // 前回・前年比較
  const compare = (e) => {
    const same = events.filter(x => x.storeId === e.storeId && x.id !== e.id);
    const prev = same.filter(x => (x.start || '') < e.start).sort((a, b) => (b.start || '').localeCompare(a.start || ''))[0];
    const ty = (() => { const d = new Date(e.start + 'T00:00:00'); d.setFullYear(d.getFullYear() - 1); return ymd(d); })();
    let yearAgo = null, best = 999;
    same.forEach(x => { const diff = Math.abs((new Date(x.start + 'T00:00:00') - new Date(ty + 'T00:00:00')) / 86400000); if (diff <= 21 && diff < best) { best = diff; yearAgo = x; } });
    return { prevSM: prev ? aggEvent(prev, reports).shinMnp : null, yearSM: yearAgo ? aggEvent(yearAgo, reports).shinMnp : null };
  };

  const saveRev = async () => { await setDoc(doc(db, 'eventConfig', 'main'), { revenuePerAcq: Number(revDraft) || 0 }, { merge: true }); alert('想定収入を保存しました'); };
  const addEvent = async () => {
    if (!form.name.trim() || !form.start || !form.end) { alert('名前・開始日・終了日を入れてください'); return; }
    await addDoc(collection(db, 'events'), { ...form, target: 0, costs: { venue: 0, labor: 0, supplies: 0, prize: 0, other: 0 }, createdAt: serverTimestamp() });
    setForm({ name: '', storeId: EVENT_STORES[0]?.id || '', start: '', end: '' }); setShowAdd(false);
  };
  const openCost = (e) => { const c = e.costs || {}; setDraft({ target: e.target || 0, venue: c.venue || 0, labor: c.labor || 0, supplies: c.supplies || 0, prize: c.prize || 0, other: c.other || 0 }); };
  const saveCost = async (e) => {
    await setDoc(doc(db, 'events', e.id), { target: Number(draft.target) || 0, costs: { venue: +draft.venue || 0, labor: +draft.labor || 0, supplies: +draft.supplies || 0, prize: +draft.prize || 0, other: +draft.other || 0 } }, { merge: true });
    alert('費用を保存しました');
  };
  const delEvent = async (e) => { if (confirm('「' + e.name + '」を削除しますか？')) { await deleteDoc(doc(db, 'events', e.id)); setOpenId(null); } };
  const saveFunnel = async (e) => {
    for (const d of Object.keys(fDraft)) {
      const v = fDraft[d];
      await setDoc(doc(db, 'eventFunnel', e.id + '_' + d), { eventId: e.id, storeId: e.storeId, date: d, catch: +v.catch || 0, prospect: +v.prospect || 0, guided: +v.guided || 0, updatedAt: serverTimestamp() }, { merge: true });
    }
    alert('ファネルを保存しました');
  };
  const addFollow = async (e) => {
    if (!follow.customer.trim()) { alert('顧客メモを入れてください'); return; }
    await addDoc(collection(db, 'pipeline'), { ...follow, fromEventId: e.id, storeId: e.storeId, status: 'open', createdAt: serverTimestamp() });
    setFollow({ customer: '', owner: '', nextDate: '', stage: '見込み', note: '' });
  };
  const setStage = async (id, stage) => { await setDoc(doc(db, 'pipeline', id), { stage, status: (stage === '成約' || stage === '失注') ? 'closed' : 'open' }, { merge: true }); };
  const delFollow = async (id) => { if (confirm('この案件を削除しますか？')) await deleteDoc(doc(db, 'pipeline', id)); };
  const open = (e) => {
    if (openId === e.id) { setOpenId(null); return; }
    setOpenId(e.id); setSubTab('agg'); setDayFilter('all'); openCost(e);
    const fd = {}; daysBetween(e.start, e.end).forEach(d => { const f = funnels.find(x => x.eventId === e.id && x.date === d); fd[d] = { catch: f?.catch || 0, prospect: f?.prospect || 0, guided: f?.guided || 0 }; });
    setFDraft(fd);
    setFollow({ customer: '', owner: '', nextDate: '', stage: '見込み', note: '' });
  };

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 10 }}>📊 イベント集計</h1>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[['summary', '📊 集計'], ['race', '🏁 期間比較']].map(([id, label]) => (
          <button key={id} onClick={() => setTopTab(id)} style={{ flex: 1, padding: 9, borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: topTab === id ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.02)', color: topTab === id ? C.gold : C.mut2, border: topTab === id ? '1px solid rgba(251,191,36,0.25)' : '1px solid rgba(255,255,255,0.04)' }}>{label}</button>
        ))}
      </div>
      <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ ...inp, marginBottom: 12, width: 'auto', display: 'inline-block' }} />

      {topTab === 'summary' && (<>
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: C.w2, flexShrink: 0 }}>新規+MNP<br />1件の想定収入</span>
          <input type="number" value={revDraft} onChange={e => setRevDraft(e.target.value)} placeholder="例: 30000" style={{ ...inp, textAlign: 'right' }} />
          <span style={{ fontSize: 11, color: C.mut }}>円</span>
          <button onClick={saveRev} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', background: C.green, color: '#000', flexShrink: 0 }}>保存</button>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <button onClick={() => setStoreFilter('all')} style={chip(storeFilter === 'all')}>全イベント（{monthEvents.reduce((n, e) => n + aggMap[e.id].total, 0)}件）</button>
          {storeChips.map(s => <button key={s.id} onClick={() => setStoreFilter(s.id)} style={chip(storeFilter === s.id)}>{s.name}（{s.count}件）</button>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          {summaryCard('受付オーダー数', totals.orders + '件', C.green)}
          {summaryCard('新規+MNP', totals.sm + '件', C.gold)}
          {summaryCard('総費用', yen(totals.cost), C.purple)}
          {summaryCard('件単価(G)', yen(totals.g), C.red, '費用÷新規+MNP')}
        </div>
        {rev > 0 && (
          <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: C.mut }}>想定収入 {yen(totals.income)} − 費用 {yen(totals.cost)}</span>
            <span style={{ fontSize: 15, fontWeight: 900, color: totals.profit >= 0 ? C.green : C.red }}>{totals.profit >= 0 ? '黒字 ' : '赤字 '}{yen(totals.profit)}</span>
          </div>
        )}
        {outRank.length > 0 && (
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 8 }}>👷 外注 生産性（新規+MNP）</div>
            {outRank.map(o => (
              <div key={o.nm} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                <span style={{ color: C.red }}>{o.nm}</span>
                <span style={{ color: C.w2 }}>新規+MNP <b style={{ color: C.gold }}>{o.sm}</b> ／ 受付 {o.total}件</span>
              </div>
            ))}
            <div style={{ fontSize: 9, color: C.mut2, marginTop: 4 }}>※ 件数ベースの生産性です（会社別の費用は未記録のため、1件あたり費用は今後）。</div>
          </div>
        )}

        <button onClick={() => setShowAdd(v => !v)} style={{ width: '100%', padding: 12, borderRadius: 12, marginBottom: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: showAdd ? 'rgba(248,113,113,0.06)' : 'transparent', color: showAdd ? C.red : C.gold, border: '1px dashed ' + (showAdd ? 'rgba(248,113,113,0.4)' : 'rgba(251,191,36,0.4)') }}>{showAdd ? '× 閉じる' : '＋ イベントを追加'}</button>
        {showAdd && (
          <div style={card}>
            <label style={lbl}>イベント名</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例: 5月第1週イベント" style={{ ...inp, marginBottom: 10 }} />
            <label style={lbl}>店舗</label>
            <select value={form.storeId} onChange={e => setForm({ ...form, storeId: e.target.value })} style={{ ...inp, marginBottom: 10 }}>{EVENT_STORES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1 }}><label style={lbl}>開始日</label><input type="date" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} style={inp} /></div>
              <div style={{ flex: 1 }}><label style={lbl}>終了日</label><input type="date" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} style={inp} /></div>
            </div>
            <button onClick={addEvent} style={{ width: '100%', padding: 11, borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: C.green, color: '#000' }}>イベントを追加</button>
          </div>
        )}

        {filtered.length === 0 && <div style={{ textAlign: 'center', color: C.mut2, fontSize: 12, padding: 20 }}>この月のイベントはありません</div>}
        {filtered.map(e => { const a = aggMap[e.id]; const isOpen = openId === e.id; const days = daysBetween(e.start, e.end);
          const target = e.target || 0; const rate = target > 0 ? Math.round(a.shinMnp / target * 100) : null; const remain = Math.max(0, target - a.shinMnp);
          const profit = rev > 0 ? a.shinMnp * rev - a.costSum : null;
          return (
            <div key={e.id} style={{ ...card, borderColor: isOpen ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.06)' }}>
              <div onClick={() => open(e)} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: C.gold }}>{e.name}</span>
                  <span style={{ fontSize: 18, fontWeight: 900, color: C.green }}>{a.total}<span style={{ fontSize: 11 }}>件</span></span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.mut, marginTop: 2 }}>
                  <span>{storeName(e.storeId)}｜{e.start}〜{e.end}</span>
                  <span>G:{a.shinMnp} {yen(a.g)}/件</span>
                </div>
                {target > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.mut, marginBottom: 2 }}><span>目標 {target}（あと{remain}）</span><span style={{ color: rate >= 100 ? C.green : C.gold, fontWeight: 700 }}>{rate}%</span></div>
                    <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 3, width: Math.min(rate, 100) + '%', background: rate >= 100 ? C.green : C.gold }} /></div>
                  </div>
                )}
                {profit !== null && <div style={{ fontSize: 10, marginTop: 4, color: profit >= 0 ? C.green : C.red, fontWeight: 700 }}>{profit >= 0 ? '黒字 ' : '赤字 '}{yen(profit)}</div>}
                <div style={{ fontSize: 11, color: isOpen ? C.mut : C.gold, marginTop: 6 }}>{isOpen ? '▲ 閉じる' : '▼ 詳細・費用入力'}</div>
              </div>

              {isOpen && (
                <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    {[['agg', '📊 集計'], ['detail', '📋 明細'], ['cost', '💰 費用'], ['funnel', '🪜 じょうご'], ['follow', '📞 フォロー']].map(([id, label]) => (
                      <button key={id} onClick={() => setSubTab(id)} style={{ flex: 1, padding: 7, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: subTab === id ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.03)', color: subTab === id ? C.purple : C.mut2, border: subTab === id ? '1px solid rgba(167,139,250,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>{label}</button>
                    ))}
                  </div>

                  {subTab === 'agg' && (() => {
                    const cmp = compare(e); const item = a.item;
                    const mane = item.manekatsu2 || 0; const net = item.network || 0;
                    const maneRate = a.shinMnp > 0 ? Math.round(mane / a.shinMnp * 100) : 0;
                    const netRate = a.shinMnp > 0 ? Math.round(net / a.shinMnp * 100) : 0;
                    const avg1c = a.total > 0 ? Math.round(a.plus1cSum / a.total) : 0;
                    const income = a.shinMnp * rev; const profit2 = income - a.costSum; const be = rev > 0 ? Math.ceil(a.costSum / rev) : null;
                    const ls = dayFilter === 'all' ? a.lines : a.lines.filter(l => l.date === dayFilter);
                    const byMain = {}; ls.forEach(l => byMain[l.mainCat] = (byMain[l.mainCat] || 0) + 1);
                    const byStaff = {}; const byOut = {}; ls.forEach(l => { if (isOut(l.actor)) byOut[l.actor] = (byOut[l.actor] || 0) + 1; else byStaff[l.actor] = (byStaff[l.actor] || 0) + 1; });
                    return (<>
                      {/* 達成率（主役） */}
                      <div style={{ ...card, background: 'rgba(52,211,153,0.05)', borderColor: 'rgba(52,211,153,0.2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>🎯 達成率</span>
                          <span style={{ fontSize: 20, fontWeight: 900, color: target > 0 && a.shinMnp >= target ? C.green : C.gold }}>{target > 0 ? Math.round(a.shinMnp / target * 100) + '%' : '—'}</span>
                        </div>
                        <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 4 }}><div style={{ height: '100%', borderRadius: 4, width: (target > 0 ? Math.min(a.shinMnp / target * 100, 100) : 0) + '%', background: C.green }} /></div>
                        <div style={{ fontSize: 11, color: C.mut }}>目標 {target}件 ／ 実績 {a.shinMnp}件 ／ あと {Math.max(0, target - a.shinMnp)}件</div>
                      </div>
                      {/* 採算 */}
                      <div style={card}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 6 }}>💴 採算</div>
                        {rev > 0 ? (<>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.mut, padding: '2px 0' }}><span>想定収入（{a.shinMnp}件×{yen(rev)}）</span><span style={{ color: C.green }}>{yen(income)}</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.mut, padding: '2px 0' }}><span>費用</span><span style={{ color: C.purple }}>{yen(a.costSum)}</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800, padding: '4px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}><span style={{ color: '#fff' }}>{profit2 >= 0 ? '黒字' : '赤字'}</span><span style={{ color: profit2 >= 0 ? C.green : C.red }}>{yen(profit2)}</span></div>
                          {profit2 < 0 && be != null && <div style={{ fontSize: 10, color: C.gold, marginTop: 2 }}>あと {Math.max(0, be - a.shinMnp)}件で黒字（損益分岐 {be}件）</div>}
                        </>) : <div style={{ fontSize: 11, color: C.mut2 }}>上の「1件の想定収入」を入れると黒字・赤字が出ます。</div>}
                      </div>
                      {/* 前回・前年 */}
                      {(cmp.prevSM != null || cmp.yearSM != null) && (
                        <div style={{ ...card, display: 'flex', gap: 16, fontSize: 11 }}>
                          {cmp.prevSM != null && <span style={{ color: C.mut }}>前回比 <b style={{ color: a.shinMnp - cmp.prevSM >= 0 ? C.green : C.red }}>{a.shinMnp - cmp.prevSM >= 0 ? '+' : ''}{a.shinMnp - cmp.prevSM}</b>（前回{cmp.prevSM}）</span>}
                          {cmp.yearSM != null && <span style={{ color: C.mut }}>前年比 <b style={{ color: a.shinMnp - cmp.yearSM >= 0 ? C.green : C.red }}>{a.shinMnp - cmp.yearSM >= 0 ? '+' : ''}{a.shinMnp - cmp.yearSM}</b>（前年{cmp.yearSM}）</span>}
                        </div>
                      )}
                      {/* 質・LTV */}
                      <div style={card}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 8 }}>💎 質・LTV</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 10 }}>
                          {miniCard('マネ活2率', maneRate + '%', C.gold)}{miniCard('固定比率', netRate + '%', C.blue)}{miniCard('+1C平均/件', yen(avg1c), C.green)}
                        </div>
                        <div style={{ fontSize: 10, color: C.mut, marginBottom: 6 }}>+1C販売額 合計：<b style={{ color: C.green }}>{yen(a.plus1cSum)}</b></div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4 }}>
                          {LTV_KEYS.filter(k => item[k]).map(k => (
                            <div key={k} style={{ padding: '5px 3px', borderRadius: 7, background: 'rgba(167,139,250,0.1)', textAlign: 'center', border: '1px solid rgba(167,139,250,0.25)' }}>
                              <div style={{ fontSize: 14, fontWeight: 900, color: C.purple }}>{item[k]}</div>
                              <div style={{ fontSize: 8, color: C.purple }}>{POINT_ITEMS[k].label}</div>
                            </div>
                          ))}
                          {LTV_KEYS.every(k => !item[k]) && <div style={{ fontSize: 10, color: C.mut2, gridColumn: '1/4' }}>LTV商材の獲得はまだありません</div>}
                        </div>
                      </div>
                      {/* 日別 + 大分類/自社/外注 */}
                      {days.length > 1 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                          <button onClick={() => setDayFilter('all')} style={dayChip(dayFilter === 'all')}>全日程</button>
                          {days.map((d, i) => { const c = a.lines.filter(l => l.date === d).length; const wd = ['日', '月', '火', '水', '木', '金', '土'][new Date(d + 'T00:00:00').getDay()]; return <button key={d} onClick={() => setDayFilter(d)} style={dayChip(dayFilter === d)}>{i + 1}日目 {d.slice(5).replace('-', '/')}({wd}) {c}件</button>; })}
                        </div>
                      )}
                      <Section title="📊 大分類別">{MAIN_CAT.filter(m => byMain[m.id]).map(m => row(m.name, byMain[m.id] + '件', C.gold))}</Section>
                      <Section title="👤 自社スタッフ">{Object.entries(byStaff).sort((x, y) => y[1] - x[1]).map(([n, c]) => row(n, c + '件', C.green))}{Object.keys(byStaff).length === 0 && <Empty />}</Section>
                      <Section title="👷 外注会社別">{Object.entries(byOut).sort((x, y) => y[1] - x[1]).map(([n, c]) => row(n, c + '件', C.red))}{Object.keys(byOut).length === 0 && <Empty />}</Section>
                    </>);
                  })()}

                  {subTab === 'detail' && (() => {
                    const ls = a.lines; const byMainL = {}; ls.forEach(l => (byMainL[l.mainCat] = byMainL[l.mainCat] || []).push(l));
                    const byActor = {}; ls.forEach(l => byActor[l.actor] = (byActor[l.actor] || 0) + 1);
                    return (<>
                      <div style={{ fontSize: 11, color: C.mut, marginBottom: 8 }}>全{ls.length}件の獲得明細</div>
                      {MAIN_CAT.filter(m => byMainL[m.id]).map(m => (
                        <div key={m.id} style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: C.gold, marginBottom: 4 }}>{m.name}（{byMainL[m.id].length}件）</div>
                          <div style={{ display: 'flex', fontSize: 9, color: C.mut2, padding: '2px 0' }}><span style={{ width: 44 }}>日付</span><span style={{ width: 90 }}>獲得者</span><span style={{ flex: 1 }}>商材</span><span>+1C</span></div>
                          {byMainL[m.id].map((l, i) => (
                            <div key={i} style={{ display: 'flex', fontSize: 11, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                              <span style={{ width: 44, color: C.mut }}>{l.date.slice(5).replace('-', '/')}</span>
                              <span style={{ width: 90, color: isOut(l.actor) ? C.red : C.green, fontWeight: 600 }}>{l.actor}</span>
                              <span style={{ flex: 1, color: C.w2 }}>{midName(l.midCat)}</span>
                              <span style={{ color: C.mut }}>{l.plus1c > 0 ? yen(l.plus1c) : '-'}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                      <Section title="👤 獲得者別合計">{Object.entries(byActor).sort((x, y) => y[1] - x[1]).map(([n, c]) => row(n, c + '件', isOut(n) ? C.red : C.green))}{ls.length === 0 && <Empty />}</Section>
                    </>);
                  })()}

                  {subTab === 'cost' && draft && (<>
                    <label style={lbl}>🎯 新規+MNP目標</label>
                    <input type="number" value={draft.target} onChange={ev2 => setDraft({ ...draft, target: ev2.target.value })} style={{ ...inp, marginBottom: 12 }} />
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.mut, marginBottom: 6 }}>💰 費用入力</div>
                    {COST_KEYS.map(([k, label]) => (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ width: 110, fontSize: 11, color: C.w2 }}>{label}</span>
                        <input type="number" value={draft[k]} onChange={ev2 => setDraft({ ...draft, [k]: ev2.target.value })} style={{ ...inp, textAlign: 'right' }} />
                        <span style={{ fontSize: 11, color: C.mut }}>円</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 13 }}><b style={{ color: '#fff' }}>合計</b><b style={{ color: C.purple }}>{yen(COST_KEYS.reduce((s, [k]) => s + (+draft[k] || 0), 0))}</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 10 }}><span style={{ color: C.mut }}>件単価(G)</span><b style={{ color: C.red }}>{yen(a.shinMnp > 0 ? Math.round(COST_KEYS.reduce((s, [k]) => s + (+draft[k] || 0), 0) / a.shinMnp) : 0)}</b></div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => saveCost(e)} style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: C.green, color: '#000' }}>費用を保存</button>
                      <button onClick={() => delEvent(e)} style={{ width: 56, borderRadius: 10, border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.06)', color: C.red, cursor: 'pointer', fontSize: 16 }}>🗑</button>
                    </div>
                  </>)}

                  {subTab === 'funnel' && fDraft && (() => {
                    const days = daysBetween(e.start, e.end);
                    const sum = days.reduce((s, d) => { const v = fDraft[d] || {}; s.c += +v.catch || 0; s.p += +v.prospect || 0; s.g += +v.guided || 0; return s; }, { c: 0, p: 0, g: 0 });
                    const seikai = a.shinMnp;
                    const pct = (n, d2) => d2 > 0 ? Math.round(n / d2 * 100) : 0;
                    const steps = [['キャッチ', sum.c, null, C.blue], ['見込み', sum.p, pct(sum.p, sum.c), C.purple], ['店舗誘導', sum.g, pct(sum.g, sum.p), C.gold], ['成約(新規+MNP)', seikai, pct(seikai, sum.g), C.green]];
                    return (<>
                      <div style={card}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 8 }}>🪜 転換率（じょうご）</div>
                        {steps.map(([label, n, rate, col], i) => (
                          <div key={i} style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}><span style={{ color: C.w2 }}>{label}</span><span style={{ color: C.gold, fontWeight: 700 }}>{n}件{rate != null && <span style={{ color: C.mut2, fontSize: 9 }}>　前段比 {rate}%</span>}</span></div>
                            <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 4, width: (sum.c > 0 ? n / sum.c * 100 : 0) + '%', background: col }} /></div>
                          </div>
                        ))}
                        <div style={{ fontSize: 10, color: C.mut, marginTop: 4 }}>キャッチ→成約 {pct(seikai, sum.c)}%</div>
                      </div>
                      <div style={card}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 8 }}>📝 日別入力（その日の終わりに）</div>
                        <div style={{ display: 'flex', fontSize: 9, color: C.mut2, padding: '2px 0' }}><span style={{ flex: 1 }}>日付</span><span style={{ width: 60, textAlign: 'center' }}>キャッチ</span><span style={{ width: 60, textAlign: 'center' }}>見込み</span><span style={{ width: 60, textAlign: 'center' }}>誘導</span></div>
                        {days.map(d => { const wd = ['日', '月', '火', '水', '木', '金', '土'][new Date(d + 'T00:00:00').getDay()]; const v = fDraft[d] || { catch: 0, prospect: 0, guided: 0 };
                          return (<div key={d} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 0' }}>
                            <span style={{ flex: 1, fontSize: 10, color: C.mut }}>{d.slice(5).replace('-', '/')}({wd})</span>
                            {['catch', 'prospect', 'guided'].map(key => <input key={key} type="number" value={v[key]} onChange={ev2 => setFDraft({ ...fDraft, [d]: { ...v, [key]: ev2.target.value } })} style={{ width: 60, padding: 6, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 12, textAlign: 'center', outline: 'none', boxSizing: 'border-box' }} />)}
                          </div>);
                        })}
                        <button onClick={() => saveFunnel(e)} style={{ width: '100%', padding: 11, borderRadius: 10, marginTop: 8, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: C.green, color: '#000' }}>ファネルを保存</button>
                      </div>
                    </>);
                  })()}

                  {subTab === 'follow' && (() => {
                    const STAGES = ['見込み', '来店予約', '来店', '成約', '失注'];
                    const items = pipeline.filter(p => p.fromEventId === e.id).sort((x, y) => (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0));
                    const sc = s => s === '成約' ? C.green : s === '失注' ? C.mut2 : (s === '来店' || s === '来店予約') ? C.gold : C.blue;
                    return (<>
                      <div style={card}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 8 }}>📞 後日フォロー案件を追加</div>
                        <input value={follow.customer} onChange={ev2 => setFollow({ ...follow, customer: ev2.target.value })} placeholder="顧客メモ（例: 田中様 iPhone検討/UQから乗換）" style={{ ...inp, marginBottom: 8 }} />
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <input value={follow.owner} onChange={ev2 => setFollow({ ...follow, owner: ev2.target.value })} placeholder="担当" style={inp} />
                          <input type="date" value={follow.nextDate} onChange={ev2 => setFollow({ ...follow, nextDate: ev2.target.value })} style={inp} />
                        </div>
                        <button onClick={() => addFollow(e)} style={{ width: '100%', padding: 10, borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: C.gold, color: '#000' }}>案件を追加</button>
                      </div>
                      <div style={{ fontSize: 11, color: C.mut, marginBottom: 6 }}>このイベント発の案件（{items.length}件）</div>
                      {items.length === 0 && <div style={{ fontSize: 11, color: C.mut2, padding: 8 }}>まだありません。取りこぼした見込み客をここに残すと、後日フォローできます。</div>}
                      {items.map(p => (
                        <div key={p.id} style={{ ...card, padding: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <span style={{ fontSize: 12, color: C.w2, fontWeight: 600, flex: 1 }}>{p.customer}</span>
                            <span onClick={() => delFollow(p.id)} style={{ fontSize: 12, color: C.red, cursor: 'pointer', marginLeft: 8 }}>🗑</span>
                          </div>
                          <div style={{ fontSize: 10, color: C.mut, margin: '4px 0' }}>{p.owner ? '担当: ' + p.owner : ''}{p.nextDate ? '　次回: ' + p.nextDate : ''}</div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {STAGES.map(s => <button key={s} onClick={() => setStage(p.id, s)} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer', background: p.stage === s ? sc(s) + '26' : 'rgba(255,255,255,0.03)', color: p.stage === s ? sc(s) : C.mut2, border: p.stage === s ? '1px solid ' + sc(s) + '66' : '1px solid rgba(255,255,255,0.06)' }}>{s}</button>)}
                          </div>
                        </div>
                      ))}
                      <div style={{ fontSize: 9, color: C.mut2 }}>※ ここに残した案件は、今後の「パイプライン（商談）」画面にもそのまま出ます（同じデータ）。成約にすると、このイベント発の後日成約として記録されます。</div>
                    </>);
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </>)}

      {topTab === 'race' && (<>
        <div style={{ fontSize: 11, color: C.mut, marginBottom: 12 }}>🏁 同じ期間のイベント同士で「新規+MNP」を比較（イベント店＋主催店の合算）。</div>
        {races.length === 0 && <div style={{ textAlign: 'center', color: C.mut2, fontSize: 12, padding: 20 }}>この月のイベントはありません</div>}
        {races.map(r => { const max = r.rows[0]?.shinMnp || 1;
          return (
            <div key={r.period} style={card}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.green, marginBottom: 10 }}>🗓 {r.period}</div>
              {r.rows.map((row2, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? C.gold : C.w2 }}>{i + 1}位　{row2.name}</span>
                    <span style={{ fontSize: 15, fontWeight: 900, color: i === 0 ? C.green : C.gold }}>{row2.shinMnp}<span style={{ fontSize: 10 }}>件</span></span>
                  </div>
                  <div style={{ height: 12, borderRadius: 6, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 6, width: (row2.shinMnp / max * 100) + '%', background: i === 0 ? C.green : C.gold }} /></div>
                  <div style={{ fontSize: 10, color: C.mut, marginTop: 3 }}>新規: {row2.shin}　MNP: {row2.mnp}　全体: {row2.total}</div>
                </div>
              ))}
            </div>
          );
        })}
      </>)}
    </div>
  );
}

function chip(on) { return { padding: '6px 10px', borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: on ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.02)', color: on ? '#FBBF24' : '#94A3B8', border: on ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }; }
function dayChip(on) { return { padding: '5px 8px', borderRadius: 7, fontSize: 9, fontWeight: 600, cursor: 'pointer', background: on ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.02)', color: on ? '#FBBF24' : '#94A3B8', border: on ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }; }
function summaryCard(label, val, color, sub) { return (<div style={{ background: '#1a1625', borderRadius: 12, padding: 12, border: '1px solid ' + color + '22' }}><div style={{ fontSize: 9, color: '#64748B' }}>{label}</div><div style={{ fontSize: 22, fontWeight: 900, color }}>{val}</div>{sub && <div style={{ fontSize: 8, color: '#94A3B8' }}>{sub}</div>}</div>); }
function miniCard(label, val, color) { return (<div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 8, textAlign: 'center' }}><div style={{ fontSize: 15, fontWeight: 900, color }}>{val}</div><div style={{ fontSize: 8, color: '#94A3B8' }}>{label}</div></div>); }
function Section({ title, children }) { return (<div style={{ marginBottom: 12 }}><div style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0', marginBottom: 6 }}>{title}</div>{children}</div>); }
function row(name, val, color) { return (<div key={name} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}><span style={{ color: '#E2E8F0' }}>{name}</span><span style={{ color, fontWeight: 700 }}>{val}</span></div>); }
function Empty() { return <div style={{ fontSize: 10, color: '#64748B' }}>なし</div>; }
