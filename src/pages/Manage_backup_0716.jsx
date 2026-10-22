import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const C = { gold: '#FBBF24', w2: '#E2E8F0', mut: '#94A3B8' };

// grade = だれまで見せるか
//  'all'     … 全員（スタッフ含む）
//  'event'   … イベント担当 以上（＝event / manager / admin）
//  'manager' … 部長・店長 以上（＝manager / admin）
//  'admin'   … 管理者（社長・経理）だけ
const ITEMS = [
  { to: '/coaching-dashboard', icon: '👀', label: '経営者ダッシュボード', desc: 'スタッフ別のカルテ・宣言・振り返りを観察', grade: 'admin' },
  { to: '/target-setting', icon: '🎯', label: '目標設定', desc: '店舗ごとの月間目標を入力', grade: 'manager' },
  { to: '/me', icon: '🙋', label: '個人目標・進捗', desc: '本人の達成率と目標', grade: 'all' },
  { to: '/monthly-check', icon: '✅', label: '店舗 月次達成チェック', desc: '決済率など（翌月10日まで）', grade: 'manager' },
  { to: '/kpi', icon: '📈', label: 'KPI指標', desc: '総販・単価・項目別・店舗別', grade: 'manager' },
  { to: '/events', icon: '📊', label: 'イベント集計', desc: 'イベント実績・費用・期間比較', grade: 'event' },
  { to: '/pipeline', icon: '📞', label: 'パイプライン（商談）', desc: '見込み案件を成約まで管理', grade: 'all' },
  { to: '/incentive-settings', icon: '⚙️', label: '報酬設定', desc: 'ランキング賞・チーム賞の金額', grade: 'admin' },
  { to: '/payroll', icon: '🧾', label: '給与反映 インセンティブ一覧', desc: '全スタッフの月次確定額・CSV出力', grade: 'admin' },
  { to: '/point-settings', icon: '🎯', label: 'ポイント設定', desc: '各項目のpt値・ON/OFF・MID除外', grade: 'admin' },
  { to: '/kddi-results', icon: '🎯', label: 'KDDI結果指標', desc: '○△✗入力で店舗の係数算出', grade: 'manager' },
  { to: '/bot-send', icon: '📤', label: 'BOT送信（日次進捗）', desc: '指定日のサマリーをLINEに手動送信', grade: 'admin' },
  { to: '/data-cleanup', icon: '🧹', label: 'データクリーンアップ', desc: 'スタッフ名の表記ゆれを一括正規化', grade: 'admin' },
  { to: '/austyle-bonus', icon: '🏆', label: 'auStyle強化商材 奨励金', desc: '5項目バランス＋シナジーで積み上げ', grade: 'manager' },
  { to: '/excel', icon: '📥', label: 'Excel出力', desc: '店舗・月ごとに書き出し', grade: 'manager' },
  { to: '/profile-edit', icon: '👤', label: 'プロフィール編集', desc: '自分の名前・所属店', grade: 'all' },
  { to: '/thank-you-calls', icon: '📞', label: 'サンキューコール', desc: '販売後の御礼コール推奨リスト・スヌーズ可', grade: 'all' },
];

export default function Manage() {
  const nav = useNavigate();
  const { isAdmin, isManager, isEvent } = useAuth();
  const canSee = (grade) =>
    grade === 'all' ? true
      : grade === 'event' ? (isEvent || isManager)
      : grade === 'manager' ? isManager
      : grade === 'admin' ? isAdmin
      : false;
  const items = ITEMS.filter(it => canSee(it.grade));
  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 12 }}>⚙️ 管理</h1>
      {items.map(it => (
        <button key={it.to} onClick={() => nav(it.to)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: 14, borderRadius: 12, marginBottom: 9, textAlign: 'left', cursor: 'pointer', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 22 }}>{it.icon}</span>
          <span>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.w2 }}>{it.label}</div>
            <div style={{ fontSize: 10, color: C.mut }}>{it.desc}</div>
          </span>
        </button>
      ))}
    </div>
  );
}
