// =====================================================================
// StaffAdmin.jsx ―― スタッフ・店舗管理
// 管理者専用。Firestoreの staffDirectory / storeDirectory を編集する。
//
// 2026-08-01 追加（目印: roleSync2026）
//   これまで「名簿の役職」と「ログイン権限(users)」が別管理で、名簿で店長に
//   しても本人の画面が変わらなかった。以下を追加して連動させる。
//   ① 役割を保存すると、その人の users.role も一緒に書き換える
//   ② 「🔑 ログイン権限の状態」カードで食い違いを表示し、ボタン一つでそろえる
//   ③ 「部長(director)」は権限としては店長と同じ manager で動かす
//      （AuthContext と firestore.rules が director を知らないため）
// 目印: staffDirectorySeed
// =====================================================================
import { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { STORES, STAFF, staffStore } from '../data/masters';

const C = { gold: '#FBBF24', green: '#34D399', blue: '#38BDF8', red: '#F87171', purple: '#A78BFA', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B', dim: '#475569' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };
const inp = { width: '100%', padding: '9px 10px', borderRadius: 9, border: '1px solid #2A2640', background: '#1C1830', color: '#fff', fontSize: 13, boxSizing: 'border-box' };
const btn = (bg, col = '#0F0D1A') => ({ padding: '9px 14px', borderRadius: 9, border: 'none', background: bg, color: col, fontSize: 12.5, fontWeight: 800, cursor: 'pointer' });
const norm = (s) => (s || '').replace(/[\s\u3000]+/g, '');
const todayS = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// 名簿上の役職。ここを変えると users(ログイン権限) にも反映される（roleSync2026）
const ROLES = [
  { id: 'staff', name: 'スタッフ', color: C.mut },
  { id: 'event', name: 'イベント担当', color: C.green },
  { id: 'manager', name: '店長', color: C.gold },
  { id: 'director', name: '部長', color: C.purple },
  { id: 'admin', name: '管理者', color: C.blue },
];
const roleName = (id) => ROLES.find(r => r.id === id)?.name || 'スタッフ';
const roleColor = (id) => ROLES.find(r => r.id === id)?.color || C.mut;

// 名簿の役職 → ログイン権限(users.role) の対応表。
// 部長は権限としては店長と同じ manager（AuthContext/rules が director を知らないため）
const AUTH_ROLE = { staff: 'staff', event: 'event', manager: 'manager', director: 'manager', admin: 'admin' };
const authRoleOf = (id) => AUTH_ROLE[id] || 'staff';
const AUTH_LABEL = { admin: '管理者', manager: '店長・部長', event: 'イベント担当', staff: 'スタッフ' };
const authName = (r) => AUTH_LABEL[r] || 'スタッフ';

// 取り込み時に店長として登録する4名（あとから画面で変更可能）
const SEED_MANAGERS = ['柳沼千絵', '竹内由', '高橋亜紀子', '増川美由紀'];

export default function StaffAdmin() {
  const [tab, setTab] = useState('staff');            // 'staff' | 'store'
  const [staffDocs, setStaffDocs] = useState(null);   // null=読み込み中
  const [storeDocs, setStoreDocs] = useState(null);
  const [userDocs, setUserDocs] = useState(null);     // ログインアカウント（users）
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // ---- 追加フォーム ----
  const [newName, setNewName] = useState('');
  const [newStore, setNewStore] = useState('STORE_001');
  const [newRole, setNewRole] = useState('staff');
  const [newStoreName, setNewStoreName] = useState('');
  // ---- 編集中 ----
  const [editId, setEditId] = useState(null);
  const [editStore, setEditStore] = useState('');
  const [editRole, setEditRole] = useState('staff');
  const [editStoreId, setEditStoreId] = useState(null);
  const [editStoreName, setEditStoreName] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'staffDirectory'), s => setStaffDocs(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => setErr('スタッフ名簿の読み込みに失敗：' + e.message));
    const u2 = onSnapshot(collection(db, 'storeDirectory'), s => setStoreDocs(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => setErr('店舗一覧の読み込みに失敗：' + e.message));
    const u3 = onSnapshot(collection(db, 'users'), s => setUserDocs(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => setErr('ログインアカウントの読み込みに失敗：' + e.message));
    return () => { u1(); u2(); u3(); };
  }, []);

  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 4000); };
  const fail = (e) => { setErr('保存できませんでした：' + (e?.message || e)); setBusy(false); };

  // 店舗リスト（Firestoreにあればそれ・なければmasters.jsを表示）＝フォールバック方式
  const storeList = useMemo(() => {
    const src = (storeDocs && storeDocs.length > 0)
      ? storeDocs.slice().sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.id.localeCompare(b.id))
      : STORES.map((s, i) => ({ ...s, active: true, order: i }));
    return src;
  }, [storeDocs]);
  const mainStores = storeList.filter(s => !s.isEvent && s.active !== false);
  const sName = (id) => storeList.find(s => s.id === id)?.name || id;

  const activeStaff = useMemo(() => (staffDocs || []).filter(s => s.active !== false)
    .sort((a, b) => (a.storeId || '').localeCompare(b.storeId || '') || (a.name || '').localeCompare(b.name, 'ja')), [staffDocs]);
  const retiredStaff = useMemo(() => (staffDocs || []).filter(s => s.active === false)
    .sort((a, b) => (b.retiredAt || '').localeCompare(a.retiredAt || '')), [staffDocs]);
  const seeded = staffDocs !== null && staffDocs.length > 0;

  // ---- ログイン権限（users）との突き合わせ 目印: roleSync2026 ----
  // 名前（空白を除いた形）で名簿とログインアカウントを結びつける
  const usersFor = (nameNorm) => (userDocs || []).filter(u => norm(u.name) === nameNorm);

  // 名簿と食い違っている人の一覧
  const mismatches = useMemo(() => {
    if (!staffDocs || !userDocs) return [];
    const out = [];
    staffDocs.filter(s => s.active !== false).forEach(s => {
      const key = s.nameNorm || s.id;
      const target = authRoleOf(s.role);
      (userDocs || []).filter(u => norm(u.name) === key).forEach(u => {
        const cur = u.role || 'staff';
        if (cur !== target) out.push({ staff: s, user: u, cur, target });
      });
    });
    return out;
  }, [staffDocs, userDocs]);

  // 名簿にはいるが、まだアプリに登録していない人
  const notRegistered = useMemo(() => {
    if (!staffDocs || !userDocs) return [];
    return staffDocs.filter(s => s.active !== false
      && !userDocs.some(u => norm(u.name) === (s.nameNorm || s.id)));
  }, [staffDocs, userDocs]);

  // 名簿に無いアカウント（管理者・経理など）。この画面では触らない
  const outsideUsers = useMemo(() => {
    if (!staffDocs || !userDocs) return [];
    return userDocs.filter(u => !staffDocs.some(s => (s.nameNorm || s.id) === norm(u.name)));
  }, [staffDocs, userDocs]);

  // 1人分のログイン権限を名簿に合わせる
  const syncAuthRole = async (nameNorm, dirRole) => {
    const target = authRoleOf(dirRole);
    const hits = usersFor(nameNorm);
    const needs = hits.filter(u => (u.role || 'staff') !== target);
    for (const u of needs) {
      await updateDoc(doc(db, 'users', u.id), { role: target });
    }
    return { found: hits.length, changed: needs.length };
  };

  // まとめてそろえる
  const syncAll = async () => {
    if (mismatches.length === 0) return;
    const lines = mismatches.map(m => '・' + m.staff.name + '：' + authName(m.cur) + ' → ' + authName(m.target)).join('\n');
    if (!window.confirm('次の' + mismatches.length + '名のログイン権限を名簿に合わせます。よろしいですか？\n\n' + lines + '\n\n※本人が再ログインすると画面に反映されます')) return;
    setBusy(true);
    try {
      for (const m of mismatches) {
        await updateDoc(doc(db, 'users', m.user.id), { role: m.target });
      }
      setBusy(false);
      flash('✅ ' + mismatches.length + '名のログイン権限をそろえました（本人の再ログインで反映されます）');
    } catch (e) { fail(e); }
  };

  // ---- 初回取り込み（masters.js → Firestore）目印: staffDirectorySeed ----
  const seed = async () => {
    if (!window.confirm('現在の名簿（33名・9店舗）をアプリの管理台帳に取り込みます。よろしいですか？\n（初回に1度だけ押すボタンです）')) return;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      STORES.forEach((s, i) => {
        batch.set(doc(db, 'storeDirectory', s.id), {
          name: s.name, isEvent: !!s.isEvent, host: s.host || null, active: true, order: i,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      });
      STAFF.forEach((full) => {
        const n = norm(full);
        batch.set(doc(db, 'staffDirectory', n), {
          name: full, nameNorm: n,
          storeId: staffStore(full) || null,
          role: SEED_MANAGERS.includes(n) ? 'manager' : 'staff',
          active: true, retiredAt: null,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
      setBusy(false);
      flash('✅ 取り込み完了！ スタッフ' + STAFF.length + '名・店舗' + STORES.length + '件を登録しました');
    } catch (e) { fail(e); }
  };

  // ---- スタッフ追加 ----
  const addStaff = async () => {
    const full = newName.trim();
    if (!full) { setErr('名前を入力してください（例：山田 太郎）'); return; }
    const n = norm(full);
    if ((staffDocs || []).some(s => s.nameNorm === n && s.active !== false)) { setErr('同じ名前のスタッフがすでに登録されています'); return; }
    setBusy(true);
    try {
      await setDoc(doc(db, 'staffDirectory', n), {
        name: full, nameNorm: n, storeId: newStore, role: newRole,
        active: true, retiredAt: null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }, { merge: true });
      const r = await syncAuthRole(n, newRole);   // roleSync2026
      setNewName(''); setNewRole('staff'); setBusy(false);
      flash('✅ ' + full + ' さんを ' + sName(newStore) + ' に追加しました'
        + (r.changed > 0 ? '／ログイン権限も「' + roleName(newRole) + '」にそろえました' : ''));
    } catch (e) { fail(e); }
  };

  // ---- スタッフ編集（所属・役職） ----
  const openEdit = (s) => { setEditId(s.id); setEditStore(s.storeId || 'STORE_001'); setEditRole(s.role || 'staff'); };
  const saveEdit = async (s) => {
    setBusy(true);
    try {
      await updateDoc(doc(db, 'staffDirectory', s.id), { storeId: editStore, role: editRole, updatedAt: serverTimestamp() });
      const r = await syncAuthRole(s.nameNorm || s.id, editRole);   // roleSync2026
      setEditId(null); setBusy(false);
      flash('✅ ' + s.name + ' さんの情報を更新しました'
        + (r.found === 0
          ? '（※この方はまだアプリに登録していないため、ログイン権限はまだありません。本人の登録後に「🔑 ログイン権限をそろえる」を押してください）'
          : r.changed > 0
            ? '／ログイン権限も「' + roleName(editRole) + '」に変更しました。本人が再ログインすると画面に反映されます'
            : ''));
    } catch (e) { fail(e); }
  };

  // ---- 退職・復帰 ----
  const retire = async (s) => {
    if (!window.confirm(s.name + ' さんを退職にしますか？\n（一覧から外れますが、記録は残ります。復帰も可能です）')) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, 'staffDirectory', s.id), { active: false, retiredAt: todayS(), updatedAt: serverTimestamp() });
      setEditId(null); setBusy(false);
      flash('✅ ' + s.name + ' さんを退職として記録しました');
    } catch (e) { fail(e); }
  };
  const restore = async (s) => {
    setBusy(true);
    try {
      await updateDoc(doc(db, 'staffDirectory', s.id), { active: true, retiredAt: null, updatedAt: serverTimestamp() });
      setBusy(false);
      flash('✅ ' + s.name + ' さんを復帰させました');
    } catch (e) { fail(e); }
  };

  // ---- 店舗の追加・名称変更・休止 ----
  const nextStoreId = () => {
    const nums = storeList.map(s => parseInt((s.id || '').replace('STORE_', ''), 10)).filter(n => !isNaN(n));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return 'STORE_' + String(next).padStart(3, '0');
  };
  const addStore = async () => {
    const nm = newStoreName.trim();
    if (!nm) { setErr('店舗名を入力してください'); return; }
    if (storeList.some(s => s.name === nm)) { setErr('同じ名前の店舗がすでにあります'); return; }
    setBusy(true);
    try {
      const id = nextStoreId();
      await setDoc(doc(db, 'storeDirectory', id), {
        name: nm, isEvent: false, host: null, active: true, order: storeList.length,
        updatedAt: serverTimestamp(),
      });
      setNewStoreName(''); setBusy(false);
      flash('✅ 店舗「' + nm + '」を追加しました（' + id + '）');
    } catch (e) { fail(e); }
  };
  const saveStoreName = async (st) => {
    const nm = editStoreName.trim();
    if (!nm) { setErr('店舗名を入力してください'); return; }
    setBusy(true);
    try {
      await updateDoc(doc(db, 'storeDirectory', st.id), { name: nm, updatedAt: serverTimestamp() });
      setEditStoreId(null); setBusy(false);
      flash('✅ 店舗名を「' + nm + '」に変更しました');
    } catch (e) { fail(e); }
  };
  const toggleStore = async (st) => {
    const toPause = st.active !== false;
    if (toPause) {
      const cnt = activeStaff.filter(s => s.storeId === st.id).length;
      if (cnt > 0) { setErr('「' + st.name + '」には所属スタッフが' + cnt + '名います。先に所属を変更してから休止してください'); return; }
      if (!window.confirm('店舗「' + st.name + '」を休止にしますか？（選択肢から外れます。再開も可能です）')) return;
    }
    setBusy(true);
    try {
      await updateDoc(doc(db, 'storeDirectory', st.id), { active: !toPause ? true : false, updatedAt: serverTimestamp() });
      setBusy(false);
      flash(toPause ? '✅ 「' + st.name + '」を休止にしました' : '✅ 「' + st.name + '」を再開しました');
    } catch (e) { fail(e); }
  };

  // ---- 表示 ----
  if (staffDocs === null || storeDocs === null || userDocs === null) {
    return <div style={{ padding: 20, color: C.mut, fontSize: 13 }}>読み込み中…</div>;
  }

  return (
    <div style={{ padding: '8px 16px', maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>👥 スタッフ・店舗管理</h1>
      <div style={{ fontSize: 10.5, color: C.mut2, marginBottom: 12 }}>スタッフの追加・異動・退職と、店舗の管理をここで行います（管理者専用）</div>

      {msg && <div style={{ ...card, borderColor: 'rgba(52,211,153,0.4)', color: C.green, fontSize: 12.5, fontWeight: 700 }}>{msg}</div>}
      {err && <div style={{ ...card, borderColor: 'rgba(248,113,113,0.4)', color: '#fca5a5', fontSize: 12.5, fontWeight: 700 }}>⚠️ {err}</div>}

      {/* 初回取り込み */}
      {!seeded && (
        <div style={{ ...card, border: '1px solid rgba(251,191,36,0.4)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.gold, marginBottom: 6 }}>はじめに（1回だけ）</div>
          <div style={{ fontSize: 11.5, color: C.w2, lineHeight: 1.7, marginBottom: 10 }}>
            現在の名簿（スタッフ{STAFF.length}名・店舗{STORES.length}件）をこの管理台帳に取り込みます。取り込み後は、名簿の変更をこの画面だけで行えるようになります。
          </div>
          <button onClick={seed} disabled={busy} style={btn(C.gold)}>📥 現在の名簿を取り込む</button>
        </div>
      )}

      {/* タブ */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {[['staff', '👥 スタッフ'], ['store', '🏬 店舗']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: 9, borderRadius: 10, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', border: '1px solid ' + (tab === id ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.08)'), background: tab === id ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.02)', color: tab === id ? C.gold : C.mut }}>{label}</button>
        ))}
      </div>

      {tab === 'staff' && (
        <>
          {/* ログイン権限の状態 目印: roleSync2026 */}
          {seeded && (
            <div style={{ ...card, border: '1px solid ' + (mismatches.length ? 'rgba(251,191,36,0.45)' : 'rgba(52,211,153,0.25)') }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: mismatches.length ? C.gold : C.green, marginBottom: 6 }}>
                🔑 ログイン権限の状態
              </div>
              {mismatches.length === 0 ? (
                <div style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.7 }}>
                  名簿の役職と、本人のログイン権限は すべて一致しています。
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 11.5, color: C.w2, lineHeight: 1.7, marginBottom: 6 }}>
                    名簿とちがう人が <b style={{ color: C.gold }}>{mismatches.length}名</b> います。ボタンを押すとそろいます。
                  </div>
                  {mismatches.map((m, i) => (
                    <div key={i} style={{ fontSize: 11.5, color: C.w2, padding: '3px 0' }}>
                      ・{m.staff.name}：<span style={{ color: C.mut }}>{authName(m.cur)}</span> → <b style={{ color: C.gold }}>{authName(m.target)}</b>
                    </div>
                  ))}
                  <button onClick={syncAll} disabled={busy} style={{ ...btn(C.gold), marginTop: 9 }}>🔄 ログイン権限をそろえる</button>
                </>
              )}
              {notRegistered.length > 0 && (
                <div style={{ fontSize: 10.5, color: C.mut2, marginTop: 9, lineHeight: 1.6 }}>
                  ※ まだアプリに登録していない方：{notRegistered.length}名（{notRegistered.slice(0, 6).map(s => s.name).join('・')}{notRegistered.length > 6 ? ' ほか' : ''}）。本人の登録後に、このボタンでそろえてください。
                </div>
              )}
              {outsideUsers.length > 0 && (
                <div style={{ fontSize: 10.5, color: C.mut2, marginTop: 6, lineHeight: 1.6 }}>
                  ※ 名簿に無いアカウント：{outsideUsers.length}件（管理者・経理など）。この画面では変更しません。
                </div>
              )}
              <div style={{ fontSize: 10.5, color: C.mut2, marginTop: 6, lineHeight: 1.6 }}>
                ※「部長」は、権限としては店長と同じ扱いです（全店を見られます）。
              </div>
            </div>
          )}

          {/* 追加 */}
          <div style={card}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.w2, marginBottom: 8 }}>➕ スタッフを追加</div>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="名前（例：山田 太郎）" style={{ ...inp, marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <select value={newStore} onChange={e => setNewStore(e.target.value)} style={{ ...inp, flex: 1 }}>
                {mainStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={newRole} onChange={e => setNewRole(e.target.value)} style={{ ...inp, width: 120 }}>
                {ROLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <button onClick={addStaff} disabled={busy} style={btn(C.green)}>追加する</button>
          </div>

          {/* 店舗別一覧 */}
          {seeded && mainStores.map(st => {
            const mem = activeStaff.filter(s => s.storeId === st.id);
            if (mem.length === 0) return null;
            return (
              <div key={st.id} style={card}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: C.gold, marginBottom: 8 }}>🏬 {st.name} <span style={{ color: C.mut2, fontWeight: 600 }}>({mem.length}名)</span></div>
                {mem.map(s => (
                  <div key={s.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '8px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.w2 }}>{s.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: roleColor(s.role), border: '1px solid ' + roleColor(s.role), borderRadius: 999, padding: '2px 8px' }}>{roleName(s.role)}</span>
                      <button onClick={() => editId === s.id ? setEditId(null) : openEdit(s)} style={{ ...btn('rgba(255,255,255,0.06)', C.w2), padding: '6px 10px' }}>{editId === s.id ? '閉じる' : '編集'}</button>
                    </div>
                    {editId === s.id && (
                      <div style={{ marginTop: 8, padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 9 }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <select value={editStore} onChange={e => setEditStore(e.target.value)} style={{ ...inp, flex: 1 }}>
                            {mainStores.map(m2 => <option key={m2.id} value={m2.id}>{m2.name}</option>)}
                          </select>
                          <select value={editRole} onChange={e => setEditRole(e.target.value)} style={{ ...inp, width: 120 }}>
                            {ROLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => saveEdit(s)} disabled={busy} style={btn(C.green)}>保存</button>
                          <button onClick={() => retire(s)} disabled={busy} style={btn('rgba(248,113,113,0.15)', C.red)}>退職にする</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

          {/* 所属未設定 */}
          {seeded && activeStaff.some(s => !s.storeId || !mainStores.some(m2 => m2.id === s.storeId)) && (
            <div style={{ ...card, borderColor: 'rgba(248,113,113,0.3)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: C.red, marginBottom: 8 }}>⚠️ 所属店が未設定・不明</div>
              {activeStaff.filter(s => !s.storeId || !mainStores.some(m2 => m2.id === s.storeId)).map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <span style={{ flex: 1, fontSize: 13, color: C.w2 }}>{s.name}</span>
                  <button onClick={() => openEdit(s)} style={{ ...btn('rgba(255,255,255,0.06)', C.w2), padding: '6px 10px' }}>設定する</button>
                </div>
              ))}
            </div>
          )}

          {/* 退職者 */}
          {retiredStaff.length > 0 && (
            <div style={card}>
              <button onClick={() => setShowRetired(v => !v)} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                {showRetired ? '▼' : '▶'} 退職者（{retiredStaff.length}名）
              </button>
              {showRetired && retiredStaff.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid rgba(255,255,255,0.05)', padding: '8px 0', marginTop: 6 }}>
                  <span style={{ flex: 1, fontSize: 12.5, color: C.mut }}>{s.name} <span style={{ fontSize: 10, color: C.mut2 }}>（{s.retiredAt || '日付不明'} 退職）</span></span>
                  <button onClick={() => restore(s)} disabled={busy} style={{ ...btn('rgba(56,189,248,0.15)', C.blue), padding: '6px 10px' }}>復帰</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'store' && (
        <>
          <div style={card}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.w2, marginBottom: 8 }}>➕ 店舗を追加</div>
            <input value={newStoreName} onChange={e => setNewStoreName(e.target.value)} placeholder="店舗名（例：auStyle〇〇）" style={{ ...inp, marginBottom: 8 }} />
            <button onClick={addStore} disabled={busy || !seeded} style={btn(C.green)}>追加する</button>
            {!seeded && <div style={{ fontSize: 10.5, color: C.mut2, marginTop: 6 }}>※先に上の「現在の名簿を取り込む」を押してください</div>}
          </div>

          {storeList.map(st => (
            <div key={st.id} style={{ ...card, opacity: st.active === false ? 0.55 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.w2 }}>{st.name}</span>
                  <span style={{ fontSize: 9.5, color: C.mut2, marginLeft: 8 }}>{st.id}{st.isEvent ? '・イベント店' : ''}{st.active === false ? '・休止中' : ''}</span>
                </span>
                {!st.isEvent && <span style={{ fontSize: 10.5, color: C.mut }}>{activeStaff.filter(s => s.storeId === st.id).length}名</span>}
                <button onClick={() => { setEditStoreId(editStoreId === st.id ? null : st.id); setEditStoreName(st.name); }} disabled={!seeded} style={{ ...btn('rgba(255,255,255,0.06)', C.w2), padding: '6px 10px' }}>{editStoreId === st.id ? '閉じる' : '編集'}</button>
              </div>
              {editStoreId === st.id && (
                <div style={{ marginTop: 8, padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 9 }}>
                  <input value={editStoreName} onChange={e => setEditStoreName(e.target.value)} style={{ ...inp, marginBottom: 8 }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => saveStoreName(st)} disabled={busy} style={btn(C.green)}>名称を保存</button>
                    <button onClick={() => toggleStore(st)} disabled={busy} style={btn(st.active === false ? 'rgba(56,189,248,0.15)' : 'rgba(248,113,113,0.15)', st.active === false ? C.blue : C.red)}>{st.active === false ? '再開する' : '休止にする'}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: C.mut2, lineHeight: 1.7, marginTop: 4 }}>
            ※店舗の削除はできません（過去の実績データが店舗IDと結びついているため）。使わなくなった店舗は「休止」にしてください。
          </div>
        </>
      )}
    </div>
  );
}
