// =====================================================================
// karute-master.js  ―― 営業手法カルテ マスタデータ
// 戦術リスト・価値創造の3軸由来のフレーズ・期間オプション・自己評価
// =====================================================================

// ---- 戦術リスト（10手法 + 自由記入）----
// 各手法に「特徴」ではなく「価値の1行」を添えるのが価値創造の3軸の肝
export const TACTICS = [
  { id: 'T01', name: 'アタッチ追求型',  valueOneLiner: '家計の見える化で、お客様に "見通し" を届ける' },
  { id: 'T02', name: 'MNP集中型',      valueOneLiner: '通信費の不安から、家計の余裕への変化を作る' },
  { id: 'T03', name: 'マネ活転換型',    valueOneLiner: '節約する人生から、増やす人生への扉を開く' },
  { id: 'T04', name: '機種変アップセル', valueOneLiner: '今のスマホへの不満を、未来の便利さに変える' },
  { id: 'T05', name: '固定セット販売',   valueOneLiner: 'モバイルとネットを束ねて、家計の一体感を作る' },
  { id: 'T06', name: 'ゴールド先行',    valueOneLiner: '毎月の支払いを、毎月の還元体験に変える' },
  { id: 'T07', name: '保証必須化',      valueOneLiner: '"もしも"の不安を、"もしも"の安心に変える' },
  { id: 'T08', name: 'でんき紐づけ',    valueOneLiner: '見えない電気を、見える節約に変える' },
  { id: 'T09', name: 'Pontaパス提案',  valueOneLiner: '日常の小さな支払いを、ご褒美の積み重ねに変える' },
  { id: 'T99', name: '自由記入',       valueOneLiner: 'お客様のために、自分で考えた手法を試す', isCustom: true },
];

export const tacticName    = (id) => TACTICS.find(t => t.id === id)?.name || '';
export const tacticValue   = (id) => TACTICS.find(t => t.id === id)?.valueOneLiner || '';

// ---- 価値創造の3軸 由来のフレーズ群 ----
// 「考え始める瞬間」に表示する気づきの種
// 月によって自動ローテーション（毎月新鮮な気持ちで考えられるように）

export const PHRASES_DECLARE = [
  '数字の前に、お客様の "言葉にしていない不安" を見よう',
  '商品を売るのではなく、お客様の状態を変える',
  'お客様の困りごとの奥に、本当のニーズがある',
  '特徴ではなく、価値で選ぼう',
];

export const PHRASES_REVIEW = [
  '数字が達成しても、お客様の感情が動かなかったら？',
  '何件売れたかより、何人を笑顔にしたか',
  '今週、お客様の表情はどう変わりましたか？',
  'お客様の "ありがとう" の質は、上がっていますか？',
];

// 月によってフレーズを切り替える（同じ月は同じフレーズ）
export function getPhraseForMonth(phrases, month) {
  if (!month) return phrases[0];
  const m = parseInt(month.split('-')[1], 10) || 1;
  return phrases[(m - 1) % phrases.length];
}

// ---- 期間オプション（チェックポイントの単位）----
export const PERIOD_OPTIONS = [
  { id: 'weekly',    name: '週次',   days: 7,  desc: '7日ごとにチェックポイント（月3〜4回）' },
  { id: '5days',     name: '5日間', days: 5,  desc: '5日ごとにチェックポイント（月6回）' },
  { id: 'halfmonth', name: '半月',   days: 15, desc: '半月ごと（月2回）' },
  { id: 'monthly',   name: '月次',   days: 30, desc: '月末に1回だけ振り返り' },
];

export const periodName = (id) => PERIOD_OPTIONS.find(p => p.id === id)?.name || '';

// ---- 単位オプション（戦術の量を表す）----
export const UNIT_OPTIONS = ['件', '台', '組', '回', '%', 'pt'];

// ---- 戦術ステータス ----
export const TACTIC_STATUS = {
  IN_PROGRESS: 'in_progress',
  COMPLETED:   'completed',
  CANCELED:    'canceled',
};

// ---- 月末の自己評価（3段階）----
export const SELF_RATINGS = [
  { id: 'achieved',  label: '達成',     icon: '◎', color: '#34D399' },
  { id: 'almost',    label: 'あと一歩',  icon: '△', color: '#FBBF24' },
  { id: 'not_yet',   label: '未挑戦',    icon: '✗', color: '#94A3B8' },
];

export const ratingLabel = (id) => SELF_RATINGS.find(r => r.id === id)?.label || '';
export const ratingColor = (id) => SELF_RATINGS.find(r => r.id === id)?.color || '#94A3B8';
export const ratingIcon  = (id) => SELF_RATINGS.find(r => r.id === id)?.icon || '';

// =====================================================================
// ユーティリティ関数
// =====================================================================

// 現在月の文字列（"2026-06"）
export function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 指定月の日数（"2026-06" → 30）
export function getDaysInMonth(month) {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, m, 0).getDate();
}

// チェックポイント日付の自動生成
// 例: ('2026-06', 'weekly') → ['2026-06-07', '2026-06-14', '2026-06-21', '2026-06-28', '2026-06-30']
export function generateCheckpointDates(month, periodId) {
  const period = PERIOD_OPTIONS.find(p => p.id === periodId);
  if (!period) return [];
  const [year, m] = month.split('-').map(Number);
  const daysInMonth = new Date(year, m, 0).getDate();
  const result = [];
  let current = period.days;
  while (current <= daysInMonth) {
    result.push(`${year}-${String(m).padStart(2, '0')}-${String(current).padStart(2, '0')}`);
    current += period.days;
  }
  // 最終日（月末）が含まれていなければ必ず追加
  const lastDate = `${year}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  if (!result.includes(lastDate)) {
    result.push(lastDate);
  }
  return result;
}

// 月の経過率（"2026-06" の今日が何%消化されてるか）
export function getMonthProgress(month) {
  const [year, m] = month.split('-').map(Number);
  const today = new Date();
  const tyear = today.getFullYear();
  const tmonth = today.getMonth() + 1;
  if (tyear < year || (tyear === year && tmonth < m)) return 0;   // 未来
  if (tyear > year || (tyear === year && tmonth > m)) return 100; // 過去
  return Math.round((today.getDate() / getDaysInMonth(month)) * 100);
}

// 日付が今日以前か（チェックポイント記入可否の判定用）
export function isDatePastOrToday(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return target <= today;
}

// 月の表示用フォーマット（"2026-06" → "2026年6月"）
export function formatMonth(month) {
  if (!month) return '';
  const [y, m] = month.split('-');
  return `${y}年${parseInt(m, 10)}月`;
}

// 日付の表示用フォーマット（"2026-06-07" → "6/7"）
export function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

// 月のリスト生成（過去N月分・履歴UI用）
export function getMonthList(n = 12) {
  const result = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return result;
}
