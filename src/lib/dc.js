/* ───────── ダブルクロージング（DC）の区分と集計 ─────────
   仕様書 v1（2026-10-03）
   A 外注自力 / B 外注着座→当社DC / C 外注声かけ→当社 / D 当社自力 / E 当社同士DC
*/
export const DC_CLASS = {
  A: { label: '外注自力', short: 'A' },
  B: { label: '外注着座→当社DC', short: 'B' },
  C: { label: '外注声かけ→当社', short: 'C' },
  D: { label: '当社自力', short: 'D' },
  E: { label: '当社同士DC', short: 'E' },
};
export const dcClass = (r) => {
  if (!r) return 'D';
  if (r.counted === false) return r.dcStaff ? 'B' : 'A';
  if (r.dcStaff) return 'E';
  return r.extApproach ? 'C' : 'D';
};
/* ダブクロ成約（dcStaff あり）だけを抽出 */
export const isDcReport = (r) => !!(r && r.dcStaff);
/* 報告の獲得者名（外注なら "外注 会社:名前"） */
export const acquirerOf = (r) => r.counted === false ? ('外注 ' + (r.extName || '')) : (r.proxyStaff || r.staffName || '');
/* 商材の要約（lines → "MNP 2・機変 1" のような短い文字列） */
export const linesSummary = (r) => {
  const m = {};
  (r.lines || []).forEach(l => {
    const k = l.mainCatName || l.midCatName || l.mainCat || '';
    m[k] = (m[k] || 0) + 1;
  });
  return Object.entries(m).map(([k, v]) => `${k} ${v}`).join('・');
};
