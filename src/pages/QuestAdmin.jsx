// =====================================================================
// QuestAdmin.jsx ―― 自走版（店長・部長用）2026-10-09 追加
//  全員の「ふりかえり・じぶん診断・答え合わせ・作戦・できた／できなかった」を一覧で見て、
//  ひとことコメントを返す画面。コメントはスタッフのホームに出る。
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { collection, query, where, onSnapshot, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useDirectory } from '../contexts/DirectoryContext';
import { ITEM, CHOICES, norm, ymd, weekStart, addDays } from '../lib/quest';

const C = { gold: '#FBBF24', green: '#34D399', red: '#F87171', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B', q: '#93C5FD' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 12, marginBottom: 10 };
const sel = { padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 };
const DOW = ['月', '火', '水', '木', '金', '土', '日'];

export default function QuestAdmin() {
  const { profile } = useAuth();
  const dir = useDirectory();
  const me = profile?.name || '';
  const myRole = profile?.role === 'admin' ? 'president' : (dir.roleOf(me) === 'director' ? 'director' : 'manager');
  const roleLabel = { manager: '店長', director: '部長', president: '社長' };

  const thisW = weekStart(new Date());
  const [wOffset, setWOffset] = useState(0);
  const wStart = addDays(thisW, -7 * wOffset);
  const wKey = ymd(wStart);
  const [store, setStore] = useState(() => dir.staffStoreOf(me) || 'all');
  const [docs, setDocs] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savedAt, setSavedAt] = useState({});

  useEffect(() => {
    return onSnapshot(query(collection(db, 'weeklyQuests'), where('weekKey', '==', wKey)),
      (s) => setDocs(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setDocs([]));
  }, [wKey]);

  const staff = useMemo(() => dir.staffNames.filter((n) => store === 'all' || dir.staffStoreOf(n) === store), [dir, store]);
  const byName = useMemo(() => { const m = {}; docs.forEach((d) => { m[norm(d.staffName)] = d; }); return m; }, [docs]);
  const doneCount = staff.filter((n) => byName[norm(n)]?.plan).length;

  const saveComment = async (q) => {
    const text = (drafts[q.id] ?? '').trim();
    if (!text) return;
    try {
      await setDoc(doc(db, 'weeklyQuests', q.id), { comments: { [myRole]: { name: me, text, at: serverTimestamp() } } }, { merge: true });
      setSavedAt((p) => ({ ...p, [q.id]: true }));
    } catch (e) { alert('保存できませんでした: ' + e.message); }
  };

  return (
    <div style={{ padding: '8px 16px', maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>🗺️ 今週の作戦（全員の一覧）</h1>
      <div style={{ fontSize: 11, color: C.mut, marginBottom: 10 }}>スタッフが自分で考えた「課題」と「作戦」を見て、ひとことだけ返してください。答えは言わず、背中を押す一言で十分です。あなたは「{roleLabel[myRole]}」としてコメントします。</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <select style={sel} value={wOffset} onChange={(e) => setWOffset(Number(e.target.value))}>
          {[0, 1, 2, 3].map((o) => <option key={o} value={o}>{o === 0 ? '今週' : o === 1 ? '先週' : o + '週前'}（{ymd(addDays(thisW, -7 * o)).slice(5).replace('-', '/')}〜）</option>)}
        </select>
        <select style={sel} value={store} onChange={(e) => setStore(e.target.value)}>
          <option value="all">全店</option>
          {dir.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.w2 }}>
        <span>作戦会議をした人</span><b style={{ color: doneCount === staff.length ? C.green : C.gold }}>{doneCount}／{staff.length}名</b>
      </div>

      {staff.map((name) => {
        const q = byName[norm(name)];
        if (!q || !q.plan) {
          return (
            <div key={name} style={{ ...card, opacity: 0.6, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: C.w2, fontWeight: 700 }}>{name}</span><span style={{ color: C.red }}>まだ作戦会議をしていません</span>
            </div>
          );
        }
        const choice = CHOICES.find((c) => c.id === q.diagnosis?.choice);
        const checks = q.checks || {};
        const comments = q.comments || {};
        return (
          <div key={name} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{name}</span>
              <span style={{ fontSize: 11, color: C.mut }}>{dir.storeNameOf(dir.staffStoreOf(name))}</span>
            </div>
            <Row label="うまくいったこと" v={q.reflection?.good} />
            <Row label="うまくいかなかったこと" v={q.reflection?.bad} />
            <Row label="じぶん診断" v={choice ? choice.label + (q.diagnosis?.reason ? '（' + q.diagnosis.reason + '）' : '') : ''} />
            <Row label="数字が示す課題" v={q.answer ? q.answer.label + (q.answer.matched ? '　🎯 見立てと一致' : '　🔍 見立てとちがう') : ''} color={q.answer?.matched ? C.green : C.gold} />
            <Row label="今週の作戦" v={`${ITEM[q.plan.item]?.label || ''} ${q.plan.target}件　「${q.plan.action}」`} color={C.gold} />
            <div style={{ display: 'flex', gap: 4, margin: '6px 0' }}>
              {DOW.map((d, i) => {
                const k = ymd(addDays(wStart, i)); const v = checks[k];
                return <div key={d} style={{ flex: 1, textAlign: 'center', fontSize: 10, padding: '3px 0', borderRadius: 4, border: '1px solid #333', color: v === true ? C.green : v === false ? C.red : C.mut2 }}>{d}<br />{v === true ? '○' : v === false ? '×' : '−'}</div>;
              })}
            </div>
            {Object.entries(comments).filter(([, c]) => c?.text).map(([k, c]) => (
              <div key={k} style={{ fontSize: 12, color: C.w2, background: '#1E293B', borderLeft: '3px solid ' + C.gold, padding: '5px 8px', borderRadius: 4, marginBottom: 4 }}>
                <span style={{ color: C.q }}>{roleLabel[k] || k} {c.name}：</span>{c.text}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <input value={drafts[q.id] ?? comments[myRole]?.text ?? ''} onChange={(e) => { setDrafts((p) => ({ ...p, [q.id]: e.target.value })); setSavedAt((p) => ({ ...p, [q.id]: false })); }}
                placeholder={roleLabel[myRole] + 'としてひとこと'} style={{ ...sel, flex: 1, fontSize: 12 }} />
              <button onClick={() => saveComment(q)} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: savedAt[q.id] ? C.green : C.gold, color: '#000', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>{savedAt[q.id] ? '送信済' : '送る'}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ label, v, color }) {
  if (!v) return null;
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12, padding: '3px 0', borderBottom: '1px dashed rgba(255,255,255,0.06)' }}>
      <span style={{ width: 110, flexShrink: 0, color: C.mut }}>{label}</span><span style={{ color: color || C.w2 }}>{v}</span>
    </div>
  );
}
