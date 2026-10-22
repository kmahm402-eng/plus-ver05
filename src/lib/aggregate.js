// =====================================================================
// aggregate.js  ―― 達成率の中核ロジック（テスト済み）
// 報告レコード → 目標グループ別の件数/金額 → 達成率。ルールはここに集約。
// =====================================================================
import { TARGET_GROUPS, CATEGORIES } from '../data/targetGroups';
import { EVENT_HOST } from '../data/masters';

// code(MID/OPT) → 該当グループ の索引
const CODE_INDEX = {};
for (const g of TARGET_GROUPS) for (const c of g.codes) (CODE_INDEX[c] = CODE_INDEX[c] || []).push(g);

// 1本のラインが入る件数グループ（物販=円は別）。回線(lineType)でau/uqを確定。
export function lineToCountGroups(line) {
  const lt = line.lineType || '';
  const codes = [line.midCat, ...((line.opts) || [])].filter(Boolean);
  const hits = [];
  for (const code of codes) {
    for (const g of (CODE_INDEX[code] || [])) {
      if (g.unit !== '件') continue;
      if (g.lineType && g.lineType !== lt) continue;
      hits.push(g.id);
    }
  }
  return hits;
}

// 計上先店舗（計上ルール）
// 獲得店舗で計上（旧システム同様の獲得先カウント）。
// ただしイベント店(STORE_007〜009)での獲得は、主催店（開通店）に合算する。
// → 全体の数字 ＝ 店舗内訳の合計 が必ず一致する（行方不明ゼロ）。
export function creditStoreOf(report) {
  const sid = report.storeId || null;
  return EVENT_HOST[sid] || sid;
}

// 報告配列 → 集計。opts: {storeId, month, staffName, onlyCounted=true}
export function aggregate(reports, opts = {}) {
  const { storeId = null, month = null, staffName = null, onlyCounted = true } = opts;
  const byGroup = {}; for (const g of TARGET_GROUPS) byGroup[g.id] = 0;
  let plus1cTotal = 0;

  for (const r of reports) {
    const counted = (r.counted !== undefined) ? r.counted : (r.acqType !== 'outsource');
    if (onlyCounted && !counted) continue;
    if (storeId && creditStoreOf(r) !== storeId) continue;
    if (staffName && (r.proxyStaff || r.staffName) !== staffName) continue;
    if (month && r._month && r._month !== month) continue;

    for (const line of (r.lines || [])) {
      for (const gid of lineToCountGroups(line)) byGroup[gid] += 1;
      const amt = Number(line.plus1c || 0);
      if (amt > 0) plus1cTotal += amt;
    }
  }

  const byCategory = {}; for (const c of CATEGORIES) byCategory[c] = 0;
  let goldInternal = 0;
  for (const g of TARGET_GROUPS) {
    if (g.unit !== '件') continue;
    if (g.internal) { goldInternal += byGroup[g.id]; continue; }
    byCategory[g.cat] += byGroup[g.id];
  }
  const grandTotal = byCategory['モバイル'] + byCategory['固定商材'] + byCategory['LTV商材'];
  return { byGroup, byCategory, grandTotal, goldInternal, plus1cTotal };
}

export function rate(actual, target) {
  if (!target || target <= 0) return null;
  return Math.round((actual / target) * 1000) / 10;
}
export function remaining(actual, target) {
  if (!target || target <= 0) return null;
  return Math.max(0, target - actual);
}
export { TARGET_GROUPS, CATEGORIES };
