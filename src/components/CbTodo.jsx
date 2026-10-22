import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

/* ホームに出す「CBシステム 未登録」の一覧
   ・CBありで報告した自分の報告のうち、「CBシステムに登録した」を押していないもの
   ・押すと cbRegistered=true が付いて消える（CBチャージ管理システム本体には触れない） */

const C = { gold: '#FBBF24', red: '#F87171', w: '#fff', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
export const CB_SYSTEM_URL = 'https://cb-charge-manager.web.app';
const yen = (n) => '¥' + Math.round(n || 0).toLocaleString();
const md = (d) => d ? `${d.getMonth() + 1}/${d.getDate()}` : '';

const normCode = (v) => (v || '').replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/[\s\u3000]+/g, '').toUpperCase();
const CODE_OK = /^[A-Z0-9-]{3,32}$/;
const laterOf = (r) => (r.lines || []).map((l, i) => ({ l, i })).filter(({ l }) => l.zoChoice === 'later' || l.swChoice === 'later');
const laterKeys = (r) => laterOf(r).flatMap(({ l, i }) => ['zo', 'sw'].filter(k => (k === 'zo' ? l.zoChoice : l.swChoice) === 'later').map(k => ({ l, i, k })));

/* ホームに出す「🔑 コード未入力」：増量・セット割のコードを「後日予定」にした報告。コードを入れると消える */
export function CodeTodo() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!user) return;
    // コード「後日予定」が残っている自分の報告（3か月前の1日以降）。uid＋日付の組み合わせ検索は索引が要るので、日付だけで読んで手元で絞る（ホームの月間集計と同じ読み方）
    const from = new Date(); from.setDate(1); from.setHours(0, 0, 0, 0); from.setMonth(from.getMonth() - 3);   // 3か月前の1日から
    const q = query(collection(db, 'reports'), where('createdAt', '>=', from));
    return onSnapshot(q, s => {
      const arr = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.uid === user.uid && laterOf(r).length > 0);
      arr.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
      setItems(arr);
    }, () => setItems([]));
  }, [user]);
  const save = async (r, i, kind, l, d) => {
    const key = r.id + ':' + i + ':' + kind; const code = normCode(vals[key]);
    if (!code) { alert('コードを入力してください。'); return; }
    if (!CODE_OK.test(code)) { alert('コードは英数字で、1回線分だけ入れてください（「/」や「,」で複数は入れない）。'); return; }
    const label = md(d) + ' ' + (i + 1) + '台目 ' + (l.midCatName || '') + (l.appNo ? ' ' + l.appNo : '');
    if (!confirm(label + ' の' + (kind === 'zo' ? '増量オプション' : '自宅セット割') + 'のコードを「' + code + '」で登録します。よろしいですか？')) return;
    setBusy(key);
    try {
      // 最新の内容を読み直してから該当行だけ書き換える（他の端末の更新を消さない）
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'reports', r.id); const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('報告が見つかりません');
        const lines = (snap.data().lines || []).map((x, j) => j !== i ? x : (kind === 'zo' ? { ...x, zoChoice: 'yes', zoCode: code } : { ...x, swChoice: 'yes', swCode: code }));
        tx.update(ref, { lines });
      });
    } catch (e) { alert('記録できませんでした：' + e.message); }
    setBusy('');
  };
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 12, padding: 12, borderRadius: 12, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.4)' }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: C.gold }}>🔑 コード未入力 {items.reduce((a, r) => a + laterKeys(r).length, 0)}件</div>
      <div style={{ fontSize: 10, color: C.mut, marginTop: 2, lineHeight: 1.5 }}>「後日予定」にした増量オプション・自宅セット割のコードです。コードが出たら入れてください（3か月間残ります）。</div>
      {items.map(r => laterKeys(r).map(({ l, i, k }) => {
        const key = r.id + ':' + i + ':' + k; const d = r.createdAt?.toDate?.();
        return (
          <div key={key} style={{ marginTop: 8, padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.03)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.w }}>{md(d)}　{i + 1}台目 {l.midCatName || ''}{l.model ? ' ' + (l.model === '__custom__' ? l.customModel : l.model) : ''}{l.appNo ? ' ' + l.appNo : ''}　<span style={{ color: C.gold }}>{k === 'zo' ? '増量オプション' : '自宅セット割'}のコード</span></div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input value={vals[key] || ''} onChange={e => setVals(v => ({ ...v, [key]: e.target.value }))} placeholder="コードを入力" maxLength={32} style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 8, fontSize: 12, background: 'rgba(255,255,255,0.05)', color: C.w, border: '1px solid rgba(255,255,255,0.12)' }} />
              <button onClick={() => save(r, i, k, l, d)} disabled={!!busy} style={{ flexShrink: 0, padding: '8px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(251,191,36,0.15)', color: C.gold, border: '1px solid rgba(251,191,36,0.4)' }}>{busy === key ? '…' : '登録'}</button>
            </div>
          </div>
        );
      }))}
    </div>
  );
}

export function cbLinesOf(r) {
  return (r.lines || []).filter(l => l.cbChoice === 'yes' || (l.cbChoice !== 'no' && Number(l.cashback || 0) > 0));
}

export default function CbTodo() {
  const { user, profile } = useAuth();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!user) return;
    // 自分が入力した報告で、CBあり かつ 未登録 のもの（等しい条件だけなので複合インデックス不要）
    const q = query(collection(db, 'reports'), where('uid', '==', user.uid), where('cbNeed', '==', true), where('cbRegistered', '==', false));
    return onSnapshot(q, s => {
      const arr = s.docs.map(d => ({ id: d.id, ...d.data() }));
      arr.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
      setItems(arr);
    }, () => setItems([]));
  }, [user]);

  const mark = async (r) => {
    const total = cbLinesOf(r).reduce((a, l) => a + Number(l.cashback || 0), 0);
    if (!confirm('CBチャージ管理システムに ' + yen(total) + ' を登録しましたか？\n\n登録した → OK\nまだ → キャンセル')) return;
    setBusy(r.id);
    try {
      await updateDoc(doc(db, 'reports', r.id), { cbRegistered: true, cbRegisteredAt: serverTimestamp(), cbRegisteredBy: profile?.name || user?.email || '' });
    } catch (e) { alert('記録できませんでした：' + e.message); }
    setBusy('');
  };

  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 12, padding: 12, borderRadius: 12, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.45)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: C.red }}>💴 CBシステム 未登録 {items.length}件</div>
        <a href={CB_SYSTEM_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: C.gold, textDecoration: 'none' }}>CBシステムを開く ↗</a>
      </div>
      <div style={{ fontSize: 10, color: C.mut, marginTop: 2, lineHeight: 1.5 }}>CBありで報告した分です。CBチャージ管理システムに登録したら「登録した」を押してください。</div>
      {items.map(r => {
        const ls = cbLinesOf(r); const total = ls.reduce((a, l) => a + Number(l.cashback || 0), 0);
        const d = r.createdAt?.toDate?.(); const days = d ? Math.floor((Date.now() - d.getTime()) / 86400000) : 0;
        return (
          <div key={r.id} style={{ marginTop: 8, padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.w }}>{md(d)}　{yen(total)}<span style={{ fontSize: 10, color: C.mut }}>（{ls.length}台分）</span>{days >= 2 && <span style={{ marginLeft: 6, fontSize: 10, color: C.red }}>{days}日経過</span>}</div>
              <div style={{ fontSize: 10, color: C.mut2, whiteSpace: 'normal', lineHeight: 1.4 }}>{ls.map(l => (l.midCatName || '') + (l.appNo ? ' ' + l.appNo : '') + ' ' + yen(l.cashback) + (l.cbFamily ? ' 👨‍👩‍👧' + (l.cbFamilyRep || '') : '')).join('／')}{r.proxyStaff ? `　獲得：${r.proxyStaff}` : ''}</div>
            </div>
            <button onClick={() => mark(r)} disabled={busy === r.id} style={{ flexShrink: 0, padding: '8px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(52,211,153,0.15)', color: '#34D399', border: '1px solid rgba(52,211,153,0.4)' }}>{busy === r.id ? '…' : '✓ 登録した'}</button>
          </div>
        );
      })}
    </div>
  );
}
