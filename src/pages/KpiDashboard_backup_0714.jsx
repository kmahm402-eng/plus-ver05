import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { MAIN_STORES, storeName } from '../data/masters';

const normName = (n) => { let s = (n || '?').replace(/[\s\u3000]+/g, ''); return s.replace('香央里', '香央理'); };
const SOUHAN_MAIN = ['MAIN_001', 'MAIN_002', 'MAIN_003', 'MAIN_004'];
const TANKA_TARGET = 25000;
// KPI項目（件数）→ 対象MID
const KPI_TRACK = [
  { label: '2BMNP', mids: ['MID_017', 'MID_018'] },
  { label: '2B新規', mids: ['MID_001', 'MID_002', 'MID_003', 'MID_004', 'MID_005', 'MID_006', 'MID_007', 'MID_008', 'MID_009', 'MID_010', 'MID_011', 'MID_012'] },
  { label: 'au機種変更', mids: ['MID_021', 'MID_022'] },
  { label: 'UQ機種変更', mids: ['MID_023', 'MID_024'] },
  { label: 'アップセル', mids: ['MID_025', 'MID_026', 'MID_027', 'MID_057'] },
  { label: 'auでんき', mids: ['MID_045'] },
  { label: 'クレカS', mids: ['MID_043'] },
  { label: 'クレカG', mids: ['MID_041'] },
  { label: 'クレカR', mids: ['MID_042'] },
  { label: 'じぎん', mids: ['MID_044'] },
];
const C = { gold: '#FBBF24', green: '#34D399', purple: '#A78BFA', red: '#F87171', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B', dim: '#475569' };
const ym = (d) => d.getFullYear() + '年' + (d.getMonth() + 1) + '月';

function calcStaff(reps) {
  const items = {}; KPI_TRACK.forEach(it => items[it.label] = 0);
  let plus1c = 0, souhan = 0;
  reps.forEach(r => (r.lines || []).forEach(l => {
    KPI_TRACK.forEach(it => { if (it.mids.includes(l.midCat)) items[it.label]++; });
    if (l.plus1c && Number(l.plus1c) > 0) plus1c += Number(l.plus1c);
    if (SOUHAN_MAIN.includes(l.mainCat)) souhan++;
  }));
  return { items, plus1c, souhan, tanka: souhan > 0 ? Math.round(plus1c / souhan) : 0 };
}

export default function KpiDashboard() {
  const { user, profile } = useAuth();
  const [reports, setReports] = useState([]);
  const [tab, setTab] = useState('personal');
  const [storeFilter, setStoreFilter] = useState(MAIN_STORES[0]?.id || '');
  const myName = normName(profile?.name || '');
  const now = new Date(); const mStart = new Date(now.getFullYear(), now.getMonth(), 1); const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, 'reports'), orderBy('createdAt', 'desc')), snap => setReports(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [user]);

  const mReps = useMemo(() => reports.filter(r => { const d = r.createdAt?.toDate?.(); return d && d >= mStart && d < mEnd && (r.counted !== false); }), [reports]);
  const byStaff = useMemo(() => {
    const map = {}; mReps.forEach(r => { const nm = normName(r.acqType === 'proxy' ? r.proxyStaff : r.staffName); (map[nm] = map[nm] || []).push(r); });
    const out = {}; Object.entries(map).forEach(([nm, reps]) => out[nm] = calcStaff(reps)); return out;
  }, [mReps]);
  const my = byStaff[myName] || calcStaff([]);
  const rankSouhan = useMemo(() => Object.entries(byStaff).map(([nm, d]) => ({ nm, ...d })).filter(s => s.souhan > 0).sort((a, b) => b.souhan - a.souhan), [byStaff]);
  const rankTanka = useMemo(() => rankSouhan.filter(s => s.tanka > 0).slice().sort((a, b) => b.tanka - a.tanka), [rankSouhan]);

  const storeData = useMemo(() => {
    const sReps = mReps.filter(r => r.storeId === storeFilter);
    const map = {};
    sReps.forEach(r => { const nm = normName(r.acqType === 'proxy' ? r.proxyStaff : r.staffName); (map[nm] = map[nm] || []).push(r); });
    return Object.entries(map).map(([nm, reps]) => ({ nm, ...calcStaff(reps), proxy: reps.some(r => r.acqType === 'proxy') })).sort((a, b) => b.souhan - a.souhan);
  }, [mReps, storeFilter]);

  const exportExcel = () => {
    if (storeData.length === 0) return;
    const nums = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮';
    const header = ['項目', ...storeData.map((s, i) => (nums[i] || '') + (s.nm.length > 2 ? s.nm.substring(0, 2) : s.nm)), '合計'];
    const labels = [...KPI_TRACK.map(it => it.label), 'プラワン', '単価'];
    const rows = labels.map(label => {
      const row = [label]; let total = 0;
      storeData.forEach(s => { let v = label === 'プラワン' ? s.plus1c : label === '単価' ? s.tanka : (s.items[label] || 0); row.push(v); total += v; });
      row.push(label === '単価' ? '' : total); return row;
    });
    const ws = XLSX.utils.aoa_to_sheet([[], [], header, ...rows]);
    ws['!cols'] = [{ wch: 12 }, ...storeData.map(() => ({ wch: 8 })), { wch: 10 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'KPI');
    XLSX.writeFile(wb, storeName(storeFilter) + '_KPI_' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + '.xlsx');
  };

  const tabBtn = (id, label, col) => (
    <button onClick={() => setTab(id)} style={{ flex: 1, padding: '6px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: tab === id ? col + '26' : 'rgba(255,255,255,0.03)', color: tab === id ? col : C.mut2, border: tab === id ? '1px solid ' + col + '4d' : '1px solid rgba(255,255,255,0.05)' }}>{label}</button>
  );

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 2 }}>📈 KPI指標</h1>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 10 }}>{ym(now)}</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>{tabBtn('personal', '🙋 個人', C.gold)}{tabBtn('ranking', '🏆 ランキング', C.green)}{tabBtn('store', '🏪 店舗別', C.purple)}</div>

      {tab === 'personal' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div style={{ background: '#1a1625', borderRadius: 12, padding: 12, border: '1px solid rgba(52,211,153,0.12)' }}><div style={{ fontSize: 9, color: C.mut2 }}>総販台数</div><div style={{ fontSize: 24, fontWeight: 900, color: C.green }}>{my.souhan}<span style={{ fontSize: 11 }}>台</span></div></div>
            <div style={{ background: '#1a1625', borderRadius: 12, padding: 12, border: '1px solid ' + (my.tanka >= TANKA_TARGET ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)') }}><div style={{ fontSize: 9, color: C.mut2 }}>+1C単価</div><div style={{ fontSize: 22, fontWeight: 900, color: my.tanka >= TANKA_TARGET ? C.green : C.red }}>¥{my.tanka.toLocaleString()}</div><div style={{ fontSize: 8, color: C.mut }}>目標 ¥{TANKA_TARGET.toLocaleString()}</div></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4 }}>
            {KPI_TRACK.map(it => { const v = my.items[it.label] || 0; return (
              <div key={it.label} style={{ padding: '6px 4px', borderRadius: 8, background: v > 0 ? C.purple + '12' : 'rgba(255,255,255,0.02)', textAlign: 'center', border: '1px solid ' + (v > 0 ? C.purple + '30' : 'rgba(255,255,255,0.04)') }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: v > 0 ? C.purple : C.dim }}>{v}</div>
                <div style={{ fontSize: 8, color: v > 0 ? C.purple : C.mut2, fontWeight: 600 }}>{it.label}</div>
              </div>); })}
          </div>
        </div>
      )}

      {tab === 'ranking' && (
        <div>
          {[{ title: '総販台数', arr: rankSouhan, key: 'souhan', unit: '台' }, { title: '+1C単価', arr: rankTanka, key: 'tanka', unit: '', yen: true }].map(block => {
            const max = block.arr[0]?.[block.key] || 1; const medals = ['🥇', '🥈', '🥉'];
            return (
              <div key={block.title} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 6 }}>{block.title}</div>
                {block.arr.slice(0, 10).map((r, i) => { const isMe = r.nm === myName; const v = r[block.key];
                  return (
                    <div key={r.nm} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <div style={{ width: 20, fontSize: 11, textAlign: 'center' }}>{medals[i] || (i + 1)}</div>
                      <div style={{ width: 70, fontSize: 10, color: isMe ? C.gold : C.w2, fontWeight: isMe ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nm}{isMe ? '★' : ''}</div>
                      <div style={{ flex: 1, height: 10, borderRadius: 4, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 4, width: (v / max * 100) + '%', background: C.green }} /></div>
                      <div style={{ width: 56, fontSize: 9, fontWeight: 700, color: isMe ? C.gold : C.mut, textAlign: 'right' }}>{block.yen ? '¥' + v.toLocaleString() : v + block.unit}</div>
                    </div>); })}
                {block.arr.length === 0 && <div style={{ fontSize: 10, color: C.mut2 }}>データなし</div>}
              </div>); })}
        </div>
      )}

      {tab === 'store' && (
        <div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
            {MAIN_STORES.map(st => (
              <button key={st.id} onClick={() => setStoreFilter(st.id)} style={{ padding: '6px 9px', borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: storeFilter === st.id ? C.purple + '26' : 'rgba(255,255,255,0.02)', color: storeFilter === st.id ? C.purple : C.mut2, border: storeFilter === st.id ? '1px solid ' + C.purple + '4d' : '1px solid rgba(255,255,255,0.05)' }}>{st.name}</button>
            ))}
          </div>
          <button onClick={exportExcel} style={{ width: '100%', padding: 8, borderRadius: 8, marginBottom: 10, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(52,211,153,0.08)', color: C.green, border: '1px solid rgba(52,211,153,0.2)' }}>📥 KPI Excel出力（{storeName(storeFilter)}）</button>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, marginBottom: 10 }}>
            {KPI_TRACK.map(it => { const total = storeData.reduce((s, st) => s + (st.items[it.label] || 0), 0); return (
              <div key={it.label} style={{ padding: '6px 4px', borderRadius: 8, background: total > 0 ? C.purple + '12' : 'rgba(255,255,255,0.02)', textAlign: 'center', border: '1px solid ' + (total > 0 ? C.purple + '30' : 'rgba(255,255,255,0.04)') }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: total > 0 ? C.purple : C.dim }}>{total}</div>
                <div style={{ fontSize: 8, color: total > 0 ? C.purple : C.mut2, fontWeight: 600 }}>{it.label}</div>
              </div>); })}
          </div>
          {storeData.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
                <thead><tr>
                  <th style={{ textAlign: 'left', padding: '4px 6px', color: C.mut2, borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', left: 0, background: '#0F0D1A', minWidth: 50 }}>名前</th>
                  {KPI_TRACK.map(it => <th key={it.label} style={{ textAlign: 'center', padding: '4px 2px', color: C.purple, borderBottom: '1px solid rgba(255,255,255,0.06)', minWidth: 24, whiteSpace: 'nowrap' }}>{it.label.length > 3 ? it.label.substring(0, 3) : it.label}</th>)}
                  <th style={{ textAlign: 'center', padding: '4px 4px', color: C.gold, borderBottom: '1px solid rgba(255,255,255,0.06)', minWidth: 48 }}>+1C</th>
                  <th style={{ textAlign: 'center', padding: '4px 4px', color: C.gold, borderBottom: '1px solid rgba(255,255,255,0.06)', minWidth: 40 }}>単価</th>
                </tr></thead>
                <tbody>{storeData.map(st => (
                  <tr key={st.nm}>
                    <td style={{ padding: '4px 6px', color: C.w2, fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.03)', position: 'sticky', left: 0, background: '#0F0D1A', whiteSpace: 'nowrap' }}>{st.nm.length > 3 ? st.nm.substring(0, 3) : st.nm}{st.proxy ? ' 📋' : ''}</td>
                    {KPI_TRACK.map(it => { const v = st.items[it.label] || 0; return <td key={it.label} style={{ textAlign: 'center', padding: '4px 2px', color: v > 0 ? C.w2 : '#334155', fontWeight: v > 0 ? 700 : 400, borderBottom: '1px solid rgba(255,255,255,0.03)' }}>{v || '-'}</td>; })}
                    <td style={{ textAlign: 'center', padding: '4px 4px', color: st.plus1c > 0 ? C.gold : '#334155', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 8 }}>{st.plus1c > 0 ? '¥' + st.plus1c.toLocaleString() : '-'}</td>
                    <td style={{ textAlign: 'center', padding: '4px 4px', color: st.tanka >= TANKA_TARGET ? C.green : st.tanka > 0 ? C.red : '#334155', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 8 }}>{st.tanka > 0 ? '¥' + st.tanka.toLocaleString() : '-'}</td>
                  </tr>))}</tbody>
                <tfoot><tr>
                  <td style={{ padding: '4px 6px', color: C.gold, fontWeight: 800, borderTop: '1px solid rgba(251,191,36,0.2)', position: 'sticky', left: 0, background: '#0F0D1A' }}>合計</td>
                  {KPI_TRACK.map(it => { const t = storeData.reduce((s, st) => s + (st.items[it.label] || 0), 0); return <td key={it.label} style={{ textAlign: 'center', padding: '4px 2px', color: C.gold, fontWeight: 800, borderTop: '1px solid rgba(251,191,36,0.2)' }}>{t}</td>; })}
                  <td style={{ textAlign: 'center', padding: '4px 4px', color: C.gold, fontWeight: 800, borderTop: '1px solid rgba(251,191,36,0.2)', fontSize: 8 }}>¥{storeData.reduce((s, st) => s + st.plus1c, 0).toLocaleString()}</td>
                  <td style={{ borderTop: '1px solid rgba(251,191,36,0.2)' }}></td>
                </tr></tfoot>
              </table>
            </div>
          ) : <div style={{ textAlign: 'center', padding: 20, color: C.dim, fontSize: 11 }}>データなし</div>}
        </div>
      )}
    </div>
  );
}
