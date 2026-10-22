import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { YEN_PER_POINT } from '../lib/points';

const DEFAULTS = { king1: 5000, king2: 3000, king3: 2000, champion: 3000, teamBonus: 2000 };
const FIELDS = [
  ['king1', 'ポイント王 1位', '店舗内で社内ポイント1位'],
  ['king2', 'ポイント王 2位', '店舗内2位'],
  ['king3', 'ポイント王 3位', '店舗内3位'],
  ['champion', '達成率チャンピオン', '個人目標の達成率1位'],
  ['teamBonus', 'チーム賞（1人あたり）', '店舗が月間目標を達成で全員に'],
];
const C = { gold: '#FBBF24', green: '#34D399', mut: '#94A3B8', mut2: '#64748B', w2: '#E2E8F0' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };
const inp = { width: 120, padding: 9, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, textAlign: 'right', outline: 'none', boxSizing: 'border-box' };

export default function IncentiveSettings() {
  const { user } = useAuth();
  const [cfg, setCfg] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'incentiveConfig', 'main'), s => { if (s.exists()) setCfg({ ...DEFAULTS, ...s.data() }); });
  }, [user]);

  const save = async () => {
    setSaving(true);
    try { await setDoc(doc(db, 'incentiveConfig', 'main'), { king1: +cfg.king1 || 0, king2: +cfg.king2 || 0, king3: +cfg.king3 || 0, champion: +cfg.champion || 0, teamBonus: +cfg.teamBonus || 0 }, { merge: true }); alert('報酬設定を保存しました'); }
    catch (e) { alert('保存エラー: ' + e.message); }
    setSaving(false);
  };

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>⚙️ 報酬設定</h1>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 12 }}>②ランキング賞・③チーム賞の金額を設定します。いつでも変更できます。</div>

      <div style={{ ...card, background: 'rgba(251,191,36,0.05)', borderColor: 'rgba(251,191,36,0.2)' }}>
        <div style={{ fontSize: 11, color: C.mut }}>① 土台（自動計算）</div>
        <div style={{ fontSize: 13, color: C.w2, fontWeight: 700 }}>社内ポイント × ¥{YEN_PER_POINT}（固定）</div>
        <div style={{ fontSize: 9, color: C.mut2 }}>※ 1ポイントの単価を変えるときは points.js を変更します（システム担当）。</div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 10 }}>② ランキング賞・③ チーム賞</div>
        {FIELDS.map(([k, label, desc]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: C.w2, fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 9, color: C.mut2 }}>{desc}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 12, color: C.mut }}>¥</span>
              <input type="number" value={cfg[k]} onChange={e => setCfg({ ...cfg, [k]: e.target.value })} style={inp} />
            </div>
          </div>
        ))}
      </div>

      <button onClick={save} disabled={saving} style={{ width: '100%', padding: 13, borderRadius: 12, fontSize: 14, fontWeight: 800, border: 'none', cursor: 'pointer', background: saving ? 'rgba(255,255,255,0.1)' : C.green, color: saving ? C.mut : '#000' }}>{saving ? '保存中…' : '保存する'}</button>
      <div style={{ fontSize: 9, color: C.mut2, marginTop: 10, lineHeight: 1.6 }}>※ ②③の自動加算は「店舗内ランキング」「店舗の月間目標達成」をもとにします。店舗内にするにはスタッフ所属店マスタ（masters.js の STAFF_STORE_MAP）の登録が必要です。チーム賞・達成率賞の自動判定は店舗目標との連携後に有効化します。</div>
    </div>
  );
}
