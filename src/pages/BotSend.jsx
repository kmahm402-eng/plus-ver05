import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { GAS_URL } from '../data/masters';
import { buildBotProgressMessage } from '../lib/botMessage';

const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const C = { gold: '#FBBF24', green: '#34D399', purple: '#A78BFA', red: '#F87171', blue: '#38BDF8', w: '#fff', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };

export default function BotSend() {
  const { user, profile } = useAuth();
  const [reports, setReports] = useState([]);
  const [targetDate, setTargetDate] = useState(() => ymd(new Date()));
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');
  const isAdmin = profile?.role === 'admin' || profile?.role === 'manager';

  useEffect(() => {
    if (!user || !targetDate) return;
    // 選んだ日だけ読み込む（軽量化・dayRangeFetch）。日付を変えるとその日を再取得
    const _t0 = new Date(targetDate + 'T00:00:00');
    const _t1 = new Date(_t0); _t1.setDate(_t1.getDate() + 1);
    return onSnapshot(query(collection(db, 'reports'), where('createdAt', '>=', _t0), where('createdAt', '<', _t1)), s => setReports(s.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [user, targetDate]);

  // プレビューテキスト生成
  const previewText = useMemo(() => {
    const d = new Date(targetDate + 'T12:00:00');
    return buildBotProgressMessage(reports, d);
  }, [reports, targetDate]);

  // 当日の件数チェック
  const todayCount = useMemo(() => {
    const t0 = new Date(targetDate + 'T00:00:00');
    const t1 = new Date(t0); t1.setDate(t1.getDate() + 1);
    return reports.filter(r => {
      const d = r.createdAt?.toDate?.();
      return d && d >= t0 && d < t1;
    }).length;
  }, [reports, targetDate]);

  const send = async () => {
    if (!isAdmin) { alert('管理者のみ送信可能です'); return; }
    if (!confirm('日次進捗をLINEに送信します。よろしいですか？\n\n対象日: ' + targetDate + '\n報告件数: ' + todayCount + '件')) return;
    setSending(true); setMsg('');
    try {
      await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ source: 'plus-manager', text: previewText }),
      });
      setMsg('✅ LINEに送信しました');
      setTimeout(() => setMsg(''), 4000);
    } catch (e) {
      setMsg('❌ 送信エラー: ' + e.message);
    }
    setSending(false);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(previewText);
      setMsg('📋 クリップボードにコピーしました');
      setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setMsg('❌ コピー失敗: ' + e.message);
    }
  };

  const yesterday = () => {
    const d = new Date(targetDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    setTargetDate(ymd(d));
  };
  const tomorrow = () => {
    const d = new Date(targetDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    setTargetDate(ymd(d));
  };
  const today = () => setTargetDate(ymd(new Date()));

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: C.w, marginBottom: 4 }}>📤 BOT送信（日次進捗）</h1>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 10, lineHeight: 1.5 }}>指定日の実績サマリーを生成してLINEグループに送信します。送信前にプレビューで確認できます。</div>

      {/* 対象日切替 */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: C.mut }}>📅 対象日:</span>
          <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} style={{ padding: 6, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: C.w, fontSize: 11, outline: 'none' }} />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={yesterday} style={{ flex: 1, padding: 6, borderRadius: 6, fontSize: 10, cursor: 'pointer', background: 'rgba(255,255,255,0.02)', color: C.mut, border: '1px solid rgba(255,255,255,0.05)' }}>← 前日</button>
          <button onClick={today} style={{ flex: 1, padding: 6, borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: 'rgba(251,191,36,0.1)', color: C.gold, border: '1px solid rgba(251,191,36,0.2)' }}>📅 今日</button>
          <button onClick={tomorrow} style={{ flex: 1, padding: 6, borderRadius: 6, fontSize: 10, cursor: 'pointer', background: 'rgba(255,255,255,0.02)', color: C.mut, border: '1px solid rgba(255,255,255,0.05)' }}>翌日 →</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: todayCount === 0 ? C.red : C.green, textAlign: 'center' }}>
          {todayCount === 0 ? '⚠️ この日の報告はありません' : '✓ この日の報告: ' + todayCount + '件'}
        </div>
      </div>

      {/* プレビュー */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.w2 }}>👀 プレビュー</span>
          <span style={{ fontSize: 9, color: C.mut2 }}>{previewText.split('\n').length}行 / {previewText.length}文字</span>
        </div>
        <pre style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 8, padding: 10, fontSize: 10, color: C.w2, lineHeight: 1.6, margin: 0, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 400, overflowY: 'auto' }}>{previewText}</pre>
      </div>

      {/* 送信・コピーボタン */}
      <div style={{ position: 'sticky', bottom: 8, marginTop: 16, background: 'rgba(15,13,26,0.95)', padding: 8, borderRadius: 10, backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={copyToClipboard} style={{ flex: 1, padding: 10, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(167,139,250,0.08)', color: C.purple, border: '1px solid rgba(167,139,250,0.25)' }}>📋 コピー</button>
          <button onClick={send} disabled={sending || !isAdmin || todayCount === 0} style={{ flex: 2, padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: sending || !isAdmin || todayCount === 0 ? 'not-allowed' : 'pointer', background: sending || !isAdmin || todayCount === 0 ? 'rgba(255,255,255,0.1)' : C.gold, color: sending || !isAdmin || todayCount === 0 ? C.mut : '#000', border: 'none' }}>{sending ? '送信中…' : todayCount === 0 ? '報告なし（送信不可）' : '📤 LINEに送信'}</button>
        </div>
        {msg && <div style={{ textAlign: 'center', fontSize: 11, marginTop: 6, color: msg.startsWith('✅') || msg.startsWith('📋') ? C.green : C.red, fontWeight: 700 }}>{msg}</div>}
        {!isAdmin && <div style={{ textAlign: 'center', fontSize: 10, color: C.red, marginTop: 6 }}>送信は管理者のみ可能（プレビュー・コピーは閲覧可）</div>}
      </div>
    </div>
  );
}
