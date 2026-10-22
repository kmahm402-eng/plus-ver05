// =====================================================================
// points.js ―― 社内ポイント計算の中核（2026年6月開始・新体系）
// プラン × 端末 × MNP の組み合わせで点数が決まる新体系。
// 仕様は『社内ポイント制度_2026年6月開始_スタッフ説明書』が正本。
// 1pt = ¥80 固定・個人の上限なし。
// 2026-10-04：MNP系5項目（端末有3・SIMのみ2）の標準点数を2倍に変更（10月から）。
// =====================================================================
import { classifyLine, hasDevice, isMnp } from './tactical';

export const YEN_PER_POINT = 80;

// ---- 各項目: pt=1件あたり点数 / cap=最大点(個人・月, null=上限なし) / grp=表示分類 ----
export const POINT_ITEMS = {
  // 🆕 新規ID系（プラン × 端末 × MNP）
  mane_mnp_dev:    { label: 'マネ活2 MNP端末有',          pt: 20, cap: null, grp: '新規ID' },
  mane_kddi_dev:   { label: 'マネ活2 KDDI内移行端末有',   pt: 10, cap: null, grp: '新規ID' },
  value_mnp_dev:   { label: 'バリューリンク MNP端末有',   pt: 14, cap: null, grp: '新規ID' },
  komi_mnp_dev:    { label: 'コミコミ MNP端末有',         pt: 8,  cap: null, grp: '新規ID' },
  mane_new_dev:    { label: 'マネ活2 通常新規端末有',     pt: 4,  cap: null, grp: '新規ID' },
  value_mnp_sim:   { label: 'バリューリンク MNP SIMのみ', pt: 6,  cap: null, grp: '新規ID' },
  value_new_dev:   { label: 'バリューリンク 通常新規端末有', pt: 3, cap: null, grp: '新規ID' },
  komi_mnp_sim:    { label: 'コミコミ MNP SIMのみ',       pt: 4,  cap: null, grp: '新規ID' },
  u18_new_dev:     { label: 'U18/シニア 通常新規端末有',  pt: 1,  cap: null, grp: '新規ID' },
  komi_new_dev:    { label: 'コミコミ 通常新規端末有',    pt: 1,  cap: null, grp: '新規ID' },
  toku_new_dev:    { label: 'トクトク 通常新規端末有',    pt: 1,  cap: null, grp: '新規ID' },
  houjin_sp:       { label: '法人SP',                    pt: 1,  cap: null, grp: '新規ID' },

  // 🔁 LTV系（継続商材）
  network:         { label: 'ネットワーク商品(固定)',     pt: 7,  cap: null, grp: 'LTV' },
  pay_gold:        { label: 'PAYゴールド',                pt: 4,  cap: null, grp: 'LTV' },
  pay_card:        { label: 'PAYカード',                  pt: 2,  cap: null, grp: 'LTV' },
  denki:           { label: 'auでんき',                   pt: 2,  cap: null, grp: 'LTV' },
  jibun:           { label: 'じぶん銀行口座開設',          pt: 1,  cap: null, grp: 'LTV' },
  wimax:           { label: 'UQ WiMAX',                  pt: 1,  cap: null, grp: 'LTV' },
  setai:           { label: '世帯商材',                   pt: 1,  cap: null, grp: 'LTV' },
  kojin:           { label: '個人商材',                   pt: 1,  cap: null, grp: 'LTV' },
  kishuhen:        { label: '機種変更',                   pt: 1,  cap: null, grp: 'LTV' },
  sonota:          { label: 'その他',                     pt: 1,  cap: null, grp: 'LTV' },
};

// ---- 対応セット ----
const UPSELL    = ['MID_025', 'MID_026', 'MID_027'];           // KDDI内移行（アップセル UQ→au）
const RECOUP    = ['MID_035', 'MID_057'];                       // リクープ（au→UQ）→ 対象外
const NETWORK   = ['MID_030', 'MID_031', 'MID_033', 'MID_063', 'MID_066', 'MID_067', 'MID_068']; // 固定: auひかり/BL光/固定代替/NCV/ひかりプラスタイプ1-3
const SETAI     = ['MID_052', 'MID_053', 'MID_054'];            // 世帯商材: おうち/わんにゃん/自転車
const KOJIN     = ['MID_047', 'MID_048', 'MID_049', 'MID_050', 'MID_051', 'MID_059', 'MID_065']; // 個人商材（MID_065=Apple One）

// 1ライン → {itemId: 件数}
export function linePoints(line, report) {
  const mid = line.midCat;
  const mainCat = line.mainCat;
  const corporate = report.contractType === 'corporate';
  const add = {};
  const inc = (k, n = 1) => { add[k] = (add[k] || 0) + n; };

  // ===== 新規/MNP/番号移行（MAIN_001 / MAIN_002 / MAIN_004）=====
  if (['MAIN_001', 'MAIN_002', 'MAIN_004'].includes(mainCat)) {
    // リクープ（au→UQ番号移行）は対象外
    if (RECOUP.includes(mid)) return add;

    // 法人契約はプラン無関係に「法人SP」1pt
    if (corporate) { inc('houjin_sp'); return add; }

    const cat = classifyLine(line);  // manekatsu2 / valuelink / komikomi / u18senior / tokutoku / other / null
    const dev = hasDevice(line);     // 端末有
    const mnp = isMnp(line);         // MAIN_002（MNP）
    const upsell = UPSELL.includes(mid);  // KDDI内移行アップセル

    if (cat === 'manekatsu2') {
      if (mnp && dev) inc('mane_mnp_dev');
      else if (upsell && dev) inc('mane_kddi_dev');
      else if (dev) inc('mane_new_dev');
      else inc('sonota');  // SIMのみマネ活2等、資料に明記なし→「その他」最低1pt
    } else if (cat === 'valuelink') {
      if (mnp && dev) inc('value_mnp_dev');
      else if (mnp) inc('value_mnp_sim');
      else if (dev) inc('value_new_dev');
      else inc('sonota');
    } else if (cat === 'komikomi') {
      if (mnp && dev) inc('komi_mnp_dev');
      else if (mnp) inc('komi_mnp_sim');
      else if (dev) inc('komi_new_dev');
      else inc('sonota');
    } else if (cat === 'u18senior') {
      if (dev) inc('u18_new_dev');
      else inc('sonota');
    } else if (cat === 'tokutoku') {
      if (dev) inc('toku_new_dev');
      else inc('sonota');
    } else {
      // プラン未分類 → 最低保証「その他」1pt
      inc('sonota');
    }
    return add;
  }

  // ===== 機種変更（MAIN_003）=====
  if (mainCat === 'MAIN_003') {
    inc('kishuhen');
    return add;
  }

  // ===== 固定（MAIN_005）=====
  if (NETWORK.includes(mid)) { inc('network'); return add; }
  if (mid === 'MID_032') { inc('wimax'); return add; }

  // ===== LTV（MAIN_006）=====
  if (mid === 'MID_041' || mid === 'MID_042') { inc('pay_gold'); return add; }  // PAYゴールド
  if (mid === 'MID_043') { inc('pay_card'); return add; }                       // PAYカード
  if (mid === 'MID_044') { inc('jibun'); return add; }                          // じぶん銀行
  if (mid === 'MID_045') { inc('denki'); return add; }                          // auでんき（※都市ガスは別MIDで対象外）
  if (SETAI.includes(mid)) { inc('setai'); return add; }
  if (KOJIN.includes(mid)) { inc('kojin'); return add; }

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
      const addition = linePoints(line, r);
      for (const k in addition) counts[k] = (counts[k] || 0) + addition[k];
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
