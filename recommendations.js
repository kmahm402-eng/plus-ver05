// =============================================================
// src/lib/recommendations.js
// 経営者からスタッフへの「強化推奨」と「軽いリアクション」を保存・取得する。
// 強制ではなく "問いかけ"。スタッフは次月の履修画面で参考として見る。
// 新しいコレクション recommendations / coachingReactions を使う（既存に影響なし）。
// =============================================================

import { db } from '../firebase';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';

// ---- 強化推奨を1件保存 ----
// 例：addRecommendation({ staffId, staffName, tagId:'T03', tagLabel:'マネ活転換',
//                         note:'来月ここを意識してみては？', fromName:'小野 康平', month:'2026-06' })
export async function addRecommendation({
  staffId,
  staffName,
  tagId,
  tagLabel,
  note = '',
  fromName = '',
  month,
}) {
  return await addDoc(collection(db, 'recommendations'), {
    staffId: staffId || null,
    staffName: staffName || '',
    tagId: tagId || null,
    tagLabel: tagLabel || '',
    note,
    fromName,
    month: month || null,
    status: 'open', // open → スタッフがまだ見ていない / 反映前
    staffResponse: null, // スタッフが選んだら入る
    createdAt: serverTimestamp(),
  });
}

// ---- あるスタッフへの推奨履歴を取得（新しい順） ----
export async function listRecommendations(staffId) {
  const col = collection(db, 'recommendations');
  try {
    const snap = await getDocs(
      query(col, where('staffId', '==', staffId), orderBy('createdAt', 'desc'))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // orderBy のインデックスが無い場合に備えて、絞り込みだけして手元で並べる
    const snap = await getDocs(query(col, where('staffId', '==', staffId)));
    const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    arr.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    return arr;
  }
}

// ---- 軽いリアクション（👍 🔥 💡）を保存 ----
export async function addReaction({
  staffId,
  declarationId,
  emoji,
  fromName = '',
  month,
}) {
  return await addDoc(collection(db, 'coachingReactions'), {
    staffId: staffId || null,
    declarationId: declarationId || null,
    emoji,
    fromName,
    month: month || null,
    createdAt: serverTimestamp(),
  });
}
