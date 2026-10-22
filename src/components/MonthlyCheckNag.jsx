import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { storeName } from '../data/masters';
import { lastMonthYM } from '../pages/StoreMonthlyCheck';

export default function MonthlyCheckNag() {
  const { user, profile, isManager } = useAuth();
  const nav = useNavigate();
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const month = lastMonthYM();

  useEffect(() => {
    if (!user || !profile?.storeId || !isManager) return;
    let live = true;
    getDoc(doc(db, 'storeMonthlyCheck', profile.storeId + '_' + month))
      .then(s => { if (live && !(s.exists() && s.data().submitted)) setShow(true); })
      .catch(() => { if (live) setShow(true); });
    return () => { live = false; };
  }, [user, profile, month, isManager]);

  if (!show || dismissed) return null;
  const deadline = (() => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m, 10); return (d.getMonth() + 1) + '月10日'; })();

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#1a1625', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 16, padding: 22, maxWidth: 340, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 36 }}>📢</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#FBBF24', margin: '8px 0 4px' }}>店舗の月次達成チェック</div>
        <div style={{ fontSize: 12, color: '#E2E8F0', lineHeight: 1.7, marginBottom: 4 }}>
          {storeName(profile.storeId)} の <b>{month}分</b> がまだ提出されていません。
        </div>
        <div style={{ fontSize: 11, color: '#F87171', marginBottom: 16 }}>提出期限：{deadline}まで</div>
        <button onClick={() => { setShow(false); nav('/monthly-check'); }} style={{ width: '100%', padding: 11, borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: '#FBBF24', color: '#000', marginBottom: 8 }}>今すぐチェックする</button>
        <button onClick={() => setDismissed(true)} style={{ width: '100%', padding: 9, borderRadius: 10, fontSize: 11, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'transparent', color: '#94A3B8' }}>あとで（次回また表示します）</button>
      </div>
    </div>
  );
}
