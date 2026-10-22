import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { useDirectory } from '../contexts/DirectoryContext';

// =====================================================================
// 案件がどれだけ成約につながったかを見る画面
//
//  ① 今月の成約のうち、案件から生まれたのは何件か
//  ② 作った案件が、その後どうなったか（進行中・成約・失注）
//  ③ 案件を作る人と作らない人で、成果に差があるか
// =====================================================================

const C = { gold: '#FBBF24', green: '#34D399', blue: '#38BDF8', red: '#F87171',
            purple: '#A78BFA', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const norm = (s) => (s || '').replace(/[\s\u3000]+/g, '');
const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const monthRange = (m) => { const [y, mo] = m.split('-').map(Number); return [new Date(y, mo - 1, 1), new Date(y, mo, 1)]; };

const SOURCES = [
  { id: 'call',      label: '📞 アーチ架電' },
  { id: 'call_evt',  label: '📋 イベントアンケート架電' },
  { id: 'revisit',   label: '🔁 店頭提案の戻り' },
  { id: 'family',    label: '👨‍👩 来店客のご家族' },
  { id: 'referral',  label: '🤝 紹介' },
  { id: 'shokuiki',  label: '🏢 職域・法人訪問' },
  { id: 'personal',  label: '👤 自分の知人・家族' },
  { id: 'other',     label: '📝 その他' },
];
const srcLabel = (id) => SOURCES.find(s => s.id === id)?.label || '（未設定）';

// 回線の獲得だけを数える（アクセサリーや金融は数えない）
const LINE_MIDS = ['MID_001','MID_002','MID_005','MID_006','MID_007','MID_008','MID_011','MID_012',
                   'MID_017','MID_018','MID_019','MID_020','MID_021','MID_022','MID_023','MID_024'];

export default function PipelineAnalytics() {
  const { user } = useAuth();
  const { staffNames, staffStoreOf, storeNameOf } = useDirectory();
  const [month, setMonth] = useState(() => ym(new Date()));
  const [reports, setReports] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    const u = onSnapshot(query(collection(db, 'pipeline')), s =>
      setPipeline(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => u();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let alive = true; setLoading(true);
    const [ms, me] = monthRange(month);
    getDocs(query(collection(db, 'reports'), where('createdAt', '>=', ms), where('createdAt', '<', me)))
      .then(snap => { if (alive) { setReports(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); } })
      .catch(() => { if (alive) { setReports([]); setLoading(false); } });
    return () => { alive = false; };
  }, [user, month]);

  // ===== ① 今月の成約のうち、案件から生まれたのは何件か =====
  const fromPipe = useMemo(() => {
    let all = 0, viaPipe = 0;
    const bySrc = {};
    reports.forEach(r => {
      if (r.counted === false) return;
      const n = (r.lines || []).filter(l => LINE_MIDS.includes(l.midCat)).length;
      if (!n) return;
      all += n;
      if (r.pipelineId) {
        viaPipe += n;
        const k = r.pipelineSource || '_none';
        bySrc[k] = (bySrc[k] || 0) + n;
      }
    });
    return { all, viaPipe, rate: all > 0 ? viaPipe / all * 100 : 0,
             bySrc: Object.entries(bySrc).sort((a, b) => b[1] - a[1]) };
  }, [reports]);

  // ===== ② 作った案件が、その後どうなったか =====
  const track = useMemo(() => {
    const inMonth = pipeline.filter(p => {
      const d = p.createdAt?.toDate?.(); return d && ym(d) === month;
    });
    const won = inMonth.filter(p => p.stage === '成約');
    const lost = inMonth.filter(p => p.stage === '失注');
    const open = inMonth.filter(p => !['成約', '失注'].includes(p.stage));
    // 作ってから成約するまでの日数
    const days = won.map(p => {
      const c = p.createdAt?.toDate?.(); if (!c || !p.wonDate) return null;
      const w = new Date(p.wonDate + 'T12:00:00');
      return Math.max(0, Math.round((w - c) / 86400000));
    }).filter(x => x != null);
    const avgDays = days.length ? Math.round(days.reduce((s, x) => s + x, 0) / days.length) : null;

    // きっかけ別
    const bySrc = {};
    inMonth.forEach(p => {
      const k = p.source || '_none';
      bySrc[k] = bySrc[k] || { all: 0, won: 0, lost: 0, open: 0 };
      bySrc[k].all++;
      if (p.stage === '成約') bySrc[k].won++;
      else if (p.stage === '失注') bySrc[k].lost++;
      else bySrc[k].open++;
    });
    return { all: inMonth.length, won: won.length, lost: lost.length, open: open.length, avgDays,
             rate: won.length + lost.length > 0 ? won.length / (won.length + lost.length) * 100 : null,
             bySrc: Object.entries(bySrc).map(([k, v]) => ({ k, ...v,
               rate: v.won + v.lost > 0 ? v.won / (v.won + v.lost) * 100 : null }))
               .sort((a, b) => b.all - a.all) };
  }, [pipeline, month]);

  // ===== ③ 案件を作る人と作らない人で、成果に差があるか =====
  const byStaff = useMemo(() => {
    const M = {};
    const get = (n) => (M[n] = M[n] || { name: n, made: 0, won: 0, lines: 0 });
    staffNames.forEach(n => get(norm(n)));
    pipeline.forEach(p => {
      const d = p.createdAt?.toDate?.(); if (!d || ym(d) !== month) return;
      const w = norm(p.owner); if (!w) return;
      get(w).made++;
      if (p.stage === '成約') get(w).won++;
    });
    reports.forEach(r => {
      if (r.counted === false) return;
      const w = norm(r.proxyStaff || r.staffName); if (!w) return;
      const n = (r.lines || []).filter(l => LINE_MIDS.includes(l.midCat)).length;
      if (n) get(w).lines += n;
    });
    const list = Object.values(M).filter(x => x.made > 0 || x.lines > 0);
    const withP = list.filter(x => x.made > 0);
    const without = list.filter(x => x.made === 0);
    const avg = (a) => a.length ? Math.round(a.reduce((s, x) => s + x.lines, 0) / a.length * 10) / 10 : 0;
    return { list: list.sort((a, b) => b.made - a.made || b.lines - a.lines),
             withP: withP.length, without: without.length,
             avgWith: avg(withP), avgWithout: avg(without) };
  }, [pipeline, reports, month, staffNames]);

  const sel = { padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' };
  const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 13, marginBottom: 12 };
  const h = { fontSize: 12, fontWeight: 800, marginBottom: 9 };
  const th = { padding: '7px 5px', fontSize: 9.5, color: C.mut, fontWeight: 700, textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.1)' };
  const thL = { ...th, textAlign: 'left' };
  const td = { padding: '7px 5px', fontSize: 11.5, color: C.w2, textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.04)' };
  const tdL = { ...td, textAlign: 'left' };

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>📈 案件は成約につながっているか</h1>
      <div style={{ fontSize: 10, color: C.mut2, marginBottom: 10 }}>案件を作る動きが、実際の獲得にどう効いているかを見る画面です。</div>

      <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ ...sel, width: '100%', marginBottom: 12 }} />

      {/* ① 成約のうち案件経由 */}
      <div style={card}>
        <div style={{ ...h, color: C.green }}>① 今月の獲得のうち、案件から生まれたもの</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 34, fontWeight: 900, color: C.green }}>{fromPipe.viaPipe}</span>
          <span style={{ fontSize: 14, color: C.mut }}>/ {fromPipe.all}件</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: C.gold, marginLeft: 'auto' }}>{fromPipe.rate.toFixed(0)}%</span>
        </div>
        <div style={{ height: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ height: '100%', width: fromPipe.rate + '%', background: C.green, borderRadius: 6 }} />
        </div>
        {fromPipe.bySrc.length > 0 ? (
          <div>
            <div style={{ fontSize: 10, color: C.mut, marginBottom: 4 }}>内訳（どの活動から）</div>
            {fromPipe.bySrc.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.w2, marginBottom: 2 }}>
                <span>{srcLabel(k)}</span><b style={{ color: C.green }}>{v}件</b>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 10.5, color: C.mut2, lineHeight: 1.6 }}>
            まだ案件経由の獲得がありません。<br />
            ※ 案件ページで「成約」を押して報告すると、ここに入ります。報告画面から直接入力したものは案件経由になりません。
          </div>
        )}
      </div>

      {/* ② 作った案件の追跡 */}
      <div style={card}>
        <div style={{ ...h, color: C.blue }}>② 今月つくった案件の、その後</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 9 }}>
          {[['作った', track.all, C.w2], ['成約', track.won, C.green], ['進行中', track.open, C.blue], ['失注', track.lost, C.red]].map(([k, v, col]) => (
            <div key={k} style={{ flex: 1, textAlign: 'center', padding: '8px 2px', borderRadius: 9, background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ fontSize: 9.5, color: C.mut2 }}>{k}</div>
              <div style={{ fontSize: 19, fontWeight: 900, color: col }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: C.mut, marginBottom: 9 }}>
          <span>成約率 <b style={{ color: track.rate >= 50 ? C.green : C.gold, fontSize: 14 }}>{track.rate != null ? track.rate.toFixed(0) + '%' : '—'}</b></span>
          <span>作ってから成約まで 平均 <b style={{ color: C.purple, fontSize: 14 }}>{track.avgDays != null ? track.avgDays + '日' : '—'}</b></span>
        </div>
        {track.bySrc.length > 0 && (<>
          <div style={{ fontSize: 10, color: C.mut, marginBottom: 5 }}>きっかけ別</div>
          {track.bySrc.map(x => (
            <div key={x.k} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: C.w2, marginBottom: 2 }}>
                <span>{srcLabel(x.k)}</span>
                <span style={{ color: C.mut }}>{x.all}件{x.won > 0 && <b style={{ color: C.green }}> → 成約{x.won}</b>}
                  {x.rate != null && <b style={{ color: x.rate >= 50 ? C.green : x.rate >= 25 ? C.gold : C.mut2 }}>（{x.rate.toFixed(0)}%）</b>}</span>
              </div>
              <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: (x.won / x.all * 100) + '%', background: C.green }} />
                <div style={{ width: (x.open / x.all * 100) + '%', background: C.blue }} />
                <div style={{ width: (x.lost / x.all * 100) + '%', background: 'rgba(248,113,113,0.5)' }} />
              </div>
            </div>
          ))}
        </>)}
        {track.all === 0 && <div style={{ fontSize: 10.5, color: C.mut2 }}>今月つくられた案件はまだありません</div>}
      </div>

      {/* ③ 案件を作る人と作らない人 */}
      <div style={card}>
        <div style={{ ...h, color: C.purple }}>③ 案件を作る人と、作らない人</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, padding: '10px 8px', borderRadius: 9, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.3)' }}>
            <div style={{ fontSize: 9.5, color: C.purple }}>案件を作っている人（{byStaff.withP}名）</div>
            <div style={{ fontSize: 21, fontWeight: 900, color: C.purple }}>{byStaff.avgWith}<span style={{ fontSize: 11, color: C.mut }}> 件/人</span></div>
          </div>
          <div style={{ flex: 1, padding: '10px 8px', borderRadius: 9, background: 'rgba(255,255,255,0.03)' }}>
            <div style={{ fontSize: 9.5, color: C.mut2 }}>作っていない人（{byStaff.without}名）</div>
            <div style={{ fontSize: 21, fontWeight: 900, color: C.mut }}>{byStaff.avgWithout}<span style={{ fontSize: 11, color: C.mut2 }}> 件/人</span></div>
          </div>
        </div>
        <div style={{ fontSize: 9.5, color: C.mut2, marginBottom: 10, lineHeight: 1.6 }}>
          ※ 1人あたりの平均獲得（回線）です。差が出ていても、それだけで因果があるとは言えません。もともと動く人が案件も書いている可能性があります。判断材料の1つとして見てください。
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={thL}>名前</th><th style={th}>作った案件</th><th style={th}>うち成約</th><th style={th}>獲得（回線）</th></tr></thead>
            <tbody>
              {byStaff.list.map(x => (
                <tr key={x.name} style={{ opacity: x.made > 0 ? 1 : 0.5 }}>
                  <td style={tdL}>{x.name}</td>
                  <td style={{ ...td, color: x.made > 0 ? C.purple : C.mut2, fontWeight: x.made ? 700 : 400 }}>{x.made || '—'}</td>
                  <td style={{ ...td, color: x.won ? C.green : C.mut2 }}>{x.won || '—'}</td>
                  <td style={{ ...td, color: C.gold, fontWeight: 700 }}>{x.lines || '—'}</td>
                </tr>
              ))}
              {byStaff.list.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: C.mut }}>{loading ? '読み込み中…' : 'データがありません'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 9, color: C.mut2, lineHeight: 1.6, marginBottom: 20 }}>
        ※ ①は「案件ページで成約を押して報告した分」だけが入ります。報告画面から直接入れたものは含まれません。<br />
        ※ 成約率は「成約 ÷（成約＋失注）」。進行中は分母に入れていません。<br />
        ※ 数字が意味を持つには、各きっかけ20件ほど必要です。2〜3ヶ月見てから判断してください。
      </div>
    </div>
  );
}
