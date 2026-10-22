import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { storeName } from '../data/masters';

const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDaysYmd = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (dateStr) => { const d = new Date(dateStr); d.setHours(0, 0, 0, 0); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d - t) / 86400000); };

const C = { gold: '#FBBF24', green: '#34D399', purple: '#A78BFA', red: '#F87171', blue: '#38BDF8', orange: '#FB923C', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };
const inp = { width: '100%', padding: 9, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' };

const ENTRY_POINTS = [
  { id: 'family',  label: '👨‍👩 家族が他社利用',     suggest: 'MNP・家族まとめ' },
  { id: 'wifi',    label: '📶 自宅Wi-Fi・ネット',    suggest: 'auひかり・BIGLOBE光' },
  { id: 'payment', label: '💳 支払い方法',           suggest: 'au PAYゴールド・じぶん銀行' },
  { id: 'trouble', label: '🤔 料金・使い方の困りごと', suggest: '付加価値・プラン見直し' },
  { id: 'support', label: '🛟 操作・設定の不安',      suggest: '店頭設定サポート定額' },
  { id: 'device',  label: '📱 古い端末',             suggest: '機種変更・買い替え' },
];
const entryOf = (id) => ENTRY_POINTS.find(e => e.id === id);

const DEFAULT_DAYS = 3; // 販売から何日後にコール推奨

export default function ThankYouCalls() {
  const { user, profile } = useAuth();
  const [reports, setReports] = useState([]);
  const [view, setView] = useState('mine'); // mine=自分のコール / all=みんなの状況
  const [openStaff, setOpenStaff] = useState(null); // みんなの状況で開いている担当者
  const [filter, setFilter] = useState('due');
  const [noteFor, setNoteFor] = useState(null);
  const [tempNote, setTempNote] = useState('');
  const [entryFor, setEntryFor] = useState(null);
  const [entryType, setEntryType] = useState('');
  const [entryMemo, setEntryMemo] = useState('');
  const me = profile?.name || '';
  const today = ymd(new Date());

  useEffect(() => {
    if (!user) return;
    // 直近31日分だけ読み込む（軽量化・recent31Fetch）。この画面は過去30日の販売しか使わない
    const fetchStart = new Date();
    fetchStart.setDate(fetchStart.getDate() - 31);
    fetchStart.setHours(0, 0, 0, 0);
    return onSnapshot(query(collection(db, 'reports'), where('createdAt', '>=', fetchStart)), s => setReports(s.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [user]);

  // 自分の販売（counted=true・過去30日以内）
  const myRecent = useMemo(() => reports.filter(r => {
    if (r.counted === false) return false;
    const acq = r.proxyStaff || r.staffName;
    if (acq !== me) return false;
    const cd = r.createdAt?.toDate?.();
    if (!cd) return false;
    const days = Math.round((Date.now() - cd.getTime()) / 86400000);
    return days >= 0 && days <= 30;
  }), [reports, me]);

  const buckets = useMemo(() => {
    const due = [], snoozed = [], done = [];
    myRecent.forEach(r => {
      if (r.tycStatus === 'done') { done.push(r); return; }
      const cd = r.createdAt.toDate();
      const reportDate = ymd(cd);
      const def = new Date(cd); def.setDate(def.getDate() + DEFAULT_DAYS); const defaultDue = ymd(def);
      const dueDate = r.tycSnoozeTo || defaultDue;
      const rec = { ...r, _dueDate: dueDate, _reportDate: reportDate };
      if (dueDate <= today) due.push(rec); else snoozed.push(rec);
    });
    due.sort((a, b) => a._dueDate.localeCompare(b._dueDate));
    snoozed.sort((a, b) => a._dueDate.localeCompare(b._dueDate));
    done.sort((a, b) => (b.tycDoneAt?.toMillis?.() || 0) - (a.tycDoneAt?.toMillis?.() || 0));
    return { due, snoozed, done };
  }, [myRecent, today]);

  const list = buckets[filter] || [];

  // みんなの状況：過去30日の全スタッフのコール状況（店舗別→担当者別）。閲覧専用
  const teamStats = useMemo(() => {
    const byStore = {};
    reports.forEach(r => {
      if (r.counted === false) return;
      const cd = r.createdAt?.toDate?.(); if (!cd) return;
      const days = Math.round((Date.now() - cd.getTime()) / 86400000);
      if (days < 0 || days > 30) return;
      const staff = r.proxyStaff || r.staffName || '不明';
      const sid = r.storeId || '不明';
      const isDone = r.tycStatus === 'done';
      const def = new Date(cd); def.setDate(def.getDate() + DEFAULT_DAYS);
      const dueDate = r.tycSnoozeTo || ymd(def);
      const overdue = !isDone && dueDate <= today;
      const st = (byStore[sid] = byStore[sid] || {});
      const rec = (st[staff] = st[staff] || { total: 0, done: 0, overdue: 0, items: [] });
      rec.total++; if (isDone) rec.done++; if (overdue) rec.overdue++;
      const archs = (r.lines || []).map(l => l.archNo).filter(Boolean).join('/');
      rec.items.push({ id: r.id, date: ymd(cd), arch: archs, summary: [...new Set((r.lines || []).map(l => l.midCatName).filter(Boolean))].join(' / ') || (r.lineCount + '件'), isDone, overdue });
    });
    return byStore;
  }, [reports, today]);

  const markDone = async (id, note) => {
    await setDoc(doc(db, 'reports', id), { tycStatus: 'done', tycDoneAt: serverTimestamp(), tycNote: note || '' }, { merge: true });
    setNoteFor(null); setTempNote('');
  };
  const snooze = async (id, days) => {
    await setDoc(doc(db, 'reports', id), { tycStatus: 'snoozed', tycSnoozeTo: addDaysYmd(days) }, { merge: true });
  };
  const undoSnooze = async (id) => {
    await setDoc(doc(db, 'reports', id), { tycStatus: 'pending', tycSnoozeTo: null }, { merge: true });
  };
  const reopenDone = async (id) => {
    await setDoc(doc(db, 'reports', id), { tycStatus: 'pending', tycDoneAt: null, tycNote: '' }, { merge: true });
  };
  // コールで見つけた入口をパイプライン（見込み案件）に登録し、このコールを完了にする
  const registerEntry = async (r) => {
    if (!entryType) { alert('入口を選んでください'); return; }
    await addDoc(collection(db, 'pipeline'), {
      customer: (entryMemo || customerSummary(r)).trim(),
      storeId: r.storeId, owner: me, nextDate: '', stage: '見込み', note: '',
      entry: entryType, fromEventId: null, status: 'open', createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'reports', r.id), { tycStatus: 'done', tycDoneAt: serverTimestamp(), tycNote: 'コールで入口発見→パイプライン登録（' + (entryOf(entryType)?.suggest || '') + '）' }, { merge: true });
    setEntryFor(null); setEntryType(''); setEntryMemo('');
  };

  const customerSummary = (r) => {
    const lines = r.lines || [];
    const mids = [...new Set(lines.map(l => l.midCatName).filter(Boolean))].join(' / ');
    return mids || (r.lineCount + '件');
  };

  const chips = [
    { id: 'due', label: '📞 今日のコール', n: buckets.due.length, c: C.red },
    { id: 'snoozed', label: '⏰ スヌーズ中', n: buckets.snoozed.length, c: C.gold },
    { id: 'done', label: '✓ 完了済み', n: buckets.done.length, c: C.green },
  ];

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>📞 サンキューコール</h1>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 10, lineHeight: 1.5 }}>販売したお客様への御礼の電話。販売から{DEFAULT_DAYS}日後を目安に。LTV提案・Pontaパス追加・口コミ依頼のきっかけにも繋がります。報告すると自動でここに載ります（登録作業は不要）。</div>

      {/* 自分のコール／みんなの状況 切替 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {[{ id: 'mine', label: '📞 自分のコール' }, { id: 'all', label: '👀 みんなの状況' }].map(v => (
          <button key={v.id} onClick={() => setView(v.id)} style={{ flex: 1, padding: 8, borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: view === v.id ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.02)', color: view === v.id ? C.gold : C.mut2, border: view === v.id ? '1px solid rgba(251,191,36,0.2)' : '1px solid rgba(255,255,255,0.03)' }}>{v.label}</button>
        ))}
      </div>

      {view === 'mine' && <>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {chips.map(c => (
          <button key={c.id} onClick={() => setFilter(c.id)} style={{ flex: 1, padding: '7px 4px', borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: filter === c.id ? c.c + '26' : 'rgba(255,255,255,0.02)', color: filter === c.id ? c.c : C.mut2, border: filter === c.id ? '1px solid ' + c.c + '66' : '1px solid rgba(255,255,255,0.05)', lineHeight: 1.4 }}>{c.label}<br /><b>{c.n}件</b></button>
        ))}
      </div>

      {list.length === 0 && (
        <div style={{ textAlign: 'center', color: C.mut2, fontSize: 12, padding: 28 }}>
          {filter === 'due' ? '今すぐコールが必要な案件はありません ✓' : filter === 'snoozed' ? 'スヌーズ中の案件はありません' : 'まだ完了済みコールはありません'}
        </div>
      )}

      {list.map(r => {
        const elapsedDays = r._reportDate ? -daysBetween(r._reportDate) : null;
        const dueDays = r._dueDate ? daysBetween(r._dueDate) : null;
        return (
          <div key={r.id} style={{ ...card, borderColor: filter === 'due' ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: C.w2, fontWeight: 700, flex: 1, lineHeight: 1.4 }}>{customerSummary(r)}</span>
              {elapsedDays !== null && <span style={{ fontSize: 9, color: C.mut, flexShrink: 0, marginLeft: 6 }}>{elapsedDays}日前販売</span>}
            </div>
            <div style={{ fontSize: 9, color: C.mut, marginBottom: 6 }}>
              {storeName(r.storeId)}
              {' ／ 報告: ' + (r.createdAt?.toDate?.()?.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) || '')}
              {(() => { const a = (r.lines || []).map(l => l.archNo).filter(Boolean).join('/'); return a ? ' ／ ARCH: ' + a : ''; })()}
              {(r.lines || [])[0]?.appNo ? ' ／ 申込書: ' + (r.lines || [])[0].appNo : ''}
            </div>
            {(r.lines || []).slice(0, 3).map((l, i) => (
              <div key={i} style={{ fontSize: 9, color: C.mut2, marginBottom: 2 }}>
                {i + 1}台目: {l.midCatName}{l.model ? ' ／ ' + l.model : ''}{l.planNames?.[0] ? ' ／ ' + l.planNames[0] : ''}
              </div>
            ))}

            {filter === 'due' && (
              <>
                {dueDays !== null && dueDays < 0 && <div style={{ fontSize: 10, color: C.red, fontWeight: 700, marginTop: 6 }}>⚠️ コール推奨日から{-dueDays}日経過</div>}
                {noteFor === r.id ? (
                  <div style={{ marginTop: 8 }}>
                    <textarea value={tempNote} onChange={e => setTempNote(e.target.value)} placeholder="メモ（任意）: 良い反応／Pontaパス興味あり／4G→5G相談あり／クレーム気味 など" style={{ ...inp, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button onClick={() => { setNoteFor(null); setTempNote(''); }} style={{ flex: 1, padding: 8, borderRadius: 8, fontSize: 11, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: C.mut, border: 'none' }}>キャンセル</button>
                      <button onClick={() => markDone(r.id, tempNote)} style={{ flex: 2, padding: 8, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: C.green, color: '#000', border: 'none' }}>✓ 完了で記録</button>
                    </div>
                  </div>
                ) : entryFor === r.id ? (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 10, color: C.blue, marginBottom: 6, fontWeight: 700 }}>🎯 コールで見つけた入口をパイプラインに登録</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 4, marginBottom: entryType ? 6 : 8 }}>
                      {ENTRY_POINTS.map(ep => (
                        <button key={ep.id} onClick={() => setEntryType(entryType === ep.id ? '' : ep.id)} style={{ padding: 8, borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', textAlign: 'left', background: entryType === ep.id ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.03)', color: entryType === ep.id ? C.green : C.w2, border: entryType === ep.id ? '1px solid rgba(52,211,153,0.5)' : '1px solid rgba(255,255,255,0.08)' }}>{ep.label}</button>
                      ))}
                    </div>
                    {entryType && <div style={{ marginBottom: 8, padding: 8, borderRadius: 6, background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', fontSize: 11, color: C.blue }}>→ つなげる提案: <b>{entryOf(entryType)?.suggest}</b></div>}
                    <input value={entryMemo} onChange={e => setEntryMemo(e.target.value)} placeholder="顧客メモ（例: 奥様が他社利用、次回家族で来店）" style={inp} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button onClick={() => { setEntryFor(null); setEntryType(''); setEntryMemo(''); }} style={{ flex: 1, padding: 8, borderRadius: 8, fontSize: 11, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: C.mut, border: 'none' }}>キャンセル</button>
                      <button onClick={() => registerEntry(r)} disabled={!entryType} style={{ flex: 2, padding: 8, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: entryType ? 'pointer' : 'not-allowed', background: entryType ? C.blue : 'rgba(255,255,255,0.08)', color: entryType ? '#000' : C.mut, border: 'none' }}>パイプラインに登録＋コール完了</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => markDone(r.id, '')} style={{ flex: 1, minWidth: 80, padding: 7, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(52,211,153,0.15)', color: C.green, border: '1px solid rgba(52,211,153,0.3)' }}>✓ 完了</button>
                    <button onClick={() => { setNoteFor(r.id); setTempNote(''); }} style={{ flex: 1, minWidth: 100, padding: 7, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(52,211,153,0.06)', color: C.green, border: '1px solid rgba(52,211,153,0.2)' }}>📝 メモ付き完了</button>
                    <button onClick={() => { setEntryFor(r.id); setEntryType(''); setEntryMemo(customerSummary(r)); }} style={{ flex: 1, minWidth: 110, padding: 7, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(56,189,248,0.1)', color: C.blue, border: '1px solid rgba(56,189,248,0.3)' }}>🎯 入口を見つけた</button>
                    <button onClick={() => snooze(r.id, 1)} style={{ padding: '7px 9px', borderRadius: 8, fontSize: 10, cursor: 'pointer', background: 'rgba(251,191,36,0.1)', color: C.gold, border: '1px solid rgba(251,191,36,0.25)' }}>⏰明日</button>
                    <button onClick={() => snooze(r.id, 3)} style={{ padding: '7px 9px', borderRadius: 8, fontSize: 10, cursor: 'pointer', background: 'rgba(251,191,36,0.1)', color: C.gold, border: '1px solid rgba(251,191,36,0.25)' }}>⏰3日後</button>
                    <button onClick={() => snooze(r.id, 7)} style={{ padding: '7px 9px', borderRadius: 8, fontSize: 10, cursor: 'pointer', background: 'rgba(251,191,36,0.1)', color: C.gold, border: '1px solid rgba(251,191,36,0.25)' }}>⏰1週間後</button>
                  </div>
                )}
              </>
            )}

            {filter === 'snoozed' && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 10, color: C.gold, marginBottom: 6 }}>⏰ コール予定日: {r._dueDate} (あと{dueDays}日)</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => undoSnooze(r.id)} style={{ flex: 1, padding: 7, borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: C.mut, border: 'none' }}>↩️ 今日リストに戻す</button>
                  <button onClick={() => markDone(r.id, '')} style={{ flex: 1, padding: 7, borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: 'rgba(52,211,153,0.1)', color: C.green, border: '1px solid rgba(52,211,153,0.25)' }}>✓ 完了に変更</button>
                </div>
              </div>
            )}

            {filter === 'done' && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 10, color: C.green, marginBottom: 4 }}>✓ 完了: {r.tycDoneAt?.toDate?.()?.toLocaleDateString('ja-JP') || ''}</div>
                {r.tycNote && <div style={{ fontSize: 10, color: C.w2, padding: 6, background: 'rgba(0,0,0,0.25)', borderRadius: 6, marginBottom: 4, lineHeight: 1.5 }}>📝 {r.tycNote}</div>}
                <button onClick={() => reopenDone(r.id)} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: C.mut, border: 'none' }}>↩️ 再オープン</button>
              </div>
            )}
          </div>
        );
      })}
      </>}

      {/* みんなの状況（店舗別・担当者別／閲覧専用） */}
      {view === 'all' && (
        <div>
          <div style={{ fontSize: 10, color: C.mut, marginBottom: 10, lineHeight: 1.5 }}>過去30日の販売に対するコール状況です（店舗別・担当者別／全員が見られます）。完了の操作は本人が「自分のコール」から行います。</div>
          {Object.keys(teamStats).length === 0 && <div style={{ textAlign: 'center', color: C.mut2, fontSize: 12, padding: 28 }}>過去30日の販売がありません</div>}
          {Object.entries(teamStats).map(([sid, staffMap]) => (
            <div key={sid} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.w2, marginBottom: 6 }}>🏬 {storeName(sid) || sid}</div>
              {Object.entries(staffMap).sort((a, b) => b[1].overdue - a[1].overdue || b[1].total - a[1].total).map(([nm, st]) => {
                const key = sid + '_' + nm;
                const open = openStaff === key;
                const pct = st.total > 0 ? Math.round(st.done / st.total * 100) : 0;
                return (
                  <div key={nm} style={{ ...card, marginBottom: 6, padding: 10, borderColor: st.overdue > 0 ? 'rgba(248,113,113,0.35)' : 'rgba(255,255,255,0.06)' }}>
                    <div onClick={() => setOpenStaff(open ? null : key)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: nm === me ? C.gold : C.w2 }}>{nm}{nm === me ? '★' : ''}</span>
                      <span style={{ fontSize: 10 }}>
                        <span style={{ color: pct >= 100 ? C.green : C.mut }}>完了 {st.done}/{st.total}件（{pct}%）</span>
                        {st.overdue > 0 && <b style={{ color: C.red, marginLeft: 8 }}>⚠️ 未コール {st.overdue}件</b>}
                        <span style={{ color: C.mut2, marginLeft: 6 }}>{open ? '▲' : '▼'}</span>
                      </span>
                    </div>
                    {open && st.items.slice().sort((a, b) => a.date.localeCompare(b.date)).map((it, i) => (
                      <div key={it.id || i} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '5px 0', borderTop: '1px solid rgba(255,255,255,' + (i === 0 ? '0.08' : '0.03') + ')', marginTop: i === 0 ? 8 : 0, fontSize: 10 }}>
                        <span style={{ color: C.mut2, flexShrink: 0 }}>{it.date.slice(5).replace('-', '/')}</span>
                        <span style={{ color: C.w2, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.arch ? 'ARCH:' + it.arch + ' ／ ' : ''}{it.summary}</span>
                        <span style={{ flexShrink: 0, fontWeight: 700, color: it.isDone ? C.green : it.overdue ? C.red : C.gold }}>{it.isDone ? '✓ 済' : it.overdue ? '未' : '予定'}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
