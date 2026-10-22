import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { MAIN_STORES, storeName } from '../data/masters';
import { TARGET_GROUPS, CATEGORIES } from '../lib/aggregate';

const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const C = { gold: '#FBBF24', blue: '#38BDF8', purple: '#A78BFA', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };

export default function TargetSetting() {
  const { user, profile } = useAuth();
  const [storeId, setStoreId] = useState('');
  const [month, setMonth] = useState(() => ym(new Date()));
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { if (profile?.storeId) setStoreId(profile.storeId); }, [profile]);
  useEffect(() => {
    if (!storeId || !month) return;
    setLoaded(false);
    getDoc(doc(db, 'storeTargets', storeId + '_' + month))
      .then(s => { setValues(s.exists() ? (s.data().groupTargets || {}) : {}); setLoaded(true); })
      .catch(() => { setValues({}); setLoaded(true); });
  }, [storeId, month]);

  const setVal = (gid, v) => setValues(p => ({ ...p, [gid]: v === '' ? '' : Number(v) }));

  const save = async () => {
    if (!storeId) { alert('店舗を選んでください'); return; }
    setSaving(true);
    try {
      const groupTargets = {};
      for (const g of TARGET_GROUPS) { const n = Number(values[g.id] || 0); if (n > 0) groupTargets[g.id] = n; }
      await setDoc(doc(db, 'storeTargets', storeId + '_' + month),
        { storeId, month, groupTargets, updatedAt: serverTimestamp(), updatedBy: profile?.name || user?.email || '' }, { merge: true });
      alert('保存しました（' + storeName(storeId) + '・' + month + '）');
    } catch (e) { alert('保存エラー: ' + e.message); }
    setSaving(false);
  };

  const badge = (g) => g.lineType === 'au'
    ? <span style={{ fontSize: 8, fontWeight: 700, borderRadius: 4, padding: '1px 5px', marginRight: 5, background: 'rgba(56,189,248,0.15)', color: C.blue }}>au</span>
    : g.lineType === 'uq'
      ? <span style={{ fontSize: 8, fontWeight: 700, borderRadius: 4, padding: '1px 5px', marginRight: 5, background: 'rgba(167,139,250,0.15)', color: C.purple }}>UQ</span>
      : null;

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 12 }}>🎯 目標設定</h1>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {MAIN_STORES.map(s => (
          <button key={s.id} onClick={() => setStoreId(s.id)} style={{ padding: '5px 9px', borderRadius: 7, fontSize: 9, cursor: 'pointer', background: storeId === s.id ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.02)', color: storeId === s.id ? C.gold : C.mut, border: storeId === s.id ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>{s.name}</button>
        ))}
      </div>
      <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, marginBottom: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />

      {!storeId ? <div style={{ ...card, fontSize: 11, color: C.mut }}>店舗を選んでください。</div>
        : !loaded ? <div style={{ ...card, fontSize: 11, color: C.mut }}>読み込み中…</div>
          : (<>
            {CATEGORIES.map(cat => (
              <div key={cat} style={card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 8 }}>{cat}{cat === '物販(+1C)' ? '（円・金額）' : ''}</div>
                {TARGET_GROUPS.filter(g => g.cat === cat).map(g => (
                  <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', gap: 8 }}>
                    <span style={{ fontSize: 11, color: C.w2, flex: 1 }}>{badge(g)}{g.label}{g.internal ? '（内数）' : ''}</span>
                    <input type="number" inputMode="numeric" value={values[g.id] ?? ''} onChange={e => setVal(g.id, e.target.value)} placeholder="0" style={{ width: 88, padding: 6, borderRadius: 7, textAlign: 'right', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, outline: 'none' }} />
                  </div>
                ))}
              </div>
            ))}
            <button onClick={save} disabled={saving} style={{ width: '100%', padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: saving ? 'rgba(255,255,255,0.1)' : C.gold, color: saving ? C.mut : '#000', marginBottom: 8 }}>{saving ? '保存中…' : '💾 この月の目標を保存'}</button>
            <div style={{ fontSize: 9, color: C.mut2, textAlign: 'center' }}>内数（PAYゴールド）は合計に足されません。0のままなら達成率では「対象外」表示になります。</div>
          </>)}
    </div>
  );
}
