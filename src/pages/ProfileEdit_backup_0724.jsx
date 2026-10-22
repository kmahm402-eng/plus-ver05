import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { STAFF, ADMINS, isAdmin, MAIN_STORES } from '../data/masters';

const C = { gold: '#FBBF24', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const roleLabel = (r) => r === 'admin' ? '管理者（社長・経理）' : r === 'manager' ? '部長・店長' : r === 'event' ? 'イベント担当' : 'スタッフ';
const fieldLabel = { fontSize: 11, color: C.mut, marginBottom: 6, display: 'block' };
const selectStyle = { width: '100%', padding: 11, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 18 };

export default function ProfileEdit() {
  const { user, profile, saveProfile } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState(profile?.name || '');
  const [role, setRole] = useState(profile?.role || 'staff');
  const [storeId, setStoreId] = useState(profile?.storeId || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setRole(profile.role || 'staff');
      setStoreId(profile.storeId || '');
    }
  }, [profile]);

  const submit = async () => {
    if (!name) { alert('お名前を選んでください'); return; }
    if (!isAdmin(name) && !storeId) { alert('所属店を選んでください'); return; }
    setSaving(true);
    try {
      await saveProfile({ name, role, storeId });
      alert('プロフィールを更新しました');
      nav('/');
    } catch (e) {
      alert('保存エラー: ' + e.message);
      setSaving(false);
    }
  };

  const inList = STAFF.includes(name) || ADMINS.includes(name);

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 12 }}>👤 プロフィール編集</h1>

      <div style={{ fontSize: 10, color: C.mut2, marginBottom: 14, padding: 9, borderRadius: 8, background: 'rgba(255,255,255,0.02)', lineHeight: 1.6 }}>
        ログインアカウント: <b style={{ color: C.w2 }}>{user?.email}</b><br />
        現在の登録名: <b style={{ color: C.gold }}>{profile?.name || '(未登録)'}</b><br />
        ※ 名前・所属店を変更できます。役割（権限）の変更は管理者が行います。
      </div>

      <label style={fieldLabel}>お名前</label>
      {!inList && name && (
        <div style={{ fontSize: 10, color: C.mut2, marginBottom: 4, padding: 6, borderRadius: 6, background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)' }}>現在の値「{name}」は一覧に無いため、下から選び直してください。</div>
      )}
      <select value={inList ? name : ''} onChange={e => { const v = e.target.value; setName(v); if (isAdmin(v)) { setStoreId(''); } }} style={selectStyle}>
        <option value="">— 一覧から選ぶ —</option>
        <optgroup label="実績報告者">
          {STAFF.map(n => <option key={n} value={n}>{n}</option>)}
        </optgroup>
        <optgroup label="管理者・経理（報告対象外）">
          {ADMINS.map(n => <option key={n} value={n}>{n}</option>)}
        </optgroup>
      </select>

      {isAdmin(name) ? (
        <div style={{ fontSize: 11, color: C.gold, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 10, padding: 10, marginBottom: 18, lineHeight: 1.6 }}>管理者・経理の方です。<br />実績報告・ランキング・インセンティブの対象外です。</div>
      ) : (
        <>
          <label style={fieldLabel}>所属店</label>
          <select value={storeId} onChange={e => setStoreId(e.target.value)} style={selectStyle}>
            <option value="">— 店舗を選ぶ —</option>
            {MAIN_STORES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <label style={fieldLabel}>役割</label>
          <div style={{ fontSize: 11, color: C.mut, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 12, marginBottom: 24, lineHeight: 1.6 }}>
            現在の役割：<b style={{ color: C.gold }}>{roleLabel(role)}</b><br />役割（権限）の変更は管理者が行います。
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => nav('/')} style={{ flex: 1, padding: 14, borderRadius: 12, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: C.mut }}>キャンセル</button>
        <button onClick={submit} disabled={saving} style={{ flex: 2, padding: 14, borderRadius: 12, fontSize: 14, fontWeight: 800, border: 'none', cursor: 'pointer', background: saving ? 'rgba(255,255,255,0.1)' : C.gold, color: saving ? C.mut : '#000' }}>{saving ? '保存中…' : '✓ 保存する'}</button>
      </div>
    </div>
  );
}
