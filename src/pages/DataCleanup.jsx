import { useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { useDirectory } from '../contexts/DirectoryContext'; // 名簿は配線盤から（Phase 2切替済み）

const C = { gold: '#FBBF24', green: '#34D399', purple: '#A78BFA', red: '#F87171', blue: '#38BDF8', orange: '#FB923C', w: '#fff', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };

// 名前正規化（スペース除去・典型誤字補正）
const normName = (n) => {
  if (!n) return '';
  let s = String(n).replace(/[\s\u3000]+/g, '');
  s = s.replace('香央里', '香央理'); // 誤字補正例
  return s;
};

export default function DataCleanup() {
  const { user, profile } = useAuth();
  const { staffNames, source } = useDirectory(); // 在籍中スタッフの正式名簿（台帳から）
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [executing, setExecuting] = useState(false);
  const [executeResult, setExecuteResult] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const isAdmin = profile?.role === 'admin' || profile?.role === 'manager';

  // 正規化キー → 正式表記 の対応表（名簿が変われば自動で作り直し）
  const officialByNorm = useMemo(() => {
    const m = {};
    (staffNames || []).forEach(s => { m[normName(s)] = s; });
    return m;
  }, [staffNames]);
  const getOfficialName = (rawName) => officialByNorm[normName(rawName)] || null;

  // スキャン実行（reports全件を読み取り・書き込みなし）
  const scan = async () => {
    setLoading(true); setScanResult(null); setExecuteResult(null);
    try {
      const snap = await getDocs(collection(db, 'reports'));
      const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setReports(allDocs);

      // 名前ゆれを検出
      const variantMap = {}; // normalized => Set of raw names
      const reportNames = []; // [{ id, field, rawName, normalized, officialName }]

      allDocs.forEach(r => {
        ['staffName', 'proxyStaff'].forEach(field => {
          const raw = r[field];
          if (!raw) return;
          const norm = normName(raw);
          if (!variantMap[norm]) variantMap[norm] = new Set();
          variantMap[norm].add(raw);
          const official = getOfficialName(raw);
          if (official && raw !== official) {
            reportNames.push({ id: r.id, field, rawName: raw, normalized: norm, officialName: official });
          }
        });
      });

      // 公式名が見つからないものも検出（warning）
      const unknown = {};
      allDocs.forEach(r => {
        ['staffName', 'proxyStaff'].forEach(field => {
          const raw = r[field];
          if (!raw) return;
          if (!getOfficialName(raw) && r.acqType !== 'outsource') {
            unknown[raw] = (unknown[raw] || 0) + 1;
          }
        });
      });

      // 変換が必要な (rawName -> officialName) のサマリ
      const conversionSummary = {};
      reportNames.forEach(rn => {
        const key = rn.rawName + '|' + rn.officialName;
        if (!conversionSummary[key]) {
          conversionSummary[key] = { rawName: rn.rawName, officialName: rn.officialName, count: 0, ids: [] };
        }
        conversionSummary[key].count++;
        conversionSummary[key].ids.push({ id: rn.id, field: rn.field });
      });

      setScanResult({
        total: allDocs.length,
        affectedReports: reportNames.length,
        conversions: Object.values(conversionSummary).sort((a, b) => b.count - a.count),
        unknown: Object.entries(unknown).sort((a, b) => b[1] - a[1]),
      });
    } catch (e) {
      alert('スキャンエラー: ' + e.message);
    }
    setLoading(false);
  };

  // 実行（書き込み）
  const execute = async () => {
    if (!scanResult || scanResult.conversions.length === 0) return;
    if (confirmText !== 'CLEANUP') { alert('確認コードが違います'); return; }
    setExecuting(true); setExecuteResult(null);
    let success = 0, failed = 0;
    const errors = [];
    try {
      for (const conv of scanResult.conversions) {
        for (const target of conv.ids) {
          try {
            await updateDoc(doc(db, 'reports', target.id), { [target.field]: conv.officialName });
            success++;
          } catch (e) {
            failed++;
            errors.push(target.id + ': ' + e.message);
          }
        }
      }
      setExecuteResult({ success, failed, errors });
      setConfirmText('');
      // 再スキャン
      setTimeout(() => scan(), 500);
    } catch (e) {
      alert('実行エラー: ' + e.message);
    }
    setExecuting(false);
  };

  if (!isAdmin) return <div style={{ padding: 20, color: C.red }}>このページは管理者のみ閲覧可能です</div>;

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: C.w, marginBottom: 4 }}>🧹 データクリーンアップ</h1>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 4, lineHeight: 1.5 }}>過去のreportsに含まれるスタッフ名の表記ゆれ（スペース有無・誤字）を一括で正式表記に統一します。</div>
      {/* 名簿の読み込み元バッジ（Phase 2確認用） */}
      <div style={{ display: 'inline-block', fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 6, marginBottom: 10, background: source === 'directory' ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.1)', color: source === 'directory' ? C.green : C.gold, border: source === 'directory' ? '1px solid rgba(52,211,153,0.3)' : '1px solid rgba(251,191,36,0.3)' }}>
        名簿：{source === 'directory' ? '✅ アプリ内台帳（' + (staffNames || []).length + '名）' : '⚠️ 従来（プログラム内）で動作中'}
      </div>

      {/* 警告 */}
      <div style={{ ...card, background: 'rgba(248,113,113,0.06)', borderColor: 'rgba(248,113,113,0.3)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.red, marginBottom: 4 }}>⚠️ 実行前の注意</div>
        <div style={{ fontSize: 10, color: C.w2, lineHeight: 1.7 }}>
          ・既存の報告データを書き換える操作です（取り消し不可）<br />
          ・実行前に必ず「スキャン」で対象を確認してください<br />
          ・実行時は確認コード「CLEANUP」入力が必要
        </div>
      </div>

      {/* スキャンボタン */}
      <button onClick={scan} disabled={loading} style={{ width: '100%', padding: 12, borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer', background: loading ? 'rgba(255,255,255,0.1)' : C.gold, color: loading ? C.mut : '#000', border: 'none', marginBottom: 12 }}>
        {loading ? '🔄 スキャン中...' : '🔍 報告データをスキャン'}
      </button>

      {/* スキャン結果 */}
      {scanResult && (
        <>
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.w2, marginBottom: 8 }}>📊 スキャン結果</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              <div style={{ padding: 8, borderRadius: 8, background: 'rgba(56,189,248,0.06)', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.mut }}>総報告数</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: C.blue }}>{scanResult.total}</div>
              </div>
              <div style={{ padding: 8, borderRadius: 8, background: scanResult.affectedReports > 0 ? 'rgba(248,113,113,0.06)' : 'rgba(52,211,153,0.06)', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.mut }}>要修正</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: scanResult.affectedReports > 0 ? C.red : C.green }}>{scanResult.affectedReports}</div>
              </div>
              <div style={{ padding: 8, borderRadius: 8, background: 'rgba(167,139,250,0.06)', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.mut }}>変換パターン</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: C.purple }}>{scanResult.conversions.length}</div>
              </div>
            </div>
          </div>

          {/* 変換対象一覧 */}
          {scanResult.conversions.length > 0 ? (
            <div style={card}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.w2, marginBottom: 8 }}>🔄 修正対象（{scanResult.conversions.length}パターン）</div>
              {scanResult.conversions.map((conv, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, marginBottom: 4, borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
                  <span style={{ fontSize: 11, color: C.red, fontFamily: 'monospace', minWidth: 100 }}>「{conv.rawName}」</span>
                  <span style={{ fontSize: 10, color: C.mut }}>→</span>
                  <span style={{ fontSize: 11, color: C.green, fontFamily: 'monospace', flex: 1 }}>「{conv.officialName}」</span>
                  <span style={{ fontSize: 10, color: C.gold, fontWeight: 700 }}>{conv.count}件</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ ...card, background: 'rgba(52,211,153,0.06)', borderColor: 'rgba(52,211,153,0.3)', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>✅ 表記ゆれは見つかりませんでした</div>
              <div style={{ fontSize: 10, color: C.mut, marginTop: 4 }}>クリーンな状態です</div>
            </div>
          )}

          {/* 未知のスタッフ名（警告） */}
          {scanResult.unknown.length > 0 && (
            <div style={{ ...card, background: 'rgba(251,191,36,0.04)', borderColor: 'rgba(251,191,36,0.3)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, marginBottom: 6 }}>⚠️ 公式STAFF一覧にない名前（{scanResult.unknown.length}件）</div>
              <div style={{ fontSize: 9, color: C.mut, marginBottom: 6 }}>※自動修正されません。退職者の過去記録はここに出ますが、正常です</div>
              {scanResult.unknown.map(([name, cnt]) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '3px 0', color: C.w2 }}>
                  <span>「{name}」</span>
                  <span style={{ color: C.mut2 }}>{cnt}件</span>
                </div>
              ))}
            </div>
          )}

          {/* 実行エリア */}
          {scanResult.conversions.length > 0 && (
            <div style={{ ...card, background: 'rgba(248,113,113,0.04)', borderColor: 'rgba(248,113,113,0.3)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.red, marginBottom: 6 }}>🚨 実行（書き込み）</div>
              <div style={{ fontSize: 10, color: C.w2, marginBottom: 8, lineHeight: 1.6 }}>
                上記{scanResult.affectedReports}件のレポートを書き換えます。<br />
                確認のため、下の欄に <b style={{ color: C.gold, fontFamily: 'monospace' }}>CLEANUP</b> と入力してください。
              </div>
              <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="CLEANUP" style={{ width: '100%', padding: 8, borderRadius: 6, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(248,113,113,0.3)', color: C.w, fontSize: 12, outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace', marginBottom: 8 }} />
              <button onClick={execute} disabled={executing || confirmText !== 'CLEANUP'} style={{ width: '100%', padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: executing || confirmText !== 'CLEANUP' ? 'not-allowed' : 'pointer', background: executing || confirmText !== 'CLEANUP' ? 'rgba(255,255,255,0.1)' : C.red, color: executing || confirmText !== 'CLEANUP' ? C.mut : C.w, border: 'none' }}>
                {executing ? '実行中...' : '🚨 クリーンアップを実行'}
              </button>
            </div>
          )}

          {/* 実行結果 */}
          {executeResult && (
            <div style={{ ...card, background: 'rgba(52,211,153,0.06)', borderColor: 'rgba(52,211,153,0.3)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 6 }}>✅ 実行結果</div>
              <div style={{ fontSize: 11, color: C.w2 }}>成功: <b style={{ color: C.green }}>{executeResult.success}件</b> / 失敗: <b style={{ color: executeResult.failed > 0 ? C.red : C.mut }}>{executeResult.failed}件</b></div>
              {executeResult.errors.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ fontSize: 10, color: C.red, cursor: 'pointer' }}>エラー詳細（{executeResult.errors.length}件）</summary>
                  <div style={{ fontSize: 9, color: C.mut, marginTop: 4, maxHeight: 100, overflowY: 'auto' }}>
                    {executeResult.errors.map((e, i) => <div key={i}>・{e}</div>)}
                  </div>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
