import { useState } from 'react';
import { auth } from '../firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const handleLogin = async () => {
    setLoading(true); setErr('');
    try { await signInWithEmailAndPassword(auth, email, pw); nav('/'); }
    catch (e) { setErr(e.code || 'ログインに失敗しました'); setLoading(false); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0F0D1A', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 340, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🎯</div>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: '#FBBF24', marginBottom: 4 }}>PLUS Manager</h1>
        <p style={{ fontSize: 12, color: '#64748B', marginBottom: 32 }}>達成率・目標管理</p>
        <div style={{ marginBottom: 12 }}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="メールアドレス" style={{ width: '100%', padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="パスワード" onKeyDown={e => e.key === 'Enter' && handleLogin()} style={{ width: '100%', padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        {err && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 12 }}>{err}</div>}
        <button onClick={handleLogin} disabled={loading || !email || !pw} style={{ width: '100%', padding: 12, borderRadius: 10, background: loading ? '#64748B' : 'linear-gradient(135deg,#FBBF24,#F59E0B)', color: '#000', fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer' }}>{loading ? 'ログイン中...' : 'ログイン'}</button>
        <p style={{ fontSize: 10, color: '#475569', marginTop: 20 }}>※ 現行アプリと同じアカウントでログインできます</p>
      </div>
    </div>
  );
}
