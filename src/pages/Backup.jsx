// =====================================================================
// Backup.jsx ―― データバックアップ（管理者専用）
// 全コレクションを読み取り、1つのファイル（JSON）にまとめてPCへ保存する。
// 読み取りのみ・書き込みは一切しない（既存データへの影響ゼロ）。
// 目印: backupAllCollections
// =====================================================================
import { useState } from 'react';
import { db } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';

const C = { gold: '#FBBF24', green: '#34D399', blue: '#38BDF8', red: '#F87171', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 14, marginBottom: 10 };

// バックアップ対象（コレクション名, 画面表示名）
const COLLECTIONS = [
  ['reports', '実績報告'],
  ['users', 'ログインユーザー'],
  ['staffDirectory', 'スタッフ台帳'],
  ['storeDirectory', '店舗台帳'],
  ['staffTargets', '個人目標'],
  ['storeTargets', '店舗目標'],
  ['declarations', '営業手法カルテ'],
  ['recommendations', 'ダッシュボード推奨'],
  ['coachingReactions', 'ダッシュボードリアクション'],
  ['storeMonthlyCheck', '店舗 月次チェック'],
  ['pipeline', 'パイプライン（商談）'],
  ['events', 'イベント'],
  ['eventConfig', 'イベント設定'],
  ['eventFunnel', 'イベント推移'],
  ['kddiResults', 'KDDI結果指標'],
  ['auStyleBonusConfig', 'auStyle奨励金 設定'],
  ['auStyleBonusRates', 'auStyle奨励金 率'],
  ['incentiveConfig', '報酬設定'],
  ['pointConfig', 'ポイント設定'],
  ['library', 'コンテンツライブラリ'],
];

// 日時（Timestamp）は「__ts: 文字列」に変換して保存する（復元時に元へ戻せる形）
const ser = (v) => {
  if (v === null || v === undefined) return v;
  if (typeof v === 'object' && typeof v.toDate === 'function') return { __ts: v.toDate().toISOString() };
  if (Array.isArray(v)) return v.map(ser);
  if (typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => { o[k] = ser(v[k]); }); return o; }
  return v;
};

const pad2 = (n) => String(n).padStart(2, '0');
const stamp = () => {
  const d = new Date();
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes());
};

export default function Backup() {
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState([]);      // { name, label, count, state: 'wait'|'run'|'ok'|'ng' }
  const [done, setDone] = useState(null);    // { total, fileName, when }
  const [err, setErr] = useState('');

  const backupAllCollections = async () => {
    if (running) return;
    setRunning(true); setErr(''); setDone(null);
    const init = COLLECTIONS.map(([name, label]) => ({ name, label, count: 0, state: 'wait' }));
    setRows(init);

    const out = { __backup: { app: 'PLUS Manager (plus-ver05)', createdAt: new Date().toISOString(), format: 1 }, collections: {} };
    let total = 0;
    let anyFail = false;

    for (let i = 0; i < COLLECTIONS.length; i++) {
      const [name] = COLLECTIONS[i];
      setRows(r => r.map((x, j) => j === i ? { ...x, state: 'run' } : x));
      try {
        const snap = await getDocs(collection(db, name));
        const docs = snap.docs.map(d => ({ __id: d.id, ...ser(d.data()) }));
        out.collections[name] = docs;
        total += docs.length;
        setRows(r => r.map((x, j) => j === i ? { ...x, state: 'ok', count: docs.length } : x));
      } catch (e) {
        anyFail = true;
        out.collections[name] = { __error: String(e && e.message || e) };
        setRows(r => r.map((x, j) => j === i ? { ...x, state: 'ng' } : x));
      }
    }

    if (anyFail) {
      setErr('一部の読み取りに失敗しました。通信環境を確認して、もう一度お試しください（失敗した項目は ✗ 表示）。ファイル自体は保存されます。');
    }

    // ファイルとしてPCへ保存（サーバーを経由しない）
    try {
      const fileName = 'PLUSManager_バックアップ_' + stamp() + '.json';
      const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      setDone({ total, fileName, when: new Date().toLocaleString('ja-JP') });
    } catch (e) {
      setErr('ファイルの保存に失敗しました：' + String(e && e.message || e));
    }
    setRunning(false);
  };

  const mark = (s) => s === 'ok' ? '✅' : s === 'ng' ? '✗' : s === 'run' ? '⏳' : '・';
  const markColor = (s) => s === 'ok' ? C.green : s === 'ng' ? C.red : s === 'run' ? C.gold : C.mut2;

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 12 }}>💾 バックアップ</h1>

      <div style={card}>
        <div style={{ fontSize: 12.5, color: C.w2, lineHeight: 1.8 }}>
          すべてのデータ（実績報告・名簿・目標・設定など {COLLECTIONS.length}種類）を、
          <b style={{ color: C.gold }}>1つのファイル</b>にまとめてこのパソコンに保存します。
        </div>
        <ul style={{ fontSize: 11, color: C.mut, lineHeight: 1.9, margin: '8px 0 0', paddingLeft: 18 }}>
          <li>読み取るだけで、書き込みは一切しません（既存データへの影響ゼロ）</li>
          <li>データはこの画面から直接パソコンに保存されます（外部を経由しません）</li>
          <li>おすすめの頻度：<b style={{ color: C.w2 }}>月に1回＋大きな変更作業の前</b></li>
          <li>保存したファイルは、万一のときの復元に使います（復元は管理者にご相談ください）</li>
        </ul>
        <button
          onClick={backupAllCollections}
          disabled={running}
          style={{ marginTop: 12, width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', cursor: running ? 'default' : 'pointer', background: running ? '#3a3450' : C.gold, color: running ? C.mut : '#0F0D1A', fontSize: 14, fontWeight: 900 }}>
          {running ? '作成中…（そのままお待ちください）' : '今すぐバックアップを作る'}
        </button>
      </div>

      {rows.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.mut, marginBottom: 8 }}>進行状況</div>
          {rows.map((r) => (
            <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ fontSize: 11.5, color: C.w2 }}>
                <span style={{ color: markColor(r.state), marginRight: 6 }}>{mark(r.state)}</span>{r.label}
              </div>
              <div style={{ fontSize: 11, color: r.state === 'ok' ? C.green : C.mut2 }}>{r.state === 'ok' ? r.count + '件' : ''}</div>
            </div>
          ))}
        </div>
      )}

      {done && (
        <div style={{ ...card, border: '1px solid rgba(52,211,153,0.4)' }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: C.green, marginBottom: 6 }}>✅ バックアップ完了</div>
          <div style={{ fontSize: 11.5, color: C.w2, lineHeight: 1.8 }}>
            合計 <b style={{ color: C.gold }}>{done.total.toLocaleString()}件</b> のデータを保存しました。<br />
            ファイル名：<span style={{ color: C.blue }}>{done.fileName}</span><br />
            保存先：このパソコンのダウンロードフォルダ<br />
            作成日時：{done.when}
          </div>
          <div style={{ fontSize: 10.5, color: C.mut, marginTop: 6 }}>
            💡 ダウンロードフォルダから、USBメモリや会社のGoogleドライブなど「パソコン以外の場所」にもコピーしておくと、さらに安心です。
          </div>
        </div>
      )}

      {err && (
        <div style={{ ...card, border: '1px solid rgba(248,113,113,0.4)' }}>
          <div style={{ fontSize: 11.5, color: C.red, lineHeight: 1.7 }}>{err}</div>
        </div>
      )}
    </div>
  );
}
