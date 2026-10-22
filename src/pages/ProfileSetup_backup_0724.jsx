import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { STAFF, ADMINS, isAdmin, MAIN_STORES } from '../data/masters';

const C = { gold: '#FBBF24', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const fieldLabel = { fontSize: 11, color: C.mut, marginBottom: 6, display: 'block' };
const selectStyle = { width: '100%', padding: 11, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 18 };

export default function ProfileSetup() {
  const { user, saveProfile, logout } = useAuth();
  const [name, setName] = useState('');
  const role = 'staff'; // 役割は本人に選ばせない。管理者が後から設定する。
  const [storeId, setStoreId] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name) { alert('お名前を選んでください'); return; }
    if (!isAdmin(name) && !storeId) { alert('所属店を選んでください'); return; }
    setSaving(true);
    try {
      await saveProfile({ name, role, storeId });
      // saveProfile成功でprofileがセットされ、自動でホームに切り替わります
    } catch (e) {
      alert('保存エラー: ' + e.message);
      setSaving(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0F0D1A', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 20px' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 30 }}>👋</div>
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: '8px 0 4px' }}>はじめての登録</h1>
          <p style={{ fontSize: 11, color: C.mut, lineHeight: 1.6 }}>最初に、あなたの情報を登録します。<br />一度だけの設定です。</p>
        </div>

        <label style={fieldLabel}>お名前</label>
        <select value={name} onChange={e => { const v = e.target.value; setName(v); if (isAdmin(v)) { setStoreId(''); } }} style={selectStyle}>
          <option value="">— 一覧から選ぶ —</option>
          <optgroup label="実績報告者">
            {STAFF.map(n => <option key={n} value={n}>{n}</option>)}
          </optgroup>
          <optgroup label="管理者・経理（報告対象外）">
            {ADMINS.map(n => <option key={n} value={n}>{n}</option>)}
          </optgroup>
        </select>

        {isAdmin(name) ? (
          <div style={{ fontSize: 11, color: C.gold, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 10, padding: 10, marginBottom: 18, lineHeight: 1.6 }}>管理者・経理の方として登録します。<br />権限はあとで管理者が設定します。実績報告・ランキング・インセンティブの対象外です。</div>
        ) : (
          <>
            <label style={fieldLabel}>所属店</label>
            <select value={storeId} onChange={e => setStoreId(e.target.value)} style={selectStyle}>
              <option value="">— 店舗を選ぶ —</option>
              {MAIN_STORES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </>
        )}

        <div style={{ fontSize: 11, color: C.mut, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 12, marginBottom: 24, lineHeight: 1.6 }}>役割（権限）は管理者が設定します。まずはこのまま登録してください。</div>

        <button onClick={submit} disabled={saving} style={{ width: '100%', padding: 14, borderRadius: 12, fontSize: 15, fontWeight: 800, border: 'none', cursor: 'pointer', background: saving ? 'rgba(255,255,255,0.1)' : C.gold, color: saving ? C.mut : '#000' }}>{saving ? '登録中…' : 'この内容で始める'}</button>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 10, color: C.mut2 }}>
          {user?.email}
          <br />
          <span onClick={logout} style={{ color: C.mut, textDecoration: 'underline', cursor: 'pointer' }}>別のアカウントでログイン</span>
        </div>
        <p style={{ fontSize: 9, color: C.mut2, textAlign: 'center', marginTop: 14, lineHeight: 1.6 }}>※ 一覧にお名前が無い場合は、管理者にスタッフ登録を依頼してください（表記ゆれ防止のため一覧選択にしています）。</p>
      </div>
    </div>
  );
}
