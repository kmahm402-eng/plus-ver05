// =====================================================================
// tactical.js ― 四半期戦術（プランミックス・絶対取る・足切り）の集計
// 資料「2026年6月-8月_四半期戦術.docx」をベースに、報告データから集計。
// ※ Ponta連携率・ログイン率は現報告データに無いため pending（null）で返す。
// =====================================================================

export const PLAN_CATS = {
  manekatsu2: { label: 'マネ活2',     color: '#FBBF24', mnpScore: 19 },
  valuelink:  { label: 'バリューリンク', color: '#A78BFA', mnpScore: 13 },
  komikomi:   { label: 'コミコミ',    color: '#38BDF8', mnpScore: 10 },
  u18senior:  { label: 'U18/シニア',  color: '#34D399', mnpScore: 10 },
  tokutoku:   { label: 'トクトク',    color: '#F87171', mnpScore: 4, warn: true },
  other:      { label: 'その他',     color: '#64748B', mnpScore: 1 },
};
export const PLAN_CAT_ORDER = ['manekatsu2', 'valuelink', 'komikomi', 'u18senior', 'tokutoku', 'other'];

export function classifyPlan(name) {
  if (!name) return 'other';
  // マネ活2 を最優先で判定（バリューリンクマネ活2 も含む）
  if (name.includes('マネ活2')) return 'manekatsu2';
  if (name === 'バリューリンク') return 'valuelink';
  if (name.includes('コミコミ')) return 'komikomi';
  if (name.includes('U1') || name.includes('U2') || name.includes('シニアバリュー') || name.includes('スマホスタート')) return 'u18senior';
  if (name.includes('トクトク')) return 'tokutoku';
  return 'other';
}

export function classifyLine(line) {
  const planNames = line.planNames || [];
  if (planNames.length === 0) return null;
  // 優先順位の高い分類で確定
  for (const g of PLAN_CAT_ORDER) {
    if (planNames.some(p => classifyPlan(p) === g)) return g;
  }
  return 'other';
}

export const hasDevice = (line) => !!line.model && line.model !== 'なし(SIMのみ)';
export const isMnp = (line) => line.mainCat === 'MAIN_002';
export const isMobileLine = (line) => ['MAIN_001', 'MAIN_002', 'MAIN_003', 'MAIN_004'].includes(line.mainCat);

// 1件あたりのIDポイント（資料の計算式 = ベース1 + 基準点 × 端末係数 × MNP係数）
export function lineIdScore(line) {
  const cat = classifyLine(line); if (!cat) return 0;
  const baseScoreMap = { manekatsu2: 3, valuelink: 2, komikomi: 1.5, u18senior: 1.5, tokutoku: 0.5, other: 0 };
  const baseScore = baseScoreMap[cat];
  const deviceMult = hasDevice(line) ? 2 : 1;
  const mnpMult = isMnp(line) ? 3 : 1;
  return 1 + baseScore * deviceMult * mnpMult;
}

import { creditStoreOf } from './aggregate';

function _filterReports(reports, opts) {
  const { storeId = null, month = null, staffName = null, onlyCounted = true } = opts || {};
  return reports.filter(r => {
    if (onlyCounted && r.counted === false) return false;
    if (storeId && creditStoreOf(r) !== storeId) return false;
    if (month && r._month !== month) return false;
    if (staffName && (r.proxyStaff || r.staffName) !== staffName) return false;
    return true;
  });
}

// ───── プランミックス ─────
export function planMix(reports, opts = {}) {
  const list = _filterReports(reports, opts);
  const totals = Object.fromEntries(PLAN_CAT_ORDER.map(k => [k, 0]));
  let totalMobile = 0;
  let totalIdScore = 0;
  let premiumManekatsu = 0; // マネ活2 × MNP × 端末有 = 19pt
  let premiumValue = 0;     // バリューリンク × MNP × 端末有 = 13pt
  list.forEach(r => (r.lines || []).forEach(line => {
    if (!isMobileLine(line)) return;
    totalMobile++;
    totalIdScore += lineIdScore(line);
    const cat = classifyLine(line);
    if (cat) totals[cat]++;
    if (cat === 'manekatsu2' && isMnp(line) && hasDevice(line)) premiumManekatsu++;
    if (cat === 'valuelink' && isMnp(line) && hasDevice(line)) premiumValue++;
  }));
  const highEff = totals.manekatsu2 + totals.valuelink;
  const highEffRate = totalMobile > 0 ? Math.round(highEff / totalMobile * 1000) / 10 : 0;
  const tokutokuRate = totalMobile > 0 ? Math.round(totals.tokutoku / totalMobile * 1000) / 10 : 0;
  return { totals, totalMobile, totalIdScore: Math.round(totalIdScore * 10) / 10, premiumManekatsu, premiumValue, highEffRate, tokutokuRate };
}

// ───── 絶対取る項目 ─────
const OPT_GROUPS = {
  callFlat: ['通話定額2', '通話定額ライト2', '通話放題', '通話放題ライト', '通話パック60'],
  warranty: ['故障紛失サポート', '故障紛失AppleCare', '故障紛失ワイドAppleCare'],
  setup: ['使い方サポート'],
  ponta: ['Pontaパス'],
};

export const ESSENTIAL_TARGETS = [
  { key: 'callFlat',  label: '通話定額',     target: 50, hasData: true },
  { key: 'pontaLink', label: 'Ponta連携',    target: 70, hasData: true },
  { key: 'login',     label: 'My auログイン', target: 80, hasData: true },
  { key: 'warranty',  label: '保証',         target: 90, hasData: true },
  { key: 'setup',     label: '使い方SP',     target: 35, hasData: true },
  { key: 'payCard',   label: 'PAY発行',      target: 30, hasData: true },
  { key: 'pontaPass', label: 'Pontaパス',    target: 60, hasData: true },
];

export function essentialMetrics(reports, opts = {}) {
  const list = _filterReports(reports, opts);
  let mobile = 0, mobileKojin = 0, withDevice = 0, callFlat = 0, warranty = 0, setup = 0, ponta = 0, payCard = 0, pontaLink = 0, mauLogin = 0;
  list.forEach(r => {
    // 法人契約はPonta連携・My auログインが出来ないため、率の母数から除外する
    const corp = r.contractType === 'corporate';
    (r.lines || []).forEach(line => {
      if (isMobileLine(line)) {
        mobile++;
        if (!corp) mobileKojin++;
        if (hasDevice(line)) withDevice++;
        const on = line.optNames || [];
        if (on.some(o => OPT_GROUPS.callFlat.includes(o))) callFlat++;
        if (on.some(o => OPT_GROUPS.warranty.includes(o))) warranty++;
        if (on.some(o => OPT_GROUPS.setup.includes(o))) setup++;
        if (on.some(o => OPT_GROUPS.ponta.includes(o))) ponta++;
        if (line.pontaLink) pontaLink++;
        if (line.mauLogin) mauLogin++;
      }
      if (line.midCat === 'MID_043') payCard++; // au PAYカード
    });
  });
  const rate = (a, b) => b > 0 ? Math.round(a / b * 1000) / 10 : null;
  return {
    mobile, withDevice,
    callFlat:  { count: callFlat,  rate: rate(callFlat,  mobile),     target: 50 },
    pontaLink: { count: pontaLink, rate: rate(pontaLink, mobileKojin), target: 70 },
    login:     { count: mauLogin,  rate: rate(mauLogin,  mobileKojin), target: 80 },
    warranty:  { count: warranty,  rate: rate(warranty,  withDevice),  target: 90 },
    setup:     { count: setup,     rate: rate(setup,     mobile),      target: 35 },
    payCard:   { count: payCard,   rate: rate(payCard,   mobile),      target: 30 },
    pontaPass: { count: ponta,     rate: rate(ponta,     mobile),      target: 60 },
  };
}

// ───── 足切り（世帯商材・個人商材） ─────
export const ASHI_KIRI = {
  household: [
    { midCat: 'MID_052', label: 'おうちあんしん', target: 3 },
    { midCat: 'MID_053', label: 'わんにゃん',     target: 1 },
    { midCat: 'MID_054', label: '自転車',         target: 6 },
  ],
  personal: [
    { midCat: 'MID_047', label: 'Netflix',     target: 3 },
    { midCat: 'MID_049', label: 'AppleMusic',  target: 4 },
    { midCat: 'MID_048', label: 'YouTube',     target: 3 },
    { midCat: 'MID_050', label: 'TELASA',      target: 1 },
    { midCat: 'MID_051', label: 'GoogleAI',    target: 1 },
    { midCat: 'MID_059', label: 'Amazon',      target: 3 },
  ],
};

// ───── PAYゴールド進捗（資料: 18件/月・マネ活契約者に必ず提案） ─────
export function goldProgress(reports, opts = {}) {
  const list = _filterReports(reports, opts);
  let goldNew = 0, goldRu = 0, maneContracts = 0, maneWithGold = 0;
  list.forEach(r => {
    const lines = r.lines || [];
    const hasGold = lines.some(l => ['MID_041', 'MID_042'].includes(l.midCat));
    const hasMane = lines.some(l => isMobileLine(l) && classifyLine(l) === 'manekatsu2');
    lines.forEach(l => {
      if (l.midCat === 'MID_041') goldNew++;
      if (l.midCat === 'MID_042') goldRu++;
      if (isMobileLine(l) && classifyLine(l) === 'manekatsu2') maneContracts++;
    });
    if (hasMane && hasGold) maneWithGold++;
  });
  const total = goldNew + goldRu;
  const target = 18;
  return {
    total, goldNew, goldRu, target,
    rate: Math.round(total / target * 1000) / 10,
    achieved: total >= target,
    maneContracts, maneWithGold,
    maneGoldRate: maneContracts > 0 ? Math.round(maneWithGold / maneContracts * 1000) / 10 : null,
  };
}

export function ashiKiri(reports, opts = {}) {
  const list = _filterReports(reports, opts);
  const counts = {};
  [...ASHI_KIRI.household, ...ASHI_KIRI.personal].forEach(item => counts[item.midCat] = 0);
  list.forEach(r => (r.lines || []).forEach(line => {
    if (counts[line.midCat] !== undefined) counts[line.midCat]++;
  }));
  const fill = (item) => ({ ...item, count: counts[item.midCat] || 0, achieved: (counts[item.midCat] || 0) >= item.target, remain: Math.max(0, item.target - (counts[item.midCat] || 0)) });
  const household = ASHI_KIRI.household.map(fill);
  const personal = ASHI_KIRI.personal.map(fill);
  return { household, personal, householdOK: household.every(h => h.achieved), personalOK: personal.every(p => p.achieved) };
}
