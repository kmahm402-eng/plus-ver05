import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where, Timestamp, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { MAIN_STORES, EVENT_HOST, storeName, staffStore } from '../data/masters';
import * as XLSX from 'xlsx';

/* キャッシュバック集計（スタッフ別・店舗別・会社全体）
   ・報告画面で入れた「CBのお約束 あり／なし」と金額を、月ごとに集計する
   ・読むだけの画面。データは一切書き換えない */

const C = {
  gold: '#FBBF24', green: '#34D399', red: '#F87171', blue: '#38BDF8', purple: '#A78BFA',
  w: '#fff', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B',
  card: 'rgba(255,255,255,0.02)', line: '1px solid rgba(255,255,255,0.06)',
};
const card = { background: C.card, border: C.line, borderRadius: 12, padding: 12, marginBottom: 10 };
const th = { padding: '6px 4px', fontSize: 10, color: C.mut, fontWeight: 700, textAlign: 'right', borderBottom: C.line, whiteSpace: 'nowrap' };
const td = { padding: '6px 4px', fontSize: 11, color: C.w2, textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.04)', whiteSpace: 'nowrap' };
const yen = (n) => '¥' + Math.round(n || 0).toLocaleString();
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');

// 報告画面と同じ：新規・MNP・固定 が「あり／なし」必須の契約
const CB_MAINS = ['MAIN_001', 'MAIN_002'];
const CB_FIXED_MIDS = ['MID_030', 'MID_031', 'MID_032', 'MID_033', 'MID_063', 'MID_066', 'MID_067', 'MID_068'];
const isCbTarget = (l) => CB_MAINS.includes(l.mainCat) || CB_FIXED_MIDS.includes(l.midCat);
const MAIN_LABEL = { MAIN_001: '新規', MAIN_002: 'MNP', MAIN_003: '機種変更', MAIN_004: 'UQ→au', MAIN_005: 'その他', MAIN_006: '金融・コンテンツ' };
const kindOf = (l) => CB_FIXED_MIDS.includes(l.midCat) ? '固定（' + (l.midCatName || '') + '）' : (MAIN_LABEL[l.mainCat] || l.mainCatName || '');
const creditStore = (r) => EVENT_HOST[r.storeId] || r.storeId || '';
const personOf = (r) => (r.acqType === 'outsource' || r.counted === false)
  ? '外注：' + ((r.extName || '').split(':')[0] || '会社名なし')
  : (r.acqType === 'proxy' ? r.proxyStaff : r.staffName) || '名前なし';

// 1契約のCB状態：yes / no / unknown（ルール開始前の古い報告など）
const CB_MAX = 80000; // 1件あたりのCBは8万円を超えない（社長方針）。これを超える金額は入力ミスとして合計から外す
function cbStatus(l) {
  const amt = Number(l.cashback || 0);
  if (amt > CB_MAX || amt < 0 || !Number.isInteger(amt)) return 'bad';
  if (l.cbChoice === 'yes' || (l.cbChoice !== 'no' && amt > 0)) return 'yes';
  if (l.cbChoice === 'no') return 'no';
  return 'unknown';
}
const blank = () => ({ target: 0, yes: 0, yesTarget: 0, no: 0, unknown: 0, bad: 0, amount: 0 });
const normNo = (v) => (v || '').replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/[\s\u3000]+/g, '').toUpperCase();

export default function CbSummary() {
  const { user, profile } = useAuth();
  const [marking, setMarking] = useState('');
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [reports, setReports] = useState(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState('store'); // store / staff / list

  useEffect(() => {
    if (!user) return;
    if (!/^\d{4}-\d{2}$/.test(month)) return;   // 月が空・不正なら読みに行かない
    let alive = true;
    const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1;
    const q = query(collection(db, 'reports'),
      where('createdAt', '>=', Timestamp.fromDate(new Date(y, m, 1))),
      where('createdAt', '<', Timestamp.fromDate(new Date(y, m + 1, 1))));
    setReports(null); setErr('');
    getDocs(q).then(s => { if (alive) setReports(s.docs.map(d => ({ id: d.id, ...d.data() }))); })
      .catch(e => { if (alive) { setErr('読み込めませんでした：' + e.message); setReports([]); } });
    return () => { alive = false; };
  }, [user, month]);

  const data = useMemo(() => {
    const total = blank(), byStore = {}, byStaff = {}, list = [];
    (reports || []).forEach(r => {
      const sid = creditStore(r), who = personOf(r);
      const d = r.createdAt?.toDate?.();
      (r.lines || []).forEach(l => {
        const isTarget = isCbTarget(l);
        const st = cbStatus(l);
        const hasCode = !!(l.zoChoice || l.swChoice);                         // 増量・セット割のコード確認がある行（CBなしでも明細に出す）
        const counted = isTarget || st === 'yes' || st === 'bad';              // 機種変更などはCBがある時だけ数える
        if (!counted && !hasCode) return;
        const amt = st === 'yes' ? Number(l.cashback || 0) : 0;
        const add = (o) => { if (isTarget) o.target++; if (isTarget && st === 'yes') o.yesTarget++; o[st]++; o.amount += amt; };
        if (counted) { add(total); add(byStore[sid] = byStore[sid] || blank()); add(byStaff[who] = byStaff[who] || { ...blank(), store: who.startsWith('外注：') ? '' : (staffStore(who) || sid) }); }
        if (st !== 'no' || hasCode) list.push({
          date: d ? `${d.getMonth() + 1}/${d.getDate()}` : '', ts: d ? d.getTime() : 0,
          rid: r.id, store: storeName(sid) || '店舗不明', staff: who, kind: kindOf(l),
          status: st === 'yes' ? 'あり' : st === 'bad' ? '入力ミス？' : st === 'no' ? 'なし' : counted ? '未確認' : '—', amount: st === 'bad' ? Number(l.cashback || 0) : amt, appNo: normNo(l.appNo),
          family: l.cbFamily ? '代表: ' + (l.cbFamilyRep || '') : '', zoCode: l.zoChoice === 'yes' ? (l.zoCode || '') : l.zoChoice === 'no' ? 'なし' : l.zoChoice === 'later' ? '後日予定（未入力）' : '', swCode: l.swChoice === 'yes' ? (l.swCode || '') : l.swChoice === 'no' ? 'なし' : l.swChoice === 'later' ? '後日予定（未入力）' : '',
        });
      });
    });
    list.sort((a, b) => a.ts - b.ts);
    // CBシステム未登録（cbNeed が付いた新しい報告だけ。10/15 より前の報告には付かない）
    const pending = (reports || []).filter(r => r.cbNeed === true && r.cbRegistered !== true).map(r => {
      const d = r.createdAt?.toDate?.(); const ls = (r.lines || []).filter(l => l.cbChoice === 'yes' || (l.cbChoice !== 'no' && Number(l.cashback || 0) > 0));
      return { id: r.id, date: d ? `${d.getMonth() + 1}/${d.getDate()}` : '', days: d ? Math.floor((Date.now() - d.getTime()) / 86400000) : 0, store: storeName(creditStore(r)) || '店舗不明', who: personOf(r), by: r.staffName || '', amount: ls.reduce((a, l) => a + Number(l.cashback || 0), 0), apps: ls.map(l => normNo(l.appNo)).filter(Boolean).join('／') || '—', n: ls.length };
    }).sort((a, b) => b.days - a.days);
    const registered = (reports || []).filter(r => r.cbNeed === true && r.cbRegistered === true).length;
    // 要確認：重複（同じ申込書番号でCBありが2件以上）／申込書番号なし（CBシステムと照合できない）／入力ミス？
    // 同じ報告の中の2回線（同じお客様）は重複に数えない。別の報告で同じ番号が出たときだけ「二重報告？」
    const rids = {}; list.forEach(x => { if (x.status === 'あり' && normNo(x.appNo)) (rids[normNo(x.appNo)] = rids[normNo(x.appNo)] || new Set()).add(x.rid); });
    const cnt = {}; Object.keys(rids).forEach(k => { cnt[k] = rids[k].size; });
    const issues = [];
    list.forEach(x => {
      if (x.status === '入力ミス？') issues.push({ ...x, why: '金額が8万円超か不正（IMEIなどの入れ間違い？ 本当に8万円超なら店長へ別途連絡）' });
      else if (x.status === 'あり' && !normNo(x.appNo)) issues.push({ ...x, why: '申込書番号なし（CBシステムと照合できない）' });
      else if (x.status === 'あり' && cnt[normNo(x.appNo)] > 1) issues.push({ ...x, why: '同じ申込書番号の報告が別に' + (cnt[normNo(x.appNo)] - 1) + '件（二重報告？）' });
      else if (x.zoCode === '後日予定（未入力）' || x.swCode === '後日予定（未入力）') issues.push({ ...x, why: 'コードが「後日予定」のまま（本人がホームの「コード未入力」から入れる）' });
    });
    const staffRows = Object.entries(byStaff).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount || b.yes - a.yes);
    const storeRows = MAIN_STORES.map(s => ({ id: s.id, name: s.name, ...(byStore[s.id] || blank()) }));
    Object.keys(byStore).filter(k => !MAIN_STORES.some(s => s.id === k)).forEach(k => storeRows.push({ id: k || '_none', name: storeName(k) || '店舗不明', ...byStore[k] }));
    return { total, storeRows, staffRows, list, issues, pending, registered };
  }, [reports]);

  const exportExcel = () => {
    const row = (name, v) => ({ 名前: name, '対象契約': v.target, 'CBあり': v.yes, 'CBなし': v.no, '未確認': v.unknown, '入力ミス？': v.bad, 'CB率': v.target ? Math.round(v.yesTarget / v.target * 100) + '%' : '—', 'CB合計(円)': v.amount, '1件平均(円)': v.yes ? Math.round(v.amount / v.yes) : 0 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([row('全社', data.total)]), '会社全体');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.storeRows.map(s => row(s.name, s))), '店舗別');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.staffRows.length ? data.staffRows.map(s => ({ 所属: storeName(s.store) || '—', ...row(s.name, s) })) : [{ 名前: '該当なし' }]), 'スタッフ別');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.list.length ? data.list.map(x => ({ 日付: x.date, 獲得店舗: x.store, スタッフ: x.staff, 契約: x.kind, CB: x.status, '金額(円)': x.amount, 申込書番号: x.appNo, 家族まとめ: x.family, 増量コード: x.zoCode, セット割コード: x.swCode })) : [{ 日付: '該当なし' }]), '明細');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.issues.length ? data.issues.map(x => ({ 日付: x.date, 獲得店舗: x.store, スタッフ: x.staff, 契約: x.kind, '金額(円)': x.amount, 申込書番号: x.appNo, 理由: x.why })) : [{ 理由: '要確認なし' }]), '要確認');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.pending.length ? data.pending.map(p => ({ 日付: p.date, 経過日数: p.days, 獲得店舗: p.store, スタッフ: p.who, 入力者: p.by, '金額(円)': p.amount, 台数: p.n, 申込書番号: p.apps })) : [{ 日付: '未登録なし' }]), '未登録');
    XLSX.writeFile(wb, `CB集計_${month}.xlsx`);
  };

  const markRegistered = async (p) => {
    if (!confirm(p.who + ' の ' + yen(p.amount) + ' を、CBチャージ管理システムに登録済みにしますか？\n（本人に確認してから押してください）')) return;
    setMarking(p.id);
    try {
      await updateDoc(doc(db, 'reports', p.id), { cbRegistered: true, cbRegisteredAt: serverTimestamp(), cbRegisteredBy: (profile?.name || '') + '（店長確認）' });
      setReports(rs => rs.map(r => r.id === p.id ? { ...r, cbRegistered: true } : r));
    } catch (e) { alert('記録できませんでした：' + e.message); }
    setMarking('');
  };
  const T = data.total;
  const Head = ({ first }) => (
    <tr><th style={{ ...th, textAlign: 'left' }}>{first}</th><th style={th}>対象</th><th style={th}>あり</th><th style={th}>なし</th><th style={th}>未確認</th><th style={th}>CB率</th><th style={th}>CB合計</th></tr>
  );
  const Row = ({ name, v, sub }) => (
    <tr>
      <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>{name}{sub ? <div style={{ fontSize: 9, color: C.mut2 }}>{sub}</div> : null}</td>
      <td style={td}>{v.target}</td><td style={{ ...td, color: C.gold }}>{v.yes}</td><td style={td}>{v.no}</td>
      <td style={{ ...td, color: v.unknown ? C.red : C.mut2 }}>{v.unknown}</td><td style={td}>{pct(v.yesTarget, v.target)}</td>
      <td style={{ ...td, fontWeight: 700 }}>{yen(v.amount)}</td>
    </tr>
  );

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: C.w, marginBottom: 4 }}>💴 キャッシュバック集計</h1>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 10, lineHeight: 1.6 }}>報告画面の「キャッシュバックのお約束」を月ごとに集計します。店舗は獲得店舗（イベントは主催店に合算）、外注も含みます。</div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: C.w, fontSize: 12 }} />
        <button onClick={exportExcel} disabled={!reports} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(52,211,153,0.12)', color: C.green, border: '1px solid rgba(52,211,153,0.35)' }}>📥 Excel出力</button>
      </div>

      {err && <div style={{ ...card, color: C.red, fontSize: 11 }}>{err}</div>}
      {!reports ? <div style={{ ...card, fontSize: 11, color: C.mut }}>読み込み中…</div> : (
        <>
          <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <div><div style={{ fontSize: 10, color: C.mut }}>会社全体のCB合計</div><div style={{ fontSize: 20, fontWeight: 900, color: C.gold }}>{yen(T.amount)}</div></div>
            <div><div style={{ fontSize: 10, color: C.mut }}>CBあり／対象契約</div><div style={{ fontSize: 20, fontWeight: 900, color: C.w }}>{T.yesTarget}<span style={{ fontSize: 12, color: C.mut }}> / {T.target}件（{pct(T.yesTarget, T.target)}）{T.yes > T.yesTarget ? `＋機変など${T.yes - T.yesTarget}件` : ''}</span></div></div>
            <div><div style={{ fontSize: 10, color: C.mut }}>1件あたり平均</div><div style={{ fontSize: 14, fontWeight: 700, color: C.w2 }}>{T.yes ? yen(T.amount / T.yes) : '—'}</div></div>
            <div><div style={{ fontSize: 10, color: C.mut }}>CBシステム 未登録</div><div style={{ fontSize: 14, fontWeight: 700, color: data.pending.length ? C.red : C.green }}>{data.pending.length}件<span style={{ fontSize: 10, color: C.mut }}>（登録済み {data.registered}）</span></div></div>
          </div>
          {data.issues.length > 0 && <div style={{ ...card, border: '1px solid rgba(248,113,113,0.4)', fontSize: 11, color: C.red, lineHeight: 1.6 }}>⚠️ 要確認の報告が {data.issues.length}件 あります（8万円超の金額・申込書番号なし・同じ番号の重複・コード後日予定のまま）。8万円超は合計から外しています。「要確認」で中身を見てください。</div>}

          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {[{ id: 'store', n: '店舗別' }, { id: 'staff', n: 'スタッフ別' }, { id: 'list', n: '明細' }, { id: 'issues', n: '要確認' + (data.issues.length ? '（' + data.issues.length + '）' : '') }, { id: 'pending', n: '未登録' + (data.pending.length ? '（' + data.pending.length + '）' : '') }].map(t => (
              <button key={t.id} onClick={() => setView(t.id)} style={{ flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: view === t.id ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.02)', color: view === t.id ? C.gold : C.mut, border: view === t.id ? '1px solid rgba(251,191,36,0.35)' : C.line }}>{t.n}</button>
            ))}
          </div>

          <div style={{ ...card, overflowX: 'auto' }}>
            {view === 'store' && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><Head first="店舗" /></thead>
                <tbody>{data.storeRows.map(s => <Row key={s.id} name={s.name} v={s} />)}<Row name="全社" v={T} /></tbody></table>
            )}
            {view === 'staff' && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><Head first="スタッフ" /></thead>
                <tbody>{data.staffRows.map(s => <Row key={s.name} name={s.name} sub={storeName(s.store)} v={s} />)}</tbody></table>
            )}
            {view === 'pending' && (
              <>
                <div style={{ fontSize: 10, color: C.mut, marginBottom: 6, lineHeight: 1.6 }}>CBありで報告したのに、本人が「CBシステムに登録した」を押していない報告です（登録済み {data.registered}件）。本人に確認し、登録していれば「登録済みにする」を押してください。</div>
                {data.pending.length === 0 ? <div style={{ fontSize: 11, color: C.green }}>✅ 未登録はありません。</div> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={{ ...th, textAlign: 'left' }}>日付</th><th style={{ ...th, textAlign: 'left' }}>スタッフ</th><th style={th}>金額</th><th style={{ ...th, textAlign: 'left' }}>申込書番号</th><th style={th}></th></tr></thead>
                    <tbody>{data.pending.map(p => (
                      <tr key={p.id}><td style={{ ...td, textAlign: 'left' }}>{p.date}{p.days >= 2 && <div style={{ fontSize: 9, color: C.red }}>{p.days}日経過</div>}</td><td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>{p.who}<div style={{ fontSize: 9, color: C.mut2 }}>{p.store}{p.by && p.by !== p.who ? '・入力：' + p.by : ''}</div></td>
                        <td style={td}>{yen(p.amount)}<div style={{ fontSize: 9, color: C.mut2 }}>{p.n}台分</div></td><td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', fontSize: 10 }}>{p.apps}</td>
                        <td style={td}><button onClick={() => markRegistered(p)} disabled={marking === p.id} style={{ padding: '6px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: 'rgba(52,211,153,0.12)', color: C.green, border: '1px solid rgba(52,211,153,0.35)', whiteSpace: 'nowrap' }}>{marking === p.id ? '…' : '登録済みにする'}</button></td></tr>
                    ))}</tbody>
                  </table>
                )}
              </>
            )}
            {view === 'issues' && (
              data.issues.length === 0 ? <div style={{ fontSize: 11, color: C.green }}>✅ 要確認の報告はありません。</div> : (
                <>
                  <div style={{ fontSize: 10, color: C.mut, marginBottom: 6, lineHeight: 1.6 }}>本人に確認して、報告を直してもらってください（報告画面の「履歴」から削除→再入力）。</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={{ ...th, textAlign: 'left' }}>日付</th><th style={{ ...th, textAlign: 'left' }}>スタッフ</th><th style={th}>金額</th><th style={{ ...th, textAlign: 'left' }}>申込書番号</th><th style={{ ...th, textAlign: 'left' }}>理由</th></tr></thead>
                    <tbody>{data.issues.map((x, i) => (
                      <tr key={i}><td style={{ ...td, textAlign: 'left' }}>{x.date}</td><td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>{x.staff}<div style={{ fontSize: 9, color: C.mut2 }}>{x.store}・{x.kind}</div></td>
                        <td style={td}>{x.status === '入力ミス？' ? String(x.amount) : yen(x.amount)}</td><td style={{ ...td, textAlign: 'left' }}>{x.appNo || '—'}</td><td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', color: C.red }}>{x.why}</td></tr>
                    ))}</tbody>
                  </table>
                </>
              )
            )}
            {view === 'list' && (
              data.list.length === 0 ? <div style={{ fontSize: 11, color: C.mut }}>対象の契約はまだありません。</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={{ ...th, textAlign: 'left' }}>日付</th><th style={{ ...th, textAlign: 'left' }}>スタッフ</th><th style={th}>金額</th><th style={{ ...th, textAlign: 'left' }}>申込書番号</th><th style={th}>CB</th><th style={{ ...th, textAlign: 'left' }}>コード</th></tr></thead>
                  <tbody>{data.list.map((x, i) => (
                    <tr key={i}><td style={{ ...td, textAlign: 'left' }}>{x.date}</td><td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>{x.staff}<div style={{ fontSize: 9, color: C.mut2 }}>{x.store}・{x.kind}</div></td>
                      <td style={td}>{x.status === '入力ミス？' ? '金額不正' : x.amount ? yen(x.amount) : '—'}</td><td style={{ ...td, textAlign: 'left' }}>{x.appNo || '—'}{x.family && <div style={{ fontSize: 9, color: C.purple }}>👨‍👩‍👧 {x.family}</div>}</td><td style={{ ...td, color: x.status === 'あり' ? C.gold : x.status === 'なし' || x.status === '—' ? C.mut : C.red }}>{x.status}</td><td style={{ ...td, textAlign: 'left', fontSize: 9, color: C.mut, whiteSpace: 'normal' }}>{x.zoCode && <div>増量: {x.zoCode}</div>}{x.swCode && <div>セット割: {x.swCode}</div>}{!x.zoCode && !x.swCode && '—'}</td></tr>
                  ))}</tbody>
                </table>
              )
            )}
          </div>
          <div style={{ fontSize: 9, color: C.mut2, lineHeight: 1.6 }}>
            ・対象＝新規・MNP・固定（ひかり・BL光・WiMAXなど）の契約数。機種変更などはCBがあった時だけ「あり」に数えます。<br />
            ・未確認＝「あり／なし」の記録が無い契約。2026年10月15日より前の報告は未確認のままで構いません（直す必要はありません）。<br />
            ・「未登録」は10月15日以降の報告だけが対象です。「未確認」（あり／なしの記録が無い古い報告）は {T.unknown}件。<br />
            ・要確認の「同じ申込書番号」は、CBありの契約どうしで別の報告に同じ番号があるときだけ出ます。<br />
            ・CBシステムには、1回線＝1件で各回線の金額を登録します（家族まとめは代表者名を入れる）。この画面は1契約ごとの合計です。
          </div>
        </>
      )}
    </div>
  );
}
