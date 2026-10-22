import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, setDoc, serverTimestamp } from 'firebase/firestore';

// 5棚の定義
const SHELVES = [
  { id: 1, name: '基礎トークブック', desc: '全員の土台。どの顧客の何を解決し、どんな価値を届けるか。', icon: '📘', color: '#34D399' },
  { id: 2, name: '推薦図書',         desc: '視野を広げる本の紹介。',                                 icon: '📚', color: '#38BDF8' },
  { id: 3, name: '経験談',           desc: '価値で売れた瞬間・ニーズの裏に気づいた瞬間のストーリー。', icon: '💬', color: '#FBBF24' },
  { id: 4, name: '本質の読み物',     desc: '価値創造の3軸（顕在/潜在・特徴/利点/価値）。',          icon: '🧭', color: '#A78BFA' },
  { id: 5, name: 'アドバンスト',     desc: '上位向けの深い知見。',                                 icon: '🚀', color: '#FB923C' },
];
const shelfOf = (id) => SHELVES.find(s => s.id === id);

const C = { gold: '#FBBF24', green: '#34D399', purple: '#A78BFA', red: '#F87171', blue: '#38BDF8', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };
const inp = { width: '100%', padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const lbl = { fontSize: 11, color: '#94A3B8', marginBottom: 5, display: 'block' };

export default function Library() {
  const { user, profile, isAdmin } = useAuth();
  const [articles, setArticles] = useState([]);
  const [shelf, setShelf] = useState(1);       // 選んでいる棚
  const [reading, setReading] = useState(null); // 読んでいる記事ID
  const [editing, setEditing] = useState(null); // 編集中の記事ID（管理者）
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ shelf: 1, title: '', body: '' });

  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, 'library')), s => setArticles(s.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [user]);

  const shelfArticles = useMemo(() =>
    articles.filter(a => a.shelf === shelf)
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
  [articles, shelf]);
  const countOf = (sid) => articles.filter(a => a.shelf === sid).length;

  const openAdd = () => { setEditing(null); setForm({ shelf, title: '', body: '' }); setShowAdd(true); };
  const startEdit = (a) => { setEditing(a.id); setForm({ shelf: a.shelf, title: a.title, body: a.body || '' }); setShowAdd(true); setReading(null); };
  const save = async () => {
    if (!form.title.trim()) { alert('タイトルを入れてください'); return; }
    if (editing) {
      await setDoc(doc(db, 'library', editing), { shelf: form.shelf, title: form.title.trim(), body: form.body }, { merge: true });
    } else {
      await addDoc(collection(db, 'library'), { shelf: form.shelf, title: form.title.trim(), body: form.body, createdBy: profile?.name || '', createdAt: serverTimestamp() });
    }
    setShowAdd(false); setEditing(null); setForm({ shelf, title: '', body: '' });
  };
  const del = async (id) => { if (confirm('この記事を削除しますか？')) { await deleteDoc(doc(db, 'library', id)); setReading(null); } };

  // ── 記事を読む画面 ──
  if (reading) {
    const a = articles.find(x => x.id === reading);
    if (!a) { setReading(null); return null; }
    const sh = shelfOf(a.shelf);
    return (
      <div style={{ padding: '8px 16px' }}>
        <button onClick={() => setReading(null)} style={{ background: '#1C1830', border: '1px solid #2A2640', color: C.gold, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '7px 14px', borderRadius: 10, marginBottom: 12 }}>← 棚に戻る</button>
        <div style={{ fontSize: 11, color: sh?.color || C.mut, marginBottom: 4 }}>{sh?.icon} {sh?.name}</div>
        <h1 style={{ fontSize: 18, fontWeight: 900, color: '#fff', marginBottom: 8, lineHeight: 1.4 }}>{a.title}</h1>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, color: C.w2, lineHeight: 1.8 }}>{a.body || '（本文なし）'}</div>
        {a.createdBy && <div style={{ fontSize: 10, color: C.mut2, marginTop: 14 }}>記録: {a.createdBy}</div>}
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={() => startEdit(a)} style={{ flex: 1, padding: 9, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(56,189,248,0.1)', color: C.blue, border: '1px solid rgba(56,189,248,0.3)' }}>✏️ 編集</button>
            <button onClick={() => del(a.id)} style={{ flex: 1, padding: 9, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(248,113,113,0.08)', color: C.red, border: '1px solid rgba(248,113,113,0.25)' }}>🗑 削除</button>
          </div>
        )}
      </div>
    );
  }

  // ── 一覧画面 ──
  const sh = shelfOf(shelf);
  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>📚 コンテンツライブラリ</h1>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 12, lineHeight: 1.5 }}>学びの棚です。棚1は全員の土台、棚2〜5は気になったときに開いてください。</div>

      {/* 棚タブ */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, overflowX: 'auto', paddingBottom: 4 }}>
        {SHELVES.map(s => (
          <button key={s.id} onClick={() => { setShelf(s.id); setShowAdd(false); }} style={{ flex: '0 0 auto', padding: '7px 11px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', background: shelf === s.id ? s.color + '26' : 'rgba(255,255,255,0.02)', color: shelf === s.id ? s.color : C.mut2, border: shelf === s.id ? '1px solid ' + s.color + '66' : '1px solid rgba(255,255,255,0.05)' }}>{s.icon} 棚{s.id} {s.name} {countOf(s.id) > 0 ? '(' + countOf(s.id) + ')' : ''}</button>
        ))}
      </div>

      {/* 選んでいる棚の説明 */}
      <div style={{ ...card, padding: 10, background: (sh?.color || '#fff') + '0d', borderColor: (sh?.color || '#fff') + '33' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: sh?.color }}>{sh?.icon} 棚{sh?.id}　{sh?.name}</div>
        <div style={{ fontSize: 10.5, color: C.mut, marginTop: 3, lineHeight: 1.5 }}>{sh?.desc}</div>
      </div>

      {/* 管理者：記事追加 */}
      {isAdmin && (
        <button onClick={() => (showAdd ? setShowAdd(false) : openAdd())} style={{ width: '100%', padding: 11, borderRadius: 12, marginBottom: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: showAdd ? 'rgba(248,113,113,0.06)' : 'transparent', color: showAdd ? C.red : C.gold, border: '1px dashed ' + (showAdd ? 'rgba(248,113,113,0.4)' : 'rgba(251,191,36,0.4)') }}>{showAdd ? '× 閉じる' : '＋ 記事を追加'}</button>
      )}
      {isAdmin && showAdd && (
        <div style={card}>
          <label style={lbl}>棚</label>
          <select value={form.shelf} onChange={e => setForm({ ...form, shelf: Number(e.target.value) })} style={inp}>
            {SHELVES.map(s => <option key={s.id} value={s.id}>棚{s.id}　{s.name}</option>)}
          </select>
          <label style={{ ...lbl, marginTop: 8 }}>タイトル</label>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="例: au PAYゴールドの価値の伝え方" style={inp} />
          <label style={{ ...lbl, marginTop: 8 }}>本文</label>
          <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="記事の本文。改行はそのまま反映されます。" style={{ ...inp, minHeight: 160, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />
          <button onClick={save} style={{ width: '100%', padding: 11, marginTop: 10, borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', background: C.gold, color: '#000', border: 'none' }}>{editing ? '更新する' : '追加する'}</button>
        </div>
      )}

      {/* 記事リスト */}
      {shelfArticles.length === 0 && <div style={{ textAlign: 'center', color: C.mut2, fontSize: 12, padding: 24 }}>この棚にはまだ記事がありません</div>}
      {shelfArticles.map(a => (
        <button key={a.id} onClick={() => setReading(a.id)} style={{ display: 'block', width: '100%', textAlign: 'left', ...card, padding: 12, cursor: 'pointer' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.w2, marginBottom: 3, lineHeight: 1.4 }}>{a.title}</div>
          {a.body && <div style={{ fontSize: 10.5, color: C.mut, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{a.body}</div>}
          {a.createdBy && <div style={{ fontSize: 9, color: C.mut2, marginTop: 5 }}>記録: {a.createdBy}</div>}
        </button>
      ))}
    </div>
  );
}
