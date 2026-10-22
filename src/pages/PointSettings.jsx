import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { POINT_ITEMS } from '../lib/points';
import { MAIN_CAT, MID_CAT } from '../data/masters';

const C = { gold: '#FBBF24', green: '#34D399', purple: '#A78BFA', red: '#F87171', blue: '#38BDF8', w: '#fff', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };
const inp = { width: 70, padding: '4px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: C.gold, fontSize: 11, outline: 'none', textAlign: 'center' };

const GROUPS = ['新規ID', 'LTV'];

export default function PointSettings() {
  const { user, profile } = useAuth();
  const [tab, setTab] = useState('items'); // 'items' or 'exclude'
  const [draft, setDraft] = useState(null);
  const [excludedMids, setExcludedMids] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [mainFilter, setMainFilter] = useState('all');
  const isAdmin = profile?.role === 'admin' || profile?.role === 'manager';

  // 初期化（デフォルト + Firestore保存値マージ）
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'pointConfig', 'main'), s => {
      const saved = s.exists() ? s.data() : {};
      // POINT_ITEMSをベースに保存値で上書き（enabled, pt, cap）
      const merged = {};
      Object.keys(POINT_ITEMS).forEach(k => {
        const def = POINT_ITEMS[k];
        const sv = saved.items?.[k] || {};
        merged[k] = {
          label: def.label,
          grp: def.grp,
          pt: sv.pt !== undefined ? sv.pt : def.pt,
          cap: sv.cap !== undefined ? sv.cap : def.cap,
          enabled: sv.enabled !== false, // デフォルトON
        };
      });
      setDraft(merged);
      setExcludedMids(saved.excludedMids || []);
    });
  }, [user]);

  const update = (k, key, val) => setDraft(d => ({ ...d, [k]: { ...d[k], [key]: val } }));
  const toggleGroupAll = (grp, enabled) => setDraft(d => {
    const next = { ...d };
    Object.keys(next).forEach(k => { if (next[k].grp === grp) next[k] = { ...next[k], enabled }; });
    return next;
  });
  const toggleMid = (mid) => setExcludedMids(prev => prev.includes(mid) ? prev.filter(x => x !== mid) : [...prev, mid]);
  const toggleMainAll = (mainId, exclude) => {
    const mids = MID_CAT.filter(m => m.main === mainId).map(m => m.id);
    setExcludedMids(prev => {
      if (exclude) return [...new Set([...prev, ...mids])];
      return prev.filter(x => !mids.includes(x));
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true); setMsg('');
    try {
      // itemsのみ保存形に整形（labelとgrpはデフォルト由来なので保存不要）
      const items = {};
      Object.keys(draft).forEach(k => {
        items[k] = { pt: Number(draft[k].pt) || 0, cap: draft[k].cap === null || draft[k].cap === '' ? null : Number(draft[k].cap), enabled: draft[k].enabled !== false };
      });
      await setDoc(doc(db, 'pointConfig', 'main'), { items, excludedMids, updatedAt: new Date(), updatedBy: profile?.name || '' }, { merge: false });
      setMsg('✅ 保存しました');
      setTimeout(() => setMsg(''), 2500);
    } catch (e) { setMsg('❌ ' + e.message); }
    setSaving(false);
  };

  const restoreDefaults = () => {
    if (!confirm('全項目を初期値に戻します。よろしいですか？\n（保存ボタンを押すまでは確定されません）')) return;
    const next = {};
    Object.keys(POINT_ITEMS).forEach(k => { next[k] = { ...POINT_ITEMS[k], enabled: true }; });
    setDraft(next);
    setExcludedMids([]);
  };

  if (!draft) return <div style={{ padding: 20, color: C.mut }}>読み込み中...</div>;
  if (!isAdmin) return <div style={{ padding: 20, color: C.red }}>このページは管理者のみ閲覧可能です</div>;

  const itemsByGrp = (g) => Object.entries(draft).filter(([, v]) => v.grp === g);
  const excludedCount = excludedMids.length;
  const disabledItemCount = Object.values(draft).filter(v => v.enabled === false).length;

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: C.w, marginBottom: 4 }}>⚙️ ポイント設定</h1>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 10, lineHeight: 1.5 }}>計算ロジックの本体は「ポイント項目」、特定商材を除外したい時は「MID除外」を使います。</div>

      {/* タブ切替 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        <button onClick={() => setTab('items')} style={{ flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: tab === 'items' ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.02)', color: tab === 'items' ? C.gold : C.mut2, border: tab === 'items' ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)', lineHeight: 1.4 }}>🎯 ポイント項目<br /><b>{disabledItemCount > 0 ? disabledItemCount + '項目OFF' : '全' + Object.keys(draft).length + '項目'}</b></button>
        <button onClick={() => setTab('exclude')} style={{ flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: tab === 'exclude' ? 'rgba(248,113,113,0.15)' : 'rgba(255,255,255,0.02)', color: tab === 'exclude' ? C.red : C.mut2, border: tab === 'exclude' ? '1px solid rgba(248,113,113,0.3)' : '1px solid rgba(255,255,255,0.05)', lineHeight: 1.4 }}>🚫 MID除外<br /><b>{excludedCount > 0 ? excludedCount + '件除外中' : '除外なし'}</b></button>
      </div>

      {/* === タブ1: ポイント項目 === */}
      {tab === 'items' && (
        <>
          <div style={{ fontSize: 10, color: C.mut, marginBottom: 6, lineHeight: 1.5 }}>各項目のON/OFF・pt値・上限(cap)を編集します。capが空欄=上限なし。</div>
          {GROUPS.map(grp => {
            const items = itemsByGrp(grp);
            return (
              <div key={grp} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.w }}>{grp === '新規ID' ? '🆕 新規ID' : '🔁 LTV'}<span style={{ fontSize: 9, color: C.mut2, marginLeft: 6 }}>({items.length}項目)</span></span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => toggleGroupAll(grp, true)} style={{ fontSize: 9, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', background: 'rgba(52,211,153,0.1)', color: C.green, border: '1px solid rgba(52,211,153,0.2)' }}>全ON</button>
                    <button onClick={() => toggleGroupAll(grp, false)} style={{ fontSize: 9, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', background: 'rgba(248,113,113,0.1)', color: C.red, border: '1px solid rgba(248,113,113,0.2)' }}>全OFF</button>
                  </div>
                </div>
                {items.map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 7, marginBottom: 3, borderRadius: 7, background: v.enabled === false ? 'rgba(255,255,255,0.01)' : 'rgba(52,211,153,0.03)' }}>
                    <button onClick={() => update(k, 'enabled', !v.enabled)} style={{ width: 36, height: 20, borderRadius: 10, cursor: 'pointer', background: v.enabled !== false ? C.green : '#475569', border: 'none', position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: v.enabled !== false ? 18 : 2, transition: 'left 0.15s' }} />
                    </button>
                    <div style={{ flex: 1, fontSize: 11, color: v.enabled === false ? C.mut2 : C.w2, fontWeight: 600 }}>{v.label}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <input type="number" step="0.5" value={v.pt} onChange={e => update(k, 'pt', Number(e.target.value) || 0)} style={inp} />
                      <span style={{ fontSize: 9, color: C.mut2 }}>pt</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 9, color: C.mut2 }}>cap</span>
                      <input type="number" value={v.cap === null ? '' : v.cap} placeholder="∞" onChange={e => update(k, 'cap', e.target.value === '' ? null : Number(e.target.value))} style={inp} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </>
      )}

      {/* === タブ2: MID除外 === */}
      {tab === 'exclude' && (
        <>
          <div style={{ fontSize: 10, color: C.mut, marginBottom: 6, lineHeight: 1.5 }}>除外したMIDは集計から完全に除外されます（点数化されない）。特定商材を一時的に対象外にしたい時に使います。</div>
          {/* 大分類フィルタ */}
          <div style={{ display: 'flex', gap: 3, marginBottom: 8, overflowX: 'auto', paddingBottom: 4 }}>
            <button onClick={() => setMainFilter('all')} style={{ flex: '0 0 auto', padding: '5px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', background: mainFilter === 'all' ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.02)', color: mainFilter === 'all' ? C.gold : C.mut2, border: mainFilter === 'all' ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>全て</button>
            {MAIN_CAT.map(mc => (
              <button key={mc.id} onClick={() => setMainFilter(mc.id)} style={{ flex: '0 0 auto', padding: '5px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', background: mainFilter === mc.id ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.02)', color: mainFilter === mc.id ? C.gold : C.mut2, border: mainFilter === mc.id ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>{mc.name}</button>
            ))}
          </div>

          {MAIN_CAT.filter(mc => mainFilter === 'all' || mainFilter === mc.id).map(mc => {
            const mids = MID_CAT.filter(m => m.main === mc.id);
            if (mids.length === 0) return null;
            const allExcluded = mids.every(m => excludedMids.includes(m.id));
            return (
              <div key={mc.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.w }}>{mc.name}<span style={{ fontSize: 9, color: C.mut2, marginLeft: 6 }}>({mids.length}項目)</span></span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => toggleMainAll(mc.id, false)} style={{ fontSize: 9, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', background: 'rgba(52,211,153,0.1)', color: C.green, border: '1px solid rgba(52,211,153,0.2)' }}>全集計</button>
                    <button onClick={() => toggleMainAll(mc.id, true)} style={{ fontSize: 9, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', background: 'rgba(248,113,113,0.1)', color: C.red, border: '1px solid rgba(248,113,113,0.2)' }}>全除外</button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {mids.map(m => {
                    const ex = excludedMids.includes(m.id);
                    return (
                      <button key={m.id} onClick={() => toggleMid(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: 6, borderRadius: 6, cursor: 'pointer', background: ex ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.02)', border: ex ? '1px solid rgba(248,113,113,0.3)' : '1px solid rgba(255,255,255,0.04)', textAlign: 'left' }}>
                        <span style={{ fontSize: 11 }}>{ex ? '🚫' : '✓'}</span>
                        <span style={{ fontSize: 10, color: ex ? C.red : C.w2, flex: 1, textDecoration: ex ? 'line-through' : 'none' }}>{m.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* 保存・初期化ボタン（共通） */}
      <div style={{ position: 'sticky', bottom: 8, marginTop: 16, background: 'rgba(15,13,26,0.95)', padding: 8, borderRadius: 10, backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={restoreDefaults} style={{ flex: 1, padding: 10, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(167,139,250,0.08)', color: C.purple, border: '1px solid rgba(167,139,250,0.25)' }}>↻ 初期値に戻す</button>
          <button onClick={save} disabled={saving} style={{ flex: 2, padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: saving ? 'rgba(255,255,255,0.1)' : C.gold, color: saving ? C.mut : '#000', border: 'none' }}>{saving ? '保存中…' : '✓ 設定を保存'}</button>
        </div>
        {msg && <div style={{ textAlign: 'center', fontSize: 11, marginTop: 6, color: msg.startsWith('✅') ? C.green : C.red, fontWeight: 700 }}>{msg}</div>}
      </div>
    </div>
  );
}
