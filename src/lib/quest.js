// =====================================================================
// quest.js ―― 自走版（週1回の作戦会議＋毎日のホーム）の計算
// 2026-10-09 追加。既存データ（reports / staffTargets / pointConfig）を読むだけ。
// 書き込むのは weeklyQuests（1人1週1件）だけ。
// =====================================================================
import { lineToCountGroups } from './aggregate';
import { classifyLine, isMobileLine } from './tactical';

const pad = (n) => String(n).padStart(2, '0');
export const norm = (s) => (s || '').replace(/[\s　]+/g, '');
export const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const ym = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1);
export const dateOf = (r) => (r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : null);
export const whoOf = (r) => r.proxyStaff || r.staffName;
export const isCounted = (r) => (r.counted !== undefined ? r.counted : r.acqType !== 'outsource');

// 週は月曜はじまり。週のキー＝その週の月曜の日付
export function weekStart(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
export const weekKeyOf = (d = new Date()) => ymd(weekStart(d));
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// ---- 項目（敵・作戦・答え合わせで共通） ----
// kind: 'vol'＝件数でくらべる / 'rate'＝受付100件あたりでくらべる（契約の中身）
export const ITEMS = [
  { key: 'uketsuke', label: '受付の数', enemy: '受付スライム', icon: '🟤', kind: 'vol', test: (l) => isMobileLine(l) },
  { key: 'shinki', label: '新規・MNP', enemy: 'MNPスライム', icon: '🟣', kind: 'vol', groups: ['g_au_mnp', 'g_uq_mnp', 'g_au_u18', 'g_uq_u18', 'g_au_o60', 'g_uq_o60'] },
  { key: 'kihen', label: '機種変更', enemy: '機変スライム', icon: '🟢', kind: 'vol', groups: ['g_hs_au', 'g_hs_uq'] },
  { key: 'up', label: 'UQ→au', enemy: 'UQスライム', icon: '🟠', kind: 'vol', groups: ['g_up_au'] },
  { key: 'gold', label: 'ゴールド', enemy: 'ゴールドスライム', icon: '🟡', kind: 'rate', test: (l) => ['MID_041', 'MID_042'].includes(l.midCat) },
  { key: 'denki', label: 'でんき', enemy: 'でんきスライム', icon: '⚡', kind: 'rate', test: (l) => l.midCat === 'MID_045' },
  { key: 'kotei', label: '固定', enemy: '固定ゴーレム', icon: '🗿', kind: 'rate', groups: ['g_hikari', 'g_hikari_p1', 'g_hikari_p2', 'g_hikari_p3', 'g_bl', 'g_kotei_daitai', 'g_ncv', 'g_wimax'] },
  { key: 'jibun', label: 'じぶん銀行', enemy: '銀行スライム', icon: '🏦', kind: 'rate', test: (l) => l.midCat === 'MID_044' },
  { key: 'ponta', label: 'Pontaパス', enemy: 'Pontaスライム', icon: '🦝', kind: 'rate', test: (l) => isMobileLine(l) && (l.optNames || []).includes('Pontaパス') },
  { key: 'mane', label: 'マネ活', enemy: 'マネ活スライム', icon: '💰', kind: 'rate', test: (l) => isMobileLine(l) && classifyLine(l) === 'manekatsu2' },
];
export const ITEM = Object.fromEntries(ITEMS.map((i) => [i.key, i]));

// au Style 強化商材（auStyle強化商材 奨励金画面と同じ閾値）
export const STYLE = [
  { key: 'denki', label: 'でんき', threshold: 10 },
  { key: 'gold', label: 'ゴールド', threshold: 15 },
  { key: 'jibun', label: 'じぶん銀行', threshold: 40 },
  { key: 'ponta', label: 'Pontaパス', threshold: 90 },
  { key: 'mane', label: 'マネ活', threshold: 60 },
];

// 報告の配列 → 項目ごとの件数。filter(r)=trueの報告だけ数える
export function countItems(reports, filter) {
  const c = Object.fromEntries(ITEMS.map((i) => [i.key, 0]));
  for (const r of reports) {
    if (!isCounted(r)) continue;
    if (filter && !filter(r)) continue;
    for (const l of r.lines || []) {
      const gs = lineToCountGroups(l);
      for (const it of ITEMS) {
        if (it.groups) c[it.key] += gs.filter((g) => it.groups.includes(g)).length;
        else if (it.test(l)) c[it.key] += 1;
      }
    }
  }
  return c;
}

// 強化商材の率（受付100件あたり）と、閾値に対する達成度（1.0＝閾値ちょうど）
export function styleRates(counts) {
  const base = counts.uketsuke || 0;
  return STYLE.map((s) => {
    const rate = base > 0 ? Math.round((counts[s.key] / base) * 1000) / 10 : null;
    return { ...s, rate, ach: rate == null ? 0 : rate / s.threshold };
  });
}

// 答え合わせ：直近4週間の数字を、店の1人あたり平均とくらべて、いちばん低い項目を「課題」にする
//  件数の項目（受付・新規・機変・UQ→au）は件数で、中身の項目は受付100件あたりで比べる
//  受付が5件未満のときは「中身」の判定をしない（少なすぎてブレるため）
export function diagnose(mine, store, storeHeads) {
  const heads = Math.max(1, storeHeads || 1);
  const rows = ITEMS.map((it) => {
    let me, avg;
    if (it.kind === 'vol') { me = mine[it.key]; avg = store[it.key] / heads; }
    else {
      if ((mine.uketsuke || 0) < 5) return null;
      me = (mine[it.key] / mine.uketsuke) * 100;
      avg = store.uketsuke > 0 ? (store[it.key] / store.uketsuke) * 100 : 0;
    }
    const ratio = avg > 0 ? me / avg : null;
    return { key: it.key, label: it.label, kind: it.kind, me, avg, ratio };
  }).filter((r) => r && r.ratio != null);
  // 同じ低さなら、店の平均が大きい（＝取りこぼしが大きい）ほうを優先
  const sorted = rows.slice().sort((a, b) => (a.ratio - b.ratio) || (b.avg - a.avg));
  return { rows, worst: sorted[0] || null, best: sorted[sorted.length - 1] || null, sorted };
}

// じぶん診断の選択肢 → どの項目が当てはまるか
export const CHOICES = [
  { id: 'uketsuke', label: '受付の数が少ない', keys: ['uketsuke'] },
  { id: 'naka', label: '契約の中身（ゴールド・でんき・固定など）が少ない', keys: ['gold', 'denki', 'kotei', 'jibun', 'ponta', 'mane'] },
  { id: 'shinki', label: '新規・MNPが少ない', keys: ['shinki'] },
  { id: 'kihen', label: '機種変更が少ない', keys: ['kihen'] },
  { id: 'up', label: 'UQからauへの切り替えが少ない', keys: ['up'] },
];
export const choiceOfKey = (key) => CHOICES.find((c) => c.keys.includes(key)) || null;

// 作戦の候補（自分で書くこともできる）
export const ACTIONS = {
  uketsuke: ['来店したお客さまに、自分から先に声をかける', '待ち時間のお客さまに「今日はどうされましたか」と聞く'],
  shinki: ['ご家族の回線を、毎回1回はたずねる', '他社のお客さまには料金の比較表を必ず見せる'],
  kihen: ['使用年数が3年以上の方に、機種の話を必ずする', '電池の減りが早いか、毎回たずねる'],
  up: ['UQのお客さまには、auとの比較表を必ず見せる', 'UQのお客さまに家族の契約をたずねる'],
  gold: ['機種変更のお客さま全員に、ゴールドの話をする', '受付の最後に「カードはお持ちですか？」と聞く'],
  denki: ['住所変更・新生活のお客さまに、でんきの話をする', '受付の最後に電気代をたずねる'],
  kotei: ['ご自宅のネット回線を、毎回たずねる', '光回線の比較表を見せる'],
  jibun: ['ゴールドのお申込みと一緒に、じぶん銀行をご案内する', 'auPAYの残高の使い方とセットで話す'],
  ponta: ['新規・機種変更の全員に、Pontaパスの特典を見せる', 'ご案内の流れの中に毎回入れる'],
  mane: ['料金プランの説明は、マネ活から始める', 'マネ活でもらえる分を具体的に見せる'],
};

// あいぼう：先月の同じ日とくらべたペースで育つ（毎月たまごに戻らない）
export function avatarStage(ptsNow, lastSameDay) {
  const stages = [
    { at: 0, icon: '🥚', name: 'たまご' },
    { at: 0.5, icon: '🐣', name: 'ひよっこ' },
    { at: 0.8, icon: '🧑‍🎓', name: '見習い' },
    { at: 1, icon: '🧑‍🚀', name: 'ナイト（先月ペース超え）' },
    { at: 1.2, icon: '🦸', name: '勇者（先月の1.2倍）' },
  ];
  if (!lastSameDay || lastSameDay < 10) {
    const abs = [0, 10, 30, 60, 100];
    let i = 0; abs.forEach((v, k) => { if (ptsNow >= v) i = k; });
    return { ...stages[i], next: i < 4 ? abs[i + 1] - ptsNow : 0 };
  }
  const r = ptsNow / lastSameDay;
  let i = 0; stages.forEach((st, k) => { if (r >= st.at) i = k; });
  const next = i < 4 ? Math.max(1, Math.ceil(stages[i + 1].at * lastSameDay - ptsNow)) : 0;
  return { ...stages[i], next };
}

// localStorage は使えない環境もあるので、必ず try で包む
export function lsGet(k) { try { const v = window.localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
export function lsSet(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* 何もしない */ } }
