import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, onSnapshot, doc, where } from 'firebase/firestore';
import { aggregate, creditStoreOf } from '../lib/aggregate';
import { TARGET_GROUPS, CATEGORIES } from '../data/targetGroups';
import { computePoints, YEN_PER_POINT } from '../lib/points';
import { planMix, essentialMetrics, ashiKiri, goldProgress, PLAN_CATS, PLAN_CAT_ORDER, ESSENTIAL_TARGETS, classifyLine, hasDevice, isMnp, isMobileLine } from '../lib/tactical';
import { MAIN_STORES, storeName, STAFF, staffStore } from '../data/masters';

const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const yen = (n) => '¥' + Number(n || 0).toLocaleString();
const C = { gold: '#FBBF24', green: '#34D399', purple: '#A78BFA', orange: '#FB923C', blue: '#38BDF8', red: '#F87171', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B', dim: '#475569' };
const catCol = { 'モバイル': C.gold, '固定商材': C.orange, 'LTV商材': C.purple, '物販(+1C)': C.green };
// 店舗別月間進捗の「項目別 達成率」用（リクープ=UQ番号移行は見づらいため非表示）
const PROGRESS_ITEMS = [
  { label: '新規', gids: ['g_au_o60', 'g_au_u18', 'g_uq_o60', 'g_uq_u18'] },
  { label: 'MNP', gids: ['g_au_mnp', 'g_uq_mnp'] },
  { label: '機変', gids: ['g_hs_au', 'g_hs_uq'] },
  { label: 'アップ', gids: ['g_up_au'] },
  { label: 'ひかり', gids: ['g_hikari'] },
  { label: 'BL光', gids: ['g_bl'] },
  { label: 'WiMAX', gids: ['g_wimax'] },
  { label: 'ゴールド', gids: ['g_paygold_au', 'g_paygold_uq'] },
];
const progColor = (p) => p == null ? C.dim : p >= 100 ? C.green : p >= 80 ? C.gold : C.red;
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };
const APP_VERSION = 'Ver 0.1'; // ← バージョン表記。修正してデプロイするたびに、この番号を上げる（0.1→0.2→0.3…）

export default function Home() {
  const { user, profile, logout } = useAuth();
  const nav = useNavigate();
  const [reports, setReports] = useState([]);
  const [storeTargets, setStoreTargets] = useState({}); // storeId → groupTargets
  const [pointConfig, setPointConfig] = useState(null); // pointConfig/main から読込
  const [excludedMids, setExcludedMids] = useState([]);
  const [showExport, setShowExport] = useState(false);
  const [exportItems, setExportItems] = useState(() => new Set(['category', 'staff', 'plus1c']));
  const [copied, setCopied] = useState(false);
  const [tacticalStore, setTacticalStore] = useState('all'); // 戦術ダッシュボードの店舗フィルタ
  const [detailStore, setDetailStore] = useState('STORE_001'); // 店舗別詳細の選択店舗
  const [detailTab, setDetailTab] = useState('kyoka'); // kyoka | all
  const [detailOpen, setDetailOpen] = useState(false); // 折りたたみ
  const [todayDetail, setTodayDetail] = useState(false); // 本日の内訳トグル
  const [monthDetail, setMonthDetail] = useState(false); // 月間の内訳トグル
  const today = ymd(new Date());
  const month = ym(new Date());
  const me = profile?.name || '';

  useEffect(() => {
    if (!user) return;
    // 当月1日 0:00 以降の報告だけ読み込む（軽量化・数字は当月/本日しか使わないため影響なし）
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const u1 = onSnapshot(query(collection(db, 'reports'), where('createdAt', '>=', monthStart)), s => setReports(s.docs.map(d => { const r = { id: d.id, ...d.data() }; const cd = r.createdAt?.toDate?.(); if (cd) r._month = ym(cd); return r; })));
    const u2 = onSnapshot(query(collection(db, 'storeTargets')), s => {
      const m = {};
      s.docs.forEach(d => { const v = d.data(); if (d.id.endsWith('_' + month)) m[d.id.replace('_' + month, '')] = v.groupTargets || {}; });
      setStoreTargets(m);
    });
    const u3 = onSnapshot(doc(db, 'pointConfig', 'main'), s => {
      if (s.exists()) {
        const data = s.data();
        // 保存されたitemsをcomputePoints用configに変換（labelとgrpはデフォルトから）
        const cfg = {}; const items = data.items || {};
        // POINT_ITEMSのキーを使う必要があるので、本ファイルでは詳細マージしない（生のitemsを渡す→未定義キーはcomputePoints側でフォールバック）
        // ここではenabled/pt/capのみオーバーライドの想定でそのまま渡す
        Object.keys(items).forEach(k => { cfg[k] = items[k]; });
        setPointConfig(cfg);
        setExcludedMids(data.excludedMids || []);
      } else {
        setPointConfig(null);
        setExcludedMids([]);
      }
    });
    return () => { u1(); u2(); u3(); };
  }, [user, month]);

  // 当月レポート（counted のみ）
  const monthReports = useMemo(() => reports.filter(r => r._month === month), [reports, month]);
  const todayReports = useMemo(() => reports.filter(r => { const d = r.createdAt?.toDate?.(); return d && ymd(d) === today; }), [reports, today]);

  // 全店合計（本日）
  const todayTotal = useMemo(() => aggregate(todayReports), [todayReports]);
  // 店舗別 本日
  const todayByStore = useMemo(() => MAIN_STORES.map(s => ({ store: s, ...aggregate(todayReports, { storeId: s.id }) })), [todayReports]);
  // 店舗別 月間
  const monthByStore = useMemo(() => MAIN_STORES.map(s => {
    const ag = aggregate(monthReports, { storeId: s.id });
    const tgt = storeTargets[s.id] || {};
    const totalTarget = TARGET_GROUPS.filter(g => g.unit === '件' && !g.internal).reduce((sum, g) => sum + (tgt[g.id] || 0), 0);
    const rate = totalTarget > 0 ? (ag.grandTotal / totalTarget * 100) : null;
    return { store: s, ag, totalTarget, rate };
  }), [monthReports, storeTargets]);
  // 全社合計 月間
  const monthAll = useMemo(() => aggregate(monthReports), [monthReports]);
  const monthAllTarget = monthByStore.reduce((s, x) => s + x.totalTarget, 0);
  const monthAllRate = monthAllTarget > 0 ? Math.round(monthAll.grandTotal / monthAllTarget * 1000) / 10 : null;

  // 今月ランキング (全社)
  const ranking = useMemo(() =>
    STAFF.map(name => ({ name, ...computePoints(reports, { month, staffName: name, config: pointConfig, excludedMids }) }))
      .filter(s => s.totalPoints > 0)
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, 5),
    [reports, month]);

  // 自分の今月の見込み（土台①のみ・詳細は報酬画面）
  const mine = useMemo(() => computePoints(reports, { month, staffName: me, config: pointConfig, excludedMids }), [reports, month, me, pointConfig, excludedMids]);
  const myStore = staffStore(me);

  // サンキューコール待機件数（自分・販売3日後以降で未完了）
  const tycDueCount = useMemo(() => {
    let n = 0;
    reports.forEach(r => {
      if (r.counted === false) return;
      if (r.tycStatus === 'done') return;
      const acq = r.proxyStaff || r.staffName;
      if (acq !== me) return;
      const cd = r.createdAt?.toDate?.();
      if (!cd) return;
      const elapsed = Math.round((Date.now() - cd.getTime()) / 86400000);
      if (elapsed < 0 || elapsed > 30) return;
      const def = new Date(cd); def.setDate(def.getDate() + 3); const defaultDue = ymd(def);
      const dueDate = r.tycSnoozeTo || defaultDue;
      if (dueDate <= today) n++;
    });
    return n;
  }, [reports, me, today]);

  // ───── 四半期戦術ダッシュボード ─────
  const tacOpts = useMemo(() => ({ month, storeId: tacticalStore === 'all' ? null : tacticalStore }), [month, tacticalStore]);
  const tactMix = useMemo(() => planMix(reports, tacOpts), [reports, tacOpts]);
  const tactEssen = useMemo(() => essentialMetrics(reports, tacOpts), [reports, tacOpts]);
  const tactAshi = useMemo(() => ashiKiri(reports, tacOpts), [reports, tacOpts]);
  const tactGold = useMemo(() => goldProgress(reports, tacOpts), [reports, tacOpts]);
  const tacScope = tacticalStore === 'all' ? '全店' : storeName(tacticalStore);

  // ───── 店舗別 詳細（タブで店舗切替して強化商材/全商材＋スタッフ別） ─────
  const detailData = useMemo(() => {
    // 項目別（店舗実績）は外注も含む。スタッフ別は下のstaffMapで外注を除外する。
    const storeReports = monthReports.filter(r => creditStoreOf(r) === detailStore);
    const cntMid = (mid) => { let c = 0; storeReports.forEach(r => (r.lines || []).forEach(l => { if (l.midCat === mid) c++; })); return c; };
    const cntMids = (mids) => { let c = 0; storeReports.forEach(r => (r.lines || []).forEach(l => { if (mids.includes(l.midCat)) c++; })); return c; };
    const cntMain = (mainId) => { let c = 0; storeReports.forEach(r => (r.lines || []).forEach(l => { if (l.mainCat === mainId) c++; })); return c; };
    const cntPlanMnpDev = (cat) => { let c = 0; storeReports.forEach(r => (r.lines || []).forEach(l => { if (classifyLine(l) === cat && isMnp(l) && hasDevice(l)) c++; })); return c; };
    const cntPlanCat = (cat) => { let c = 0; storeReports.forEach(r => (r.lines || []).forEach(l => { if (classifyLine(l) === cat && isMobileLine(l)) c++; })); return c; };
    const cntPontaLink = () => { let c = 0; storeReports.forEach(r => (r.lines || []).forEach(l => { if (isMobileLine(l) && l.pontaLink) c++; })); return c; };
    const cntMauLogin = () => { let c = 0; storeReports.forEach(r => (r.lines || []).forEach(l => { if (isMobileLine(l) && l.mauLogin) c++; })); return c; };
    const cntOptName = (names) => { let c = 0; storeReports.forEach(r => (r.lines || []).forEach(l => { if (isMobileLine(l) && (l.optNames || []).some(o => names.includes(o))) c++; })); return c; };

    // 強化商材（資料の重点項目を上に＝マネ活2優先）
    const kyokaItems = [
      { label: 'マネ活2 MNP端末', mid: '__premium_mane', count: cntPlanMnpDev('manekatsu2'), color: '#FBBF24', star: true },
      { label: 'マネ活2 全体',    mid: '__cat_mane',     count: cntPlanCat('manekatsu2'),    color: '#FBBF24' },
      { label: 'ゴールド新規',    mid: 'MID_041', count: cntMid('MID_041'), color: '#FBBF24' },
      { label: 'ゴールドRU',      mid: 'MID_042', count: cntMid('MID_042'), color: '#FBBF24' },
      { label: 'じぶん銀行',      mid: 'MID_044', count: cntMid('MID_044'), color: '#38BDF8' },
      { label: 'auでんき',        mid: 'MID_045', count: cntMid('MID_045'), color: '#34D399' },
      { label: 'KDDI内移行',      mid: '__kddi',  count: cntMids(['MID_025', 'MID_027']), color: '#FB923C' },
      { label: 'Ponta連携',       mid: '__ponta', count: cntPontaLink(), color: '#34D399' },
      { label: 'ログイン誘導',    mid: '__login', count: cntMauLogin(),  color: '#34D399' },
      { label: '保証',           mid: '__warr',  count: cntOptName(['故障紛失サポート', '故障紛失AppleCare', '故障紛失ワイドAppleCare']), color: '#A78BFA' },
      { label: 'Pontaパス',       mid: '__ppass', count: cntOptName(['Pontaパス']), color: '#FB923C' },
      { label: 'Smart TV',        mid: 'MID_037', count: cntMid('MID_037'), color: '#A78BFA' },
      { label: 'スマートウォッチ', mid: 'MID_060', count: cntMid('MID_060'), color: '#A78BFA' },
      { label: 'バスマット',      mid: 'MID_061', count: cntMid('MID_061'), color: '#A78BFA' },
      { label: 'スマートリング',   mid: 'MID_062', count: cntMid('MID_062'), color: '#A78BFA' },
    ];

    // 全商材
    const allItems = [
      { label: 'au新規',     mid: '__aushinki', count: cntMids(['MID_001','MID_002','MID_003','MID_004','MID_005','MID_006']), color: '#34D399' },
      { label: 'UQ新規',     mid: '__uqshinki', count: cntMids(['MID_007','MID_008','MID_009','MID_010','MID_011','MID_012']), color: '#34D399' },
      { label: 'auMNP',      mid: '__aumnp',    count: cntMids(['MID_017','MID_018']), color: '#FB923C' },
      { label: 'UQMNP',      mid: '__uqmnp',    count: cntMids(['MID_019','MID_020']), color: '#FB923C' },
      { label: 'au機変',     mid: '__aukishu',  count: cntMids(['MID_021','MID_022']), color: '#38BDF8' },
      { label: 'UQ機変',     mid: '__uqkishu',  count: cntMids(['MID_023','MID_024']), color: '#38BDF8' },
      { label: 'アップセル',  mid: '__upsell',   count: cntMain('MAIN_004'), color: '#E879F9' },
      { label: 'auひかり',   mid: 'MID_030',    count: cntMid('MID_030'), color: '#FB923C' },
      { label: 'BL光',       mid: 'MID_031',    count: cntMid('MID_031'), color: '#FB923C' },
      { label: 'WiMAX',      mid: 'MID_032',    count: cntMid('MID_032'), color: '#FB923C' },
      { label: 'ゴールド新規', mid: 'MID_041',   count: cntMid('MID_041'), color: '#FBBF24' },
      { label: 'ゴールドRU',  mid: 'MID_042',   count: cntMid('MID_042'), color: '#FBBF24' },
      { label: 'PAYカード',   mid: 'MID_043',   count: cntMid('MID_043'), color: '#FBBF24' },
      { label: 'じぶん銀行',  mid: 'MID_044',   count: cntMid('MID_044'), color: '#38BDF8' },
      { label: 'auでんき',    mid: 'MID_045',   count: cntMid('MID_045'), color: '#34D399' },
      { label: 'Netflix',    mid: 'MID_047',   count: cntMid('MID_047'), color: '#F87171' },
      { label: 'YouTube',    mid: 'MID_048',   count: cntMid('MID_048'), color: '#F87171' },
      { label: 'Pontaパス',   mid: '__ppass',   count: cntOptName(['Pontaパス']), color: '#FB923C' },
      { label: '自転車',     mid: 'MID_054',   count: cntMid('MID_054'), color: '#94A3B8' },
    ];

    const items = detailTab === 'kyoka' ? kyokaItems : allItems;

    // スタッフ別（item.midと一致する報告だけ拾う）
    const matchItem = (item, line) => {
      if (item.mid.startsWith('MID_')) return line.midCat === item.mid;
      if (item.mid === '__premium_mane') return isMobileLine(line) && classifyLine(line) === 'manekatsu2' && isMnp(line) && hasDevice(line);
      if (item.mid === '__cat_mane') return isMobileLine(line) && classifyLine(line) === 'manekatsu2';
      if (item.mid === '__kddi') return ['MID_025', 'MID_027'].includes(line.midCat);
      if (item.mid === '__ponta') return isMobileLine(line) && !!line.pontaLink;
      if (item.mid === '__login') return isMobileLine(line) && !!line.mauLogin;
      if (item.mid === '__warr') return isMobileLine(line) && (line.optNames || []).some(o => ['故障紛失サポート', '故障紛失AppleCare', '故障紛失ワイドAppleCare'].includes(o));
      if (item.mid === '__ppass') return isMobileLine(line) && (line.optNames || []).some(o => o === 'Pontaパス');
      if (item.mid === '__aushinki') return ['MID_001','MID_002','MID_003','MID_004','MID_005','MID_006'].includes(line.midCat);
      if (item.mid === '__uqshinki') return ['MID_007','MID_008','MID_009','MID_010','MID_011','MID_012'].includes(line.midCat);
      if (item.mid === '__aumnp') return ['MID_017','MID_018'].includes(line.midCat);
      if (item.mid === '__uqmnp') return ['MID_019','MID_020'].includes(line.midCat);
      if (item.mid === '__aukishu') return ['MID_021','MID_022'].includes(line.midCat);
      if (item.mid === '__uqkishu') return ['MID_023','MID_024'].includes(line.midCat);
      if (item.mid === '__upsell') return line.mainCat === 'MAIN_004';
      return false;
    };
    const staffMap = {};
    storeReports.forEach(r => {
      if (r.acqType === 'outsource') return;   // スタッフ別は個人実績なので外注を除外
      const nm = r.acqType === 'proxy' ? r.proxyStaff : r.staffName;
      if (!nm) return;
      if (!staffMap[nm]) staffMap[nm] = { name: nm, counts: {} };
      (r.lines || []).forEach(l => items.forEach(it => { if (matchItem(it, l)) staffMap[nm].counts[it.label] = (staffMap[nm].counts[it.label] || 0) + 1; }));
    });
    const staffArr = Object.values(staffMap)
      .map(s => ({ ...s, total: Object.values(s.counts).reduce((a, b) => a + b, 0) }))
      .filter(s => s.total > 0)
      .sort((a, b) => b.total - a.total);

    const grandTotal = items.reduce((s, i) => s + i.count, 0);
    return { items, staffArr, grandTotal };
  }, [monthReports, detailStore, detailTab]);

  // 内訳集計（新規/MNP/機変/UP/ひかり/BL/WiMAX/LTV/+1C）
  // ※店舗実績・KDDI算定なので、外注(counted=false)も含める
  // O19新規(19〜59歳)はKDDI算定の新規カウント対象外（見える化のみ）→ 新規から除外
  // タブレット新規(MID_016)もモバイル新規としては数えない → 新規から除外
  const O19_NEW_MIDS = ['MID_003', 'MID_004', 'MID_009', 'MID_010', 'MID_015', 'MID_016'];
  const breakdownOf = (reports, storeId) => {
    const filtered = reports.filter(r => (!storeId || creditStoreOf(r) === storeId));
    let shinki = 0, mnp = 0, kishu = 0, upsell = 0, hikari = 0, bl = 0, wimax = 0, kdaitai = 0, ltv = 0, plus1c = 0, gold = 0, denki = 0, payCard = 0, jibun = 0;
    filtered.forEach(r => (r.lines || []).forEach(l => {
      if (l.mainCat === 'MAIN_001' && !O19_NEW_MIDS.includes(l.midCat)) shinki++;
      else if (l.mainCat === 'MAIN_002') mnp++;
      else if (l.mainCat === 'MAIN_003') kishu++;
      else if (l.mainCat === 'MAIN_004') upsell++;
      if (l.midCat === 'MID_030') hikari++;
      else if (l.midCat === 'MID_031') bl++;
      else if (l.midCat === 'MID_032') wimax++;
      else if (l.midCat === 'MID_033') kdaitai++;
      if (l.mainCat === 'MAIN_006') ltv++;
      if (l.midCat === 'MID_041' || l.midCat === 'MID_042') gold++;
      if (l.midCat === 'MID_045') denki++;
      if (l.midCat === 'MID_043') payCard++;
      if (l.midCat === 'MID_044') jibun++;
      plus1c += Number(l.plus1c) || 0;
    }));
    return { shinki, mnp, kishu, upsell, hikari, bl, wimax, kdaitai, ltv, plus1c, gold, denki, payCard, jibun, mobileTotal: shinki + mnp + kishu + upsell, fixedTotal: hikari + bl + wimax + kdaitai, total: shinki + mnp + kishu + upsell + hikari + bl + wimax + kdaitai + ltv };
  };
  const todayBreakdownByStore = useMemo(() => MAIN_STORES.map(s => ({ store: s, b: breakdownOf(todayReports, s.id) })), [todayReports]);
  const todayAll = useMemo(() => breakdownOf(todayReports), [todayReports]);
  const monthBreakdownByStore = useMemo(() => Object.fromEntries(MAIN_STORES.map(s => [s.id, breakdownOf(monthReports, s.id)])), [monthReports]);

  // ⑤ 本日の+1Cサマリー（母数＝モバイル契約のみ／金額＝+1C全部・単体販売含む）
  // ※店舗実績なので、外注も含める
  const plus1cSummaryOf = (reps, storeId) => {
    const filtered = reps.filter(r => (!storeId || creditStoreOf(r) === storeId));
    let total = 0, mobileCount = 0;
    filtered.forEach(r => (r.lines || []).forEach(l => {
      total += Number(l.plus1c) || 0;
      if (isMobileLine(l)) mobileCount++;
    }));
    return { total, mobileCount, tanka: mobileCount > 0 ? Math.round(total / mobileCount) : 0 };
  };
  const todayPlus1cAll = useMemo(() => plus1cSummaryOf(todayReports), [todayReports]);
  const todayPlus1cByStore = useMemo(() => MAIN_STORES.map(s => ({ store: s, ...plus1cSummaryOf(todayReports, s.id) })), [todayReports]);

  // ③ 本日のスタッフ別ポイント順位（全社・当日／ポイント順・台数併記）
  const todayStaffRank = useMemo(() =>
    STAFF.map(name => {
      const pts = computePoints(todayReports, { staffName: name, config: pointConfig, excludedMids });
      let dai = 0;
      todayReports.forEach(r => {
        if (r.counted === false) return;
        if ((r.proxyStaff || r.staffName) !== name) return;
        (r.lines || []).forEach(l => { if (isMobileLine(l)) dai++; });
      });
      return { name, points: pts.totalPoints, yen: pts.yen, dai };
    }).filter(s => s.points > 0 || s.dai > 0).sort((a, b) => b.points - a.points),
    [todayReports, pointConfig, excludedMids]);

  return (
    <div style={{ padding: '8px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', margin: 0 }}>🏠 ホーム</h1>
        <button onClick={async () => { if (window.confirm((me || '') + ' でログイン中です。ログアウトしますか？')) { await logout(); } }} style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(248,113,113,0.10)', color: '#F87171', border: '1px solid rgba(248,113,113,0.3)' }}>ログアウト</button>
      </div>

      {/* 自分の今月の見込み */}
      <div onClick={() => nav('/incentive')} style={{ ...card, cursor: 'pointer', background: 'rgba(251,191,36,0.06)', borderColor: 'rgba(251,191,36,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 11, color: C.mut }}>{me || 'ようこそ'}さんの今月の見込み（土台①）</span>
          <span style={{ fontSize: 9, color: C.gold }}>詳しく ›</span>
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, color: C.gold }}>{yen(mine.yen)}</div>
        <div style={{ fontSize: 9, color: C.mut2 }}>{mine.totalPoints}点 × ¥{YEN_PER_POINT}{myStore ? '　所属: ' + storeName(myStore) : ''}</div>
      </div>

      {/* サンキューコール 待機件数 */}
      {tycDueCount > 0 && (
        <div onClick={() => nav('/thank-you-calls')} style={{ ...card, cursor: 'pointer', background: 'rgba(248,113,113,0.06)', borderColor: 'rgba(248,113,113,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, color: C.red, fontWeight: 700 }}>📞 サンキューコール 推奨</div>
              <div style={{ fontSize: 10, color: C.mut, marginTop: 2 }}>販売後の御礼コールが <b style={{ color: C.red }}>{tycDueCount}件</b> 待機中</div>
            </div>
            <span style={{ fontSize: 16, color: C.red, fontWeight: 700 }}>›</span>
          </div>
        </div>
      )}

      {/* 本日の全体実績 */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>📅 本日の全体実績</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setTodayDetail(!todayDetail)} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer', background: todayDetail ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)', color: todayDetail ? C.purple : C.mut, border: todayDetail ? '1px solid rgba(167,139,250,0.3)' : '1px solid rgba(255,255,255,0.06)' }}>{todayDetail ? '📋 内訳' : '📊 サマリー'}</button>
            <span style={{ fontSize: 10, color: C.mut }}>{today}</span>
          </div>
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, color: C.green }}>{todayTotal.grandTotal}<span style={{ fontSize: 11, color: C.mut }}>件（全店合計）</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4, marginTop: 8 }}>
          {CATEGORIES.map(c => {
            const v = c === '物販(+1C)' ? todayTotal.plus1cTotal : todayTotal.byCategory[c] || 0;
            const show = c === '物販(+1C)' ? yen(v) : v + '件';
            return (
              <div key={c} style={{ padding: '5px 4px', borderRadius: 7, background: v > 0 ? catCol[c] + '14' : 'rgba(255,255,255,0.02)', textAlign: 'center', border: '1px solid ' + (v > 0 ? catCol[c] + '40' : 'rgba(255,255,255,0.04)') }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: v > 0 ? catCol[c] : C.dim }}>{show}</div>
                <div style={{ fontSize: 8, color: v > 0 ? catCol[c] : C.mut2, fontWeight: 600 }}>{c}</div>
              </div>
            );
          })}
        </div>
        {/* 店舗別 本日テーブル */}
        {/* 店舗別 本日：サマリー時はテーブル、内訳時は縦カード */}
        {todayDetail ? (
          <div style={{ marginTop: 10 }}>
            {todayBreakdownByStore.map(({ store, b }) => (
              <div key={store.id} style={{ borderRadius: 8, background: b.total > 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', padding: '7px 9px', marginBottom: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: b.total > 0 ? 4 : 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.w2 }}>{store.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: b.total > 0 ? '#fff' : C.dim }}>{b.total || '—'}{b.total > 0 && <span style={{ fontSize: 9, color: C.mut }}>件</span>}</span>
                </div>
                {b.total > 0 && (
                  <div style={{ fontSize: 9, lineHeight: 1.5, color: C.mut2 }}>
                    {b.mobileTotal > 0 && <div>モバ <span style={{ color: C.gold, fontWeight: 600 }}>新{b.shinki} MNP{b.mnp} 機変{b.kishu} UP{b.upsell}</span> <span style={{ color: C.mut2 }}>(計{b.mobileTotal})</span></div>}
                    {b.fixedTotal > 0 && <div>固定 <span style={{ color: C.orange, fontWeight: 600 }}>ひかり{b.hikari} BL{b.bl} WiMAX{b.wimax}{b.kdaitai > 0 ? ' 代替' + b.kdaitai : ''}</span> <span style={{ color: C.mut2 }}>(計{b.fixedTotal})</span></div>}
                    {(b.ltv > 0 || b.plus1c > 0) && <div>{b.ltv > 0 && <>LTV <span style={{ color: C.purple, fontWeight: 600 }}>{b.ltv}</span> </>}{b.plus1c > 0 && <>+1C <span style={{ color: C.green, fontWeight: 600 }}>{yen(b.plus1c)}</span></>}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 10, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <thead>
                <tr>
                  <th style={th()}>店舗</th>
                  <th style={th(C.gold)}>モバ</th>
                  <th style={th(C.orange)}>固定</th>
                  <th style={th(C.purple)}>LTV</th>
                  <th style={th(C.green)}>+1C</th>
                  <th style={th()}>計</th>
                </tr>
              </thead>
              <tbody>
                {todayByStore.map(r => (
                  <tr key={r.store.id}>
                    <td style={td(C.w2, true)}>{r.store.name}</td>
                    <td style={td(r.byCategory['モバイル'] > 0 ? C.gold : C.dim)}>{r.byCategory['モバイル'] || '-'}</td>
                    <td style={td(r.byCategory['固定商材'] > 0 ? C.orange : C.dim)}>{r.byCategory['固定商材'] || '-'}</td>
                    <td style={td(r.byCategory['LTV商材'] > 0 ? C.purple : C.dim)}>{r.byCategory['LTV商材'] || '-'}</td>
                    <td style={td(r.plus1cTotal > 0 ? C.green : C.dim, false, 9)}>{r.plus1cTotal > 0 ? yen(r.plus1cTotal) : '-'}</td>
                    <td style={td('#fff', false, 10, 700)}>{r.grandTotal || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 📊 本日の項目別（全店）大きく表示 */}
      <div style={card}>
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>📊 本日の項目別（全店）</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
          {[
            { label: '新規', value: todayAll.shinki, color: C.blue },
            { label: 'MNP', value: todayAll.mnp, color: C.green },
            { label: '機変', value: todayAll.kishu, color: C.gold },
            { label: 'アップセル', value: todayAll.upsell, color: C.purple },
            { label: '固定', value: todayAll.fixedTotal, color: C.orange },
            { label: 'ゴールド', value: todayAll.gold, color: '#FCD34D' },
            { label: 'auでんき', value: todayAll.denki, color: C.red },
            { label: 'PAYカード', value: todayAll.payCard, color: '#F472B6' },
            { label: 'じぶん銀行', value: todayAll.jibun, color: '#22D3EE' },
          ].map(it => (
            <div key={it.label} style={{ background: it.value > 0 ? it.color + '14' : 'rgba(255,255,255,0.02)', border: '1px solid ' + (it.value > 0 ? it.color + '40' : 'rgba(255,255,255,0.05)'), borderRadius: 10, padding: '14px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 900, color: it.value > 0 ? it.color : C.dim, lineHeight: 1 }}>{it.value}</div>
              <div style={{ fontSize: 10, color: it.value > 0 ? it.color : C.mut, fontWeight: 700, marginTop: 6 }}>{it.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 💰 本日の+1Cサマリー */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>💰 本日の+1Cサマリー</span>
          <span style={{ fontSize: 9, color: C.mut2 }}>モバイル契約あたり</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, padding: '8px 6px', borderRadius: 8, background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)', textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: C.mut2, fontWeight: 600 }}>+1C総額</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: C.green }}>{yen(todayPlus1cAll.total)}</div>
          </div>
          <div style={{ flex: 1, padding: '8px 6px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: C.mut2, fontWeight: 600 }}>モバイル台数</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: C.w2 }}>{todayPlus1cAll.mobileCount}<span style={{ fontSize: 9, color: C.mut }}>台</span></div>
          </div>
          <div style={{ flex: 1.3, padding: '8px 6px', borderRadius: 8, background: todayPlus1cAll.tanka >= 25000 ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.08)', border: '1px solid ' + (todayPlus1cAll.tanka >= 25000 ? 'rgba(52,211,153,0.35)' : 'rgba(251,191,36,0.3)'), textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: C.mut2, fontWeight: 600 }}>単価（目標¥25,000）</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: todayPlus1cAll.tanka >= 25000 ? C.green : C.gold }}>{yen(todayPlus1cAll.tanka)}{todayPlus1cAll.tanka >= 25000 ? ' ✅' : ''}</div>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr>
                <th style={th()}>店舗</th>
                <th style={th(C.green)}>+1C総額</th>
                <th style={th()}>台数</th>
                <th style={th(C.gold)}>単価</th>
              </tr>
            </thead>
            <tbody>
              {todayPlus1cByStore.map(r => (
                <tr key={r.store.id}>
                  <td style={td(C.w2, true)}>{r.store.name}</td>
                  <td style={td(r.total > 0 ? C.green : C.dim, false, 9)}>{r.total > 0 ? yen(r.total) : '-'}</td>
                  <td style={td(r.mobileCount > 0 ? C.w2 : C.dim)}>{r.mobileCount || '-'}</td>
                  <td style={td(r.tanka >= 25000 ? C.green : (r.tanka > 0 ? C.gold : C.dim), false, 9, 700)}>{r.tanka > 0 ? yen(r.tanka) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 8, color: C.mut2, marginTop: 6, lineHeight: 1.4 }}>※ 母数はモバイル契約（新規・MNP・機種変更・番号移行）のみ。固定・LTVは含めません。+1C金額は単体販売も含みます。</div>
      </div>

      {/* 店舗別 月間進捗 */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>🏪 店舗別 月間進捗</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setMonthDetail(!monthDetail)} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer', background: monthDetail ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)', color: monthDetail ? C.purple : C.mut, border: monthDetail ? '1px solid rgba(167,139,250,0.3)' : '1px solid rgba(255,255,255,0.06)' }}>{monthDetail ? '📋 内訳' : '📊 サマリー'}</button>
            <span style={{ fontSize: 10, color: monthAllRate != null && monthAllRate >= 100 ? C.green : C.gold, fontWeight: 700 }}>全社 {monthAllRate != null ? monthAllRate + '%' : '—'}</span>
          </div>
        </div>
        <div style={{ fontSize: 9, color: C.mut2, marginBottom: 8 }}>全社合計 {monthAll.grandTotal} / 目標 {monthAllTarget}件</div>
        {monthByStore.map(r => (
          <div key={r.store.id} onClick={() => nav('/target')} style={{ marginBottom: 9, cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
              <span style={{ fontSize: 11, color: C.w2, fontWeight: 600 }}>{r.store.name}</span>
              <span style={{ fontSize: 11, color: r.rate != null && r.rate >= 100 ? C.green : (r.rate != null && r.rate >= 50 ? C.gold : C.red), fontWeight: 700 }}>
                {r.ag.grandTotal} / {r.totalTarget || '—'} <span style={{ fontSize: 9 }}>{r.rate != null ? '(' + Math.round(r.rate) + '%)' : ''}</span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {CATEGORIES.filter(c => c !== '物販(+1C)').map(c => {
                const tgt = TARGET_GROUPS.filter(g => g.cat === c && g.unit === '件' && !g.internal).reduce((s, g) => s + ((storeTargets[r.store.id] || {})[g.id] || 0), 0);
                const act = r.ag.byCategory[c] || 0;
                const pct = tgt > 0 ? Math.min(act / tgt * 100, 100) : 0;
                const realPct = tgt > 0 ? Math.round(act / tgt * 100) : null;
                const shortC = c === 'モバイル' ? 'モバ' : c === '固定商材' ? '固定' : 'LTV';
                return (
                  <div key={c} style={{ flex: 1 }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: realPct != null ? catCol[c] : C.dim, textAlign: 'center', marginBottom: 2, whiteSpace: 'nowrap' }}>{shortC} {realPct != null ? realPct + '%' : '—'}</div>
                    <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: pct + '%', background: catCol[c] }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1px 8px', marginTop: 4 }}>
              {PROGRESS_ITEMS.map(it => {
                const act = it.gids.reduce((s, gid) => s + (r.ag.byGroup[gid] || 0), 0);
                const tgt = it.gids.reduce((s, gid) => s + ((storeTargets[r.store.id] || {})[gid] || 0), 0);
                const p = tgt > 0 ? Math.round(act / tgt * 100) : null;
                return <span key={it.label} style={{ fontSize: 9, fontWeight: 600, color: progColor(p), whiteSpace: 'nowrap' }}>{it.label} {p == null ? '—' : p + '%'}</span>;
              })}
            </div>
            <div style={{ fontSize: 8, color: C.mut2, marginTop: 1, lineHeight: monthDetail ? 1.55 : 1.4 }}>
              {monthDetail ? (() => {
                const bd = monthBreakdownByStore[r.store.id] || {};
                return (
                  <>
                    {bd.mobileTotal > 0 && <div>モバ <span style={{ color: C.gold }}>新{bd.shinki} MNP{bd.mnp} 機変{bd.kishu} UP{bd.upsell}</span> <span style={{ color: C.mut2 }}>(計{bd.mobileTotal})</span></div>}
                    {bd.fixedTotal > 0 && <div>固定 <span style={{ color: C.orange }}>ひかり{bd.hikari} BL{bd.bl} WiMAX{bd.wimax}{bd.kdaitai > 0 ? ' 代替' + bd.kdaitai : ''}</span> <span style={{ color: C.mut2 }}>(計{bd.fixedTotal})</span></div>}
                    <div>
                      <span style={{ color: r.ag.byCategory['LTV商材'] > 0 ? C.purple : C.dim }}>LTV {r.ag.byCategory['LTV商材'] || 0}</span>
                      {r.ag.plus1cTotal > 0 && <> <span style={{ color: C.green }}>+1C {yen(r.ag.plus1cTotal)}</span></>}
                    </div>
                  </>
                );
              })() : (
                <div style={{ display: 'flex', gap: 8 }}>
                  {CATEGORIES.filter(c => c !== '物販(+1C)').map(c => <span key={c} style={{ color: r.ag.byCategory[c] > 0 ? catCol[c] : C.dim }}>{c}: {r.ag.byCategory[c] || 0}</span>)}
                  <span style={{ color: r.ag.plus1cTotal > 0 ? C.green : C.dim }}>+1C: {yen(r.ag.plus1cTotal)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
        <div style={{ fontSize: 9, color: C.mut2, textAlign: 'center', marginTop: 4 }}>店舗をタップで「達成率」画面へ</div>
      </div>

      {/* ====== 🏪 店舗別 詳細（タブで店舗切替・強化商材/全商材） ====== */}
      <div style={card}>
        <div onClick={() => setDetailOpen(!detailOpen)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', cursor: 'pointer' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>🏪 店舗別 詳細</span>
          <span style={{ fontSize: 9, color: C.mut2 }}>{detailOpen ? '▲ 閉じる' : '▼ 開く'}</span>
        </div>
        {detailOpen && (
          <div style={{ marginTop: 10 }}>
            {/* 強化商材 / 全商材 タブ */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {[{ id: 'kyoka', label: '🏆 強化商材' }, { id: 'all', label: '📊 全商材' }].map(t => (
                <button key={t.id} onClick={() => setDetailTab(t.id)} style={{ flex: 1, padding: '5px 0', borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: detailTab === t.id ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.02)', color: detailTab === t.id ? C.purple : C.mut2, border: detailTab === t.id ? '1px solid rgba(167,139,250,0.25)' : '1px solid rgba(255,255,255,0.05)' }}>{t.label}</button>
              ))}
            </div>
            {/* 店舗タブ */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, overflowX: 'auto', paddingBottom: 2 }}>
              {MAIN_STORES.map(s => (
                <button key={s.id} onClick={() => setDetailStore(s.id)} style={{ flex: '0 0 auto', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', background: detailStore === s.id ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.02)', color: detailStore === s.id ? C.purple : C.mut2, border: detailStore === s.id ? '1px solid rgba(167,139,250,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>{s.name.replace('auStyle', '').replace('auショップ', '')}</button>
              ))}
            </div>
            {/* 商材グリッド */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, marginBottom: 10 }}>
              {detailData.items.map(it => (
                <div key={it.label} style={{ padding: '6px 4px', borderRadius: 8, background: it.count > 0 ? it.color + '14' : 'rgba(255,255,255,0.02)', textAlign: 'center', border: '1px solid ' + (it.count > 0 ? it.color + '40' : 'rgba(255,255,255,0.04)'), position: 'relative' }}>
                  {it.star && <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 8, color: C.gold }}>★19pt</span>}
                  <div style={{ fontSize: 16, fontWeight: 900, color: it.count > 0 ? it.color : C.dim }}>{it.count}</div>
                  <div style={{ fontSize: 8, color: it.count > 0 ? it.color : C.mut2, fontWeight: 600 }}>{it.label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 9, color: C.mut2, textAlign: 'right', marginBottom: 8 }}>合計 {detailData.grandTotal}件</div>

            {/* スタッフ別テーブル */}
            <div style={{ fontSize: 10, fontWeight: 700, color: C.mut, marginBottom: 4 }}>👤 スタッフ別</div>
            {detailData.staffArr.length === 0 ? (
              <div style={{ fontSize: 10, color: C.mut2, padding: 8, textAlign: 'center' }}>まだ報告がありません</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '4px 3px', color: C.mut2, borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: '#0F0D1A' }}>名前</th>
                      {detailData.items.map(it => <th key={it.label} style={{ textAlign: 'center', padding: '4px 3px', color: it.color, borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 600, whiteSpace: 'nowrap' }}>{it.label.length > 6 ? it.label.slice(0, 5) + '…' : it.label}</th>)}
                      <th style={{ textAlign: 'center', padding: '4px 3px', color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 700 }}>計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailData.staffArr.map(s => (
                      <tr key={s.name}>
                        <td style={{ textAlign: 'left', padding: '4px 3px', color: C.w2, borderBottom: '1px solid rgba(255,255,255,0.03)', fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: '#0F0D1A' }}>{s.name}</td>
                        {detailData.items.map(it => { const c = s.counts[it.label] || 0; return <td key={it.label} style={{ textAlign: 'center', padding: '4px 3px', color: c > 0 ? it.color : C.dim, borderBottom: '1px solid rgba(255,255,255,0.03)', fontWeight: c > 0 ? 700 : 500 }}>{c || '-'}</td>; })}
                        <td style={{ textAlign: 'center', padding: '4px 3px', color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.03)', fontWeight: 700 }}>{s.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ====== 📋 今月の戦術状況 ====== */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>📋 今月の戦術状況</span>
          <span style={{ fontSize: 9, color: C.mut }}>{tacScope}</span>
        </div>
        {/* 店舗切替タブ */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, overflowX: 'auto', paddingBottom: 4 }}>
          {[{ id: 'all', name: '全店' }, ...MAIN_STORES].map(s => (
            <button key={s.id} onClick={() => setTacticalStore(s.id)} style={{ padding: '5px 9px', borderRadius: 6, fontSize: 10, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', background: tacticalStore === s.id ? C.gold : 'rgba(255,255,255,0.04)', color: tacticalStore === s.id ? '#000' : C.w2, fontWeight: tacticalStore === s.id ? 700 : 500 }}>{s.name}</button>
          ))}
        </div>

        {/* A. プランミックス */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.w2, marginBottom: 6 }}>📊 プランミックス（モバイル契約 {tactMix.totalMobile}件 / 合計 {tactMix.totalIdScore}pt）</div>
          {tactMix.totalMobile > 0 ? (
            <>
              <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: 'rgba(255,255,255,0.04)', marginBottom: 6 }}>
                {PLAN_CAT_ORDER.map(k => { const v = tactMix.totals[k]; if (v === 0) return null; const pct = v / tactMix.totalMobile * 100; return <div key={k} style={{ width: pct + '%', background: PLAN_CATS[k].color }} title={PLAN_CATS[k].label + ': ' + v + '件 (' + pct.toFixed(0) + '%)'} />; })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, marginBottom: 8 }}>
                {PLAN_CAT_ORDER.map(k => { const v = tactMix.totals[k]; const pct = tactMix.totalMobile > 0 ? Math.round(v / tactMix.totalMobile * 100) : 0; return (<div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9 }}><span style={{ width: 8, height: 8, background: PLAN_CATS[k].color, borderRadius: 2, flexShrink: 0 }} /><span style={{ color: PLAN_CATS[k].warn && pct > 30 ? C.red : C.mut }}>{PLAN_CATS[k].label} {v}({pct}%)</span></div>); })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div style={{ padding: 7, borderRadius: 8, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
                  <div style={{ fontSize: 8, color: C.gold }}>★最高効率: マネ活2×MNP×端末有</div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: C.gold }}>{tactMix.premiumManekatsu}<span style={{ fontSize: 9, color: C.mut }}>件 = {tactMix.premiumManekatsu * 19}pt</span></div>
                </div>
                <div style={{ padding: 7, borderRadius: 8, background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)' }}>
                  <div style={{ fontSize: 8, color: C.purple }}>バリューリンク×MNP×端末有</div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: C.purple }}>{tactMix.premiumValue}<span style={{ fontSize: 9, color: C.mut }}>件 = {tactMix.premiumValue * 13}pt</span></div>
                </div>
              </div>
              {tactMix.tokutokuRate > 25 && (
                <div style={{ marginTop: 8, padding: 7, borderRadius: 8, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.3)', fontSize: 10, color: C.red, lineHeight: 1.5 }}>
                  ⚠️ トクトク比率が <b>{tactMix.tokutokuRate}%</b>。マネ活2への提案切替でスコア大幅UP（マネ活2は1件最大19pt、トクトクは最大4pt）
                </div>
              )}
            </>
          ) : <div style={{ fontSize: 11, color: C.mut, padding: 8 }}>今月のモバイル契約はまだありません</div>}
        </div>

        {/* A2. PAYゴールド進捗（資料: 18件/月・マネ活契約者へ提案） */}
        <div style={{ marginBottom: 14, padding: 10, borderRadius: 10, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.3)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, marginBottom: 6 }}>🏆 PAYゴールド進捗</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <span style={{ fontSize: 9, color: C.mut }}>月間目標 {tactGold.target}件</span>
            <span style={{ fontSize: 18, fontWeight: 900, color: tactGold.achieved ? C.green : C.gold }}>{tactGold.total}<span style={{ fontSize: 11, color: C.mut, fontWeight: 600 }}>件 / {tactGold.target}件 ({tactGold.rate}%)</span></span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.04)', overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: Math.min(tactGold.rate, 100) + '%', background: tactGold.achieved ? C.green : C.gold, transition: 'width 0.3s' }} />
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 10, color: C.mut, marginBottom: 6 }}>
            <span>新規 <span style={{ color: C.gold, fontWeight: 700 }}>{tactGold.goldNew}件</span></span>
            <span>RU <span style={{ color: C.gold, fontWeight: 700 }}>{tactGold.goldRu}件</span></span>
          </div>
          {tactGold.maneContracts > 0 ? (
            <div style={{ padding: 7, borderRadius: 6, background: 'rgba(0,0,0,0.2)', fontSize: 10, color: C.mut, lineHeight: 1.5 }}>
              マネ活契約 <span style={{ color: C.gold, fontWeight: 700 }}>{tactGold.maneContracts}件</span> 中、ゴールド同時付与 <span style={{ color: tactGold.maneGoldRate >= 80 ? C.green : C.red, fontWeight: 700 }}>{tactGold.maneWithGold}件 ({tactGold.maneGoldRate}%)</span>
              {tactGold.maneGoldRate < 80 && tactGold.maneContracts - tactGold.maneWithGold > 0 && (
                <div style={{ fontSize: 10, color: C.red, marginTop: 4, fontWeight: 600 }}>💡 マネ活契約者へのゴールド提案漏れ <b>{tactGold.maneContracts - tactGold.maneWithGold}件</b>。資料の必須提案項目です</div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: C.mut2 }}>マネ活契約はまだありません</div>
          )}
        </div>

        {/* B. 絶対取る7項目 */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.w2, marginBottom: 6 }}>🎯 絶対取る項目（提案するだけで取れる）</div>
          {ESSENTIAL_TARGETS.map(t => {
            const m = tactEssen[t.key]; const rate = m.rate;
            const ok = rate != null && rate >= t.target;
            const warn = rate != null && rate < t.target * 0.7;
            const color = rate == null ? C.dim : ok ? C.green : warn ? C.red : C.gold;
            return (
              <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <span style={{ color: C.w2 }}>{t.label}{ok ? ' ✓' : ''}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 9, color: C.mut2 }}>目標 {t.target}%</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color, minWidth: 75, textAlign: 'right' }}>{rate == null ? (t.hasData ? '0%' : '— 集計待ち') : rate + '%'}</span>
                </div>
              </div>
            );
          })}
          <div style={{ fontSize: 9, color: C.mut2, marginTop: 4 }}>※ 報告画面の「退店時の必須対応」をチェックするとPonta連携・ログイン率に集計されます</div>
        </div>

        {/* C. 足切り進捗 */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.w2, marginBottom: 6 }}>⚠️ 足切り進捗（1件未達で0P）</div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.mut, marginBottom: 3 }}>
              <span>世帯商材</span>
              <span style={{ color: tactAshi.householdOK ? C.green : C.red, fontWeight: 700 }}>{tactAshi.householdOK ? '✓ クリア' : '⚠️ 未達あり = 0P'}</span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {tactAshi.household.map(h => (
                <div key={h.midCat} style={{ flex: 1, padding: 5, borderRadius: 6, background: h.achieved ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)', border: '1px solid ' + (h.achieved ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'), textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: h.achieved ? C.green : C.red }}>{h.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: h.achieved ? C.green : C.red }}>{h.count}<span style={{ fontSize: 8, color: C.mut2 }}>/{h.target}</span></div>
                  {!h.achieved && <div style={{ fontSize: 7, color: C.red }}>あと{h.remain}</div>}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.mut, marginBottom: 3 }}>
              <span>個人商材</span>
              <span style={{ color: tactAshi.personalOK ? C.green : C.red, fontWeight: 700 }}>{tactAshi.personalOK ? '✓ クリア' : '⚠️ 未達あり = 0P'}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4 }}>
              {tactAshi.personal.map(p => (
                <div key={p.midCat} style={{ padding: 5, borderRadius: 6, background: p.achieved ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)', border: '1px solid ' + (p.achieved ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'), textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: p.achieved ? C.green : C.red }}>{p.label}</div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: p.achieved ? C.green : C.red }}>{p.count}<span style={{ fontSize: 7, color: C.mut2 }}>/{p.target}</span></div>
                  {!p.achieved && <div style={{ fontSize: 7, color: C.red }}>あと{p.remain}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 今月ランキング */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>👑 今月ランキング（上位5名）</span>
          <span onClick={() => nav('/incentive')} style={{ fontSize: 9, color: C.gold, cursor: 'pointer' }}>もっと見る ›</span>
        </div>
        {ranking.length === 0 && <div style={{ fontSize: 11, color: C.mut, padding: 8 }}>まだ獲得がありません</div>}
        {ranking.map((s, i) => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: i === 0 ? C.gold : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : C.mut, minWidth: 22 }}>{i + 1}</span>
            <span style={{ flex: 1, fontSize: 12, color: s.name === me ? C.gold : C.w2, fontWeight: s.name === me ? 700 : 500 }}>{s.name}{s.name === me ? '★' : ''}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.gold }}>{s.totalPoints}点</span>
            <span style={{ fontSize: 11, color: C.green }}>{yen(s.yen)}</span>
          </div>
        ))}
      </div>

      {/* 🔥 本日のスタッフ順位 */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>🔥 本日のスタッフ順位</span>
          <span style={{ fontSize: 9, color: C.mut2 }}>ポイント順・全店</span>
        </div>
        {todayStaffRank.length === 0 ? (
          <div style={{ fontSize: 11, color: C.mut2, textAlign: 'center', padding: 12 }}>本日まだ獲得がありません</div>
        ) : (
          todayStaffRank.map((s, i) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < todayStaffRank.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: i === 0 ? C.gold : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : C.mut, minWidth: 22, textAlign: 'center' }}>{i + 1}</span>
              <span style={{ flex: 1, fontSize: 12, color: s.name === me ? C.gold : C.w2, fontWeight: s.name === me ? 700 : 500 }}>{s.name}{s.name === me ? '★' : ''}</span>
              <span style={{ fontSize: 10, color: C.mut2, marginRight: 4 }}>{s.dai}台</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.gold, minWidth: 44, textAlign: 'right' }}>{s.points}pt</span>
            </div>
          ))
        )}
      </div>

      {/* 🔴 最新の獲得フィード */}
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', marginBottom: 8 }}>🔴 最新の獲得</div>
        {(() => {
          const feed = [...todayReports]
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
            .slice(0, 8);
          if (feed.length === 0) return <div style={{ fontSize: 11, color: C.mut2, textAlign: 'center', padding: 12 }}>本日まだ獲得がありません</div>;
          const now = Date.now();
          return feed.map((r, i) => {
            const nm = r.acqType === 'outsource' ? ('👷' + (r.extName || '外注')) : (r.proxyStaff || r.staffName || '?');
            const mids = [...new Set((r.lines || []).map(l => l.midCatName).filter(Boolean))].slice(0, 3).join('、');
            const t = r.createdAt?.toDate?.();
            const ago = t ? Math.round((now - t.getTime()) / 60000) : 0;
            const agoStr = ago < 1 ? '今' : ago < 60 ? ago + '分前' : ago < 1440 ? Math.round(ago / 60) + '時間前' : Math.round(ago / 1440) + '日前';
            return (
              <div key={r.id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '5px 0', borderBottom: i < feed.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: nm === me ? C.gold : C.w2 }}>{nm}{nm === me ? '★' : ''}</span>
                  <span style={{ fontSize: 9, color: C.mut2, marginLeft: 6 }}>{mids}</span>
                </div>
                <span style={{ fontSize: 9, color: C.mut2, marginLeft: 6, flexShrink: 0 }}>{agoStr}</span>
              </div>
            );
          });
        })()}
      </div>

      {/* 📋 テキスト出力 */}
      <div style={card}>
        <button onClick={() => setShowExport(v => !v)} style={{ width: '100%', padding: 8, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: showExport ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.02)', color: showExport ? C.gold : C.mut, border: '1px solid ' + (showExport ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.06)') }}>📋 本日のサマリーをテキスト出力{showExport ? ' ▲' : ' ▼'}</button>
        {showExport && (() => {
          // 出力可能項目
          const items = [
            { id: 'category', label: '大分類別件数', emoji: '📊' },
            { id: 'staff', label: 'スタッフ別件数', emoji: '👤' },
            { id: 'store', label: '店舗別件数', emoji: '🏪' },
            { id: 'plus1c', label: 'プラワン総額・単価', emoji: '💰' },
            { id: 'gold', label: 'PAYゴールド件数', emoji: '🏆' },
            { id: 'ponta', label: 'Pontaパス件数', emoji: '🎯' },
          ];
          const generateText = () => {
            const lines = [];
            const now = new Date();
            lines.push('📊 本日のサマリー(' + (now.getMonth() + 1) + '/' + now.getDate() + ')');
            lines.push('━━━━━━━━━━━━');
            if (exportItems.has('category')) {
              lines.push('');
              lines.push('【📊 大分類別】');
              const catCnt = {};
              todayReports.forEach(r => (r.lines || []).forEach(l => { const mc = l.mainCatName || '?'; catCnt[mc] = (catCnt[mc] || 0) + 1; }));
              Object.entries(catCnt).forEach(([mc, n]) => lines.push('・' + mc + ' ' + n + '件'));
            }
            if (exportItems.has('staff')) {
              lines.push('');
              lines.push('【👤 スタッフ別】');
              const staffCnt = {};
              todayReports.filter(r => r.counted !== false).forEach(r => {
                const nm = r.proxyStaff || r.staffName || '?';
                staffCnt[nm] = (staffCnt[nm] || 0) + (r.lineCount || (r.lines || []).length);
              });
              Object.entries(staffCnt).sort((a, b) => b[1] - a[1]).forEach(([nm, n]) => lines.push('・' + nm + ' ' + n + '台'));
            }
            if (exportItems.has('store')) {
              lines.push('');
              lines.push('【🏪 店舗別】');
              MAIN_STORES.forEach(s => {
                const cnt = todayReports.filter(r => creditStoreOf(r) === s.id).reduce((sum, r) => sum + (r.lineCount || (r.lines || []).length), 0);
                if (cnt > 0) lines.push('・' + s.name + ' ' + cnt + '台');
              });
            }
            if (exportItems.has('plus1c')) {
              let p1Total = 0, souhanCnt = 0;
              todayReports.forEach(r => (r.lines || []).forEach(l => {
                if (l.plus1c) p1Total += Number(l.plus1c) || 0;
                if (['MAIN_001', 'MAIN_002', 'MAIN_003', 'MAIN_004'].includes(l.mainCat)) souhanCnt++;
              }));
              if (p1Total > 0) {
                lines.push('');
                lines.push('【💰 プラワン】');
                lines.push('・総額: ¥' + p1Total.toLocaleString());
                if (souhanCnt > 0) {
                  const tanka = Math.round(p1Total / souhanCnt);
                  lines.push('・単価: ¥' + tanka.toLocaleString() + '/台' + (tanka >= 25000 ? ' ✅' : ' ⚠️目標¥25,000'));
                }
              }
            }
            if (exportItems.has('gold')) {
              let goldCnt = 0;
              todayReports.forEach(r => (r.lines || []).forEach(l => {
                if (l.midCat === 'MID_041' || l.midCat === 'MID_042') goldCnt++;
              }));
              if (goldCnt > 0) { lines.push(''); lines.push('【🏆 PAYゴールド】' + goldCnt + '件'); }
            }
            if (exportItems.has('ponta')) {
              let pontaCnt = 0;
              todayReports.forEach(r => (r.lines || []).forEach(l => {
                if ((l.opts || []).includes('OPT_115')) pontaCnt++;
              }));
              if (pontaCnt > 0) { lines.push(''); lines.push('【🎯 Pontaパス】' + pontaCnt + '件'); }
            }
            lines.push('━━━━━━━━━━━━');
            return lines.join('\n');
          };
          const txt = generateText();
          return (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, color: C.mut, marginBottom: 6 }}>出力する項目を選んでください：</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                {items.map(it => {
                  const sel = exportItems.has(it.id);
                  return (
                    <button key={it.id} onClick={() => { const s = new Set(exportItems); sel ? s.delete(it.id) : s.add(it.id); setExportItems(s); }} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer', background: sel ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.02)', color: sel ? C.gold : C.mut2, border: sel ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>{sel ? '✓ ' : ''}{it.emoji} {it.label}</button>
                  );
                })}
              </div>
              <pre style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 8, padding: 10, fontSize: 10, color: C.w2, lineHeight: 1.6, margin: 0, fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }}>{txt}</pre>
              <button onClick={async () => { try { await navigator.clipboard.writeText(txt); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) { alert('コピー失敗: ' + e.message); } }} style={{ width: '100%', marginTop: 8, padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: copied ? 'rgba(52,211,153,0.15)' : 'rgba(251,191,36,0.12)', color: copied ? C.green : C.gold, border: '1px solid ' + (copied ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.3)') }}>{copied ? '✅ コピーしました！' : '📋 テキストをコピー（' + exportItems.size + '項目）'}</button>
            </div>
          );
        })()}
      </div>

      {/* バージョン表記（ホーム画面のすみ） */}
      <div style={{ textAlign: 'right', fontSize: 9, color: C.mut2, marginTop: 4, paddingBottom: 4, letterSpacing: 0.5 }}>{APP_VERSION}</div>
    </div>
  );
}

function th(color) { return { textAlign: 'center', padding: '4px 3px', color: color || '#64748B', borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 600, whiteSpace: 'nowrap' }; }
function td(color, left, fs, weight) { return { textAlign: left ? 'left' : 'center', padding: '4px 3px', color, fontWeight: weight || 600, borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: fs || 10, whiteSpace: 'nowrap' }; }
