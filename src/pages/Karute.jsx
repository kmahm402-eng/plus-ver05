// =====================================================================
// Karute.jsx  ―― 営業手法カルテ（スタッフ向け・自営サイクルの中核）
// タブ: 📋 今月の宣言 / 📊 進捗・振り返り / 📚 履歴
// =====================================================================
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  TACTICS, PHRASES_DECLARE, PHRASES_REVIEW,
  PERIOD_OPTIONS, UNIT_OPTIONS, SELF_RATINGS, TACTIC_STATUS,
  getCurrentMonth, getMonthProgress, generateCheckpointDates,
  isDatePastOrToday, formatMonth, formatDateShort, getMonthList,
  getPhraseForMonth, tacticName, tacticValue,
  ratingLabel, ratingColor, ratingIcon, periodName,
} from '../data/karute-master';
import {
  getDeclaration, createDeclaration, updateDeclarationTactics,
  submitCheckpoint, submitMonthlyReview, getDeclarationHistory,
} from '../lib/karute';

// 色（plus-ver05 darkテーマ準拠）
const C = {
  bg:    '#0F0D1A',
  card:  'rgba(255,255,255,0.04)',
  card2: 'rgba(255,255,255,0.06)',
  bd:    'rgba(255,255,255,0.08)',
  bd2:   'rgba(255,255,255,0.14)',
  w:     '#fff',
  w2:    '#E2E8F0',
  mut:   '#94A3B8',
  mut2:  '#64748B',
  gold:  '#FBBF24',
  tl:    '#2DD4BF',
  pu:    '#A78BFA',
  red:   '#F87171',
  green: '#34D399',
  blue:  '#60A5FA',
};

// =====================================================================
// 共通スタイルパーツ
// =====================================================================
const S = {
  page:   { padding: '8px 14px 100px' },
  h1:     { fontSize: 17, fontWeight: 900, color: C.w, margin: '8px 0 4px' },
  hint:   { fontSize: 11, color: C.mut, marginBottom: 10 },
  phrase: { padding: '12px 14px', borderRadius: 12, background: 'linear-gradient(135deg, rgba(251,191,36,0.10), rgba(167,139,250,0.08))', border: '1px solid rgba(251,191,36,0.25)', fontSize: 13, color: C.gold, fontWeight: 700, marginBottom: 12, lineHeight: 1.5 },
  tabBar: { display: 'flex', gap: 4, marginBottom: 12, background: C.card, borderRadius: 12, padding: 4, border: `1px solid ${C.bd}` },
  tab:    (active) => ({ flex: 1, padding: '9px 8px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', background: active ? C.gold : 'transparent', color: active ? '#0F0D1A' : C.w2, transition: 'all .15s' }),
  card:   { background: C.card, border: `1px solid ${C.bd}`, borderRadius: 12, padding: 14, marginBottom: 10 },
  card2:  { background: C.card2, border: `1px solid ${C.bd2}`, borderRadius: 10, padding: 12, marginBottom: 8 },
  label:  { fontSize: 11, color: C.mut, fontWeight: 700, marginBottom: 4, display: 'block' },
  input:  { width: '100%', padding: '9px 11px', borderRadius: 8, background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.bd2}`, color: C.w, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' },
  ta:     { width: '100%', padding: '9px 11px', borderRadius: 8, background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.bd2}`, color: C.w, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical', minHeight: 56 },
  btn:    (color = C.gold) => ({ padding: '10px 16px', borderRadius: 10, border: 'none', background: color, color: '#0F0D1A', fontSize: 13, fontWeight: 900, cursor: 'pointer', width: '100%' }),
  btnSec: { padding: '10px 16px', borderRadius: 10, border: `1px solid ${C.bd2}`, background: 'transparent', color: C.w2, fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  pill:   (color, active) => ({ padding: '6px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: active ? color : 'transparent', color: active ? '#0F0D1A' : color, border: `1px solid ${color}`, transition: 'all .15s' }),
  row:    { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  bar:    { height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' },
  barIn:  (pct, color) => ({ width: `${Math.min(100, pct)}%`, height: '100%', background: color, transition: 'width .3s' }),
};

// =====================================================================
// メインコンポーネント
// =====================================================================
export default function Karute() {
  const { profile } = useAuth();
  const staffName = profile?.name || '';
  const [month, setMonth] = useState(getCurrentMonth());
  const [tab, setTab] = useState('declare');
  const [declaration, setDeclaration] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    if (!staffName) return;
    setLoading(true);
    const d = await getDeclaration(staffName, month);
    setDeclaration(d);
    const h = await getDeclarationHistory(staffName);
    setHistory(h);
    setLoading(false);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [staffName, month]);

  if (!staffName) {
    return (
      <div style={S.page}>
        <div style={S.card}><div style={{ color: C.mut, fontSize: 13 }}>プロフィールを設定してください</div></div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <h1 style={S.h1}>📒 営業手法カルテ</h1>
      <div style={S.hint}>{staffName} さんの自営サイクル ／ {formatMonth(month)}</div>

      {/* 月切り替え */}
      <div style={{ ...S.row, marginBottom: 12 }}>
        <select value={month} onChange={e => setMonth(e.target.value)} style={{ ...S.input, width: 'auto', maxWidth: 200 }}>
          {getMonthList(12).map(m => (
            <option key={m} value={m}>{formatMonth(m)}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: C.mut }}>月の経過 {getMonthProgress(month)}%</span>
      </div>

      {/* タブ */}
      <div style={S.tabBar}>
        <button style={S.tab(tab === 'declare')} onClick={() => setTab('declare')}>📋 今月の宣言</button>
        <button style={S.tab(tab === 'checkpoint')} onClick={() => setTab('checkpoint')}>📊 進捗・振り返り</button>
        <button style={S.tab(tab === 'history')} onClick={() => setTab('history')}>📚 履歴</button>
      </div>

      {loading ? (
        <div style={{ ...S.card, textAlign: 'center', color: C.mut, padding: 28, fontSize: 13 }}>読み込み中…</div>
      ) : tab === 'declare' ? (
        <DeclareTab declaration={declaration} staffName={staffName} month={month} onChange={reload} />
      ) : tab === 'checkpoint' ? (
        <CheckpointTab declaration={declaration} month={month} onChange={reload} />
      ) : (
        <HistoryTab history={history} setMonth={setMonth} setTab={setTab} />
      )}
    </div>
  );
}

// =====================================================================
// 📋 宣言タブ
// =====================================================================
function DeclareTab({ declaration, staffName, month, onChange }) {
  // 宣言済みなら閲覧、未宣言なら新規作成フォーム
  if (declaration && declaration.tactics?.length > 0) {
    return <DeclareView declaration={declaration} onChange={onChange} />;
  }
  return <DeclareForm staffName={staffName} month={month} onCreated={onChange} />;
}

// ─── 宣言フォーム（新規作成）───
function DeclareForm({ staffName, month, onCreated }) {
  const phrase = useMemo(() => getPhraseForMonth(PHRASES_DECLARE, month), [month]);
  const [tactics, setTactics] = useState([emptyTactic()]);
  const [saving, setSaving] = useState(false);

  function emptyTactic() {
    return {
      id: 'T01',
      name: TACTICS[0].name,
      customName: '',
      selectedReason: '',
      providedValue: '',
      quantity: 10,
      unit: '件',
      period: 'weekly',
      checkpoints: [],
      status: TACTIC_STATUS.IN_PROGRESS,
    };
  }

  const updateTactic = (i, patch) => {
    setTactics(prev => prev.map((t, idx) => idx === i ? { ...t, ...patch } : t));
  };

  const addTactic = () => {
    if (tactics.length >= 5) { alert('戦術は5つまで'); return; }
    setTactics(prev => [...prev, emptyTactic()]);
  };

  const removeTactic = (i) => {
    if (tactics.length <= 1) { alert('最低1つは必要です'); return; }
    setTactics(prev => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async () => {
    // バリデーション
    for (let i = 0; i < tactics.length; i++) {
      const t = tactics[i];
      const isCustom = t.id === 'T99';
      if (isCustom && !t.customName.trim()) {
        alert(`戦術${i + 1}: 自由記入の手法名を入力してください`); return;
      }
      if (!t.selectedReason.trim()) {
        alert(`戦術${i + 1}: 「お客様の言葉にしていない不安」を入力してください`); return;
      }
      if (!t.providedValue.trim()) {
        alert(`戦術${i + 1}: 「お客様に提供する価値」を入力してください`); return;
      }
      if (!t.quantity || t.quantity <= 0) {
        alert(`戦術${i + 1}: 量を1以上で入力してください`); return;
      }
    }

    setSaving(true);
    try {
      // チェックポイント日付を自動生成
      const finalTactics = tactics.map(t => ({
        id: t.id,
        name: t.id === 'T99' ? t.customName : t.name,
        selectedReason: t.selectedReason,
        providedValue: t.providedValue,
        quantity: Number(t.quantity),
        unit: t.unit,
        period: t.period,
        checkpoints: generateCheckpointDates(month, t.period).map((date, idx, arr) => ({
          date,
          planned: Math.round((Number(t.quantity) / arr.length) * (idx + 1)),
          actual: null,
          goodPoints: '',
          badPoints: '',
          customerInsight: '',
          submitted: false,
          submittedAt: null,
        })),
        status: TACTIC_STATUS.IN_PROGRESS,
      }));

      await createDeclaration(staffName, month, finalTactics);
      alert('宣言しました！');
      onCreated();
    } catch (e) {
      console.error(e);
      alert('保存に失敗しました');
    }
    setSaving(false);
  };

  return (
    <div>
      <div style={S.phrase}>💡 {phrase}</div>

      {tactics.map((t, i) => (
        <div key={i} style={S.card}>
          <div style={{ ...S.row, justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: C.gold }}>戦術 {i + 1}</span>
            {tactics.length > 1 && (
              <button onClick={() => removeTactic(i)} style={{ ...S.btnSec, padding: '4px 10px', fontSize: 11, color: C.red, borderColor: C.red }}>削除</button>
            )}
          </div>

          {/* 戦術選択 */}
          <label style={S.label}>戦術を選ぶ</label>
          <select value={t.id} onChange={e => {
            const id = e.target.value;
            const t0 = TACTICS.find(x => x.id === id);
            updateTactic(i, { id, name: t0.name });
          }} style={{ ...S.input, marginBottom: 6 }}>
            {TACTICS.map(t0 => <option key={t0.id} value={t0.id}>{t0.name}</option>)}
          </select>
          {t.id !== 'T99' && (
            <div style={{ fontSize: 11, color: C.tl, marginBottom: 10, padding: '6px 10px', background: 'rgba(45,212,191,0.08)', borderRadius: 6 }}>
              💎 {tacticValue(t.id)}
            </div>
          )}
          {t.id === 'T99' && (
            <input value={t.customName} onChange={e => updateTactic(i, { customName: e.target.value })} placeholder="自分で考えた手法名" style={{ ...S.input, marginBottom: 10 }} />
          )}

          {/* 価値創造の3軸 その1: 潜在ニーズ */}
          <label style={S.label}>🔍 お客様の「言葉にしていない不安」は？</label>
          <textarea value={t.selectedReason} onChange={e => updateTactic(i, { selectedReason: e.target.value })} placeholder="例: 家計が見えない不安、固定費が不透明" style={{ ...S.ta, marginBottom: 10 }} />

          {/* 価値創造の3軸 その2: 価値・感情の変化 */}
          <label style={S.label}>💎 お客様に提供する「価値・感情の変化」は？</label>
          <textarea value={t.providedValue} onChange={e => updateTactic(i, { providedValue: e.target.value })} placeholder="例: 家計の見える化・トータル節約の安心感" style={{ ...S.ta, marginBottom: 10 }} />

          {/* 量・単位 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 2 }}>
              <label style={S.label}>量</label>
              <input type="number" value={t.quantity} onChange={e => updateTactic(i, { quantity: e.target.value })} style={S.input} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>単位</label>
              <select value={t.unit} onChange={e => updateTactic(i, { unit: e.target.value })} style={S.input}>
                {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          {/* 期間（チェックポイントの単位）*/}
          <label style={S.label}>振り返りの単位</label>
          <div style={{ ...S.row, marginBottom: 6 }}>
            {PERIOD_OPTIONS.map(p => (
              <button key={p.id} onClick={() => updateTactic(i, { period: p.id })} style={S.pill(C.pu, t.period === p.id)}>{p.name}</button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: C.mut, marginBottom: 4 }}>
            {PERIOD_OPTIONS.find(p => p.id === t.period)?.desc}
          </div>
          <div style={{ fontSize: 10, color: C.mut2 }}>
            自動生成されるチェックポイント: {generateCheckpointDates(month, t.period).map(formatDateShort).join(' / ')}
          </div>
        </div>
      ))}

      <button onClick={addTactic} style={{ ...S.btnSec, width: '100%', marginBottom: 10 }}>＋ 戦術を追加（最大5つ）</button>

      <button onClick={handleSubmit} disabled={saving} style={S.btn()}>
        {saving ? '宣言中…' : '✅ 今月の宣言として登録する'}
      </button>
    </div>
  );
}

// ─── 宣言ビュー（宣言済み・閲覧）───
function DeclareView({ declaration, onChange }) {
  const t = declaration.tactics || [];
  return (
    <div>
      <div style={{ ...S.card, background: 'linear-gradient(135deg, rgba(52,211,153,0.10), rgba(45,212,191,0.06))', border: '1px solid rgba(52,211,153,0.3)' }}>
        <div style={{ fontSize: 12, color: C.green, fontWeight: 900, marginBottom: 4 }}>✅ 今月の戦術を宣言済み</div>
        <div style={{ fontSize: 11, color: C.mut }}>{t.length}個の戦術 ／ チェックポイントは「📊 進捗・振り返り」タブで</div>
      </div>

      {t.map((tactic, i) => (
        <div key={i} style={S.card}>
          <div style={{ fontSize: 14, fontWeight: 900, color: C.gold, marginBottom: 4 }}>戦術 {i + 1}: {tactic.name}</div>
          <div style={{ fontSize: 13, color: C.w2, marginBottom: 8 }}>
            目標: <b style={{ color: C.tl }}>{tactic.quantity}{tactic.unit}</b> ／ 振り返り: <b>{periodName(tactic.period)}</b>
          </div>
          <div style={S.card2}>
            <div style={{ fontSize: 10, color: C.mut, marginBottom: 3 }}>🔍 言葉にしていない不安</div>
            <div style={{ fontSize: 12, color: C.w2, whiteSpace: 'pre-wrap' }}>{tactic.selectedReason}</div>
          </div>
          <div style={{ ...S.card2, marginTop: 6 }}>
            <div style={{ fontSize: 10, color: C.mut, marginBottom: 3 }}>💎 提供する価値・感情の変化</div>
            <div style={{ fontSize: 12, color: C.w2, whiteSpace: 'pre-wrap' }}>{tactic.providedValue}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// 📊 進捗・振り返りタブ
// =====================================================================
function CheckpointTab({ declaration, month, onChange }) {
  const phrase = useMemo(() => getPhraseForMonth(PHRASES_REVIEW, month), [month]);
  const monthProgress = getMonthProgress(month);
  const showMonthlyReview = monthProgress >= 80 || declaration?.monthlyReview;

  if (!declaration || !declaration.tactics?.length) {
    return (
      <div style={S.card}>
        <div style={{ fontSize: 13, color: C.mut, textAlign: 'center', padding: '20px 10px' }}>
          まだ今月の戦術が宣言されていません。<br />「📋 今月の宣言」タブから始めてください。
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={S.phrase}>💡 {phrase}</div>

      {declaration.tactics.map((tactic, ti) => (
        <TacticProgress key={ti} declaration={declaration} tactic={tactic} tacticIndex={ti} onChange={onChange} />
      ))}

      {showMonthlyReview && (
        <MonthlyReview declaration={declaration} onChange={onChange} />
      )}
    </div>
  );
}

// ─── 戦術ごとのチェックポイント表示・入力 ───
function TacticProgress({ declaration, tactic, tacticIndex, onChange }) {
  const totalActual = (tactic.checkpoints || []).reduce((s, cp) => s + (Number(cp.actual) || 0), 0);
  const pctOfTarget = Math.round((totalActual / Number(tactic.quantity)) * 100);
  const submittedCount = (tactic.checkpoints || []).filter(cp => cp.submitted).length;

  return (
    <div style={S.card}>
      <div style={{ fontSize: 14, fontWeight: 900, color: C.gold, marginBottom: 4 }}>戦術 {tacticIndex + 1}: {tactic.name}</div>
      <div style={{ fontSize: 11, color: C.mut, marginBottom: 8 }}>
        目標 {tactic.quantity}{tactic.unit} ／ 累計実績 <b style={{ color: C.tl }}>{totalActual}{tactic.unit}</b> ／ 達成率 <b style={{ color: pctOfTarget >= 100 ? C.green : pctOfTarget >= 60 ? C.gold : C.red }}>{pctOfTarget}%</b>
      </div>
      <div style={S.bar}><div style={S.barIn(pctOfTarget, pctOfTarget >= 100 ? C.green : C.gold)} /></div>
      <div style={{ fontSize: 10, color: C.mut, margin: '6px 0 10px' }}>
        チェックポイント {submittedCount}/{(tactic.checkpoints || []).length} 提出済
      </div>

      {(tactic.checkpoints || []).map((cp, ci) => (
        <CheckpointBlock key={ci} declarationId={declaration.id} tacticIndex={tacticIndex} checkpointIndex={ci} cp={cp} unit={tactic.unit} onSaved={onChange} />
      ))}
    </div>
  );
}

// ─── チェックポイント1つ分（記入or閲覧）───
function CheckpointBlock({ declarationId, tacticIndex, checkpointIndex, cp, unit, onSaved }) {
  const canSubmit = isDatePastOrToday(cp.date);
  const [editing, setEditing] = useState(false);
  const [actual, setActual] = useState(cp.actual ?? '');
  const [goodPoints, setGoodPoints] = useState(cp.goodPoints || '');
  const [badPoints, setBadPoints] = useState(cp.badPoints || '');
  const [customerInsight, setCustomerInsight] = useState(cp.customerInsight || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (actual === '' || actual === null) { alert('実績を入力してください'); return; }
    setSaving(true);
    try {
      await submitCheckpoint(declarationId, tacticIndex, checkpointIndex, {
        actual: Number(actual),
        goodPoints,
        badPoints,
        customerInsight,
      });
      setEditing(false);
      onSaved();
    } catch (e) {
      alert('保存に失敗しました');
    }
    setSaving(false);
  };

  // 提出済みかつ非編集モード → 閲覧表示
  if (cp.submitted && !editing) {
    return (
      <div style={{ ...S.card2, borderLeft: `3px solid ${C.green}` }}>
        <div style={{ ...S.row, justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 900, color: C.w2 }}>{formatDateShort(cp.date)} 提出済</span>
          <button onClick={() => setEditing(true)} style={{ ...S.btnSec, padding: '3px 8px', fontSize: 10 }}>編集</button>
        </div>
        <div style={{ fontSize: 12, color: C.w2, marginBottom: 4 }}>
          計画 {cp.planned}{unit} ／ 実績 <b style={{ color: cp.actual >= cp.planned ? C.green : C.gold }}>{cp.actual}{unit}</b>
        </div>
        {cp.goodPoints && <div style={{ fontSize: 11, color: C.green, marginTop: 4 }}>👍 {cp.goodPoints}</div>}
        {cp.badPoints && <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>👎 {cp.badPoints}</div>}
        {cp.customerInsight && <div style={{ fontSize: 11, color: C.tl, marginTop: 4 }}>💎 {cp.customerInsight}</div>}
      </div>
    );
  }

  // 未提出 → 期日が来てなければ予約表示
  if (!canSubmit) {
    return (
      <div style={{ ...S.card2, opacity: 0.5 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.mut }}>
          🔒 {formatDateShort(cp.date)} 予定（計画 {cp.planned}{unit}） — その日になったら入力できます
        </div>
      </div>
    );
  }

  // 入力フォーム
  return (
    <div style={{ ...S.card2, borderLeft: `3px solid ${C.gold}` }}>
      <div style={{ fontSize: 12, fontWeight: 900, color: C.gold, marginBottom: 6 }}>
        ✏️ {formatDateShort(cp.date)} チェックポイント（計画 {cp.planned}{unit}）
      </div>

      <label style={S.label}>実績（数字）</label>
      <input type="number" value={actual} onChange={e => setActual(e.target.value)} placeholder="例: 5" style={{ ...S.input, marginBottom: 8 }} />

      <label style={S.label}>👍 良かったこと</label>
      <textarea value={goodPoints} onChange={e => setGoodPoints(e.target.value)} placeholder="例: ゴールド先行の言い回しが刺さった" style={{ ...S.ta, marginBottom: 8 }} />

      <label style={S.label}>👎 ダメだったこと</label>
      <textarea value={badPoints} onChange={e => setBadPoints(e.target.value)} placeholder="例: 固定セットの提案タイミングが遅かった" style={{ ...S.ta, marginBottom: 8 }} />

      <label style={S.label}>💎 お客様の感情はどう変わった？</label>
      <textarea value={customerInsight} onChange={e => setCustomerInsight(e.target.value)} placeholder="例: 「家計が一目で見えるって安心ね」と笑顔で帰られた" style={{ ...S.ta, marginBottom: 10 }} />

      <button onClick={handleSubmit} disabled={saving} style={S.btn(C.tl)}>
        {saving ? '保存中…' : '✅ このチェックポイントを保存'}
      </button>
    </div>
  );
}

// ─── 月末総合振り返り ───
function MonthlyReview({ declaration, onChange }) {
  const existing = declaration.monthlyReview;
  const [editing, setEditing] = useState(!existing);
  const [selfRating, setSelfRating] = useState(existing?.selfRating || '');
  const [goodPoints, setGoodPoints] = useState(existing?.goodPoints || '');
  const [badPoints, setBadPoints] = useState(existing?.badPoints || '');
  const [customerLearning, setCustomerLearning] = useState(existing?.customerLearning || '');
  const [nextMonthMemo, setNextMonthMemo] = useState(existing?.nextMonthMemo || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!selfRating) { alert('自己評価を選択してください'); return; }
    setSaving(true);
    try {
      await submitMonthlyReview(declaration.id, {
        selfRating, goodPoints, badPoints, customerLearning, nextMonthMemo
      });
      setEditing(false);
      onChange();
    } catch (e) {
      alert('保存に失敗しました');
    }
    setSaving(false);
  };

  if (existing && !editing) {
    return (
      <div style={{ ...S.card, background: 'linear-gradient(135deg, rgba(167,139,250,0.10), rgba(251,191,36,0.06))', border: '1px solid rgba(167,139,250,0.3)' }}>
        <div style={{ ...S.row, justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 900, color: C.pu }}>🎯 月末総合振り返り（提出済）</span>
          <button onClick={() => setEditing(true)} style={S.btnSec}>編集</button>
        </div>
        <div style={{ fontSize: 13, color: C.w2, marginBottom: 8 }}>
          自己評価: <span style={{ color: ratingColor(selfRating), fontWeight: 900 }}>{ratingIcon(selfRating)} {ratingLabel(selfRating)}</span>
        </div>
        {goodPoints && <div style={{ ...S.card2, marginTop: 6 }}><div style={{ fontSize: 10, color: C.green, marginBottom: 2 }}>👍 良かったこと</div><div style={{ fontSize: 12, color: C.w2, whiteSpace: 'pre-wrap' }}>{goodPoints}</div></div>}
        {badPoints && <div style={{ ...S.card2, marginTop: 6 }}><div style={{ fontSize: 10, color: C.red, marginBottom: 2 }}>👎 ダメだったこと</div><div style={{ fontSize: 12, color: C.w2, whiteSpace: 'pre-wrap' }}>{badPoints}</div></div>}
        {customerLearning && <div style={{ ...S.card2, marginTop: 6 }}><div style={{ fontSize: 10, color: C.tl, marginBottom: 2 }}>💎 お客様について学んだこと</div><div style={{ fontSize: 12, color: C.w2, whiteSpace: 'pre-wrap' }}>{customerLearning}</div></div>}
        {nextMonthMemo && <div style={{ ...S.card2, marginTop: 6 }}><div style={{ fontSize: 10, color: C.gold, marginBottom: 2 }}>📩 来月の自分へ</div><div style={{ fontSize: 12, color: C.w2, whiteSpace: 'pre-wrap' }}>{nextMonthMemo}</div></div>}
      </div>
    );
  }

  return (
    <div style={{ ...S.card, border: `2px solid ${C.pu}` }}>
      <div style={{ fontSize: 14, fontWeight: 900, color: C.pu, marginBottom: 10 }}>🎯 月末総合振り返り</div>

      <label style={S.label}>自己評価</label>
      <div style={{ ...S.row, marginBottom: 12 }}>
        {SELF_RATINGS.map(r => (
          <button key={r.id} onClick={() => setSelfRating(r.id)} style={S.pill(r.color, selfRating === r.id)}>
            {r.icon} {r.label}
          </button>
        ))}
      </div>

      <label style={S.label}>👍 今月、良かったこと</label>
      <textarea value={goodPoints} onChange={e => setGoodPoints(e.target.value)} style={{ ...S.ta, marginBottom: 10, minHeight: 70 }} />

      <label style={S.label}>👎 今月、ダメだったこと</label>
      <textarea value={badPoints} onChange={e => setBadPoints(e.target.value)} style={{ ...S.ta, marginBottom: 10, minHeight: 70 }} />

      <label style={S.label}>💎 お客様について、今月学んだこと</label>
      <textarea value={customerLearning} onChange={e => setCustomerLearning(e.target.value)} placeholder="例: マネ活転換は「節約より増やす」の言い方が刺さりやすい" style={{ ...S.ta, marginBottom: 10, minHeight: 70 }} />

      <label style={S.label}>📩 来月の自分への伝言</label>
      <textarea value={nextMonthMemo} onChange={e => setNextMonthMemo(e.target.value)} placeholder="例: 月初からゴールド先行のトークを意識する" style={{ ...S.ta, marginBottom: 12, minHeight: 70 }} />

      <button onClick={handleSubmit} disabled={saving} style={S.btn(C.pu)}>
        {saving ? '保存中…' : '✅ 月末振り返りを提出'}
      </button>
    </div>
  );
}

// =====================================================================
// 📚 履歴タブ
// =====================================================================
function HistoryTab({ history, setMonth, setTab }) {
  if (!history.length) {
    return (
      <div style={S.card}>
        <div style={{ fontSize: 13, color: C.mut, textAlign: 'center', padding: '20px 10px' }}>
          まだ履歴がありません。<br />毎月の宣言と振り返りが、ここに日記のように残っていきます。
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ ...S.hint, marginBottom: 10 }}>
        あなたの成長の記録です。何ヶ月でも遡れます。
      </div>

      {history.map(d => {
        const review = d.monthlyReview;
        const totalActual = (d.tactics || []).reduce((s, t) => s + (t.checkpoints || []).reduce((ss, cp) => ss + (Number(cp.actual) || 0), 0), 0);
        const totalTarget = (d.tactics || []).reduce((s, t) => s + Number(t.quantity), 0);
        return (
          <div key={d.id} style={S.card}>
            <div style={{ ...S.row, justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 900, color: C.gold }}>{formatMonth(d.month)}</span>
              {review && (
                <span style={{ fontSize: 11, fontWeight: 900, color: ratingColor(review.selfRating) }}>
                  {ratingIcon(review.selfRating)} {ratingLabel(review.selfRating)}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: C.mut, marginBottom: 6 }}>
              戦術 {(d.tactics || []).length}個 ／ 累計 {totalActual}/{totalTarget}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
              {(d.tactics || []).map((t, i) => (
                <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: 'rgba(45,212,191,0.15)', color: C.tl, border: `1px solid ${C.tl}` }}>{t.name}</span>
              ))}
            </div>
            {review?.customerLearning && (
              <div style={{ ...S.card2, marginTop: 6 }}>
                <div style={{ fontSize: 10, color: C.tl, marginBottom: 2 }}>💎 学んだこと</div>
                <div style={{ fontSize: 11, color: C.w2, whiteSpace: 'pre-wrap' }}>{review.customerLearning}</div>
              </div>
            )}
            {review?.nextMonthMemo && (
              <div style={{ ...S.card2, marginTop: 6 }}>
                <div style={{ fontSize: 10, color: C.gold, marginBottom: 2 }}>📩 来月への伝言</div>
                <div style={{ fontSize: 11, color: C.w2, whiteSpace: 'pre-wrap' }}>{review.nextMonthMemo}</div>
              </div>
            )}
            <button onClick={() => { setMonth(d.month); setTab('checkpoint'); }} style={{ ...S.btnSec, width: '100%', marginTop: 8 }}>
              📊 詳細を見る
            </button>
          </div>
        );
      })}
    </div>
  );
}
