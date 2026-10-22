import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, setDoc, doc, onSnapshot, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { useDirectory } from '../contexts/DirectoryContext';

// =====================================================================
// 期間限定キャンペーンの集計と確定（管理者・経理だけ）
//
// 考え方：
//  ・ここで「確定」を押した金額だけが給与に乗ります。
//  ・確定した金額はそのまま保存されるので、後から報告を直しても動きません。
//    （給与は一度決まったら変わらない、が一番大事なため）
//  ・支払月＝キャンペーン終了日が入っている月の、翌月25日
//    例）8/15〜8/16に終わったもの → 9月25日払い
// =====================================================================

const C = { gold: '#FBBF24', green: '#34D399', blue: '#38BDF8', red: '#F87171',
            purple: '#A78BFA', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const yen = (n) => '¥' + Number(n || 0).toLocaleString();
const norm = (s) => (s || '').replace(/[\s\u3000]+/g, '');
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// 支払月を出す（終了日の翌月）
const payMonthOf = (endDate) => {
  const [y, m] = endDate.split('-').map(Number);
  const d = new Date(y, m, 1);           // m は1始まりなので、これで「翌月」になる
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};

// ---- キャンペーンの型（ここを選ぶだけで集計方法が変わる）----
const TYPES = {
  // 8/15〜8/16 型：個人ごと・ゴールド必須・カードで満額
  gold_required: {
    label: 'ゴールド必須型（8/15〜16と同じ）',
    desc: 'ゴールド30%必須。カード合計60%で満額、届かなければ半額。',
    calc: (p, o) => {
      const nm = p.shinki + p.mnp;
      const cardAll = p.gold + p.card;
      const gRate = nm > 0 ? p.gold / nm * 100 : 0;
      const cRate = nm > 0 ? cardAll / nm * 100 : 0;
      const okCount = (nm >= o.needCount) || (p.kihen >= o.needCount);
      const okGold = gRate >= o.goldRate;
      const okCard = cRate >= o.cardRate;
      const stake = p.shinki * o.unitShinki + p.mnp * o.unitMnp;
      let pay = 0;
      if (okCount && okGold) pay = okCard ? stake : Math.round(stake * 0.5);
      return { pay, note: !okCount ? '台数不足' : !okGold ? 'ゴールド不足' : okCard ? '満額' : '半額',
               detail: `G${gRate.toFixed(0)}% C${cRate.toFixed(0)}%` };
    },
  },
  // 単純に台数×単価（条件なし）
  // 9月スタートアップ型：店舗（店舗＋イベント）の件数でバー、5条件全部で単価。外注は件数・率に入り支払いなし
  bar5: {
    label: '店舗バー＋5条件型（9/4〜9/8と同じ）',
    desc: '店舗＋イベントの合計で判定。新規MNP件数でバー（40/35/25）、5つの率が全部そろえば単価確定。外注は件数に入るが支払いは社員のみ。',
    calc: null,   // 店舗単位なので下の集計で別処理
  },
  simple: {
    label: '台数 × 単価（条件なし）',
    desc: '新規・MNPの台数に単価をかけるだけ。',
    calc: (p, o) => ({ pay: p.shinki * o.unitShinki + p.mnp * o.unitMnp, note: '—',
                       detail: `新規${p.shinki} MNP${p.mnp}` }),
  },
};

// 商材の分類（通常ルール）
const SEP = {
  bars: [{ count: 40, unit: 10000 }, { count: 35, unit: 7000 }, { count: 25, unit: 5000 }],
  conds: [
    { id: 'maneki', label: 'マネ活2',        rate: 60 },
    { id: 'gold',   label: 'ゴールド',        rate: 30 },
    { id: 'bank',   label: 'じぶん銀行セット', rate: 40 },
    { id: 'denki',  label: 'auでんき受付',    rate: 15 },
    { id: 'ponta',  label: 'Pontaパス',       rate: 80 },
  ],
  storeGroups: ['STORE_002', 'STORE_003', 'STORE_001'],
  eventHost: { STORE_007: 'STORE_002', STORE_008: 'STORE_003', STORE_009: 'STORE_001' },
  storeOverride: { '鈴木一生': 'STORE_001' },
  midShinki: ['MID_001','MID_002','MID_005','MID_006','MID_007','MID_008','MID_011','MID_012'],
  midMnp:    ['MID_017','MID_018','MID_019','MID_020'],
  auSohan: ['MID_001','MID_002','MID_003','MID_004','MID_005','MID_006','MID_017','MID_018','MID_021','MID_022'],
  uqSohan: ['MID_007','MID_008','MID_009','MID_010','MID_011','MID_012','MID_019','MID_020','MID_023','MID_024'],
  midGold: 'MID_041', midBank: 'MID_044', midDenki: 'MID_045',
  planManeki: ['P_136', 'P_108'], optPonta: 'OPT_115',
};

const MID = {
  shinki: ['MID_001', 'MID_002', 'MID_005', 'MID_006', 'MID_007', 'MID_008', 'MID_011', 'MID_012'],
  mnp:    ['MID_017', 'MID_018', 'MID_019', 'MID_020'],
  kihen:  ['MID_021', 'MID_022', 'MID_023', 'MID_024'],
  gold:   ['MID_041'],
  card:   ['MID_043'],
};

export default function CampaignPayout() {
  const { user } = useAuth();
  const { staffNames, staffStoreOf, storeNameOf, mainStores } = useDirectory();

  const [name, setName] = useState('9月スタートアップ');
  const [start, setStart] = useState('2026-09-04');
  const [end, setEnd] = useState('2026-09-09');
  const [type, setType] = useState('bar5');
  const [opt, setOpt] = useState({ needCount: 2, goldRate: 30, cardRate: 60, unitShinki: 3000, unitMnp: 5000 });
  const [targetStores, setTargetStores] = useState([]);   // 対象にする獲得場所
  const [reports, setReports] = useState(null);
  const [snapCond, setSnapCond] = useState(null);   // 集計した時点の条件（結果とずれないように固定）
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState([]);
  const [savedList, setSavedList] = useState([]);

  // 確定済みのキャンペーン一覧
  useEffect(() => {
    if (!user) return;
    const u = onSnapshot(query(collection(db, 'campaignPayouts')), s =>
      setSavedList(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.end || '').localeCompare(a.end || ''))));
    return () => u();
  }, [user]);

  // 最初は主要店舗をすべて対象にしておく
  useEffect(() => {
    if (targetStores.length === 0 && mainStores.length > 0) setTargetStores(mainStores.map(s => s.id));
  }, [mainStores]);

  // 条件を触ったら、前の集計結果は消す（古い結果を見たまま確定するのを防ぐ）
  useEffect(() => {
    if (reports) { setReports(null); setSnapCond(null); }
  }, [start, end, type, opt, targetStores, name]);

  const payMonth = useMemo(() => payMonthOf(end), [end]);

  // 期間の報告を取りに行く
  const load = async () => {
    setLoading(true); setReports(null);
    try {
      const [sy, sm, sd] = start.split('-').map(Number);
      const [ey, em, ed] = end.split('-').map(Number);
      const from = new Date(sy, sm - 1, sd, 0, 0, 0);
      const to = new Date(ey, em - 1, ed + 1, 0, 0, 0);
      const snap = await getDocs(query(collection(db, 'reports'),
        where('createdAt', '>=', from), where('createdAt', '<', to)));
      setReports(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      // このボタンを押した時点の条件をそのまま覚えておく（あとで入力欄を触っても結果表示は変わらない）
      setSnapCond({ name, start, end, type, opt: { ...opt }, payMonth: payMonthOf(end),
                    stores: targetStores.map(id => storeNameOf(id)) });
    } catch (e) {
      alert('データの取得に失敗しました。通信環境を確認して、もう一度お試しください。');
    }
    setLoading(false);
  };

  // 集計する
  // ===== 9月型：店舗ごとにバーと5条件を判定 =====
  const sepStores = useMemo(() => {
    if (!reports || type !== 'bar5') return null;
    const midsOf = (l) => (Array.isArray(l.midCats) && l.midCats.length ? l.midCats : [l.midCat]).filter(Boolean);
    const ST = {};
    SEP.storeGroups.forEach(sid => { ST[sid] = { sid, name: storeNameOf(sid), nm: 0, nmOut: 0, auSohan: 0, sohan: 0, maneki: 0, gold: 0, bank: 0, denki: 0, ponta: 0, people: {} }; });
    reports.forEach(r => {
      const isOut = r.counted === false;
      const who = norm(r.proxyStaff || r.staffName); if (!who) return;
      let sid = null;
      if (!isOut) sid = SEP.storeOverride[who] || staffStoreOf(who) || null;
      if (!sid) sid = SEP.eventHost[r.storeId] || r.storeId;
      const st = ST[sid]; if (!st) return;
      (r.lines || []).forEach(l => {
        const mids = midsOf(l);
        const plans = Array.isArray(l.plans) ? l.plans : [];
        const opts = Array.isArray(l.opts) ? l.opts : [];
        const isAu = mids.some(m => SEP.auSohan.includes(m));
        const isUq = mids.some(m => SEP.uqSohan.includes(m));
        const isNM = mids.some(m => SEP.midShinki.includes(m) || SEP.midMnp.includes(m));
        if (isAu) st.auSohan++;
        if (isAu || isUq) { st.sohan++; if (opts.includes(SEP.optPonta)) st.ponta++; }
        if (isAu && plans.some(pl => SEP.planManeki.includes(pl))) st.maneki++;
        if (mids.includes(SEP.midGold)) st.gold++;
        if (mids.includes(SEP.midBank)) st.bank++;
        if (mids.includes(SEP.midDenki)) st.denki++;
        if (isNM) { st.nm++; if (isOut) st.nmOut++; else st.people[who] = (st.people[who] || 0) + 1; }
      });
    });
    return SEP.storeGroups.map(sid => {
      const st = ST[sid];
      const bar = SEP.bars.find(b => st.nm >= b.count) || null;
      const conds = SEP.conds.map(c => {
        const num = st[c.id];
        const den = (c.id === 'maneki' || c.id === 'gold') ? st.auSohan : c.id === 'bank' ? st.gold : st.sohan;
        const pct = den > 0 ? num / den * 100 : 0;
        return { ...c, num, den, pct, ok: den > 0 && pct >= c.rate, need: Math.max(0, Math.ceil(den * c.rate / 100) - num) };
      });
      const okCount = conds.filter(c => c.ok).length;
      const unit = (bar && okCount === conds.length) ? bar.unit : 0;
      return { ...st, bar, conds, okCount, unit };
    });
  }, [reports, type, staffStoreOf, storeNameOf]);

  const rows = useMemo(() => {
    if (!reports) return null;
    if (type === 'bar5') {
      if (!sepStores) return [];
      const out = [];
      sepStores.forEach(st => {
        Object.entries(st.people).forEach(([name, n]) => {
          out.push({ name, storeId: st.sid, storeNm: st.name, shinki: 0, mnp: n, kihen: 0, gold: 0, card: 0,
                     pay: n * st.unit, note: st.unit > 0 ? '確定' : (st.bar ? '条件不足' : 'バー未達'),
                     detail: `${st.name} ${st.nm}件 条件${st.okCount}/5` });
        });
      });
      return out.sort((a, b) => b.pay - a.pay || b.mnp - a.mnp);
    }
    const P = {};
    const get = (n) => (P[n] = P[n] || { name: n, shinki: 0, mnp: 0, kihen: 0, gold: 0, card: 0 });
    reports.forEach(r => {
      if (r.counted === false) return;               // 外注は対象外
      // 獲得場所で絞る（イベント会場・サテライト・アットモバイルなどを外せる）
      if (targetStores.length > 0 && !targetStores.includes(r.storeId)) return;
      const who = norm(r.proxyStaff || r.staffName);
      if (!who) return;
      const p = get(who);
      (r.lines || []).forEach(l => {
        const m = l.midCat;
        if (MID.shinki.includes(m)) p.shinki++;
        else if (MID.mnp.includes(m)) p.mnp++;
        else if (MID.kihen.includes(m)) p.kihen++;
        else if (MID.gold.includes(m)) p.gold++;
        else if (MID.card.includes(m)) p.card++;
      });
    });
    const fn = TYPES[type].calc;
    return Object.values(P).map(p => {
      const r = fn(p, opt);
      const sid = staffStoreOf(p.name) || '';
      return { ...p, ...r, storeId: sid, storeNm: sid ? storeNameOf(sid) : '—' };
    }).filter(x => x.shinki || x.mnp || x.kihen)
      .sort((a, b) => b.pay - a.pay || b.mnp - a.mnp);
  }, [reports, type, opt, staffStoreOf, storeNameOf, targetStores, sepStores]);

  const total = useMemo(() => (rows || []).reduce((s, r) => s + r.pay, 0), [rows]);
  const winners = (rows || []).filter(r => r.pay > 0);

  // 確定して保存
  const commit = async () => {
    if (!rows || rows.length === 0) return;
    // 保存用の名前は「期間」だけで作る（日本語や記号を入れるとFirestoreが受け付けないため）
    const id = 'c_' + start.replace(/-/g, '') + '_' + end.replace(/-/g, '');
    if (!window.confirm(
      `「${name}」を確定します。\n\n` +
      `対象 ${winners.length}名 ／ 支給総額 ${yen(total)}\n` +
      `支払い：${payMonth.replace('-', '年')}月25日\n\n` +
      `確定するとこの金額が保存され、あとで報告を直しても変わりません。\n` +
      `よろしいですか？`)) return;
    try {
      await setDoc(doc(db, 'campaignPayouts', id), {
        name: String(name || '無題'), start, end, type,
        opt: {
          needCount: Number(opt.needCount) || 0,
          goldRate: Number(opt.goldRate) || 0,
          cardRate: Number(opt.cardRate) || 0,
          unitShinki: Number(opt.unitShinki) || 0,
          unitMnp: Number(opt.unitMnp) || 0,
        },
        payMonth,
        stores: targetStores.map(sid => String(storeNameOf(sid) || sid)),
        total: Number(total) || 0,
        count: winners.length,
        payouts: winners.map(r => ({
          name: String(r.name || ''),
          storeId: String(r.storeId || ''),
          pay: Number(r.pay) || 0,
          note: String(r.note || ''),
        })),
        committedAt: serverTimestamp(),
      });
      setSaved([...saved, id]);
      alert('確定しました。\n給与反映用の月次一覧に、' + payMonth + ' の支払いとして表示されます。');
    } catch (e) {
      alert('保存に失敗しました。\n\n' + (e?.message || e) + '\n\nこの内容をそのまま伝えてもらえれば原因が分かります。');
    }
  };

  const exportCsv = () => {
    if (!rows) return;
    const c = snapCond || { name, start, end, stores: [] };
    const lines = [
      ['キャンペーン名', c.name].join(','),
      ['期間', c.start + '〜' + c.end].join(','),
      ['支払い', (c.payMonth || '').replace('-', '年') + '月25日'].join(','),
      ['集計した場所', (c.stores || []).join('・')].join(','),
      ['ルール', TYPES[c.type || type].label].join(','),
      '',
    ];
    const head = ['名前', '店', '新規', 'MNP', '機変', 'ゴールド', 'カード', '判定', '内訳', '支給'];
    lines.push(head.join(','));
    rows.forEach(r => lines.push([r.name, r.storeNm, r.shinki, r.mnp, r.kihen, r.gold, r.card, r.note, r.detail, r.pay].join(',')));
    lines.push(['合計', '', '', '', '', '', '', '', '', total].join(','));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'キャンペーン集計_' + c.name + '_' + c.start + '〜' + c.end + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const removeSaved = async (id, nm) => {
    if (!window.confirm(`「${nm}」の確定を取り消します。\n給与一覧からも消えます。よろしいですか？`)) return;
    await deleteDoc(doc(db, 'campaignPayouts', id));
  };

  const inp = { padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box', width: '100%' };
  const lbl = { fontSize: 10.5, color: C.mut, fontWeight: 700, marginBottom: 4, display: 'block' };
  const th = { padding: '8px 6px', fontSize: 10, color: C.mut, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.1)' };
  const thL = { ...th, textAlign: 'left' };
  const td = { padding: '8px 6px', fontSize: 12, color: C.w2, textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.04)' };
  const tdL = { ...td, textAlign: 'left' };
  const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 12 };

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>🎯 キャンペーンの集計と確定</h1>
      <div style={{ fontSize: 10, color: C.mut2, marginBottom: 12, lineHeight: 1.6 }}>
        ここで「確定」を押した金額だけが給与に乗ります。確定後は、報告を直しても金額は変わりません。<br />
        支払いは<b style={{ color: C.gold }}>終了日の翌月25日</b>です。
      </div>

      {/* 条件を決める */}
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.gold, marginBottom: 10 }}>① 条件を入れる</div>
        <label style={lbl}>キャンペーン名</label>
        <input value={name} onChange={e => setName(e.target.value)} style={{ ...inp, marginBottom: 10 }} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1 }}><label style={lbl}>開始日</label><input type="date" value={start} onChange={e => setStart(e.target.value)} style={inp} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>終了日</label><input type="date" value={end} onChange={e => setEnd(e.target.value)} style={inp} /></div>
        </div>
        <div style={{ fontSize: 11, color: C.purple, marginBottom: 10, padding: '7px 10px', background: 'rgba(167,139,250,0.08)', borderRadius: 8 }}>
          → 支払いは <b>{payMonth.split('-')[0]}年{Number(payMonth.split('-')[1])}月25日</b> になります
        </div>

        <label style={lbl}>計算のしかた</label>
        <select value={type} onChange={e => setType(e.target.value)} style={{ ...inp, marginBottom: 6 }}>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <div style={{ fontSize: 10, color: C.mut2, marginBottom: 10 }}>{TYPES[type].desc}</div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {type !== 'bar5' && (<>
          <div style={{ flex: '1 1 30%' }}><label style={lbl}>新規 単価</label><input type="number" value={opt.unitShinki} onChange={e => setOpt({ ...opt, unitShinki: +e.target.value })} style={inp} /></div>
          <div style={{ flex: '1 1 30%' }}><label style={lbl}>MNP 単価</label><input type="number" value={opt.unitMnp} onChange={e => setOpt({ ...opt, unitMnp: +e.target.value })} style={inp} /></div>
          </>)}
          {type === 'bar5' && <div style={{ fontSize: 10.5, color: C.mut, padding: '6px 0' }}>バー・5条件は固定です（40/35/25件、マネ活2 60%・ゴールド30%・じぶん銀行40%・でんき15%・Pontaパス80%）。店舗の絞り込みは自動（中道・日吉・上磯＋各イベント）。</div>}
          {type === 'gold_required' && (<>
            <div style={{ flex: '1 1 30%' }}><label style={lbl}>権利（台数）</label><input type="number" value={opt.needCount} onChange={e => setOpt({ ...opt, needCount: +e.target.value })} style={inp} /></div>
            <div style={{ flex: '1 1 30%' }}><label style={lbl}>ゴールド率 %</label><input type="number" value={opt.goldRate} onChange={e => setOpt({ ...opt, goldRate: +e.target.value })} style={inp} /></div>
            <div style={{ flex: '1 1 30%' }}><label style={lbl}>カード率 %</label><input type="number" value={opt.cardRate} onChange={e => setOpt({ ...opt, cardRate: +e.target.value })} style={inp} /></div>
          </>)}
        </div>

        <label style={{ ...lbl, marginTop: 12 }}>対象にする獲得場所（タップで選ぶ・外したものは集計に入りません）</label>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 4 }}>
          {mainStores.map(st => {
            const on = targetStores.includes(st.id);
            return (
              <span key={st.id} onClick={() => setTargetStores(on ? targetStores.filter(x => x !== st.id) : [...targetStores, st.id])}
                style={{ padding: '5px 11px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                         background: on ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.03)',
                         color: on ? C.green : C.mut2,
                         border: on ? '1px solid rgba(52,211,153,0.4)' : '1px solid rgba(255,255,255,0.08)' }}>
                {on ? '✓ ' : ''}{st.name}
              </span>
            );
          })}
        </div>
        <div style={{ fontSize: 9.5, color: C.mut2, marginBottom: 4, lineHeight: 1.6 }}>
          ※ ここに出ていない場所（各イベント会場・サテライト・アットモバイル）は<b>最初から集計に入りません</b>。<br />
          ※ サテライトなどから店舗へ送客し、店舗で成約した分は、獲得場所が店舗なので入ります。
        </div>

        <button onClick={load} disabled={loading} style={{ width: '100%', marginTop: 12, padding: 11, border: 'none', borderRadius: 10, background: C.blue, color: '#000', fontSize: 13, fontWeight: 900, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.5 : 1 }}>
          {loading ? '集計中…' : '② この条件で集計する'}
        </button>
      </div>

      {/* 集計結果 */}
      {rows && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.gold }}>③ 中身を確認する</div>
            <div style={{ fontSize: 11, color: C.mut }}>支給 {winners.length}名 ／ <b style={{ color: C.gold, fontSize: 14 }}>{yen(total)}</b></div>
          </div>
          {snapCond && (
            <div style={{ marginBottom: 11, padding: '11px 13px', borderRadius: 10, background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.3)' }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#fff', marginBottom: 5 }}>{snapCond.name}</div>
              <div style={{ fontSize: 11.5, color: C.blue, fontWeight: 700, marginBottom: 7 }}>
                📅 {snapCond.start} 〜 {snapCond.end}
                <span style={{ color: C.mut, fontWeight: 400 }}>（{Math.round((new Date(snapCond.end) - new Date(snapCond.start)) / 86400000) + 1}日間）</span>
                　→　支払い <b style={{ color: C.purple }}>{snapCond.payMonth.split('-')[0]}年{Number(snapCond.payMonth.split('-')[1])}月25日</b>
              </div>
              <div style={{ fontSize: 10.5, color: C.w2, lineHeight: 1.8, paddingTop: 7, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <b style={{ color: C.gold }}>ルール</b>　{TYPES[snapCond.type].label}<br />
                ・単価：新規 <b>{yen(snapCond.opt.unitShinki)}</b> ／ MNP <b>{yen(snapCond.opt.unitMnp)}</b>（1台あたり）<br />
                {snapCond.type === 'bar5' && (<>
                  ・バー：40件¥10,000／35件¥7,000／25件¥5,000（店舗＋イベントの新規MNP件数）<br />
                  ・条件：マネ活2 60%・ゴールド30%・じぶん銀行40%・でんき受付15%・Pontaパス80%（5つ全部）<br />
                  ・外注の獲得は件数・率に入る。支払いは社員のみ<br />
                </>)}
                {snapCond.type === 'gold_required' && (<>
                  ・権利：新規MNP <b>{snapCond.opt.needCount}台以上</b>、または機種変更 <b>{snapCond.opt.needCount}台以上</b><br />
                  ・必須：<b style={{ color: C.gold }}>ゴールド {snapCond.opt.goldRate}%以上</b>（無ければ0円）<br />
                  ・満額：さらに<b>カード合計 {snapCond.opt.cardRate}%以上</b>（ゴールドも枚数に含む）／ゴールドのみは半額<br />
                </>)}
                ・集計した場所：<b>{snapCond.stores.join('・') || '未選択'}</b><br />
                <span style={{ color: C.mut2, fontSize: 9.5 }}>※ 各イベント会場・外注は含みません</span>
              </div>
            </div>
          )}

          {type === 'bar5' && sepStores && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: C.gold, marginBottom: 6 }}>店舗ごとの判定（店舗＋イベント合算・外注含む）</div>
              {sepStores.map(st => (
                <div key={st.sid} style={{ padding: '10px 12px', borderRadius: 10, marginBottom: 7, background: st.unit > 0 ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.03)', border: st.unit > 0 ? '1px solid rgba(52,211,153,0.35)' : '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 900, color: '#fff' }}>{st.name}</span>
                    <span style={{ fontSize: 11, color: C.mut }}>新規MNP <b style={{ color: C.gold, fontSize: 15 }}>{st.nm}</b>件{st.nmOut ? `（外注${st.nmOut}）` : ''}　バー：<b style={{ color: st.bar ? C.green : C.red }}>{st.bar ? st.bar.count + '件 ' + yen(st.bar.unit) : '未達（25件未満）'}</b></span>
                  </div>
                  {st.conds.map(c => (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: C.w2, marginBottom: 2 }}>
                      <span>{c.ok ? '✓' : '×'} {c.label} <span style={{ color: C.mut2 }}>{c.num}/{c.den}</span></span>
                      <span style={{ fontWeight: 800, color: c.ok ? C.green : C.red }}>{c.pct.toFixed(0)}% <span style={{ color: C.mut2, fontWeight: 400 }}>/ {c.rate}%{!c.ok && c.den > 0 ? `　あと${c.need}` : ''}</span></span>
                    </div>
                  ))}
                  <div style={{ fontSize: 11.5, fontWeight: 900, marginTop: 5, color: st.unit > 0 ? C.green : C.red }}>
                    条件 {st.okCount}/5 → 単価 {st.unit > 0 ? yen(st.unit) + '/件' : '¥0'}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, marginBottom: 10 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520 }}>
              <thead><tr>
                <th style={thL}>名前</th><th style={thL}>店</th>
                <th style={th}>新規</th><th style={th}>MNP</th><th style={th}>機変</th>
                <th style={th}>G</th><th style={th}>カード</th>
                <th style={thL}>判定</th><th style={{ ...th, color: C.gold }}>支給</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.name} style={{ opacity: r.pay > 0 ? 1 : 0.45 }}>
                    <td style={tdL}>{r.name}</td>
                    <td style={{ ...tdL, fontSize: 10.5, color: C.mut }}>{r.storeNm}</td>
                    <td style={td}>{r.shinki}</td><td style={td}>{r.mnp}</td><td style={{ ...td, color: C.mut }}>{r.kihen}</td>
                    <td style={{ ...td, color: r.gold ? C.gold : C.mut2 }}>{r.gold}</td>
                    <td style={{ ...td, color: C.mut }}>{r.card}</td>
                    <td style={{ ...tdL, fontSize: 10, color: r.pay > 0 ? C.green : C.red }}>{r.note}<br /><span style={{ color: C.mut2 }}>{r.detail}</span></td>
                    <td style={{ ...td, color: r.pay > 0 ? C.gold : C.mut2, fontWeight: 800 }}>{yen(r.pay)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: C.mut }}>この期間のデータはありません</td></tr>}
              </tbody>
            </table>
          </div>

          <button onClick={exportCsv} style={{ width: '100%', padding: 10, marginBottom: 8, borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(56,189,248,0.12)', color: C.blue, border: '1px solid rgba(56,189,248,0.3)' }}>
            📥 この集計をCSVで書き出す
          </button>

          <button onClick={commit} disabled={winners.length === 0} style={{ width: '100%', padding: 12, border: 'none', borderRadius: 10, background: winners.length ? C.green : 'rgba(255,255,255,0.06)', color: winners.length ? '#000' : C.mut2, fontSize: 13, fontWeight: 900, cursor: winners.length ? 'pointer' : 'default' }}>
            ④ 確定して給与に反映する（{payMonth.split('-')[0]}年{Number(payMonth.split('-')[1])}月25日払い）
          </button>
          <div style={{ fontSize: 9.5, color: C.mut2, marginTop: 6, lineHeight: 1.6 }}>
            ※ 確定するとこの金額が保存されます。あとで報告を直しても、この金額は変わりません。<br />
            ※ 同じ期間・同じ名前でもう一度確定すると、上書きされます。
          </div>
        </div>
      )}

      {/* 確定済み一覧 */}
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.green, marginBottom: 10 }}>✅ 確定済みのキャンペーン</div>
        {savedList.length === 0 && <div style={{ fontSize: 11, color: C.mut }}>まだありません</div>}
        {savedList.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 9, background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.2)', marginBottom: 6 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#fff', fontWeight: 700 }}>{s.name}</div>
              <div style={{ fontSize: 10, color: C.mut }}>{s.start} 〜 {s.end}　／　{s.count}名　／　{s.payMonth?.split('-')[0]}年{Number(s.payMonth?.split('-')[1])}月25日払い</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 900, color: C.gold }}>{yen(s.total)}</div>
            <span onClick={() => removeSaved(s.id, s.name)} style={{ fontSize: 13, color: C.red, cursor: 'pointer', padding: '0 4px' }}>🗑</span>
          </div>
        ))}
      </div>
    </div>
  );
}
