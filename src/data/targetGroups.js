// =====================================================================
// targetGroups.js  ―― 目標グループ(30) のマスタ（算定側 ver05_targetGroups.csv と一致）
// lineType: '' 区別なし / 'au' / 'uq'   internal: true 内数（合計に足さない）
// unit: '件' or '円'(物販)   codes: この群に入る MID または OPT
// =====================================================================
export const CATEGORIES = ['モバイル', '固定商材', 'LTV商材', '物販(+1C)'];

export const TARGET_GROUPS = [
  { id: 'g_au_mnp', label: 'au MNP', cat: 'モバイル', lineType: '', codes: ['MID_017', 'MID_018'], unit: '件' },
  { id: 'g_au_u18', label: 'au U18通常', cat: 'モバイル', lineType: '', codes: ['MID_005', 'MID_006'], unit: '件' },
  { id: 'g_au_o60', label: 'au O60通常', cat: 'モバイル', lineType: '', codes: ['MID_001', 'MID_002'], unit: '件' },
  { id: 'g_uq_mnp', label: 'UQ MNP', cat: 'モバイル', lineType: '', codes: ['MID_019', 'MID_020'], unit: '件' },
  { id: 'g_uq_u18', label: 'UQ U18通常', cat: 'モバイル', lineType: '', codes: ['MID_011', 'MID_012'], unit: '件' },
  { id: 'g_uq_o60', label: 'UQ O60通常', cat: 'モバイル', lineType: '', codes: ['MID_007', 'MID_008'], unit: '件' },
  { id: 'g_hs_au', label: 'HS機種変更 au', cat: 'モバイル', lineType: '', codes: ['MID_021', 'MID_022'], unit: '件' },
  { id: 'g_hs_uq', label: 'HS機種変更 UQ', cat: 'モバイル', lineType: '', codes: ['MID_023', 'MID_024'], unit: '件' },
  { id: 'g_up_au', label: 'au番号移行(UQ→au)', cat: 'モバイル', lineType: '', codes: ['MID_025', 'MID_027'], unit: '件' },
  { id: 'g_up_uq', label: 'UQ番号移行(au→UQ)', cat: 'モバイル', lineType: '', codes: ['MID_057'], unit: '件' },
  { id: 'g_hikari', label: 'auひかり', cat: '固定商材', lineType: '', codes: ['MID_030'], unit: '件' },
  { id: 'g_hikari_p1', label: 'ひかりプラスタイプ1', cat: '固定商材', lineType: '', codes: ['MID_066'], unit: '件' },
  { id: 'g_hikari_p2', label: 'ひかりプラスタイプ2', cat: '固定商材', lineType: '', codes: ['MID_067'], unit: '件' },
  { id: 'g_hikari_p3', label: 'ひかりプラスタイプ3', cat: '固定商材', lineType: '', codes: ['MID_068'], unit: '件' },
  { id: 'g_bl', label: 'BL光', cat: '固定商材', lineType: '', codes: ['MID_031'], unit: '件' },
  { id: 'g_wimax', label: 'WiMAX', cat: '固定商材', lineType: '', codes: ['MID_032'], unit: '件' },
  { id: 'g_kotei_daitai', label: '固定代替', cat: '固定商材', lineType: '', codes: ['MID_033'], unit: '件' },
  { id: 'g_ncv', label: 'NCV(CATV)', cat: '固定商材', lineType: '', codes: ['MID_063'], unit: '件' },
  { id: 'g_denki_au', label: 'でんき au', cat: 'LTV商材', lineType: 'au', codes: ['MID_045'], unit: '件' },
  { id: 'g_denki_uq', label: 'でんき UQ', cat: 'LTV商材', lineType: 'uq', codes: ['MID_045'], unit: '件' },
  { id: 'g_paycard_au', label: 'PAYカード au', cat: 'LTV商材', lineType: 'au', codes: ['MID_041', 'MID_042', 'MID_043'], unit: '件' },
  { id: 'g_paycard_uq', label: 'PAYカード UQ', cat: 'LTV商材', lineType: 'uq', codes: ['MID_041', 'MID_042', 'MID_043'], unit: '件' },
  { id: 'g_paygold_au', label: 'PAYゴールド au(内)', cat: 'LTV商材', lineType: 'au', codes: ['MID_041'], unit: '件', internal: true },
  { id: 'g_paygold_uq', label: 'PAYゴールド UQ(内)', cat: 'LTV商材', lineType: 'uq', codes: ['MID_041'], unit: '件', internal: true },
  { id: 'g_jibun_au', label: 'じぶん銀行 au', cat: 'LTV商材', lineType: 'au', codes: ['MID_044'], unit: '件' },
  { id: 'g_jibun_uq', label: 'じぶん銀行 UQ', cat: 'LTV商材', lineType: 'uq', codes: ['MID_044'], unit: '件' },
  { id: 'g_ponta_au', label: 'Pontaパス au', cat: 'LTV商材', lineType: 'au', codes: ['OPT_115'], unit: '件' },
  { id: 'g_ponta_uq', label: 'Pontaパス UQ', cat: 'LTV商材', lineType: 'uq', codes: ['OPT_115'], unit: '件' },
  { id: 'g_fp', label: '生保トス', cat: 'LTV商材', lineType: '', codes: ['MID_046'], unit: '件' },
  { id: 'g_acc', label: 'アクセサリー', cat: '物販(+1C)', lineType: '', codes: ['MID_034'], unit: '円' },
  { id: 'g_norton', label: 'Norton', cat: '物販(+1C)', lineType: '', codes: ['MID_064'], unit: '円' },
  { id: 'g_apple', label: 'Apple製品', cat: '物販(+1C)', lineType: '', codes: ['MID_036'], unit: '円' },
  { id: 'g_smart', label: 'スマート家電', cat: '物販(+1C)', lineType: '', codes: ['MID_037', 'MID_060', 'MID_061', 'MID_062'], unit: '円' },
];
