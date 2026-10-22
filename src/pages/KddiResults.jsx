import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { storeName } from '../data/masters';

const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const C = { gold: '#FBBF24', green: '#34D399', purple: '#A78BFA', red: '#F87171', orange: '#FB923C', darkred: '#EF4444', blue: '#38BDF8', w: '#fff', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };

// KDDI結果指標の項目（4カテゴリ・36項目）
const KDDI_ITEMS = [
  { cat: '📱 モバイル', items: [
    { id: 'm01', label: '新規(MNP+U18+O60) au' },
    { id: 'm02', label: '新規(MNP+U18+O60) UQ' },
    { id: 'm03', label: '他網MNP au' },
    { id: 'm04', label: '他網MNP UQ' },
    { id: 'm05', label: '機変 au' },
    { id: 'm06', label: '機変 UQ' },
    { id: 'm07', label: 'UQ→au' },
    { id: 'm08', label: 'au→UQ' },
    { id: 'm09', label: '総販(MNP+U18+O60) au' },
    { id: 'm10', label: '総販(MNP+U18+O60) UQ' },
    { id: 'm11', label: '端末販売(シングル除く) au' },
    { id: 'm12', label: '端末販売(シングル除く) UQ' },
  ]},
  { cat: '💎 LD・サポート系', items: [
    { id: 'l01', label: 'auでんき達成率' },
    { id: 'l02', label: 'au PAYカード達成率' },
    { id: 'l03', label: 'au PAYゴールドカード達成率' },
    { id: 'l04', label: 'auじぶん銀行達成率' },
    { id: 'l05', label: 'Pontaパス達成率' },
    { id: 'l06', label: 'au自転車サポート達成率' },
    { id: 'l07', label: 'ガスforau達成率' },
    { id: 'l08', label: 'au PAY利用可能率' },
    { id: 'l09', label: 'Ponta連携セット率' },
    { id: 'l10', label: '放サポセット率' },
    { id: 'l11', label: '持ち込み故障サポート加入率' },
    { id: 'l12', label: '店サポ総販同時付帯率' },
    { id: 'l13', label: '使いサポート加入率' },
    { id: 'l14', label: 'au+1総販単価' },
    { id: 'l15', label: 'au+1総販付帯率' },
    { id: 'l16', label: 'OTTアラカルト加入率' },
  ]},
  { cat: '🏠 BBC/ブランド', items: [
    { id: 'b01', label: 'auひかり+BL光達成率' },
    { id: 'b02', label: 'auひかり達成率' },
    { id: 'b03', label: 'BIGLOBE光達成率' },
    { id: 'b04', label: '固定動態達成率' },
    { id: 'b05', label: 'WiMAX達成率' },
  ]},
  { cat: '💰 ARPU', items: [
    { id: 'a01', label: 'auひかりN+1回線見込み進捗率' },
    { id: 'a02', label: 'auMAX総販内VL加入率' },
    { id: 'a03', label: 'auMAX総販内マネ活加入率' },
  ]},
];

const MARK_OPTS = [
  { v: 'circle',   l: '○', c: C.green,   weight: 1 },
  { v: 'triangle', l: '△', c: C.gold,    weight: 0.5 },
  { v: 'cross',    l: '✗', c: C.red,     weight: 0 },
  { v: '',         l: '-', c: C.mut2,    weight: null }, // 未入力
];

// 係数計算ロジック（旧と同一仕様）
function getCoeff(marks) {
  const allIds = KDDI_ITEMS.flatMap(c => c.items.map(i => i.id));
  const total = allIds.length;
  const achieved = allIds.filter(id => marks[id] === 'circle').length;
  const anyInput = Object.values(marks).some(v => v);
  if (total === 0 || !anyInput) return { rate: 1.0, pct: null, label: '未入力', color: C.mut2, achieved: 0, total };
  const pct = Math.round(achieved / total * 100);
  if (pct >= 60) return { rate: 1.05, pct, label: '優秀',       color: C.green,   achieved, total };
  if (pct >= 50) return { rate: 1.00, pct, label: '標準',       color: C.gold,    achieved, total };
  if (pct >= 40) return { rate: 0.95, pct, label: '要改善',     color: C.orange,  achieved, total };
  if (pct >= 30) return { rate: 0.90, pct, label: '警告',       color: C.red,     achieved, total };
  return                  { rate: 0.85, pct, label: '厳重警告', color: C.darkred, achieved, total };
}

// 対象店舗（KDDI指標対象の5店舗、トライアルは除く）
const KDDI_STORES = ['STORE_001', 'STORE_002', 'STORE_003', 'STORE_004'];

export default function KddiResults() {
  const { user, profile } = useAuth();
  const [storeId, setStoreId] = useState('STORE_001');
  const [month, setMonth] = useState(() => ym(new Date()));
  const [marksByStore, setMarksByStore] = useState({}); // storeId -> { itemId: 'circle'|'triangle'|'cross'|'' }
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const isAdmin = profile?.role === 'admin' || profile?.role === 'manager';

  // 全店分を1回のリスナーで読込
  useEffect(() => {
    if (!user) return;
    const unsubs = KDDI_STORES.map(sid => onSnapshot(doc(db, 'kddiResults', sid + '_' + month), s => {
      setMarksByStore(prev => ({ ...prev, [sid]: s.exists() ? (s.data().marks || {}) : {} }));
    }));
    return () => unsubs.forEach(u => u());
  }, [user, month]);

  const marks = marksByStore[storeId] || {};
  const coeff = useMemo(() => getCoeff(marks), [marks]);

  const setMark = (itemId, val) => {
    setMarksByStore(prev => ({ ...prev, [storeId]: { ...(prev[storeId] || {}), [itemId]: val } }));
  };

  const save = async () => {
    if (!isAdmin) { alert('管理者のみ保存可能です'); return; }
    setSaving(true); setMsg('');
    try {
      await setDoc(doc(db, 'kddiResults', storeId + '_' + month), {
        marks: marksByStore[storeId] || {},
        updatedAt: new Date(),
        updatedBy: profile?.name || '',
      }, { merge: false });
      setMsg('✅ ' + storeName(storeId) + ' を保存しました');
      setTimeout(() => setMsg(''), 2500);
    } catch (e) { setMsg('❌ ' + e.message); }
    setSaving(false);
  };

  const reset = () => {
    if (!confirm(storeName(storeId) + ' の入力値を全てクリアします。よろしいですか？\n（保存ボタンを押すまでは確定されません）')) return;
    setMarksByStore(prev => ({ ...prev, [storeId]: {} }));
  };

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: C.w, marginBottom: 4 }}>🎯 KDDI結果指標</h1>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 10, lineHeight: 1.5 }}>KDDIの結果指標画面を見ながら各項目に ○ △ ✗ を入力。○の数で店舗の係数が決まります。</div>

      {/* 月切替 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: C.mut }}>📅 対象月:</span>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ padding: 6, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: C.w, fontSize: 11, outline: 'none' }} />
      </div>

      {/* 店舗タブ＋各店舗の達成率・係数バッジ */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, overflowX: 'auto', paddingBottom: 4 }}>
        {KDDI_STORES.map(sid => {
          const c = getCoeff(marksByStore[sid] || {});
          const active = storeId === sid;
          return (
            <button key={sid} onClick={() => setStoreId(sid)} style={{ flex: '0 0 auto', padding: '7px 10px', borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', background: active ? c.color + '22' : 'rgba(255,255,255,0.02)', color: active ? c.color : C.mut2, border: active ? '1px solid ' + c.color + '60' : '1px solid rgba(255,255,255,0.05)', lineHeight: 1.4 }}>
              {storeName(sid).replace('auStyle', '').replace('auショップ', '')}
              {c.pct !== null && <><br /><span style={{ fontSize: 9, fontWeight: 800 }}>{c.pct}% ×{c.rate.toFixed(2)}</span></>}
            </button>
          );
        })}
      </div>

      {/* 集計サマリーカード */}
      <div style={{ ...card, background: coeff.color + '0D', borderColor: coeff.color + '40' }}>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: C.mut2 }}>○の数 / 全指標</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: coeff.color }}>{coeff.achieved}<span style={{ fontSize: 12, color: C.mut2 }}> / {coeff.total}</span></div>
          </div>
          <div style={{ flex: 1, textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.06)', paddingLeft: 8 }}>
            <div style={{ fontSize: 9, color: C.mut2 }}>達成率</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: coeff.color }}>{coeff.pct !== null ? coeff.pct + '%' : '--'}</div>
          </div>
          <div style={{ flex: 1, textAlign: 'right', borderLeft: '1px solid rgba(255,255,255,0.06)', paddingLeft: 8 }}>
            <div style={{ fontSize: 9, color: C.mut2 }}>係数</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: coeff.color }}>×{coeff.rate.toFixed(2)}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: coeff.color }}>{coeff.label}</div>
          </div>
        </div>
        {/* 係数ガイド */}
        <div style={{ marginTop: 8, padding: 6, borderRadius: 6, background: 'rgba(0,0,0,0.2)', fontSize: 9, color: C.mut, lineHeight: 1.7 }}>
          係数: <b style={{ color: C.green }}>60%以上→×1.05</b> ／ <b style={{ color: C.gold }}>50%以上→×1.00</b> ／ <b style={{ color: C.orange }}>40%以上→×0.95</b> ／ <b style={{ color: C.red }}>30%以上→×0.90</b> ／ <b style={{ color: C.darkred }}>30%未満→×0.85</b>
        </div>
      </div>

      {/* 入力エリア（カテゴリ別） */}
      {KDDI_ITEMS.map(cat => {
        // カテゴリ内の達成率
        const catIds = cat.items.map(i => i.id);
        const catCircle = catIds.filter(id => marks[id] === 'circle').length;
        const catTriangle = catIds.filter(id => marks[id] === 'triangle').length;
        const catCross = catIds.filter(id => marks[id] === 'cross').length;
        return (
          <div key={cat.cat} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid rgba(167,139,250,0.2)' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.purple }}>{cat.cat}<span style={{ fontSize: 9, color: C.mut2, marginLeft: 6, fontWeight: 500 }}>({cat.items.length}項目)</span></span>
              <div style={{ display: 'flex', gap: 6, fontSize: 9 }}>
                <span style={{ color: C.green }}>○{catCircle}</span>
                <span style={{ color: C.gold }}>△{catTriangle}</span>
                <span style={{ color: C.red }}>✗{catCross}</span>
              </div>
            </div>
            {cat.items.map(item => {
              const val = marks[item.id] || '';
              return (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3, padding: '4px 6px', borderRadius: 6, background: val === 'circle' ? 'rgba(52,211,153,0.04)' : val === 'cross' ? 'rgba(248,113,113,0.03)' : 'transparent' }}>
                  <span style={{ flex: 1, fontSize: 10, color: C.w2 }}>{item.label}</span>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {MARK_OPTS.map(opt => (
                      <button key={opt.v} onClick={() => setMark(item.id, opt.v)} disabled={!isAdmin} style={{ width: 32, height: 24, borderRadius: 5, fontSize: 12, fontWeight: 800, cursor: isAdmin ? 'pointer' : 'not-allowed', background: val === opt.v ? opt.c + '28' : 'rgba(255,255,255,0.02)', color: val === opt.v ? opt.c : C.mut2, border: val === opt.v ? '1px solid ' + opt.c + '60' : '1px solid rgba(255,255,255,0.06)', opacity: isAdmin ? 1 : 0.6 }}>{opt.l}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* 保存・クリアボタン（スティッキー） */}
      {isAdmin && (
        <div style={{ position: 'sticky', bottom: 8, marginTop: 16, background: 'rgba(15,13,26,0.95)', padding: 8, borderRadius: 10, backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={reset} style={{ flex: 1, padding: 10, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(167,139,250,0.08)', color: C.purple, border: '1px solid rgba(167,139,250,0.25)' }}>↻ この店舗をクリア</button>
            <button onClick={save} disabled={saving} style={{ flex: 2, padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: saving ? 'rgba(255,255,255,0.1)' : C.gold, color: saving ? C.mut : '#000', border: 'none' }}>{saving ? '保存中…' : '✓ ' + storeName(storeId).replace('auStyle', '').replace('auショップ', '') + ' を保存'}</button>
          </div>
          {msg && <div style={{ textAlign: 'center', fontSize: 11, marginTop: 6, color: msg.startsWith('✅') ? C.green : C.red, fontWeight: 700 }}>{msg}</div>}
          <div style={{ fontSize: 9, color: C.mut2, textAlign: 'center', marginTop: 4 }}>※ 店舗ごとに個別保存されます（タブ切替時は未保存に注意）</div>
        </div>
      )}
      {!isAdmin && (
        <div style={{ ...card, background: 'rgba(248,113,113,0.06)', borderColor: 'rgba(248,113,113,0.3)', textAlign: 'center', fontSize: 11, color: C.red }}>このページの編集は管理者のみ可能です（閲覧のみ）</div>
      )}
    </div>
  );
}
