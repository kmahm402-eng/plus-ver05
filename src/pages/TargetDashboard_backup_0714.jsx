import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, onSnapshot, doc } from 'firebase/firestore';
import { MAIN_STORES } from '../data/masters';
import { TARGET_GROUPS, CATEGORIES, aggregate, rate, remaining } from '../lib/aggregate';

const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const C = { gold: '#FBBF24', green: '#34D399', blue: '#38BDF8', purple: '#A78BFA', red: '#F87171', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };
const barColor = (p) => p == null ? C.mut2 : p >= 100 ? C.green : p >= 80 ? C.gold : C.red;

export default function TargetDashboard() {
  const { user, profile } = useAuth();
  const [storeId, setStoreId] = useState('');
  const [month, setMonth] = useState(() => ym(new Date()));
  const [reports, setReports] = useState([]);
  const [targets, setTargets] = useState({});
  const [open, setOpen] = useState({ 'モバイル': true });

  useEffect(() => { if (profile?.storeId) setStoreId(profile.storeId); }, [profile]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, 'reports')), (snap) => {
      setReports(snap.docs.map(d => {
        const r = { id: d.id, ...d.data() };
        const cd = r.createdAt?.toDate?.();
        if (cd) r._month = ym(cd);
        return r;
      }));
    });
  }, [user]);

  useEffect(() => {
    if (!storeId || !month) { setTargets({}); return; }
    return onSnapshot(doc(db, 'storeTargets', storeId + '_' + month), (s) => setTargets(s.exists() ? (s.data().groupTargets || {}) : {}));
  }, [storeId, month]);

  // 達成率は店舗実績なので外注も含める（onlyCounted: false）
  const agg = useMemo(() => aggregate(reports, { storeId: storeId || null, month, onlyCounted: false }), [reports, storeId, month]);
  const groupsByCat = useMemo(() => { const m = {}; for (const c of CATEGORIES) m[c] = TARGET_GROUPS.filter(g => g.cat === c); return m; }, []);
  const hasTargets = Object.values(targets).some(v => Number(v) > 0);

  const Bar = ({ p }) => (
    <div style={{ height: 7, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
      <div style={{ height: '100%', borderRadius: 4, width: (p == null ? 0 : Math.min(100, p)) + '%', background: barColor(p) }} />
    </div>
  );

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 12 }}>🎯 目標管理（店舗の達成率）</h1>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {MAIN_STORES.map(s => (
          <button key={s.id} onClick={() => setStoreId(s.id)} style={{ padding: '5px 9px', borderRadius: 7, fontSize: 9, cursor: 'pointer', background: storeId === s.id ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.02)', color: storeId === s.id ? C.gold : C.mut, border: storeId === s.id ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>{s.name}</button>
        ))}
      </div>
      <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, marginBottom: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />

      {!hasTargets && (
        <div style={{ ...card, borderColor: 'rgba(251,191,36,0.25)', background: 'rgba(251,191,36,0.06)', fontSize: 11, color: C.gold }}>
          この店舗・月の目標がまだ設定されていません。「目標設定」から入力すると達成率が表示されます。（実績は下に表示されています）
        </div>
      )}

      {CATEGORIES.map(cat => {
        const groups = groupsByCat[cat];
        const isMoney = cat === '物販(+1C)';
        const catActual = isMoney ? agg.plus1cTotal : agg.byCategory[cat];
        const catTarget = groups.filter(g => !g.internal).reduce((s, g) => s + Number(targets[g.id] || 0), 0);
        const catRate = rate(catActual, catTarget);
        const catRem = remaining(catActual, catTarget);
        const o = open[cat];
        return (
          <div key={cat} style={card}>
            <div onClick={() => setOpen(p => ({ ...p, [cat]: !p[cat] }))} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{o ? '▼' : '▶'} {cat}</span>
                <span>
                  <span style={{ fontSize: 11, color: C.mut }}>{isMoney ? '¥' + catActual.toLocaleString() : catActual}{!isMoney && catTarget > 0 ? ' / ' + catTarget : isMoney && catTarget > 0 ? ' / ¥' + catTarget.toLocaleString() : ''}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, marginLeft: 6, color: barColor(catRate) }}>{catRate == null ? '—' : catRate + '%'}</span>
                </span>
              </div>
              <Bar p={catRate} />
              {catRem != null && catRem > 0 && <div style={{ fontSize: 9, color: C.gold, marginTop: 3 }}>あと {catRem}{isMoney ? '円' : '件'}</div>}
              {isMoney && <div style={{ fontSize: 9, color: C.mut2, marginTop: 3 }}>金額ベース・算定外</div>}
            </div>
            {o && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                {groups.map(g => {
                  const act = agg.byGroup[g.id] || 0;
                  const tgt = Number(targets[g.id] || 0);
                  const gr = rate(act, tgt), grem = remaining(act, tgt);
                  const lt = g.lineType === 'au' ? { bg: 'rgba(56,189,248,0.15)', c: C.blue, t: 'au' } : g.lineType === 'uq' ? { bg: 'rgba(167,139,250,0.15)', c: C.purple, t: 'UQ' } : null;
                  return (
                    <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 11, opacity: g.internal ? 0.7 : 1 }}>
                      <span style={{ color: C.w2 }}>{lt && <span style={{ fontSize: 8, fontWeight: 700, borderRadius: 4, padding: '1px 5px', marginRight: 5, background: lt.bg, color: lt.c }}>{lt.t}</span>}{g.label}{g.internal ? '（内数）' : ''}</span>
                      <span style={{ color: C.mut }}><b style={{ color: '#fff' }}>{act}</b>{tgt > 0 ? ' / ' + tgt : ''}{gr != null && <span style={{ marginLeft: 6, color: barColor(gr) }}>{gr}%</span>}{grem != null && grem > 0 && <span style={{ marginLeft: 6, color: C.gold }}>あと{grem}</span>}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ fontSize: 9, color: C.mut2, textAlign: 'center', marginTop: 4 }}>合計（内数除く）{agg.grandTotal}件 ／ PAYゴールド内数 {agg.goldInternal}件</div>
    </div>
  );
}
