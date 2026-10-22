import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useDirectory } from '../contexts/DirectoryContext'; // 名簿は配線盤から（Phase 2切替済み）

// この案件は「どんな活動から生まれたか」＝1日の動きを見える化する軸
// ※ 増やしすぎると毎回「その他」を選ばれてデータが使えなくなるので8つに絞っています
const SOURCES = [
  { id: 'call',      label: '📞 アーチ架電' },
  { id: 'call_evt',  label: '📋 イベントアンケート架電' },
  { id: 'revisit',   label: '🔁 店頭提案の戻り' },
  { id: 'family',    label: '👨‍👩 来店客のご家族' },
  { id: 'referral',  label: '🤝 紹介' },
  { id: 'shokuiki',  label: '🏢 職域・法人訪問' },
  { id: 'personal',  label: '👤 自分の知人・家族' },
  { id: 'other',     label: '📝 その他' },
];
const sourceOf = (id) => SOURCES.find(s => s.id === id);
// 名前の表記ゆれ（全角・半角スペース）を吸収して比べる
const norm = (s) => (s || '').replace(/[\s\u3000]+/g, '');

const STAGES = ['見込み', '来店予約', '来店', '成約', '失注'];
const OPEN_STAGES = ['見込み', '来店予約', '来店'];
const LOST_REASONS = [
  { id: 'price',      label: '💰 料金が高い',         suggest: 30,  detail: '次キャンペーン時' },
  { id: 'carrier',    label: '📱 他社継続中',         suggest: 180, detail: '解約月接近時' },
  { id: 'wait',       label: '🤔 検討中・即決できない', suggest: 7,   detail: '1週間後' },
  { id: 'family',     label: '👨‍👩 家族と相談',         suggest: 7,   detail: '1週間後' },
  { id: 'timing',     label: '⏰ タイミング合わない',  suggest: 30,  detail: '1ヶ月後' },
  { id: 'device',     label: '📱 端末持込・端末不要',  suggest: 180, detail: '割賦終了' },
  { id: 'absent',     label: '🚫 不在・連絡取れない',  suggest: 3,   detail: '別時間帯で' },
  { id: 'competitor', label: '🏪 競合店で契約',       suggest: 365, detail: '1年後で乗換' },
  { id: 'docs',       label: '🆔 書類不備',           suggest: 7,   detail: '書類準備後' },
  { id: 'other',      label: '📝 その他',             suggest: 30,  detail: '' },
];

const ENTRY_POINTS = [
  { id: 'family',  label: '👨‍👩 家族が他社利用',     suggest: 'MNP・家族まとめ' },
  { id: 'wifi',    label: '📶 自宅Wi-Fi・ネット',    suggest: 'auひかり・BIGLOBE光' },
  { id: 'payment', label: '💳 支払い方法',           suggest: 'au PAYゴールド・じぶん銀行' },
  { id: 'trouble', label: '🤔 料金・使い方の困りごと', suggest: '付加価値・プラン見直し' },
  { id: 'support', label: '🛟 操作・設定の不安',      suggest: '店頭設定サポート定額' },
  { id: 'device',  label: '📱 古い端末',             suggest: '機種変更・買い替え' },
];
const entryOf = (id) => ENTRY_POINTS.find(e => e.id === id);

const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return ymd(d); };
const daysBetween = (dateStr) => { if (!dateStr) return null; const d = new Date(dateStr); d.setHours(0, 0, 0, 0); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d - t) / 86400000); };
const reasonOf = (id) => LOST_REASONS.find(r => r.id === id);

const C = { gold: '#FBBF24', green: '#34D399', purple: '#A78BFA', red: '#F87171', blue: '#38BDF8', orange: '#FB923C', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const sc = (s) => s === '成約' ? C.green : s === '失注' ? C.mut2 : (s === '来店' || s === '来店予約') ? C.gold : C.blue;
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };
const inp = { width: '100%', padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const lbl = { fontSize: 11, color: '#94A3B8', marginBottom: 5, display: 'block' };

export default function Pipeline() {
  const { user, profile } = useAuth();
  const { staffNames, mainStores, storeNameOf } = useDirectory();
  const me = profile?.name || '';
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState('todo');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ customer: '', storeId: profile?.storeId || (mainStores[0]?.id || ''), owner: profile?.name || '', nextDate: '', stage: '見込み', note: '', entry: '', source: '' });
  // 失注モーダル
  const [lostModalFor, setLostModalFor] = useState(null);
  const [lostReason, setLostReason] = useState('');
  const [reapproachDate, setReapproachDate] = useState('');
  const [lostNote, setLostNote] = useState('');
  // 再アプローチビューの絞り込み
  const [reasonFilter, setReasonFilter] = useState('');
  const today = ymd(new Date());

  useEffect(() => {
    if (!user) return;
    const u1 = onSnapshot(query(collection(db, 'pipeline')), s => setItems(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(query(collection(db, 'events')), s => setEvents(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); };
  }, [user]);

  const eventName = (id) => events.find(e => e.id === id)?.name;
  const isOpen = (p) => OPEN_STAGES.includes(p.stage);
  const isTodo = (p) => isOpen(p) && p.nextDate && p.nextDate <= today;
  const isReapproachDue = (p) => p.stage === '失注' && p.reapproachDate && p.reapproachDate <= today;

  const counts = useMemo(() => {
    const c = { todo: 0, reapproach: 0, reapproachDue: 0 }; STAGES.forEach(s => c[s] = 0);
    items.forEach(p => {
      c[p.stage] = (c[p.stage] || 0) + 1;
      if (isTodo(p)) c.todo++;
      if (p.stage === '失注' && p.reapproachDate) c.reapproach++;
      if (isReapproachDue(p)) c.reapproachDue++;
    });
    return c;
  }, [items, today]);

  // きっかけ別の成約率（どの活動が実っているかを見る）
  const bySource = useMemo(() => {
    const m = {};
    SOURCES.forEach(sv => { m[sv.id] = { id: sv.id, label: sv.label, all: 0, won: 0, lost: 0, open: 0 }; });
    m['_none'] = { id: '_none', label: '（未設定）', all: 0, won: 0, lost: 0, open: 0 };
    items.forEach(p => {
      const k = m[p.source] ? p.source : '_none';
      m[k].all++;
      if (p.stage === '成約') m[k].won++;
      else if (p.stage === '失注') m[k].lost++;
      else m[k].open++;
    });
    return Object.values(m).filter(x => x.all > 0)
      .map(x => ({ ...x, rate: x.won + x.lost > 0 ? x.won / (x.won + x.lost) * 100 : null }))
      .sort((a, b) => b.all - a.all);
  }, [items]);
  const eventWon = useMemo(() => items.filter(p => p.fromEventId && p.stage === '成約').length, [items]);

  const list = useMemo(() => {
    let arr = items.slice();
    if (filter === 'todo') arr = arr.filter(isTodo);
    else if (filter === 'reapproach') arr = arr.filter(p => p.stage === '失注' && p.reapproachDate);
    else if (filter !== 'all') arr = arr.filter(p => p.stage === filter);
    if (filter === 'reapproach' && reasonFilter) arr = arr.filter(p => p.lostReason === reasonFilter);
    return arr.sort((a, b) => {
      if (filter === 'reapproach') {
        const ad = a.reapproachDate || '9999', bd = b.reapproachDate || '9999';
        return ad.localeCompare(bd);
      }
      const ao = isOpen(a) ? 0 : 1, bo = isOpen(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const ad = a.nextDate || '9999', bd = b.nextDate || '9999';
      return ad.localeCompare(bd);
    });
  }, [items, filter, today, reasonFilter]);

  // 失注理由ランキング（再アプローチビューで表示）
  const lostReasonRanking = useMemo(() => {
    const r = {};
    items.filter(p => p.stage === '失注' && p.lostReason).forEach(p => { r[p.lostReason] = (r[p.lostReason] || 0) + 1; });
    return Object.entries(r).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const openLostModal = (id) => {
    const p = items.find(x => x.id === id);
    setLostReason(p?.lostReason || '');
    setReapproachDate(p?.reapproachDate || '');
    setLostNote(p?.lostNote || '');
    setLostModalFor(id);
  };
  const closeLostModal = () => { setLostModalFor(null); setLostReason(''); setReapproachDate(''); setLostNote(''); };
  const confirmLost = async () => {
    if (!lostReason) { alert('失注理由を選んでください'); return; }
    await setDoc(doc(db, 'pipeline', lostModalFor), {
      stage: '失注', status: 'closed',
      lostReason, reapproachDate, lostNote,
      lostDate: today,
    }, { merge: true });
    closeLostModal();
  };

  const setStage = async (id, stage) => {
    if (stage === '失注') { openLostModal(id); return; }
    if (stage === '成約') {
      const p = items.find(x => x.id === id);
      if (!window.confirm('この案件を成約にします。\nこのあと実績の報告画面に進みます。よろしいですか？')) return;
      await setDoc(doc(db, 'pipeline', id), { stage, status: 'closed', wonDate: today }, { merge: true });
      // 二度手間を防ぐため、そのまま報告画面へ（店舗と案件情報を引き継ぐ）
      nav('/report', { state: { fromPipeline: { id, storeId: p?.storeId || '', source: p?.source || '', customer: p?.customer || '' } } });
      return;
    }
    await setDoc(doc(db, 'pipeline', id), { stage, status: 'open' }, { merge: true });
  };
  const setNext = async (id, nextDate) => { await setDoc(doc(db, 'pipeline', id), { nextDate }, { merge: true }); };
  const setReap = async (id, reapproachDate) => { await setDoc(doc(db, 'pipeline', id), { reapproachDate }, { merge: true }); };
  const del = async (id) => { if (confirm('この案件を削除しますか？')) await deleteDoc(doc(db, 'pipeline', id)); };
  const add = async () => {
    if (!form.customer.trim()) { alert('顧客メモを入れてください'); return; }
    await addDoc(collection(db, 'pipeline'), { ...form, fromEventId: null, status: 'open', createdAt: serverTimestamp() });
    setForm({ customer: '', storeId: profile?.storeId || (mainStores[0]?.id || ''), owner: profile?.name || '', nextDate: '', stage: '見込み', note: '', entry: '', source: '' });
    setShowAdd(false);
  };

  const chips = [
    ['todo', '要フォロー', counts.todo, C.red],
    ['reapproach', '🔄 再アプローチ' + (counts.reapproachDue ? ' (' + counts.reapproachDue + '件期限来)' : ''), counts.reapproach, C.purple],
    ['all', '全件', items.length, C.w2],
    ...STAGES.map(s => [s, s, counts[s], sc(s)])
  ];

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>📞 パイプライン（商談）</h1>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 10 }}>見込みのお客様を成約まで追う。失注した方も後で再アプローチできます。</div>
      {eventWon > 0 && <div style={{ fontSize: 10, color: C.green, marginBottom: 6 }}>🏁 イベント発の後日成約: <b>{eventWon}件</b></div>}

      {/* きっかけ別の成約率＝どの活動が実っているか */}
      {bySource.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 11, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.blue, marginBottom: 7 }}>📊 きっかけ別の成約率</div>
          {bySource.map(x => (
            <div key={x.id} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: C.w2, marginBottom: 2 }}>
                <span>{x.label}</span>
                <span style={{ color: C.mut }}>
                  {x.all}件{x.won > 0 && <b style={{ color: C.green }}> → 成約{x.won}</b>}
                  {x.rate != null && <b style={{ color: x.rate >= 50 ? C.green : x.rate >= 25 ? C.gold : C.mut2 }}>（{x.rate.toFixed(0)}%）</b>}
                </span>
              </div>
              <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: (x.won / x.all * 100) + '%', background: C.green }} />
                <div style={{ width: (x.open / x.all * 100) + '%', background: C.blue }} />
                <div style={{ width: (x.lost / x.all * 100) + '%', background: 'rgba(248,113,113,0.5)' }} />
              </div>
            </div>
          ))}
          <div style={{ fontSize: 9, color: C.mut2, marginTop: 5, lineHeight: 1.6 }}>
            <span style={{ color: C.green }}>■</span>成約　<span style={{ color: C.blue }}>■</span>進行中　<span style={{ color: 'rgba(248,113,113,0.7)' }}>■</span>失注　
            ／ 率は「成約 ÷（成約＋失注）」。進行中は含みません。
          </div>
        </div>
      )}

      {/* フィルタチップ */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, overflowX: 'auto', paddingBottom: 4 }}>
        {chips.map(([id, label, n, col]) => (
          <button key={id} onClick={() => { setFilter(id); if (id !== 'reapproach') setReasonFilter(''); }} style={{ flex: '0 0 auto', padding: '6px 10px', borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', background: filter === id ? col + '26' : 'rgba(255,255,255,0.02)', color: filter === id ? col : C.mut2, border: filter === id ? '1px solid ' + col + '66' : '1px solid rgba(255,255,255,0.05)' }}>{label} {n > 0 ? '(' + n + ')' : ''}</button>
        ))}
      </div>

      {/* 再アプローチビュー：理由別フィルタ + ランキング */}
      {filter === 'reapproach' && (
        <div style={{ ...card, padding: 10, marginBottom: 10, background: 'rgba(167,139,250,0.04)', borderColor: 'rgba(167,139,250,0.2)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, marginBottom: 8 }}>🔄 失注からの再アプローチ管理</div>
          {lostReasonRanking.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: C.mut, marginBottom: 5 }}>📊 失注理由ランキング（クリックで絞り込み）</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                <button onClick={() => setReasonFilter('')} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer', background: reasonFilter === '' ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.04)', color: reasonFilter === '' ? C.purple : C.mut, border: 'none', fontWeight: 700 }}>全て</button>
                {lostReasonRanking.map(([rid, n]) => (
                  <button key={rid} onClick={() => setReasonFilter(rid)} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer', background: reasonFilter === rid ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.04)', color: reasonFilter === rid ? C.purple : C.mut, border: 'none', fontWeight: 600 }}>{reasonOf(rid)?.label || rid} {n}</button>
                ))}
              </div>
            </>
          )}
          <div style={{ fontSize: 9, color: C.mut2 }}>※ 予定日タップで日付変更／段階タップで再オープン</div>
        </div>
      )}

      {/* 新規追加 */}
      <button onClick={() => setShowAdd(v => !v)} style={{ width: '100%', padding: 11, borderRadius: 12, marginBottom: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: showAdd ? 'rgba(248,113,113,0.06)' : 'transparent', color: showAdd ? C.red : C.gold, border: '1px dashed ' + (showAdd ? 'rgba(248,113,113,0.4)' : 'rgba(251,191,36,0.4)') }}>{showAdd ? '× 閉じる' : '＋ 案件を追加'}</button>
      {showAdd && (
        <div style={card}>
          <label style={lbl}>① この案件は、どんな活動から生まれましたか？</label>
          <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} style={{ ...inp, marginBottom: 10 }}>
            <option value="">— 選んでください —</option>
            {SOURCES.map(sv => <option key={sv.id} value={sv.id}>{sv.label}</option>)}
          </select>
          <label style={lbl}>② 見つけた入口（タップ・任意）</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 4, marginBottom: form.entry ? 6 : 10 }}>
            {ENTRY_POINTS.map(ep => (
              <button key={ep.id} onClick={() => setForm({ ...form, entry: form.entry === ep.id ? '' : ep.id })} style={{ padding: 8, borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', textAlign: 'left', background: form.entry === ep.id ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.03)', color: form.entry === ep.id ? C.green : C.w2, border: form.entry === ep.id ? '1px solid rgba(52,211,153,0.5)' : '1px solid rgba(255,255,255,0.08)' }}>{ep.label}</button>
            ))}
          </div>
          {form.entry && <div style={{ marginBottom: 10, padding: 8, borderRadius: 6, background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', fontSize: 11, color: C.blue }}>→ つなげる提案: <b>{entryOf(form.entry)?.suggest}</b></div>}
          <label style={lbl}>③ 顧客メモ（他のスタッフには表示されません）</label><input value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })} placeholder="例: 30代男性、奥様が他社利用、次回家族で来店" style={inp} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}><label style={lbl}>店舗</label><select value={form.storeId} onChange={e => setForm({ ...form, storeId: e.target.value })} style={inp}>{mainStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div style={{ flex: 1 }}><label style={lbl}>担当</label><select value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} style={inp}><option value="">—</option>{staffNames.map(n => <option key={n} value={n}>{n}</option>)}</select></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}><label style={lbl}>次回</label><input type="date" value={form.nextDate} onChange={e => setForm({ ...form, nextDate: e.target.value })} style={inp} /></div>
            <div style={{ flex: 1 }}><label style={lbl}>段階</label><select value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })} style={inp}>{STAGES.filter(s => s !== '失注').map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          <button onClick={add} style={{ width: '100%', padding: 11, marginTop: 10, borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', background: C.gold, color: '#000', border: 'none' }}>追加する</button>
        </div>
      )}

      {list.length === 0 && <div style={{ textAlign: 'center', color: C.mut2, fontSize: 12, padding: 20 }}>{filter === 'todo' ? '今フォローが必要な案件はありません' : filter === 'reapproach' ? '再アプローチ予定の案件はありません' : '案件がありません'}</div>}
      {list.map(p => {
        const todo = isTodo(p); const ev = eventName(p.fromEventId);
        const isLost = p.stage === '失注';
        const reapDays = isLost ? daysBetween(p.reapproachDate) : null;
        const reapUrgent = reapDays !== null && reapDays <= 0;
        const reapSoon = reapDays !== null && reapDays > 0 && reapDays <= 7;
        const lostElapsed = isLost && p.lostDate ? Math.abs(daysBetween(p.lostDate)) : null;
        const borderColor = todo ? 'rgba(248,113,113,0.4)' : reapUrgent ? 'rgba(167,139,250,0.5)' : reapSoon ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.06)';
        // 自分の案件だけ、顧客メモと削除ボタンを出す（他の人には動きだけ見える）
        const isMine = !!p.owner && !!me && norm(p.owner) === norm(me);
        return (
          <div key={p.id} style={{ ...card, padding: 10, borderColor }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{ fontSize: 13, color: isMine ? C.w2 : C.mut2, fontWeight: 600, flex: 1 }}>
                {isMine ? p.customer : (sourceOf(p.source)?.label || '案件') + '　' + (p.owner || '') + ' さんの案件'}
              </span>
              {isMine && <span onClick={() => del(p.id)} style={{ fontSize: 12, color: C.red, cursor: 'pointer', marginLeft: 8 }}>🗑</span>}
            </div>
            <div style={{ fontSize: 10, color: C.mut, margin: '4px 0' }}>
              {storeNameOf(p.storeId)}{p.owner ? '｜担当: ' + p.owner : ''}{ev ? '｜🏁 ' + ev : '｜直接'}
            </div>
            {p.source && sourceOf(p.source) && (
              <div style={{ fontSize: 10, color: C.blue, marginBottom: 4 }}>{sourceOf(p.source).label}</div>
            )}
            {isMine && p.entry && entryOf(p.entry) && (
              <div style={{ fontSize: 10, color: C.green, marginBottom: 4 }}>{entryOf(p.entry).label} → {entryOf(p.entry).suggest}</div>
            )}
            {/* 失注情報 */}
            {isLost && (
              <div style={{ marginBottom: 6, padding: 7, borderRadius: 6, background: reapUrgent ? 'rgba(167,139,250,0.1)' : 'rgba(248,113,113,0.05)', border: '1px solid ' + (reapUrgent ? 'rgba(167,139,250,0.3)' : 'rgba(248,113,113,0.15)'), fontSize: 10 }}>
                <div style={{ color: C.red, fontWeight: 600 }}>❌ 失注: {reasonOf(p.lostReason)?.label || '理由未登録'}{lostElapsed !== null && <span style={{ color: C.mut2, fontWeight: 400 }}> （{lostElapsed}日前）</span>}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{ color: C.mut, flexShrink: 0 }}>🔄 再アプローチ:</span>
                  <input type="date" value={p.reapproachDate || ''} onChange={e => setReap(p.id, e.target.value)} style={{ ...inp, width: 'auto', padding: 4, fontSize: 10, color: reapUrgent ? C.purple : reapSoon ? C.gold : '#fff' }} />
                  {reapDays !== null && <b style={{ color: reapUrgent ? C.purple : reapSoon ? C.gold : C.mut, fontSize: 10 }}>{reapDays < 0 ? (-reapDays) + '日過ぎ' : reapDays === 0 ? '今日!' : 'あと' + reapDays + '日'}</b>}
                </div>
                {p.lostNote && <div style={{ color: C.mut, marginTop: 4, padding: 4, background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>📝 {p.lostNote}</div>}
                <button onClick={() => openLostModal(p.id)} style={{ marginTop: 5, padding: '3px 8px', borderRadius: 5, fontSize: 9, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: C.mut, border: 'none' }}>✏️ 失注情報を編集</button>
              </div>
            )}
            {/* 次回（オープン案件のみ） */}
            {!isLost && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: todo ? C.red : C.mut }}>次回:</span>
                <input type="date" value={p.nextDate || ''} onChange={e => setNext(p.id, e.target.value)} style={{ ...inp, width: 'auto', padding: 6, fontSize: 11, color: todo ? C.red : '#fff' }} />
                {todo && <span style={{ fontSize: 9, color: C.red, fontWeight: 700 }}>要フォロー</span>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {STAGES.map(s => <button key={s} onClick={() => setStage(p.id, s)} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer', background: p.stage === s ? sc(s) + '26' : 'rgba(255,255,255,0.03)', color: p.stage === s ? sc(s) : C.mut2, border: p.stage === s ? '1px solid ' + sc(s) + '66' : '1px solid rgba(255,255,255,0.06)' }}>{s}</button>)}
            </div>
          </div>
        );
      })}

      {/* 失注モーダル */}
      {lostModalFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 12 }} onClick={closeLostModal}>
          <div style={{ background: '#1a1625', borderRadius: 16, padding: 16, maxWidth: 460, width: '100%', maxHeight: '92vh', overflowY: 'auto', border: '1px solid rgba(248,113,113,0.3)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.red, marginBottom: 4 }}>❌ 失注の登録</div>
            <div style={{ fontSize: 10, color: C.mut, marginBottom: 12 }}>後で再アプローチに使うため、理由とタイミングを記録します。</div>
            <label style={lbl}>失注理由 <span style={{ color: C.red }}>*</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 4, marginBottom: 12 }}>
              {LOST_REASONS.map(r => (
                <button key={r.id} onClick={() => { setLostReason(r.id); setReapproachDate(addDays(r.suggest)); }} style={{ padding: 8, borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', textAlign: 'left', background: lostReason === r.id ? 'rgba(248,113,113,0.15)' : 'rgba(255,255,255,0.03)', color: lostReason === r.id ? C.red : C.w2, border: lostReason === r.id ? '1px solid rgba(248,113,113,0.5)' : '1px solid rgba(255,255,255,0.08)' }}>{r.label}<div style={{ fontSize: 8, color: C.mut2, marginTop: 2, fontWeight: 400 }}>→ {r.suggest}日後 ({r.detail})</div></button>
              ))}
            </div>
            <label style={lbl}>再アプローチ予定日 {lostReason && <span style={{ color: C.mut2, fontSize: 9 }}>(推奨: {reasonOf(lostReason)?.suggest}日後)</span>}</label>
            <input type="date" value={reapproachDate} onChange={e => setReapproachDate(e.target.value)} style={{ ...inp, marginBottom: 12 }} />
            <label style={lbl}>メモ（任意）</label>
            <textarea value={lostNote} onChange={e => setLostNote(e.target.value)} placeholder="例: 妻と相談、来月引っ越し予定、ポイント貯まったらまた来店" style={{ ...inp, minHeight: 60, resize: 'vertical', marginBottom: 14, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={closeLostModal} style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: C.mut, border: 'none' }}>キャンセル</button>
              <button onClick={confirmLost} disabled={!lostReason} style={{ flex: 2, padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: lostReason ? 'pointer' : 'not-allowed', background: lostReason ? C.red : 'rgba(255,255,255,0.08)', color: lostReason ? '#fff' : C.mut, border: 'none' }}>✓ 失注で確定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
