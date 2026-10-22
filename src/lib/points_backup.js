// =====================================================================
// points.js ―― 社内ポイント計算の中核（①固定¥80×ポイント）
// 仕様は算定側Ver05が正本。点数を変えるときは POINT_ITEMS と 下の対応セットを直す。
// 依存なしの純粋ロジック（そのままテストできる）。
// =====================================================================
export const YEN_PER_POINT = 80;
const PONTA_OPT = 'OPT_115';

// 各項目: pt=1件あたり点数 / cap=最大点(個人・月, null=上限なし) / grp=表示分類
export const POINT_ITEMS = {
  sp2_au_mnp:     { label: 'SP2 au MNP',          pt: 12, cap: null, grp: '新規ID' },
  sp2_uq_mnp:     { label: 'SP2 UQ MNP',          pt: 11, cap: null, grp: '新規ID' },
  mochikomi_mnp:  { label: '持込MNP(SIMのみ)',     pt: 10, cap: null, grp: '新規ID' },
  kddi_iko:       { label: 'KDDI内移行(アップセル)', pt: 8, cap: null, grp: '新規ID' },
  houjin_sp:      { label: '法人SP',              pt: 6,  cap: null, grp: '新規ID' },
  sp2_new:        { label: 'SP2 通常新規',         pt: 2,  cap: null, grp: '新規ID' },
  fp:             { label: 'FP(生保トス)',         pt: 2,  cap: null, grp: '新規ID' },
  tablet_line:    { label: '回線付タブレット',      pt: 1,  cap: null, grp: '新規ID' },
  mamorino:       { label: 'mamorino',            pt: 1,  cap: null, grp: '新規ID' },
  manekatsu2:     { label: 'マネ活2転換',          pt: 6,  cap: null, grp: 'LTV' },
  kishuhen:       { label: '機種変更',            pt: 2,  cap: 30,   grp: 'LTV' },
  au_certified:   { label: 'au Certified総販',     pt: 1,  cap: 2,    grp: 'LTV' },
  tablet_total:   { label: 'タブレット総販',        pt: 1,  cap: 3,    grp: 'LTV' },
  network:        { label: 'ネットワーク商品(固定)', pt: 8,  cap: 30,   grp: 'LTV' },
  wimax:          { label: 'UQ WiMAX',            pt: 1,  cap: 3,    grp: 'LTV' },
  pay_gold:       { label: 'PAYゴールド発行',      pt: 5,  cap: 20,   grp: 'LTV' },
  pay_card:       { label: 'PAYカード発行',        pt: 3,  cap: 20,   grp: 'LTV' },
  jibun:          { label: 'じぶん銀行開設',        pt: 1,  cap: 5,    grp: 'LTV' },
  denki:          { label: 'auでんき',            pt: 3,  cap: 5,    grp: 'LTV' },
  hosho:          { label: '保証サービス',          pt: 2,  cap: 8,    grp: 'LTV' }, // 1件+2
  mochikomi_hosho:{ label: '持込故障サポート',      pt: 1,  cap: 2,    grp: 'LTV' }, // 1件+1
  ponta:          { label: 'Pontaパス',           pt: 1,  cap: 3,    grp: 'LTV' },
  tsuwa:          { label: '通話定額',            pt: 1,  cap: 1,    grp: 'LTV' }, // 1件+1
  setai:          { label: '世帯商材',            pt: 2,  cap: 7,    grp: 'LTV' },
  kojin:          { label: '個人商材',            pt: 2,  cap: 6,    grp: 'LTV' },
};

// ---- 対応セット（どの報告がどの項目になるか）----
const MNP        = ['MID_017', 'MID_018', 'MID_019', 'MID_020'];
const NEW_O19    = ['MID_003', 'MID_004', 'MID_009', 'MID_010', 'MID_015']; // O19〜O59 新規 → 対象外
const NEW_ALL    = ['MID_001','MID_002','MID_003','MID_004','MID_005','MID_006','MID_007','MID_008','MID_009','MID_010','MID_011','MID_012','MID_013','MID_014','MID_015'];
const UPSELL     = ['MID_025', 'MID_026', 'MID_027'];           // アップセル UQ→au
const KISHUHEN   = ['MID_021', 'MID_022', 'MID_023', 'MID_024'];
const TABLET_TOT = ['MID_038', 'MID_029', 'MID_060', 'MID_061', 'MID_062']; // タブ物販/タブ機変/ウォッチ/体重計/リング
const NETWORK    = ['MID_030', 'MID_031', 'MID_033', 'MID_063']; // ひかり/BL光/固定代替/NCV
const HOSHO_OPT  = ['OPT_107', 'OPT_108', 'OPT_109'];
const TSUWA_OPT  = ['OPT_101', 'OPT_102', 'OPT_103', 'OPT_104'];
const MANEKATSU2 = ['P_108', 'P_136'];                          // 使い放題MAX+マネ活2 / バリューリンクマネ活2
const SETAI      = ['MID_052', 'MID_053', 'MID_054'];           // おうち/わんにゃん/自転車
const KOJIN      = ['MID_047', 'MID_048', 'MID_049', 'MID_050', 'MID_051', 'MID_059']; // コンテンツ系

// 1ライン → {itemId: 件数}
export function linePoints(line, report) {
  const mid = line.midCat;
  const corporate = report.contractType === 'corporate';
  const opts = line.opts || [];
  const plans = line.plans || [];
  const add = {};
  const inc = (k, n = 1) => { add[k] = (add[k] || 0) + n; };

  // 新規ID（回線）
  if (MNP.includes(mid)) {
    if (corporate) inc('houjin_sp');
    else if (mid === 'MID_018') inc('sp2_au_mnp');
    else if (mid === 'MID_020') inc('sp2_uq_mnp');
    else inc('mochikomi_mnp');                 // 017/019 SIMのみ
  } else if (NEW_ALL.includes(mid)) {
    if (!NEW_O19.includes(mid)) {              // O60/U18のみ計上
      if (corporate) inc('houjin_sp'); else inc('sp2_new');
    }
  } else if (UPSELL.includes(mid)) {
    inc('kddi_iko');
  }
  // MID_035/057(au→UQ・リクープ) は対象外

  if (mid === 'MID_016') inc('tablet_line');
  if (mid === 'MID_046') inc('fp');
  if ((line.model || '').toLowerCase().includes('mamorino')) inc('mamorino');

  // LTV
  if (KISHUHEN.includes(mid)) inc('kishuhen');
  if (plans.some(p => MANEKATSU2.includes(p))) inc('manekatsu2');
  if ((line.maker || '') === 'Apple Certified') inc('au_certified');
  if (TABLET_TOT.includes(mid)) inc('tablet_total');
  if (NETWORK.includes(mid)) inc('network');
  if (mid === 'MID_032') inc('wimax');
  if (mid === 'MID_041') inc('pay_gold');
  if (mid === 'MID_043') inc('pay_card');
  if (mid === 'MID_044') inc('jibun');
  if (mid === 'MID_045') inc('denki');
  if (mid === 'MID_056') inc('mochikomi_hosho');
  if (SETAI.includes(mid)) inc('setai');
  if (KOJIN.includes(mid)) inc('kojin');
  if (opts.includes(PONTA_OPT)) inc('ponta');
  opts.forEach(o => { if (HOSHO_OPT.includes(o)) inc('hosho'); if (TSUWA_OPT.includes(o)) inc('tsuwa'); });

  return add;
}

// 報告配列 → スタッフ別 月間ポイント（上限適用）→ ¥
export function computePoints(reports, { month = null, staffName = null, config = null, excludedMids = null } = {}) {
  // configはデフォルトを上書きする差分（pt/cap/enabled）。label/grpは常にPOINT_ITEMSから取る
  const items = {};
  Object.keys(POINT_ITEMS).forEach(k => {
    const def = POINT_ITEMS[k];
    const ov = (config && config[k]) || {};
    items[k] = {
      label: def.label,
      grp: def.grp,
      pt: ov.pt !== undefined ? ov.pt : def.pt,
      cap: ov.cap !== undefined ? ov.cap : def.cap,
      enabled: ov.enabled !== false,
    };
  });
  const excluded = excludedMids || [];
  const counts = {};
  for (const r of reports) {
    const counted = r.counted !== undefined ? r.counted : (r.acqType !== 'outsource');
    if (!counted) continue;                       // 外注は対象外
    if (month && r._month && r._month !== month) continue;
    const who = r.proxyStaff || r.staffName;
    if (staffName && who !== staffName) continue;
    for (const line of (r.lines || [])) {
      if (excluded.includes(line.midCat)) continue; // 除外MIDはスキップ
      const add = linePoints(line, r);
      for (const k in add) counts[k] = (counts[k] || 0) + add[k];
    }
  }
  let total = 0; const byItem = {};
  for (const k in counts) {
    const it = items[k]; if (!it) continue;
    if (it.enabled === false) continue;
    let pts = counts[k] * it.pt;
    if (it.cap != null) pts = Math.min(pts, it.cap);
    byItem[k] = { label: it.label, grp: it.grp, count: counts[k], points: pts };
    total += pts;
  }
  return { byItem, totalPoints: total, yen: total * YEN_PER_POINT };
}
