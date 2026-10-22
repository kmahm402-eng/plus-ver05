// =============================================================
// src/lib/dashboard.js
// 経営者ダッシュボード用：データの読み込みと集計
// 既存の karute（declarations）と同じ plus-ver05 の Firestore を読むだけ（観察専用）。
// 推奨の保存は recommendations.js が担当。PM OPTIMIZER には触れない。
//
// ★ declarations の実データ構造（カルテ本体に合わせている）
//   {
//     staffName: "小野 康平",       ← 誰のものか（氏名で持つ。ID番号は無い）
//     month: "2026-06",
//     tactics: [{
//       id:"T01", name:"アタッチ追求型",
//       selectedReason, providedValue,
//       quantity:20, unit:"件", period:"weekly",
//       checkpoints:[{date, planned, actual, goodPoints, badPoints, customerInsight, submitted}],
//       status
//     }],
//     monthlyReview:{ selfRating, goodPoints, badPoints, customerLearning, nextMonthMemo, submittedAt },
//     createdAt, updatedAt
//   }
// =============================================================

import { db } from '../firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

// ---- 店舗の並び（目標設定の6店舗） ----
export const STORES = [
  'イオン上磯',
  '中道',
  '日吉',
  '松前',
  'サテライト上磯',
  'アットモバイル',
];

// ---- カルテの戦術（レーダーの軸／強化推奨の選択肢）。karute-master.js と同じ並び ----
// 自由記入(T99)は「推奨」対象にしないので含めていない（軸には自動で出る場合あり）。
export const TACTICS = [
  { id: 'T01', label: 'アタッチ追求' },
  { id: 'T02', label: 'MNP集中' },
  { id: 'T03', label: 'マネ活転換' },
  { id: 'T04', label: '機種変アップセル' },
  { id: 'T05', label: '固定セット' },
  { id: 'T06', label: 'ゴールド先行' },
  { id: 'T07', label: '保証必須化' },
  { id: 'T08', label: 'でんき紐づけ' },
  { id: 'T09', label: 'Pontaパス提案' },
];

// 今月（例：'2026-06'）
export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// =============================================================
// アクセサ（実フィールド名。少しの表記ゆれにも一応備える）
// =============================================================
const val = (o, keys, fb = undefined) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return fb;
};

export const getStaffName = (dec) =>
  val(dec, ['staffName', 'name', 'authorName'], '');

const getTactics = (dec) => {
  const a = val(dec, ['tactics', 'strategies'], []);
  return Array.isArray(a) ? a : [];
};

const getReview = (dec) => val(dec, ['monthlyReview', 'monthEnd', 'review'], null);

const getSelfRating = (dec) => {
  const r = getReview(dec);
  return r ? val(r, ['selfRating', 'selfEval', 'rating'], null) : null;
};

// 自己評価 → 点数（◎/達成=100、△/あと一歩=60、✗/未挑戦=25）
const ratingToScore = (e) => {
  if (e == null) return null;
  const s = String(e);
  if (s.includes('◎') || s.includes('達成')) return 100;
  if (s.includes('△') || s.includes('あと一歩')) return 60;
  if (s.includes('✗') || s.includes('×') || s.includes('x') || s.includes('未挑戦')) return 25;
  return null;
};

// 日付らしきものを Date に
const toDate = (v) => {
  if (!v) return null;
  if (typeof v?.toDate === 'function') return v.toDate(); // Firestore Timestamp
  if (typeof v === 'number') return new Date(v);
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

// 1戦術の達成度（チェックポイントの実績合計 ÷ quantity）。無ければ null
const tacticAchievement = (tactic) => {
  const target = Number(val(tactic, ['quantity', 'target', 'amount'], NaN));
  if (!target || isNaN(target)) return null;
  const cps = Array.isArray(tactic.checkpoints) ? tactic.checkpoints : [];
  let actual = 0;
  let has = false;
  cps.forEach((c) => {
    const a = Number(val(c, ['actual'], NaN));
    if (!isNaN(a)) {
      actual += a;
      has = true;
    }
  });
  if (!has) return null;
  return Math.max(0, Math.min(120, Math.round((actual / target) * 100)));
};

// チェックポイントに「何か入力済み」があるか
const hasProgress = (dec) =>
  getTactics(dec).some((t) =>
    (Array.isArray(t.checkpoints) ? t.checkpoints : []).some(
      (c) =>
        (c.actual !== null && c.actual !== undefined && c.actual !== '') ||
        c.goodPoints ||
        c.badPoints ||
        c.customerInsight
    )
  );

// 月末振り返りが書かれているか
const hasReview = (dec) => {
  const r = getReview(dec);
  return !!(r && (r.selfRating || r.goodPoints || r.customerLearning || r.nextMonthMemo));
};

// =============================================================
// 読み込み
// =============================================================
export async function fetchStaff() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map((d) => {
    const u = d.data();
    return {
      id: d.id,
      name: val(u, ['name', 'displayName', 'profileName'], '(名前未設定)'),
      store: val(u, ['store', 'shop', 'storeName', 'tenpo'], ''),
      role: val(u, ['role', 'position'], ''),
      email: val(u, ['email'], ''),
    };
  });
}

export async function fetchDeclarations(month) {
  const col = collection(db, 'declarations');
  let snap;
  try {
    snap = await getDocs(query(col, where('month', '==', month)));
    if (snap.empty) snap = await getDocs(col);
  } catch (e) {
    snap = await getDocs(col);
  }
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((dec) => {
      const m = val(dec, ['month', 'ym'], null);
      return !month || !m || m === month;
    });
}

// =============================================================
// 氏名でグループ化（declarations は氏名で持っているため）
// =============================================================
export function groupDeclarationsByName(declarations) {
  const m = {};
  declarations.forEach((dec) => {
    const name = getStaffName(dec);
    if (!name) return;
    (m[name] = m[name] || []).push(dec);
  });
  return m;
}

// =============================================================
// レーダー用スコア
// 戻り値：{ tacticId: { label, score(0-100|null), tried } }
// =============================================================
export function buildRadar(decsOfStaff) {
  const axes = {};
  TACTICS.forEach((t) => {
    axes[t.id] = { label: t.label, scores: [], tried: false };
  });

  decsOfStaff.forEach((dec) => {
    const selfScore = ratingToScore(getSelfRating(dec));
    getTactics(dec).forEach((t) => {
      const id = val(t, ['id', 'tagId', 'code'], null) || (typeof t === 'string' ? t : null);
      if (!id) return;
      const label = val(t, ['name', 'label', 'title'], id);
      if (!axes[id]) axes[id] = { label, scores: [], tried: false };
      axes[id].tried = true;
      const ta = tacticAchievement(t);
      if (ta !== null) axes[id].scores.push(ta);
      else if (selfScore !== null) axes[id].scores.push(selfScore);
    });
  });

  const out = {};
  Object.entries(axes).forEach(([id, v]) => {
    let score = v.scores.length
      ? Math.round(v.scores.reduce((a, b) => a + b, 0) / v.scores.length)
      : null;
    // 宣言済みだが達成度・自己評価がまだ未記入の戦術は「挑戦中」として中間値で表示
    // （宣言した瞬間にレーダーが動くようにする。実績/自己評価が入れば本来の値に上書きされる）
    if (score === null && v.tried) score = 50;
    out[id] = { label: v.label, score, tried: v.tried };
  });
  return out;
}

// =============================================================
// 活動フィード（新しい順）
// staffByName: { 氏名: { store } }
// =============================================================
export function buildActivityFeed(declarations, staffByName = {}) {
  const items = declarations.map((dec) => {
    const name = getStaffName(dec) || '(不明)';
    const store = staffByName[name]?.store || '';
    const created = toDate(val(dec, ['createdAt', 'created', 'declaredAt'], null));
    const updated = toDate(val(dec, ['updatedAt', 'updated'], null)) || created;

    let kind = '今月の宣言';
    if (hasReview(dec)) kind = '月末の振り返り';
    else if (hasProgress(dec)) kind = '進捗の振り返り';

    const tacticLabels = getTactics(dec)
      .map((t) => val(t, ['name', 'label'], '') || val(t, ['id'], ''))
      .filter(Boolean)
      .slice(0, 3)
      .join('・');

    return { id: dec.id, name, store, kind, tacticLabels, at: updated || created || null };
  });

  items.sort((a, b) => (b.at ? b.at.getTime() : 0) - (a.at ? a.at.getTime() : 0));
  return items;
}

// 月末振り返りを画面表示用に整える
export function reviewView(dec) {
  const r = getReview(dec) || {};
  return {
    selfRating: r.selfRating || '—',
    goodPoints: r.goodPoints || '—',
    badPoints: r.badPoints || '—',
    learned: r.customerLearning || r.learned || '—',
    nextMemo: r.nextMonthMemo || r.message || '—',
  };
}

// 一覧用：カルテの入力ステージを判定
//  declared … 宣言したか / progress … 途中の振り返りをしたか
//  review … 月末総括を書いたか / hasBad … 課題点(ダメだったこと)を書いたか
export function karuteStatus(decs) {
  if (!decs || decs.length === 0) {
    return { declared: false, progress: false, review: false, hasBad: false, count: 0 };
  }
  const progress = decs.some(hasProgress);
  const review = decs.some(hasReview);
  const hasBad = decs.some((dec) => {
    const r = getReview(dec);
    if (r && r.badPoints) return true;
    return getTactics(dec).some((t) =>
      (Array.isArray(t.checkpoints) ? t.checkpoints : []).some((c) => c.badPoints)
    );
  });
  return { declared: true, progress, review, hasBad, count: decs.length };
}

// 一覧に出す自己評価記号
export function staffSelfRating(decs) {
  if (!decs || decs.length === 0) return '—';
  const last = decs[decs.length - 1];
  return getSelfRating(last) || '—';
}

export function timeAgo(date) {
  if (!date) return '';
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}
