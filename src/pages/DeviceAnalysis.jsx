// =====================================================================
// DeviceAnalysis.jsx ―― 端末分析（機種×色の売れ筋ランキング＋仕入れ目安）
// ・会社全体／店舗別 × 総合/新規/MNP/機変/UP の機種ランキングと色内訳
// ・当月の販売ペースから「月末までにあと何台売れる見込みか」＝仕入れ目安を自動計算
// ・実在庫は持たない（販売ペース予測のみ）。全スタッフ閲覧可
// ・読み込みは「選んだ月＋前月」だけ（軽量化・monthRangeFetch方式）
// =====================================================================
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { MAIN_STORES } from '../data/masters';
import { creditStoreOf } from '../lib/aggregate';

const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const C = { gold: '#FBBF24', green: '#34D399', blue: '#38BDF8', purple: '#A78BFA', red: '#F87171', orange: '#FB923C', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B', dim: '#475569' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };

const MOBILE_MAINS = ['MAIN_001', 'MAIN_002', 'MAIN_003', 'MAIN_004'];
const CAT_SHORT = { MAIN_001: '新規', MAIN_002: 'MNP', MAIN_003: '機変', MAIN_004: 'UP' };
const CAT_COLOR = { MAIN_001: C.green, MAIN_002: C.blue, MAIN_003: C.purple, MAIN_004: C.orange };
const CAT_TABS = [
  { id: 'all', label: '総合', color: C.gold },
  { id: 'MAIN_001', label: '新規', color: C.green },
  { id: 'MAIN_002', label: 'MNP', color: C.blue },
  { id: 'MAIN_003', label: '機変', color: C.purple },
  { id: 'MAIN_004', label: 'アップセル', color: C.orange },
];

export default function DeviceAnalysis() {
  const { user } = useAuth();
  const [month, setMonth] = useState(() => ym(new Date()));
  const [reports, setReports] = useState([]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [catTab, setCatTab] = useState('all');
  const [openModel, setOpenModel] = useState(null);   // ランキングで開いている機種
  const [openFc, setOpenFc] = useState(null);         // 仕入れ目安で開いている機種
  const [loading, setLoading] = useState(true);

  // 選んだ月＋前月だけ読み込む（前月比較のため2か月分）
  useEffect(() => {
    if (!user || !month) return;
    setLoading(true);
    const [_y, _m] = month.split('-').map(Number);
    const _start = new Date(_y, _m - 2, 1); // 前月1日
    const _end = new Date(_y, _m, 1);       // 翌月1日
    return onSnapshot(query(collection(db, 'reports'), where('createdAt', '>=', _start), where('createdAt', '<', _end)), (s) => {
      setReports(s.docs.map(d => { const r = { id: d.id, ...d.data() }; const cd = r.createdAt?.toDate?.(); if (cd) r._month = ym(cd); return r; }));
      setLoading(false);
    });
  }, [user, month]);

  const prevMonth = useMemo(() => { const [y, m] = month.split('-').map(Number); return ym(new Date(y, m - 2, 1)); }, [month]);

  // 端末ライン抽出（機種入力あり・モバイル4区分のみ。店舗実績＝在庫が動くため外注分も含む）
  const extract = (targetMonth) => {
    const out = [];
    reports.forEach(r => {
      if (r._month !== targetMonth) return;
      if (storeFilter !== 'all' && creditStoreOf(r) !== storeFilter) return;
      (r.lines || []).forEach(l => {
        if (!MOBILE_MAINS.includes(l.mainCat)) return;
        const model = (l.model || '').trim();
        if (!model) return;
        const color = (l.deviceColor || '').trim() || '色未記入';
        const storage = (l.deviceStorage || '').trim();
        out.push({ model, maker: l.maker || '', color, storage, variant: color + (storage ? ' / ' + storage : ''), mainCat: l.mainCat });
      });
    });
    return out;
  };

  const curLines = useMemo(() => extract(month), [reports, storeFilter, month]);
  const prevLines = useMemo(() => extract(prevMonth), [reports, storeFilter, prevMonth]);

  // 色の記入率（入力促進のため表示）
  const colorRate = useMemo(() => curLines.length === 0 ? null : Math.round(curLines.filter(l => l.color !== '色未記入').length / curLines.length * 100), [curLines]);

  // ───── ランキング（機種→色/容量の内訳つき） ─────
  const ranking = useMemo(() => {
    const lines = catTab === 'all' ? curLines : curLines.filter(l => l.mainCat === catTab);
    const m = {};
    lines.forEach(l => {
      const g = (m[l.model] = m[l.model] || { model: l.model, maker: l.maker, total: 0, byCat: {}, variants: {} });
      g.total++;
      g.byCat[l.mainCat] = (g.byCat[l.mainCat] || 0) + 1;
      const v = (g.variants[l.variant] = g.variants[l.variant] || { total: 0, byCat: {} });
      v.total++;
      v.byCat[l.mainCat] = (v.byCat[l.mainCat] || 0) + 1;
    });
    return Object.values(m).sort((a, b) => b.total - a.total);
  }, [curLines, catTab]);

  // ───── 仕入れ目安（当月のみ・販売ペース予測） ─────
  const _now = new Date();
  const isCurrentMonth = month === ym(_now);
  const forecast = useMemo(() => {
    if (!isCurrentMonth) return null;
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const elapsed = Math.max(1, _now.getDate());
    const prevMap = {};
    prevLines.forEach(l => { prevMap[l.model] = (prevMap[l.model] || 0) + 1; });
    const map = {};
    curLines.forEach(l => {
      const g = (map[l.model] = map[l.model] || { model: l.model, sold: 0, variants: {} });
      g.sold++;
      g.variants[l.variant] = (g.variants[l.variant] || 0) + 1;
    });
    const rows = Object.values(map).map(g => {
      const projected = Math.round(g.sold / elapsed * daysInMonth);
      const remaining = Math.max(0, projected - g.sold);
      const variantRows = Object.entries(g.variants).map(([variant, sold]) => {
        const p = Math.round(sold / elapsed * daysInMonth);
        return { variant, sold, projected: p, remaining: Math.max(0, p - sold) };
      }).sort((a, b) => b.sold - a.sold);
      return { ...g, projected, remaining, prev: prevMap[g.model] || 0, variantRows };
    }).sort((a, b) => b.remaining - a.remaining || b.sold - a.sold);
    return { rows, daysInMonth, elapsed };
  }, [curLines, prevLines, isCurrentMonth, month]);

  const medal = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '位';
  const maxTotal = ranking[0]?.total || 1;
  const catChips = (byCat) => (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {MOBILE_MAINS.filter(mc => byCat[mc]).map(mc => (
        <span key={mc} style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: CAT_COLOR[mc] + '22', color: CAT_COLOR[mc] }}>{CAT_SHORT[mc]}{byCat[mc]}</span>
      ))}
    </span>
  );

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>📱 端末分析</h1>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 10, lineHeight: 1.5 }}>機種×色の売れ筋ランキングと、今月の販売ペースからみた仕入れ台数の目安です。外注獲得分も含みます（店舗の在庫が動くため）。</div>

      {/* 店舗フィルタ＋月 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {[{ id: 'all', name: '会社全体' }, ...MAIN_STORES].map(s => (
          <button key={s.id} onClick={() => setStoreFilter(s.id)} style={{ flex: '0 0 auto', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', background: storeFilter === s.id ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.02)', color: storeFilter === s.id ? C.gold : C.mut2, border: storeFilter === s.id ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>{s.name.replace('auStyle', '').replace('auショップ', '')}</button>
        ))}
      </div>
      <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, marginBottom: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />

      {/* 区分タブ */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {CAT_TABS.map(t => (
          <button key={t.id} onClick={() => setCatTab(t.id)} style={{ flex: 1, padding: '7px 2px', borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: catTab === t.id ? t.color + '26' : 'rgba(255,255,255,0.02)', color: catTab === t.id ? t.color : C.mut2, border: catTab === t.id ? '1px solid ' + t.color + '4d' : '1px solid rgba(255,255,255,0.05)' }}>{t.label}</button>
        ))}
      </div>

      {/* サマリー */}
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10 }}>
        <span style={{ fontSize: 11, color: C.mut }}>端末販売（{catTab === 'all' ? '総合' : CAT_TABS.find(t => t.id === catTab)?.label}）</span>
        <span style={{ fontSize: 18, fontWeight: 900, color: C.gold }}>{(catTab === 'all' ? curLines : curLines.filter(l => l.mainCat === catTab)).length}<span style={{ fontSize: 10, color: C.mut, fontWeight: 600 }}>台</span></span>
      </div>
      {colorRate != null && colorRate < 80 && (
        <div style={{ fontSize: 9, color: C.orange, marginBottom: 10, padding: '6px 10px', borderRadius: 8, background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.2)' }}>💡 色の記入率 {colorRate}%。報告時に「色」を入れると色別の分析・仕入れ目安が正確になります。</div>
      )}

      {loading && <div style={{ fontSize: 11, color: C.mut, textAlign: 'center', padding: 20 }}>読み込み中…</div>}
      {!loading && ranking.length === 0 && <div style={{ fontSize: 11, color: C.mut2, textAlign: 'center', padding: 24 }}>この条件で機種の入力がある報告はありません</div>}

      {/* ───── 機種ランキング ───── */}
      {!loading && ranking.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', marginBottom: 6 }}>🏆 機種ランキング <span style={{ fontSize: 9, color: C.mut2, fontWeight: 400 }}>（タップで色内訳）</span></div>
          {ranking.map((g, i) => {
            const open = openModel === g.model;
            return (
              <div key={g.model} style={{ ...card, marginBottom: 6, padding: 10 }}>
                <div onClick={() => setOpenModel(open ? null : g.model)} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 30, fontSize: 12, textAlign: 'center', flexShrink: 0 }}>{medal(i)}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: C.w2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.model}<span style={{ fontSize: 9, color: C.mut2, fontWeight: 400, marginLeft: 5 }}>{g.maker}</span></span>
                    <span style={{ fontSize: 16, fontWeight: 900, color: i < 3 ? C.gold : C.w2, flexShrink: 0 }}>{g.total}<span style={{ fontSize: 9, color: C.mut, fontWeight: 600 }}>台</span></span>
                    <span style={{ color: C.mut2, fontSize: 10, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 4, width: (g.total / maxTotal * 100) + '%', background: i < 3 ? C.gold : C.mut2 }} />
                    </div>
                    {catChips(g.byCat)}
                  </div>
                </div>
                {open && (
                  <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    {Object.entries(g.variants).sort((a, b) => b[1].total - a[1].total).map(([variant, v]) => (
                      <div key={variant} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 11 }}>
                        <span style={{ color: variant.startsWith('色未記入') ? C.mut2 : C.w2 }}>🎨 {variant}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {catChips(v.byCat)}
                          <b style={{ color: '#fff', fontSize: 12 }}>{v.total}<span style={{ fontSize: 9, color: C.mut, fontWeight: 600 }}>台</span></b>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ───── 仕入れ目安（当月のみ） ───── */}
      {!loading && isCurrentMonth && forecast && forecast.rows.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', marginBottom: 2 }}>📦 仕入れ台数の目安 <span style={{ fontSize: 9, color: C.mut2, fontWeight: 400 }}>（タップで色別）</span></div>
          <div style={{ fontSize: 9, color: C.mut, marginBottom: 8, lineHeight: 1.5 }}>今月{forecast.elapsed}日経過時点の販売ペース × 残り{forecast.daysInMonth - forecast.elapsed}日 で計算した「月末までにあと売れる見込み台数」です。実在庫は考慮していないので、手元の在庫と見比べて発注してください。月の前半は数字が振れやすい点にご注意を。</div>
          {forecast.rows.map(g => {
            const open = openFc === g.model;
            return (
              <div key={g.model} style={{ ...card, marginBottom: 6, padding: 10, borderColor: g.remaining > 0 ? 'rgba(56,189,248,0.25)' : 'rgba(255,255,255,0.06)' }}>
                <div onClick={() => setOpenFc(open ? null : g.model)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: C.w2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.model}</span>
                  <span style={{ fontSize: 10, color: C.mut, flexShrink: 0 }}>今月<b style={{ color: '#fff' }}>{g.sold}</b>台 → 月末予測<b style={{ color: C.gold }}>{g.projected}</b>台</span>
                  <span style={{ fontSize: 12, fontWeight: 900, color: g.remaining > 0 ? C.blue : C.mut2, flexShrink: 0 }}>あと{g.remaining}台</span>
                  <span style={{ color: C.mut2, fontSize: 10, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
                </div>
                <div style={{ fontSize: 9, color: C.mut2, marginTop: 3 }}>前月実績 {g.prev}台</div>
                {open && (
                  <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    {g.variantRows.map(v => (
                      <div key={v.variant} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 11 }}>
                        <span style={{ color: v.variant.startsWith('色未記入') ? C.mut2 : C.w2 }}>🎨 {v.variant}</span>
                        <span style={{ fontSize: 10, color: C.mut }}>今月{v.sold}台 → 予測{v.projected}台 <b style={{ color: v.remaining > 0 ? C.blue : C.mut2 }}>あと{v.remaining}台</b></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!loading && !isCurrentMonth && (
        <div style={{ fontSize: 10, color: C.mut2, textAlign: 'center', padding: 10 }}>※ 仕入れ目安は「今月」を選んでいるときだけ表示されます（過去月は実績のみ）</div>
      )}
    </div>
  );
}
