import { useNavigate, useLocation } from 'react-router-dom';

const ITEMS = [
  { to: '/', icon: '📊', label: 'ホーム' },
  { to: '/report', icon: '📋', label: '報告' },
  { to: '/karute', icon: '📒', label: 'カルテ' },
  { to: '/target', icon: '🎯', label: '達成率' },
  { to: '/incentive', icon: '💰', label: '報酬' },
  { to: '/manage', icon: '⚙️', label: '管理' },
];

export default function BottomNav() {
  const nav = useNavigate();
  const loc = useLocation();
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: 60, background: '#15131f', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', zIndex: 50 }}>
      {ITEMS.map(it => {
        const on = loc.pathname === it.to;
        return (
          <button key={it.to} onClick={() => nav(it.to)} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', color: on ? '#FBBF24' : '#64748B', fontSize: 9 }}>
            <div style={{ fontSize: 16 }}>{it.icon}</div>{it.label}
          </button>
        );
      })}
    </div>
  );
}
