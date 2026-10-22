import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, doc, setDoc, updateDoc, query, where, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import * as XLSX from 'xlsx';
import { STAFF, MAIN_STORES, staffStore, storeName } from '../data/masters';

/* ───────── 色 ───────── */
const C = {
  gold: '#FBBF24', green: '#34D399', red: '#F87171', blue: '#38BDF8',
  mut: '#94A3B8', mut2: '#64748B', card: 'rgba(255,255,255,0.02)',
  line: '1px solid rgba(255,255,255,0.06)',
};
const card = { background: C.card, border: C.line, borderRadius: 12, padding: 12, marginBottom: 10 };
const norm = (s) => (s || '').replace(/[\s\u3000]+/g, '');
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmt = (s) => (s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : '—');

/* ───────── 接触ステップ（3年で6回）───────── */
const STEPS = [
  { key: 'd7',  label: '①7日',   days: 7,    purpose: 'お礼・不安の解消',      talk: '「先日お手続きさせていただいた○○です。その後、使い方で困っていることはありませんか」' },
  { key: 'm1',  label: '②1ヶ月', months: 1,  purpose: '初回請求の確認',        talk: '「初めての請求が届いたと思います。金額はご説明どおりでしたか」' },
  { key: 'm6',  label: '③半年',  months: 6,  purpose: 'バッテリー診断',        talk: '「半年経ちました。バッテリーの状態を無料で診断できます」※SIM単の方は機種変更の本番' },
  { key: 'y1',  label: '④1年',   months: 12, purpose: '家族と料金の見直し',    talk: '「ご家族の分もまとめると、もっと安くできるかもしれません」' },
  { key: 'y2',  label: '⑤2年',   months: 24, purpose: '機種変更の本番',        talk: '「端末の分割が終わる時期です。今なら次の機種をこの金額でご案内できます」' },
  { key: 'y3',  label: '⑥3年',   months: 36, purpose: '他社対策・継続',        talk: '「他社から案内が来ていませんか。今の条件を比べてみましょう」' },
];

const RESULTS = ['なし', '機種変更', '家族の乗り換え', 'ひかり', 'でんき', 'ゴールド', '紹介', '来店予約', 'その他'];

function addDays(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); return ymd(d); }
function addMonths(base, n) { const d = new Date(base); d.setMonth(d.getMonth() + n); return ymd(d); }
function planDate(contractDate, step) {
  if (!contractDate) return '';
  const base = new Date(contractDate + 'T00:00:00');
  return step.days ? addDays(base, step.days) : addMonths(base, step.months);
}

export default function Customers() {
  const { user, profile, isManager, isAdmin } = useAuth();
  const nav = useNavigate();
  const me = profile?.name || '';
  const homeStore = staffStore(me) || profile?.storeId || '';
  const today = ymd(new Date());

  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState('todo');           // todo | mine | store | staff
  const [editing, setEditing] = useState(null);      // 詳細を開いている顧客
  const [form, setForm] = useState(null);            // 新規登録フォーム
  const [saving, setSaving] = useState(false);
  const [doneForm, setDoneForm] = useState(null);    // {id, key} 済にする入力中
  const [viewStore, setViewStore] = useState('');    // 管理者の店舗切替（''=全店）
  const [staffFilter, setStaffFilter] = useState(''); // 全体タブの担当者絞り込み（''=全員）
  const canSeeAll = !!(isManager || isAdmin);
  const myStore = canSeeAll ? viewStore : homeStore;

  /* ── 顧客を購読（一般＝自店、管理者＝選んだ店 or 全店）── */
  useEffect(() => {
    if (!user) return;
    if (!canSeeAll && !homeStore) return;
    const base = collection(db, 'customers');
    const q = (canSeeAll && !viewStore) ? base : query(base, where('storeId', '==', canSeeAll ? viewStore : homeStore));
    return onSnapshot(q, (snap) => {
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [user, homeStore, viewStore, canSeeAll]);

  /* ── 各顧客の「次にやること」を計算 ── */
  const enriched = useMemo(() => rows.map(r => {
    const done = r.done || {};
    let next = null;
    for (const s of STEPS) {
      if (done[s.key]) continue;
      const pd = planDate(r.contractDate, s);
      if (!pd) continue;
      next = { step: s, date: pd, over: pd < today, soon: pd >= today && pd <= addDays(new Date(), 7) };
      break;
    }
    const cnt = STEPS.filter(s => done[s.key]).length;
    return { ...r, next, doneCount: cnt, finished: !next };
  }), [rows, today]);

  const todo = useMemo(() =>
    enriched.filter(r => r.next && (r.next.over || r.next.soon))
      .sort((a, b) => a.next.date.localeCompare(b.next.date)), [enriched]);
  const mine = useMemo(() =>
    enriched.filter(r => norm(r.staffName) === norm(me))
      .sort((a, b) => (b.contractDate || '').localeCompare(a.contractDate || '')), [enriched, me]);
  const all = useMemo(() =>
    enriched.filter(r => !staffFilter || norm(r.staffName) === norm(staffFilter))
      .sort((a, b) => (b.contractDate || '').localeCompare(a.contractDate || '')), [enriched, staffFilter]);
  const staffOptions = useMemo(() => {
    const seen = new Map();
    enriched.forEach(r => { const k = norm(r.staffName); if (k && !seen.has(k)) seen.set(k, r.staffName); });
    return [...seen.values()].sort();
  }, [enriched]);

  /* ── 架電リストをExcelで出力（今見ているリストをそのまま）── */
  const exportList = () => {
    if (list.length === 0) { alert('出力するお客様がいません'); return; }
    const sorted = [...list].sort((a, b) => {
      const ad = a.next?.date || '9999', bd = b.next?.date || '9999';
      return ad.localeCompare(bd);
    });
    const data = sorted.map((r, i) => ({
      '#': i + 1,
      'お客様名': r.name,
      '連絡先': r.tel || '',
      '担当': r.staffName || '',
      '店舗': storeName(r.storeId) || '',
      '契約日': r.contractDate || '',
      'SIM単': r.simOnly ? '○' : '',
      '次の接触': r.next ? r.next.step.label : '完了',
      '予定日': r.next ? r.next.date : '',
      '状態': r.finished ? '完了' : r.next?.over ? '期限超過' : r.next?.soon ? '今週' : '予定',
      '目的': r.next ? r.next.step.purpose : '',
      '話すこと': r.next ? r.next.step.talk : '',
      '済/6': r.doneCount,
      '付帯': [r.gold && 'ゴールド', r.hikari && 'ひかり', r.denki && 'でんき'].filter(Boolean).join('・'),
      'プラン': r.plan || '',
      '家族台数': r.family || '',
      'メモ': r.memo || '',
      '架電日': '', '結果': '', '次の約束': '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [3,12,13,9,12,10,5,8,10,8,14,40,5,14,12,7,20,9,10,14].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '架電リスト');
    const who = tab === 'mine' ? me : (staffFilter || (tab === 'todo' ? 'やること' : '全員'));
    XLSX.writeFile(wb, `架電リスト_${who}_${today}.xlsx`);
  };

  const stat = useMemo(() => {
    const totalPlan = enriched.reduce((s, r) => s + STEPS.filter(st => planDate(r.contractDate, st) <= today).length, 0);
    const totalDone = enriched.reduce((s, r) => s + STEPS.filter(st => (r.done || {})[st.key] && planDate(r.contractDate, st) <= today).length, 0);
    return {
      cust: enriched.length,
      over: enriched.filter(r => r.next?.over).length,
      soon: enriched.filter(r => r.next?.soon).length,
      rate: totalPlan ? Math.round(totalDone / totalPlan * 100) : 0,
    };
  }, [enriched, today]);

  /* ── スタッフ別の取り組み度 ── */
  const byStaff = useMemo(() => {
    const m = {};
    enriched.forEach(r => {
      const k = norm(r.staffName) || '（未設定）';
      const o = m[k] || (m[k] = { name: r.staffName || '（未設定）', store: r.storeId, cust: 0, sim: 0, plan: 0, done: 0, onTime: 0, over: 0, res: {}, resTotal: 0 });
      o.cust++; if (r.simOnly) o.sim++;
      if (r.next?.over) o.over++;
      STEPS.forEach(st => {
        const pd = planDate(r.contractDate, st);
        if (pd && pd <= today) {
          o.plan++;
          const lg = (r.log || {})[st.key];
          if ((r.done || {})[st.key]) {
            o.done++;
            if (lg?.onTime) o.onTime++;
            if (lg?.result && lg.result !== 'なし') { o.res[lg.result] = (o.res[lg.result] || 0) + 1; o.resTotal++; }
          }
        }
      });
    });
    return Object.values(m).map(o => ({
      ...o,
      rate: o.plan ? Math.round(o.done / o.plan * 100) : null,
      onTimeRate: o.done ? Math.round(o.onTime / o.done * 100) : null,
      convRate: o.done ? Math.round(o.resTotal / o.done * 100) : null,
    })).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.resTotal - a.resTotal);
  }, [enriched, today]);

  /* ── 新規登録 ── */
  const blank = () => ({
    name: '', tel: '', contractDate: today, staffName: me, storeId: myStore || homeStore,
    simOnly: false, eventName: '', plan: '', family: '', memo: '',
    gold: false, hikari: false, denki: false,
  });
  const save = async () => {
    if (!form?.name || !form?.contractDate) { alert('お客様名と契約日を入れてください'); return; }
    setSaving(true);
    try {
      const id = `${form.contractDate}_${norm(form.name)}_${Date.now()}`;
      await setDoc(doc(db, 'customers', id), { ...form, done: {}, log: {}, createdAt: Timestamp.now() });
      setForm(null); setTab('store');
    } catch (e) { alert('保存できませんでした: ' + e.message); }
    setSaving(false);
  };

  /* ── 接触を「済」にする ── */
  const markDone = async (r, key, result, note) => {
    const pd = planDate(r.contractDate, STEPS.find(s => s.key === key));
    try {
      await updateDoc(doc(db, 'customers', r.id), {
        [`done.${key}`]: true,
        [`log.${key}`]: { date: today, by: me, note: note || '', result: result || 'なし', onTime: today <= pd },
      });
      setDoneForm(null);
    } catch (e) { alert('更新できませんでした: ' + e.message); }
  };
  const undo = async (r, key) => {
    try { await updateDoc(doc(db, 'customers', r.id), { [`done.${key}`]: false }); }
    catch (e) { alert(e.message); }
  };

  /* ───────── 表示 ───────── */
  const badge = (r) => {
    if (r.finished) return <span style={{ ...pill, background: 'rgba(52,211,153,0.15)', color: C.green }}>完了</span>;
    if (r.next.over) return <span style={{ ...pill, background: 'rgba(248,113,113,0.18)', color: C.red }}>期限超過</span>;
    if (r.next.soon) return <span style={{ ...pill, background: 'rgba(251,191,36,0.15)', color: C.gold }}>今週</span>;
    return <span style={{ ...pill, background: 'rgba(255,255,255,0.06)', color: C.mut }}>予定</span>;
  };

  const list = tab === 'todo' ? todo : tab === 'mine' ? mine : all;

  return (
    <div style={{ padding: '8px 16px 80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', margin: 0 }}>👥 顧客管理</h1>
        {canSeeAll
          ? <select value={viewStore} onChange={e => setViewStore(e.target.value)} style={{ ...inp, width: 'auto', marginBottom: 0, padding: '5px 8px', fontSize: 11 }}>
              <option value="">全店</option>
              {MAIN_STORES.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          : <div style={{ fontSize: 11, color: C.mut }}>{storeName(myStore) || '—'}</div>}
      </div>

      {/* 店舗の状況 */}
      <div style={{ ...card, display: 'flex', gap: 8, textAlign: 'center' }}>
        {[['顧客数', stat.cust, '#fff'], ['期限超過', stat.over, C.red], ['今週', stat.soon, C.gold], ['接触率', stat.rate + '%', C.green]].map(([l, v, c]) => (
          <div key={l} style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.mut }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      {/* タブ */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[['todo', `やること ${todo.length}`], ['mine', `自分 ${mine.length}`], ['store', `全体 ${all.length}`], ['staff', 'スタッフ別']].map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k); setEditing(null); }}
            style={{ flex: 1, padding: '8px 4px', borderRadius: 10, fontSize: 11, fontWeight: 800, cursor: 'pointer',
              border: tab === k ? '1px solid rgba(251,191,36,0.4)' : C.line,
              background: tab === k ? 'rgba(251,191,36,0.12)' : 'transparent',
              color: tab === k ? C.gold : C.mut }}>{l}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={() => { setForm(blank()); setEditing(null); }}
          style={{ flex: 1, padding: 12, borderRadius: 12, border: 'none',
            background: C.gold, color: '#000', fontSize: 13, fontWeight: 900, cursor: 'pointer' }}>
          ＋ お客様を登録する
        </button>
        {tab !== 'staff' && (
          <button onClick={exportList}
            style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(52,211,153,0.4)',
              background: 'rgba(52,211,153,0.12)', color: C.green, fontSize: 12, fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            📥 架電リスト
          </button>
        )}
      </div>
      {tab === 'store' && staffOptions.length > 0 && (
        <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)} style={{ ...inp, marginBottom: 10 }}>
          <option value="">担当者：全員（{enriched.length}名）</option>
          {staffOptions.map(n => <option key={n} value={n}>担当者：{n}（{enriched.filter(r => norm(r.staffName) === norm(n)).length}名）</option>)}
        </select>
      )}

      {/* 新規登録フォーム */}
      {form && (
        <div style={{ ...card, border: '1px solid rgba(251,191,36,0.3)' }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: C.gold, marginBottom: 8 }}>お客様の登録</div>
          {[['name', 'お客様名（必須）'], ['tel', 'ご連絡先'], ['eventName', '獲得イベント'], ['plan', 'プラン'], ['family', 'ご家族の台数']].map(([k, ph]) => (
            <input key={k} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} placeholder={ph}
              style={inp} />
          ))}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={lbl}>契約日（必須）</div>
              <input type="date" value={form.contractDate} onChange={e => setForm({ ...form, contractDate: e.target.value })} style={{ ...inp, marginBottom: 0 }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={lbl}>担当</div>
              <select value={form.staffName} onChange={e => setForm({ ...form, staffName: e.target.value })} style={{ ...inp, marginBottom: 0 }}>
                {STAFF.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            {[['simOnly', 'SIM単（端末なし）'], ['gold', 'ゴールド済'], ['hikari', 'ひかり済'], ['denki', 'でんき済']].map(([k, l]) => (
              <label key={k} style={{ fontSize: 11, color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={!!form[k]} onChange={e => setForm({ ...form, [k]: e.target.checked })} />{l}
              </label>
            ))}
          </div>
          <textarea value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })} placeholder="メモ（お客様の状況・約束したこと）"
            style={{ ...inp, minHeight: 56 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} style={{ flex: 1, padding: 11, borderRadius: 10, border: 'none', background: C.green, color: '#000', fontWeight: 900, fontSize: 12, cursor: 'pointer' }}>
              {saving ? '保存中…' : '登録する'}
            </button>
            <button onClick={() => setForm(null)} style={{ padding: '11px 18px', borderRadius: 10, border: C.line, background: 'transparent', color: C.mut, fontSize: 12, cursor: 'pointer' }}>やめる</button>
          </div>
        </div>
      )}

      {/* スタッフ別 */}
      {tab === 'staff' && (
        <div>
          <div style={{ fontSize: 10.5, color: C.mut, marginBottom: 8, lineHeight: 1.6 }}>
            接触率＝予定日が来た接触のうち済にした割合／期限内率＝済のうち予定日までに実施した割合／成果率＝済のうち何かが生まれた割合。<br />
            <b style={{ color: C.gold }}>接触率が高く、成果率も高い人が「顧客管理ができている人」</b>です。顧客数だけでは判断しません。
          </div>
          {byStaff.length === 0 && <div style={{ ...card, textAlign: 'center', color: C.mut2, fontSize: 12, padding: 20 }}>まだ顧客が登録されていません</div>}
          {byStaff.map((o, i) => {
            const rc = o.rate == null ? C.mut2 : o.rate >= 80 ? C.green : o.rate >= 50 ? C.gold : C.red;
            const vc = o.convRate == null ? C.mut2 : o.convRate >= 30 ? C.green : o.convRate >= 15 ? C.gold : C.red;
            const resTxt = Object.entries(o.res).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join('・');
            return (
              <div key={o.name} style={{ ...card, borderLeft: `3px solid ${rc}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <span style={{ fontSize: 11, color: C.mut, marginRight: 6 }}>{i + 1}</span>
                    <span style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>{o.name}</span>
                    {canSeeAll && !viewStore && <span style={{ fontSize: 10, color: C.mut2, marginLeft: 6 }}>{storeName(o.store)}</span>}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: rc }}>{o.rate == null ? '—' : o.rate + '%'}<span style={{ fontSize: 9, color: C.mut, marginLeft: 3 }}>接触率</span></div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, textAlign: 'center' }}>
                  {[['顧客', o.cust, '#fff'], ['SIM単', o.sim, C.blue], ['予定', o.plan, C.mut], ['済', o.done, C.green],
                    ['期限内', o.onTimeRate == null ? '—' : o.onTimeRate + '%', o.onTimeRate >= 70 ? C.green : C.gold],
                    ['超過中', o.over, o.over > 0 ? C.red : C.mut2],
                    ['成果率', o.convRate == null ? '—' : o.convRate + '%', vc]].map(([l, v, c]) => (
                    <div key={l} style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '5px 2px' }}>
                      <div style={{ fontSize: 8.5, color: C.mut }}>{l}</div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: c }}>{v}</div>
                    </div>
                  ))}
                </div>
                {resTxt && <div style={{ fontSize: 10.5, color: C.green, marginTop: 6 }}>生まれた成果：{resTxt}（計{o.resTotal}件）</div>}
                {o.over > 0 && <div style={{ fontSize: 10.5, color: C.red, marginTop: 4 }}>期限超過が{o.over}件。まずここから。</div>}
                {o.plan > 0 && o.done === 0 && <div style={{ fontSize: 10.5, color: C.red, marginTop: 4 }}>登録はあるが1件も接触していません。</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* 一覧 */}
      {tab !== 'staff' && list.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: C.mut2, fontSize: 12, padding: 24 }}>
          {tab === 'todo' ? '今週やることはありません' : 'お客様がまだ登録されていません'}
        </div>
      )}

      {tab !== 'staff' && list.map(r => (
        <div key={r.id} style={{ ...card, borderLeft: r.next?.over ? `3px solid ${C.red}` : (r.next?.soon ? `3px solid ${C.gold}` : C.line) }}>
          <div onClick={() => setEditing(editing === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>{r.name}</span>
                {r.simOnly && <span style={{ ...pill, background: 'rgba(56,189,248,0.15)', color: C.blue, marginLeft: 6 }}>SIM単</span>}
              </div>
              {badge(r)}
            </div>
            <div style={{ fontSize: 10.5, color: C.mut, marginTop: 4 }}>
              契約 {fmt(r.contractDate)}／担当 {r.staffName}／{r.doneCount}/6回 済
              {r.tel ? `／${r.tel}` : ''}
            </div>
            {r.next && (
              <div style={{ fontSize: 11.5, marginTop: 6, color: r.next.over ? C.red : (r.next.soon ? C.gold : C.mut) }}>
                次：{r.next.step.label}（{fmt(r.next.date)}）{r.next.step.purpose}
              </div>
            )}
          </div>

          {/* 詳細 */}
          {editing === r.id && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: C.line }}>
              {r.memo && <div style={{ fontSize: 11, color: C.mut, marginBottom: 8 }}>メモ：{r.memo}</div>}
              <div style={{ fontSize: 10.5, color: C.mut, marginBottom: 8 }}>
                付帯：{[r.gold && 'ゴールド', r.hikari && 'ひかり', r.denki && 'でんき'].filter(Boolean).join('・') || '未加入'}
                {r.plan ? `／${r.plan}` : ''}{r.family ? `／家族${r.family}台` : ''}
              </div>
              {STEPS.map(s => {
                const pd = planDate(r.contractDate, s);
                const done = (r.done || {})[s.key];
                const log = (r.log || {})[s.key];
                return (
                  <div key={s.key} style={{ padding: '8px 10px', borderRadius: 8, marginBottom: 6,
                    background: done ? 'rgba(52,211,153,0.08)' : (pd < today ? 'rgba(248,113,113,0.06)' : 'rgba(255,255,255,0.03)') }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: done ? C.green : '#fff' }}>
                        {s.label}　{fmt(pd)}　{done ? '✓ 済' : (pd < today ? '未対応' : '')}
                      </div>
                      {done
                        ? <button onClick={() => undo(r, s.key)} style={miniBtn(C.mut2)}>戻す</button>
                        : <button onClick={() => setDoneForm({ id: r.id, key: s.key, result: 'なし', note: '' })} style={miniBtn(C.green)}>済にする</button>}
                    </div>
                    {doneForm && doneForm.id === r.id && doneForm.key === s.key && (
                      <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)' }}>
                        <div style={lbl}>この接触で生まれたもの</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                          {RESULTS.map(rs => (
                            <button key={rs} onClick={() => setDoneForm({ ...doneForm, result: rs })}
                              style={{ padding: '4px 9px', borderRadius: 999, fontSize: 10, fontWeight: 800, cursor: 'pointer',
                                border: doneForm.result === rs ? '1px solid ' + C.green : C.line,
                                background: doneForm.result === rs ? 'rgba(52,211,153,0.2)' : 'transparent',
                                color: doneForm.result === rs ? C.green : C.mut }}>{rs}</button>
                          ))}
                        </div>
                        <input value={doneForm.note} onChange={e => setDoneForm({ ...doneForm, note: e.target.value })} placeholder="内容・次の約束（任意）" style={{ ...inp, marginBottom: 6 }} />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => markDone(r, s.key, doneForm.result, doneForm.note)} style={{ flex: 1, padding: 8, borderRadius: 8, border: 'none', background: C.green, color: '#000', fontWeight: 900, fontSize: 11, cursor: 'pointer' }}>記録する</button>
                          <button onClick={() => setDoneForm(null)} style={{ padding: '8px 12px', borderRadius: 8, border: C.line, background: 'transparent', color: C.mut, fontSize: 11, cursor: 'pointer' }}>やめる</button>
                        </div>
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: C.mut2, marginTop: 3 }}>{s.purpose}</div>
                    {!done && <div style={{ fontSize: 10.5, color: C.mut, marginTop: 4, lineHeight: 1.5 }}>{s.talk}</div>}
                    {log && <div style={{ fontSize: 10, color: C.green, marginTop: 4 }}>{fmt(log.date)} {log.by}{log.result && log.result !== 'なし' ? `／成果：${log.result}` : ''}{log.onTime === false ? '／期限後' : ''}：{log.note || '対応済み'}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      <div style={{ fontSize: 10, color: C.mut2, lineHeight: 1.7, marginTop: 14 }}>
        ※ 売るための電話ではなく、状態を確認する電話です。困っていることを先に見つけるのが担当者の仕事です。<br />
        ※ 顧客は店舗全員で共有します。担当者が不在でも、気づいた人が対応してください。<br />
        ※ ②1ヶ月後と③半年後を飛ばすと「忘れられた顧客」になります。
      </div>
    </div>
  );
}

const inp = { width: '100%', padding: '9px 10px', marginBottom: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 12, boxSizing: 'border-box' };
const lbl = { fontSize: 10, color: '#94A3B8', marginBottom: 3 };
const pill = { padding: '2px 8px', borderRadius: 999, fontSize: 9.5, fontWeight: 800 };
const miniBtn = (c) => ({ padding: '4px 10px', borderRadius: 8, border: 'none', background: c === '#64748B' ? 'rgba(255,255,255,0.06)' : 'rgba(52,211,153,0.15)', color: c, fontSize: 10, fontWeight: 800, cursor: 'pointer' });
