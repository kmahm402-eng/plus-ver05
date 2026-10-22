// =====================================================================
// DirectoryContext.jsx ―― 名簿の配線盤（Phase 2）v2
// スタッフ台帳(staffDirectory)・店舗台帳(storeDirectory)を1回だけ読み、
// 全画面に配る。台帳が空・読めない場合は masters.js に自動で切り替わる
// （＝最悪でも現状どおり動く安全設計）。
// v2: ログイン後にだけ読む／管理者名簿(adminNames)対応／初回登録画面にも届く配置に対応
// 使い方：const { staffNames, staffStoreOf, storeNameOf } = useDirectory();
// 目印: directoryProvider
// =====================================================================
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { useAuth } from './AuthContext';
import { STAFF as STAFF_FB, STORES as STORES_FB, ADMINS as ADMINS_FB, staffStore as staffStoreFB, storeName as storeNameFB, hasStaffStoreMap as hasMapFB } from '../data/masters';

const norm = (s) => (s || '').replace(/[\s\u3000]+/g, '');
const DirectoryCtx = createContext(null);

export function DirectoryProvider({ children }) {
  const { user } = useAuth();
  const [staffDocs, setStaffDocs] = useState(null);   // null=まだ / []=空 / [...]=台帳あり
  const [storeDocs, setStoreDocs] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user) { setStaffDocs(null); setStoreDocs(null); setFailed(false); return; }
    const u1 = onSnapshot(collection(db, 'staffDirectory'),
      s => setStaffDocs(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => setFailed(true));
    const u2 = onSnapshot(collection(db, 'storeDirectory'),
      s => setStoreDocs(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => setFailed(true));
    return () => { u1(); u2(); };
  }, [user]);

  const value = useMemo(() => {
    // 台帳が使えるか（読めて・スタッフが1人以上いる）
    const useDir = !failed && Array.isArray(staffDocs) && staffDocs.length > 0;

    if (!useDir) {
      // ===== 安全装置：masters.js（今まで通り）で動く =====
      return {
        source: 'masters',
        ready: staffDocs !== null || failed,
        staffNames: STAFF_FB,
        staffNamesAll: STAFF_FB,
        adminNames: ADMINS_FB,
        isAdminName: (name) => ADMINS_FB.map(norm).includes(norm(name)),
        staffStoreOf: (name) => staffStoreFB(name),
        roleOf: () => 'staff',
        hasStoreMap: hasMapFB(),
        stores: STORES_FB.map((s, i) => ({ ...s, active: true, order: i })),
        mainStores: STORES_FB.filter(s => !s.isEvent),
        storeNameOf: (id) => storeNameFB(id),
      };
    }

    // ===== 台帳から組み立てる =====
    const active = staffDocs.filter(s => s.active !== false);
    const storeList = (Array.isArray(storeDocs) && storeDocs.length > 0)
      ? storeDocs.slice().sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || (a.id || '').localeCompare(b.id || ''))
      : STORES_FB.map((s, i) => ({ ...s, active: true, order: i }));
    const storeOrder = {}; storeList.forEach((s, i) => { storeOrder[s.id] = i; });

    // 管理者（社長・経理＝報告対象外）とスタッフを分ける
    const adminDocs = active.filter(s => s.role === 'admin');
    const staffOnly = active.filter(s => s.role !== 'admin');

    const sortedStaff = staffOnly.slice().sort((a, b) =>
      (storeOrder[a.storeId] ?? 999) - (storeOrder[b.storeId] ?? 999) || (a.name || '').localeCompare(b.name || '', 'ja'));

    const byNorm = {};
    staffDocs.forEach(s => { byNorm[s.nameNorm || norm(s.name)] = s; });

    // 台帳に管理者がまだ居ない間は、従来の管理者リストで補完（二段構えの保険）
    const adminNames = adminDocs.length > 0 ? adminDocs.map(s => s.name) : ADMINS_FB;
    const adminNormSet = new Set([...adminNames.map(norm), ...ADMINS_FB.map(norm)]);

    return {
      source: 'directory',
      ready: true,
      // 在籍中スタッフ（報告・集計対象）の名前一覧 ※管理者は含まない
      staffNames: sortedStaff.map(s => s.name),
      // 退職者も含む全名簿（過去月の集計で必要になったとき用）
      staffNamesAll: staffDocs.map(s => s.name),
      // 管理者・経理（報告対象外）
      adminNames,
      isAdminName: (name) => adminNormSet.has(norm(name)),
      // 所属店（表記ゆれはスペース除去で照合。台帳に無い名前はmastersで補完）
      staffStoreOf: (name) => (byNorm[norm(name)] && byNorm[norm(name)].storeId) || staffStoreFB(name) || null,
      // 名簿上の役職（staff/manager/director/admin）
      roleOf: (name) => (byNorm[norm(name)] && byNorm[norm(name)].role) || 'staff',
      hasStoreMap: true,
      // 店舗（休止中は除く）
      stores: storeList.filter(s => s.active !== false),
      // メイン店舗（イベント店・休止店を除く）
      mainStores: storeList.filter(s => !s.isEvent && s.active !== false),
      storeNameOf: (id) => (storeList.find(s => s.id === id) || {}).name || storeNameFB(id) || id,
    };
  }, [staffDocs, storeDocs, failed]);

  return <DirectoryCtx.Provider value={value}>{children}</DirectoryCtx.Provider>;
}

export const useDirectory = () => useContext(DirectoryCtx);
