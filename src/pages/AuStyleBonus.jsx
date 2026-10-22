import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { MAIN_STORES, storeName } from '../data/masters';
import { classifyLine, isMobileLine } from '../lib/tactical';

const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const yen = (n) => '¥' + Number(Math.round(n) || 0).toLocaleString();

const C = { gold: '#FBBF24', green: '#34D399', purple: '#A78BFA', red: '#F87171', blue: '#38BDF8', orange: '#FB923C', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B', dim: '#475569', sub: '#94A3B8' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };
const inp = { padding: 8, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' };

// ===== 新基準：au Style販売強化奨励金 =====
// 5指標それぞれに閾値(auショップ上位3割水準)を設定。
// 「閾値を超えた指標の数」で単価ランク(①②③)が決まり、単価 × 各商材の成約数 = 支援額。
//   threshold … 閾値(%)  ／  unit … [単価①, 単価②, 単価③]  ／  test … 成約数の数え方
const INDICATORS = [
  { id: 'mane',  label: 'マネ活比率',              threshold: 60, unit: [6000, 4000, 2000], cntLabel: 'マネ活2',   test: l => isMobileLine(l) && classifyLine(l) === 'manekatsu2' },
  { id: 'denki', label: 'auでんき受付完了率',      threshold: 10, unit: [4000, 2500, 1000], cntLabel: 'auでんき',  test: l => l.midCat === 'MID_045' },
  { id: 'gold',  label: 'ゴールドカード発行率',    threshold: 15, unit: [6000, 4000, 2000], cntLabel: 'ゴールド',  test: l => ['MID_041', 'MID_042'].includes(l.midCat) },
  { id: 'ponta', label: 'Pontaパス獲得率',         threshold: 90, unit: [1200, 800, 400],  cntLabel: 'Pontaパス', test: l => isMobileLine(l) && (l.optNames || []).includes('Pontaパス') },
  { id: 'jibun', label: 'じぶん銀行口座申込セット率', threshold: 40, unit: [6000, 4000, 2000], cntLabel: 'じぶん銀行', test: l => l.midCat === 'MID_044' },
];

// 閾値の達成数 → 単価ランク番号（0=単価①, 1=単価②, 2=単価③, -1=未達成）
//   5個 → ①  ／  3〜4個 → ②  ／  1〜2個 → ③  ／  0個 → 未達成
function rankIndex(n) {
  if (n >= 5) return 0;
  if (n >= 3) return 1;
  if (n >= 1) return 2;
  return -1;
}
const RANK_LABEL = ['単価①', '単価②', '単価③'];
const RANK_COLOR = ['#34D399', '#FBBF24', '#FB923C'];

// レーダーチャート（5指標の「率 ÷ 閾値」を達成度として表示。1.0で閾値ちょうど達成）
function RadarChart({ achievement, labels, rates, thresholds }) {
  const cx = 160, cy = 150, r = 90;
  const n = achievement.length || 5;
  const angles = Array.from({ length: n }, (_, i) => (i * 360 / n - 90) * Math.PI / 180);
  const ratios = achievement.map(v => Math.max(0, Math.min(v, 1.2)));
  const points = ratios.map((rt, i) => ({ x: cx + Math.cos(angles[i]) * r * rt, y: cy + Math.sin(angles[i]) * r * rt }));
  const polygonPoints = points.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
  const grids = [0.25, 0.5, 0.75, 1.0].map(g => angles.map(a => (cx + Math.cos(a) * r * g).toFixed(1) + ',' + (cy + Math.sin(a) * r * g).toFixed(1)).join(' '));
  return (
    <svg viewBox="0 0 320 280" style={{ width: '100%', maxWidth: 320, display: 'block', margin: '0 auto' }}>
      {grids.map((g, i) => (<polygon key={i} points={g} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray={i === 3 ? '0' : '2,2'} />))}
      {angles.map((a, i) => (<line key={i} x1={cx} y1={cy} x2={cx + Math.cos(a) * r} y2={cy + Math.sin(a) * r} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />))}
      <polygon points={polygonPoints} fill="rgba(251,191,36,0.25)" stroke="#FBBF24" strokeWidth="2" />
      {points.map((p, i) => (<circle key={i} cx={p.x} cy={p.y} r={ratios[i] >= 1 ? 5 : 3.5} fill={ratios[i] >= 1 ? '#34D399' : '#F87171'} stroke="#0F0D1A" strokeWidth="1.5" />))}
      <text x={cx} y={cy - r - 2} fill={C.mut2} fontSize="8" textAnchor="middle">閾値ライン</text>
      {labels.map((l, i) => {
        const lx = cx + Math.cos(angles[i]) * (r + 30);
        const ly = cy + Math.sin(angles[i]) * (r + 30);
        const anchor = Math.abs(Math.cos(angles[i])) < 0.3 ? 'middle' : Math.cos(angles[i]) > 0 ? 'start' : 'end';
        return (
          <g key={i}>
            <text x={lx} y={ly - 4} fill={C.w2} fontSize="8" fontWeight="600" textAnchor={anchor}>{l}</text>
            <text x={lx} y={ly + 7} fill={achievement[i] >= 1 ? C.green : C.red} fontSize="9.5" fontWeight="700" textAnchor={anchor}>{rates[i] != null ? rates[i] + '%' : '—'}/{thresholds[i]}%</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function AuStyleBonus() {
  const { user, profile } = useAuth();
  const [reports, setReports] = useState([]);
  const [rates, setRates] = useState({});         // { 'storeId_2026-06': { mane:65, denki:12, ... } }
  const [storeFilter, setStoreFilter] = useState('all');
  const [month, setMonth] = useState(ym(new Date()));
  const [draftRate, setDraftRate] = useState({}); // 入力中の率（選択店舗ぶん）
  const [saving, setSaving] = useState(false);
  const isAdmin = profile?.role === 'admin' || profile?.role === 'manager';

  // 報告は「選んだ月だけ」読み込む（軽量化・monthRangeFetch）。月を変えるとその月を再取得
  useEffect(() => {
    if (!user || !month) return;
    const [_y, _m] = month.split('-').map(Number);
    const _start = new Date(_y, _m - 1, 1);
    const _end = new Date(_y, _m, 1);
    return onSnapshot(query(collection(db, 'reports'), where('createdAt', '>=', _start), where('createdAt', '<', _end)), s => setReports(s.docs.map(d => { const r = { id: d.id, ...d.data() }; const cd = r.createdAt?.toDate?.(); if (cd) r._month = ym(cd); return r; })));
  }, [user, month]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, 'auStyleBonusRates'), s => { const m = {}; s.docs.forEach(d => { m[d.id] = d.data(); }); setRates(m); });
  }, [user]);

  // 選択店舗・月の保存済みの率を入力欄へ反映
  const rateKey = storeFilter !== 'all' ? storeFilter + '_' + month : null;
  useEffect(() => {
    if (rateKey && rates[rateKey]) setDraftRate(rates[rateKey]);
    else setDraftRate({});
  }, [rateKey, rates]);

  // ある店舗・ある指標の成約数を数える
  const countFor = (storeId, ind) => {
    let c = 0;
    reports.forEach(r => {
      // 奨励金は店舗実績なので外注も含める（countedで除外しない）
      if (r._month !== month) return;
      if ((r.eventStoreId || r.openStoreId || r.storeId) !== storeId) return;
      (r.lines || []).forEach(l => { if (ind.test(l)) c++; });
    });
    return c;
  };

  // ある店舗の支援額を計算（rateObj＝その店舗の率）
  const calcStore = (storeId, rateObj) => {
    let achieved = 0;
    INDICATORS.forEach(ind => { const v = Number(rateObj?.[ind.id]); if (!isNaN(v) && v > 0 && v >= ind.threshold) achieved++; });
    const ri = rankIndex(achieved);
    const rows = INDICATORS.map(ind => {
      const count = countFor(storeId, ind);
      const unit = ri >= 0 ? ind.unit[ri] : 0;
      return { ind, count, unit, subtotal: count * unit };
    });
    const total = rows.reduce((s, x) => s + x.subtotal, 0);
    return { achieved, ri, rows, total };
  };

  // 店舗選択時の計算（入力中の率で即計算）
  const selected = storeFilter !== 'all' ? calcStore(storeFilter, draftRate) : null;

  // 全店合計（保存済みの率を使う）
  const allTotal = useMemo(() => {
    if (storeFilter !== 'all') return null;
    let sum = 0;
    const per = MAIN_STORES.map(st => {
      const r = rates[st.id + '_' + month] || {};
      const c = calcStore(st.id, r);
      sum += c.total;
      const hasRate = INDICATORS.some(ind => r[ind.id] != null && r[ind.id] !== '' && Number(r[ind.id]) > 0);
      return { store: st, ...c, hasRate };
    });
    return { sum, per };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeFilter, month, rates, reports]);

  const saveRate = async () => {
    if (!rateKey) return;
    setSaving(true);
    try {
      const clean = {};
      INDICATORS.forEach(ind => { clean[ind.id] = Number(draftRate[ind.id]) || 0; });
      await setDoc(doc(db, 'auStyleBonusRates', rateKey), { ...clean, storeId: storeFilter, month, updatedAt: new Date() }, { merge: true });
    } catch (e) { alert('保存エラー: ' + e.message); }
    setSaving(false);
  };

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>🏆 au Style販売強化奨励金</h1>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 10, lineHeight: 1.5 }}>5つの率が閾値（auショップ上位3割水準）を超えた数で単価ランク（①②③）が決まり、単価 × 成約数で支援額が決まります。率はKDDI実績を見て、店舗ごとに入力してください。</div>

      {/* 店舗タブ＋月切替 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, overflowX: 'auto', paddingBottom: 4 }}>
        {[{ id: 'all', name: '全店' }, ...MAIN_STORES].map(s => (
          <button key={s.id} onClick={() => setStoreFilter(s.id)} style={{ flex: '0 0 auto', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', background: storeFilter === s.id ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.02)', color: storeFilter === s.id ? C.gold : C.mut2, border: storeFilter === s.id ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>{s.name.replace('auStyle', '').replace('auショップ', '')}</button>
        ))}
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ marginLeft: 'auto', padding: 4, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 10 }} />
      </div>

      {/* === 全店表示 === */}
      {storeFilter === 'all' && allTotal && (
        <>
          <div style={{ ...card, background: 'rgba(251,191,36,0.06)', borderColor: 'rgba(251,191,36,0.3)' }}>
            <div style={{ fontSize: 11, color: C.gold, marginBottom: 6, fontWeight: 700 }}>💰 全店の奨励金（見込み合計）</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: C.gold, textAlign: 'center', marginBottom: 4 }}>{yen(allTotal.sum)}</div>
            <div style={{ fontSize: 10, color: C.mut, textAlign: 'center' }}>各店舗をタップして率を入力すると、ここに反映されます</div>
          </div>
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', marginBottom: 8 }}>🏬 店舗別（タップで率の入力へ）</div>
            {allTotal.per.map(p => (
              <div key={p.store.id} onClick={() => setStoreFilter(p.store.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
                <span style={{ fontSize: 13, color: C.w2, fontWeight: 600 }}>{p.store.name.replace('auStyle', '').replace('auショップ', '')}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {!p.hasRate ? <span style={{ fontSize: 10, color: C.mut2 }}>率 未入力</span>
                    : <span style={{ fontSize: 10, fontWeight: 700, color: p.ri >= 0 ? RANK_COLOR[p.ri] : C.red }}>{p.ri >= 0 ? RANK_LABEL[p.ri] : '未達成'}（{p.achieved}/5）</span>}
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.gold }}>{yen(p.total)}</span>
                  <span style={{ color: C.sub }}>›</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* === 店舗選択時 === */}
      {storeFilter !== 'all' && selected && (
        <>
          {/* レーダー */}
          <div style={card}>
            <div style={{ fontSize: 11, color: C.mut, marginBottom: 6, textAlign: 'center' }}>{storeName(storeFilter)} ／ {month}</div>
            <RadarChart
              achievement={INDICATORS.map(ind => { const v = Number(draftRate[ind.id]); return !isNaN(v) && ind.threshold > 0 ? v / ind.threshold : 0; })}
              labels={INDICATORS.map(ind => ind.label.replace('受付完了率', '').replace('カード発行率', '発行').replace('口座申込セット率', 'セット').replace('獲得率', '').replace('比率', ''))}
              rates={INDICATORS.map(ind => { const v = Number(draftRate[ind.id]); return (draftRate[ind.id] == null || draftRate[ind.id] === '' || isNaN(v)) ? null : v; })}
              thresholds={INDICATORS.map(ind => ind.threshold)}
            />
          </div>

          {/* 単価ランク */}
          <div style={{ ...card, background: selected.ri >= 0 ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)', borderColor: selected.ri >= 0 ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: C.w2 }}>閾値の達成数</span>
              <span style={{ fontSize: 15, fontWeight: 900, color: selected.ri >= 0 ? RANK_COLOR[selected.ri] : C.red }}>{selected.achieved} / 5 個 → {selected.ri >= 0 ? RANK_LABEL[selected.ri] : '未達成'}</span>
            </div>
          </div>

          {/* 率の入力 */}
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', marginBottom: 8 }}>📝 率の入力（KDDI実績を見て入力）</div>
            {INDICATORS.map(ind => {
              const empty = draftRate[ind.id] == null || draftRate[ind.id] === '';
              const v = Number(draftRate[ind.id]);
              const met = !empty && !isNaN(v) && v >= ind.threshold;
              return (
                <div key={ind.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: C.w2 }}>{ind.label}</div>
                    <div style={{ fontSize: 9, color: C.mut2 }}>閾値 {ind.threshold}%</div>
                  </div>
                  <input type="number" inputMode="decimal" value={draftRate[ind.id] ?? ''} onChange={e => setDraftRate({ ...draftRate, [ind.id]: e.target.value })} placeholder="—" style={{ ...inp, width: 84, textAlign: 'right' }} />
                  <span style={{ fontSize: 12, width: 12 }}>%</span>
                  <span style={{ fontSize: 15, width: 22, textAlign: 'center' }}>{empty ? '' : (met ? '✅' : '❌')}</span>
                </div>
              );
            })}
            {isAdmin && <button onClick={saveRate} disabled={saving} style={{ width: '100%', padding: 11, marginTop: 4, borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: saving ? 'rgba(255,255,255,0.1)' : C.gold, color: saving ? C.mut : '#000', border: 'none' }}>{saving ? '保存中…' : '✓ この店舗の率を保存'}</button>}
            <div style={{ fontSize: 9, color: C.mut2, marginTop: 8, lineHeight: 1.5 }}>※ 率は自動計算できないため手入力です（KDDI実績の率をそのまま入れてください）。成約数は報告から自動集計されます。</div>
          </div>

          {/* 支援額 */}
          <div style={{ ...card, background: 'rgba(251,191,36,0.06)', borderColor: 'rgba(251,191,36,0.3)' }}>
            <div style={{ fontSize: 11, color: C.gold, marginBottom: 6, fontWeight: 700 }}>💰 この店舗の奨励金（見込み）</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: C.gold, textAlign: 'center' }}>{yen(selected.total)}</div>
            {selected.ri < 0 && <div style={{ fontSize: 10, color: C.red, textAlign: 'center', marginTop: 4 }}>閾値を1つも達成していないため支援なし</div>}
          </div>

          {/* 商材別 */}
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', marginBottom: 8 }}>📋 商材別 内訳（単価 × 成約数）</div>
            {selected.rows.map((row, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ fontSize: 12, color: C.w2 }}>{row.ind.cntLabel}</span>
                <span style={{ fontSize: 11, color: C.mut }}>{yen(row.unit)}/件 × {row.count}件 = <b style={{ color: C.gold }}>{yen(row.subtotal)}</b></span>
              </div>
            ))}
          </div>

          {/* 単価表（参考） */}
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.mut, marginBottom: 8 }}>📑 単価表（達成数で決まる）</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr style={{ color: C.mut2 }}>
                    <th style={{ textAlign: 'left', padding: 4 }}>ランク</th>
                    {INDICATORS.map(ind => <th key={ind.id} style={{ textAlign: 'right', padding: 4 }}>{ind.cntLabel}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2].map(ri => (
                    <tr key={ri} style={{ color: selected.ri === ri ? RANK_COLOR[ri] : C.w2, fontWeight: selected.ri === ri ? 800 : 400, background: selected.ri === ri ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                      <td style={{ padding: 4 }}>{RANK_LABEL[ri]}（{ri === 0 ? '5個' : ri === 1 ? '3〜4個' : '1〜2個'}）</td>
                      {INDICATORS.map(ind => <td key={ind.id} style={{ textAlign: 'right', padding: 4 }}>{ind.unit[ri].toLocaleString()}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
