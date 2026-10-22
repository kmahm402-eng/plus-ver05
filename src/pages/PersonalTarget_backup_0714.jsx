import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, onSnapshot, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { aggregate, rate, remaining } from '../lib/aggregate';

const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const C = { gold: '#FBBF24', green: '#34D399', red: '#F87171', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };
const CATS = [{ cat: 'モバイル', unit: '件' }, { cat: '固定商材', unit: '件' }, { cat: 'LTV商材', unit: '件' }, { cat: '物販(+1C)', unit: '円' }];
const barColor = (p) => p == null ? C.mut2 : p >= 100 ? C.green : p >= 80 ? C.gold : C.red;

export default function PersonalTarget() {
  const { user, profile } = useAuth();
  const [month, setMonth] = useState(() => ym(new Date()));
  const [reports, setReports] = useState([]);
  const [targets, setTargets] = useState({});
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState({});
  const me = profile?.name || user?.email || '';

  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, 'reports')), (snap) =>
      setReports(snap.docs.map(d => { const r = { id: d.id, ...d.data() }; const cd = r.createdAt?.toDate?.(); if (cd) r._month = ym(cd); return r; })));
  }, [user]);

  useEffect(() => {
    if (!user || !month) return;
    getDoc(doc(db, 'staffTargets', user.uid + '_' + month))
      .then(s => { const t = s.exists() ? (s.data().catTargets || {}) : {}; setTargets(t); setVals(t); })
      .catch(() => { setTargets({}); setVals({}); });
  }, [user, month]);

  const agg = useMemo(() => aggregate(reports, { staffName: me, month }), [reports, me, month]);

  const save = async () => {
    const catTargets = {};
    for (const { cat } of CATS) { const n = Number(vals[cat] || 0); if (n > 0) catTargets[cat] = n; }
    try {
      await setDoc(doc(db, 'staffTargets', user.uid + '_' + month),
        { uid: user.uid, staffName: me, month, catTargets, updatedAt: serverTimestamp() }, { merge: true });
      setTargets(catTargets); setEditing(false);
    } catch (e) { alert('保存エラー: ' + e.message); }
  };

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>🙋 個人目標・進捗</h1>
      <div style={{ fontSize: 11, color: C.mut, marginBottom: 12 }}>{me}</div>
      <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, marginBottom: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>今月の達成率</span>
          <button onClick={() => editing ? save() : setEditing(true)} style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 7, cursor: 'pointer', background: editing ? C.gold : 'rgba(255,255,255,0.05)', color: editing ? '#000' : C.mut, border: 'none' }}>{editing ? '保存' : '目標を編集'}</button>
        </div>
        {CATS.map(({ cat, unit }) => {
          const actual = cat === '物販(+1C)' ? agg.plus1cTotal : agg.byCategory[cat];
          const tgt = Number(targets[cat] || 0);
          const p = rate(actual, tgt), rem = remaining(actual, tgt);
          return (
            <div key={cat} style={{ marginBottom: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: C.w2, fontWeight: 600 }}>{cat}</span>
                {editing
                  ? <input type="number" value={vals[cat] ?? ''} onChange={e => setVals(p => ({ ...p, [cat]: e.target.value === '' ? '' : Number(e.target.value) }))} placeholder="目標" style={{ width: 80, padding: 4, borderRadius: 6, textAlign: 'right', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 11, outline: 'none' }} />
                  : <span><span style={{ fontSize: 10, color: C.mut }}>{cat === '物販(+1C)' ? '¥' + actual.toLocaleString() : actual}{tgt > 0 ? ' / ' + (cat === '物販(+1C)' ? '¥' + tgt.toLocaleString() : tgt) : ''}</span><span style={{ fontSize: 11, fontWeight: 800, marginLeft: 6, color: barColor(p) }}>{p == null ? '—' : p + '%'}</span></span>}
              </div>
              <div style={{ height: 7, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 4, width: (p == null ? 0 : Math.min(100, p)) + '%', background: barColor(p) }} /></div>
              {!editing && rem != null && rem > 0 && <div style={{ fontSize: 9, color: C.gold, marginTop: 3 }}>あと {cat === '物販(+1C)' ? '¥' + rem.toLocaleString() : rem + '件'}</div>}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 9, color: C.mut2, textAlign: 'center' }}>合計（内数除く）{agg.grandTotal}件 ／ あなたの今月の実績です</div>
    </div>
  );
}
