import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { MAIN_STORES, storeName } from '../data/masters';

// 前月のYYYY-MM（翌月10日までに前月分をチェックする運用）
export const lastMonthYM = (base = new Date()) => {
  const d = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};
export const CHECK_ITEMS = [
  { id: 'pay_settle', label: 'PAYカード決済率' },
  { id: 'jibun_furikae', label: 'じぶん銀行 振替率' },
  { id: 'ponta_renkei', label: 'Ponta連携率' },
  { id: 'myau_login', label: 'My au ログイン率' },
  { id: 'myuq_login', label: 'My UQ ログイン率' },
  { id: 'gas', label: '都市ガス成約数' },
];
const C = { gold: '#FBBF24', green: '#34D399', red: '#F87171', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };

export default function StoreMonthlyCheck() {
  const { user, profile } = useAuth();
  const [storeId, setStoreId] = useState('');
  const [month, setMonth] = useState(() => lastMonthYM());
  const [checks, setChecks] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (profile?.storeId) setStoreId(profile.storeId); }, [profile]);
  useEffect(() => {
    if (!storeId || !month) return;
    getDoc(doc(db, 'storeMonthlyCheck', storeId + '_' + month))
      .then(s => { const d = s.exists() ? s.data() : {}; setChecks(d.checks || {}); setSubmitted(!!d.submitted); })
      .catch(() => { setChecks({}); setSubmitted(false); });
  }, [storeId, month]);

  const toggle = (id) => setChecks(p => ({ ...p, [id]: !p[id] }));
  const save = async () => {
    if (!storeId) { alert('店舗を選んでください'); return; }
    setSaving(true);
    try {
      await setDoc(doc(db, 'storeMonthlyCheck', storeId + '_' + month),
        { storeId, month, checks, submitted: true, submittedAt: serverTimestamp(), submittedBy: profile?.name || user?.email || '' }, { merge: true });
      setSubmitted(true);
      alert('提出しました（' + storeName(storeId) + '・' + month + '）');
    } catch (e) { alert('保存エラー: ' + e.message); }
    setSaving(false);
  };

  const deadline = (() => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m, 10); return (d.getMonth() + 1) + '月10日'; })();
  const doneCount = CHECK_ITEMS.filter(i => checks[i.id]).length;

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>✅ 店舗 月次達成チェック</h1>
      <div style={{ fontSize: 11, color: C.mut, marginBottom: 12 }}>{month} 分 ／ 提出期限：{deadline}まで</div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {MAIN_STORES.map(s => (
          <button key={s.id} onClick={() => setStoreId(s.id)} style={{ padding: '5px 9px', borderRadius: 7, fontSize: 9, cursor: 'pointer', background: storeId === s.id ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.02)', color: storeId === s.id ? C.gold : C.mut, border: storeId === s.id ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>{s.name}</button>
        ))}
      </div>
      <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, marginBottom: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>達成できた項目をオンに</span>
          <span style={{ fontSize: 11, color: submitted ? C.green : C.gold }}>{submitted ? '提出済み' : '未提出'} ｜ {doneCount}/{CHECK_ITEMS.length}</span>
        </div>
        {CHECK_ITEMS.map(it => (
          <div key={it.id} onClick={() => toggle(it.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
            <span style={{ fontSize: 12, color: C.w2 }}>{it.label}</span>
            <span style={{ width: 46, height: 24, borderRadius: 12, background: checks[it.id] ? C.green : 'rgba(255,255,255,0.1)', position: 'relative', transition: 'background .15s' }}>
              <span style={{ position: 'absolute', top: 2, left: checks[it.id] ? 24 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
            </span>
          </div>
        ))}
      </div>
      <button onClick={save} disabled={saving} style={{ width: '100%', padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: saving ? 'rgba(255,255,255,0.1)' : C.gold, color: saving ? C.mut : '#000' }}>{saving ? '保存中…' : submitted ? '✅ 更新して再提出' : '提出する'}</button>
      <div style={{ fontSize: 9, color: C.mut2, textAlign: 'center', marginTop: 8 }}>達成していればオンにしてください。提出するまでホームで催促が表示されます。</div>
    </div>
  );
}
