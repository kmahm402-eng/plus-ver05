import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, onSnapshot, doc, where, getDocs } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { MAIN_STORES, storeName, MAIN_CAT, midName, OUTSOURCERS } from '../data/masters';
import { creditStoreOf } from '../lib/aggregate';

const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const C = { gold: '#FBBF24', green: '#34D399', mut: '#94A3B8', mut2: '#64748B' };
const mainName = (id) => MAIN_CAT.find(m => m.id === id)?.name || id;
const actorOf = (r) => (r.acqType === 'proxy' ? r.proxyStaff : r.staffName) || '?';
const isOut = (name) => OUTSOURCERS.includes(name);
const SHIN_MNP = ['MAIN_001', 'MAIN_002'];
const COST_LABEL = { venue: '会場費', labor: '人件費', supplies: '備品・販促費', prize: '景品代', other: 'その他' };
const COST_KEYS = ['venue', 'labor', 'supplies', 'prize', 'other'];

export default function ExcelExport() {
  const { user, profile } = useAuth();
  const [events, setEvents] = useState([]);
  const [cfg, setCfg] = useState({ revenuePerAcq: 0 });
  const [mode, setMode] = useState('store');
  const [storeId, setStoreId] = useState('');
  const [month, setMonth] = useState(() => ym(new Date()));
  const [eventId, setEventId] = useState('');

  useEffect(() => { if (profile?.storeId) setStoreId(profile.storeId); }, [profile]);
  useEffect(() => {
    if (!user) return;
    // reports はここでは読み込まない（軽量化）。ダウンロードボタンを押した時に必要な期間だけ取得する。
    const u2 = onSnapshot(query(collection(db, 'events')), s => setEvents(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u3 = onSnapshot(doc(db, 'eventConfig', 'main'), s => setCfg({ revenuePerAcq: (s.exists() ? s.data().revenuePerAcq : 0) || 0 }));
    return () => { u2(); u3(); };
  }, [user]);

  // 指定期間の報告だけ取りに行く（start以上・end未満）
  const fetchReportsRange = async (start, end) => {
    const snap = await getDocs(query(collection(db, 'reports'), where('createdAt', '>=', start), where('createdAt', '<', end)));
    return snap.docs.map(d => { const r = { id: d.id, ...d.data() }; const cd = r.createdAt?.toDate?.(); if (cd) r._month = ym(cd); return r; });
  };
  // "2026-06" のような月文字列 → その月の初日と翌月初日
  const monthRange = (m) => {
    const [y, mo] = m.split('-').map(Number);
    return [new Date(y, mo - 1, 1), new Date(y, mo, 1)];
  };

  const monthEvents = useMemo(() =>
    events.filter(e => (e.start || '').slice(0, 7) === month).sort((a, b) => (b.start || '').localeCompare(a.start || '')),
    [events, month]);

  // ===== 店舗・月の出力（これまで通り）=====
  const exportStore = async () => {
    if (!storeId) { alert('店舗を選んでください'); return; }
    const [ms, me] = monthRange(month);
    const reports = await fetchReportsRange(ms, me).catch(() => null);
    if (!reports) { alert('データの取得に失敗しました。通信環境を確認して、もう一度お試しください。'); return; }
    const rows = reports.filter(r => (r.counted !== false) && creditStoreOf(r) === storeId && (!r._month || r._month === month));
    const cnt = {};
    rows.forEach(r => (r.lines || []).forEach(l => {
      const key = (l.mainCatName || '') + '|' + (l.midCatName || '?') + (l.lineType ? '(' + l.lineType.toUpperCase() + ')' : '');
      cnt[key] = (cnt[key] || 0) + 1;
    }));
    const s1 = Object.entries(cnt).map(([k, v]) => ({ 大分類: k.split('|')[0], 商材: k.split('|')[1], 件数: v }));
    s1.push({ 大分類: '', 商材: '合計', 件数: s1.reduce((a, b) => a + b.件数, 0) });
    let p1cnt = 0, p1total = 0;
    rows.forEach(r => (r.lines || []).forEach(l => { if (l.plus1c > 0) { p1cnt++; p1total += Number(l.plus1c); } }));
    const s2 = [{ 項目: 'au+1collection', 件数: p1cnt, 合計金額: p1total }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s1), '獲得集計');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s2), '物販');
    XLSX.writeFile(wb, storeName(storeId) + '_' + month + '.xlsx');
  };

  // ===== イベント単位の出力（4シート）=====
  const exportEvent = async () => {
    if (!eventId) { alert('イベントを選んでください'); return; }
    const ev = events.find(e => e.id === eventId);
    if (!ev) { alert('イベントが見つかりません'); return; }

    // イベントの期間ぶんだけ取りに行く（月を跨ぐイベントもこの範囲で漏れなく取れる）
    const evStart = new Date(ev.start + 'T00:00:00');
    const evEndEx = new Date(ev.end + 'T00:00:00');
    evEndEx.setDate(evEndEx.getDate() + 1); // 終了日の翌日0:00 未満 ＝ 終了日いっぱいまで
    const reports = await fetchReportsRange(evStart, evEndEx).catch(() => null);
    if (!reports) { alert('データの取得に失敗しました。通信環境を確認して、もう一度お試しください。'); return; }

    // イベントの店舗 × 期間 で抽出（イベント集計と同じ拾い方）
    const reps = reports.filter(r => {
      const d = r.createdAt?.toDate?.(); if (!d) return false;
      const ds = ymd(d);
      return r.storeId === ev.storeId && ds >= ev.start && ds <= ev.end;
    });
    const lines = [];
    reps.forEach(r => (r.lines || []).forEach(l => {
      lines.push({ date: ymd(r.createdAt.toDate()), actor: actorOf(r), midCat: l.midCat, mainCat: l.mainCat, plus1c: Number(l.plus1c) || 0 });
    }));
    const total = lines.length;
    const shin = lines.filter(l => l.mainCat === 'MAIN_001' && l.midCat !== 'MID_016').length; // タブレット新規は新規に数えない
    const mnp = lines.filter(l => l.mainCat === 'MAIN_002').length;
    const shinMnp = shin + mnp;
    const plus1cSum = lines.reduce((s, l) => s + l.plus1c, 0);
    const costs = ev.costs || {};
    const costSum = COST_KEYS.reduce((s, k) => s + (Number(costs[k]) || 0), 0);
    const rev = cfg.revenuePerAcq || 0;
    const income = shinMnp * rev;
    const profit = income - costSum;

    // シート1: イベント概要
    const s1 = [];
    s1.push({ 項目: 'イベント名', 値: ev.name });
    s1.push({ 項目: '店舗', 値: storeName(ev.storeId) });
    s1.push({ 項目: '期間', 値: ev.start + ' 〜 ' + ev.end });
    s1.push({ 項目: '総件数', 値: total });
    s1.push({ 項目: '新規', 値: shin });
    s1.push({ 項目: 'MNP', 値: mnp });
    s1.push({ 項目: '新規+MNP', 値: shinMnp });
    s1.push({ 項目: '+1C販売額 合計', 値: plus1cSum });
    s1.push({ 項目: '── 費用 ──', 値: '' });
    COST_KEYS.forEach(k => s1.push({ 項目: COST_LABEL[k], 値: Number(costs[k]) || 0 }));
    s1.push({ 項目: '費用合計', 値: costSum });
    if (rev > 0) {
      s1.push({ 項目: '── 採算 ──', 値: '' });
      s1.push({ 項目: '想定収入（新規+MNP × ' + rev.toLocaleString() + '円）', 値: income });
      s1.push({ 項目: (profit >= 0 ? '黒字' : '赤字'), 値: profit });
    }

    // シート2: 商材別件数
    const cnt = {};
    lines.forEach(l => { const key = mainName(l.mainCat) + '|' + (midName(l.midCat) || '?'); cnt[key] = (cnt[key] || 0) + 1; });
    const s2 = Object.entries(cnt).map(([k, v]) => ({ 大分類: k.split('|')[0], 商材: k.split('|')[1], 件数: v }));
    s2.push({ 大分類: '', 商材: '合計', 件数: total });

    // シート3: スタッフ別
    const byActor = {};
    lines.forEach(l => { byActor[l.actor] = byActor[l.actor] || { total: 0, sm: 0 }; byActor[l.actor].total++; if (SHIN_MNP.includes(l.mainCat)) byActor[l.actor].sm++; });
    const s3 = Object.entries(byActor).sort((a, b) => b[1].total - a[1].total).map(([nm, d]) => ({ 獲得者: nm, 区分: isOut(nm) ? '外注' : '自社', 件数: d.total, '新規+MNP': d.sm }));

    // シート4: 獲得明細
    const s4 = lines.slice().sort((a, b) => a.date.localeCompare(b.date)).map(l => ({
      日付: l.date, 獲得者: l.actor, 区分: isOut(l.actor) ? '外注' : '自社', 大分類: mainName(l.mainCat), 商材: midName(l.midCat) || '?', '+1C': l.plus1c > 0 ? l.plus1c : ''
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s1), 'イベント概要');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s2), '商材別件数');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s3), 'スタッフ別');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s4), '獲得明細');
    const safe = (ev.name || 'イベント').replace(/[\\/:*?"<>|]/g, '_');
    XLSX.writeFile(wb, safe + '_' + ev.start + '.xlsx');
  };

  // ===== ニーズ発見ログの出力（成功事例の蓄積）=====
  const exportNeeds = async () => {
    const [ms, me] = monthRange(month);
    const reports = await fetchReportsRange(ms, me).catch(() => null);
    if (!reports) { alert('データの取得に失敗しました。通信環境を確認して、もう一度お試しください。'); return; }
    const rows = reports
      .filter(r => r.needsLog && (!r._month || r._month === month))
      .sort((a, b) => {
        const da = a.createdAt?.toDate?.(); const dbb = b.createdAt?.toDate?.();
        return (da && dbb) ? da - dbb : 0;
      });
    if (rows.length === 0) { alert('この月のニーズ発見ログはまだありません'); return; }
    const data = rows.map(r => {
      const d = r.createdAt?.toDate?.();
      const items = (r.lines || [])
        .map(l => (l.mainCatName || '') + (l.midCatName ? '・' + l.midCatName : '') + (l.lineType ? '(' + l.lineType.toUpperCase() + ')' : ''))
        .filter(Boolean).join(' / ');
      const nl = r.needsLog || {};
      return {
        日付: d ? ymd(d) : '',
        店舗: storeName(creditStoreOf(r)),
        スタッフ: actorOf(r),
        獲得商材: items,
        'お客様の入口': nl.entry || '',
        '本当は何が刺さったか': Array.isArray(nl.values) ? nl.values.join(' / ') : '',
        '反応が変わった説明': nl.explain || '',
        メモ: nl.memo || '',
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'ニーズ発見ログ');
    XLSX.writeFile(wb, 'ニーズ発見ログ_' + month + '.xlsx');
  };

  const inpStyle = { width: '100%', padding: 8, borderRadius: 8, marginBottom: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 12 }}>📥 Excel出力</h1>

      {/* モード切替 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[['store', '🏪 店舗・月'], ['event', '📅 イベント'], ['needs', '💡 ニーズ発見ログ']].map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)} style={{ flex: 1, padding: 10, borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: mode === id ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.02)', color: mode === id ? C.gold : C.mut2, border: mode === id ? '1px solid rgba(251,191,36,0.25)' : '1px solid rgba(255,255,255,0.04)' }}>{label}</button>
        ))}
      </div>

      {mode === 'store' && (<>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {MAIN_STORES.map(s => (
            <button key={s.id} onClick={() => setStoreId(s.id)} style={{ padding: '5px 9px', borderRadius: 7, fontSize: 9, cursor: 'pointer', background: storeId === s.id ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.02)', color: storeId === s.id ? C.gold : C.mut, border: storeId === s.id ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>{s.name}</button>
          ))}
        </div>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={inpStyle} />
        <button onClick={exportStore} style={{ width: '100%', padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: C.green, color: '#000' }}>📥 {storeId ? storeName(storeId) : '店舗'}・{month} をダウンロード</button>
        <div style={{ fontSize: 9, color: C.mut, textAlign: 'center', marginTop: 8 }}>計上ルール（獲得店）で店舗を判定しています。</div>
      </>)}

      {mode === 'event' && (<>
        <input type="month" value={month} onChange={e => { setMonth(e.target.value); setEventId(''); }} style={inpStyle} />
        {monthEvents.length === 0 && <div style={{ fontSize: 11, color: C.mut2, textAlign: 'center', padding: 16 }}>この月のイベントはありません</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {monthEvents.map(e => (
            <button key={e.id} onClick={() => setEventId(e.id)} style={{ padding: 10, borderRadius: 9, fontSize: 12, fontWeight: 600, textAlign: 'left', cursor: 'pointer', background: eventId === e.id ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.02)', color: eventId === e.id ? C.gold : C.mut, border: eventId === e.id ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>
              {e.name}<span style={{ fontSize: 9, color: C.mut2, marginLeft: 6 }}>{(e.start || '').slice(5)}〜{(e.end || '').slice(5)}・{storeName(e.storeId)}</span>
            </button>
          ))}
        </div>
        <button onClick={exportEvent} disabled={!eventId} style={{ width: '100%', padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', cursor: eventId ? 'pointer' : 'not-allowed', background: eventId ? C.green : 'rgba(255,255,255,0.06)', color: eventId ? '#000' : C.mut2 }}>📥 選んだイベントをダウンロード</button>
        <div style={{ fontSize: 9, color: C.mut, textAlign: 'center', marginTop: 8 }}>イベントの店舗 × 期間で集計（概要・商材別・スタッフ別・獲得明細の4シート）。</div>
      </>)}

      {mode === 'needs' && (<>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={inpStyle} />
        <button onClick={exportNeeds} style={{ width: '100%', padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: C.green, color: '#000' }}>📥 {month} のニーズ発見ログをダウンロード</button>
        <div style={{ fontSize: 9, color: C.mut, textAlign: 'center', marginTop: 8, lineHeight: 1.7 }}>「なぜ獲得につながったか」を1件ずつ出力します。<br/>日付・店舗・スタッフ・獲得商材・お客様の入口・刺さった価値・反応が変わった説明・メモの順。<br/>※ ニーズ発見ログが入力された報告のみ並びます。</div>
      </>)}
    </div>
  );
}
