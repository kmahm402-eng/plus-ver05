import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, onSnapshot, doc, where, getDocs } from 'firebase/firestore';
import { computePoints, YEN_PER_POINT } from '../lib/points';
import { aggregate } from '../lib/aggregate';
import { TARGET_GROUPS } from '../data/targetGroups';
import { STAFF, staffStore, storeName, MAIN_STORES } from '../data/masters';

// =====================================================================
// 給与反映用：全スタッフ 月次インセンティブ一覧（管理者・経理だけ）
// 報酬画面(PersonalIncentive)とまったく同じ計算を全員分に広げたもの。
//  ① 土台      … その人のポイント × ¥80
//  ② ランキング賞 … 店舗内の点数 1位/2位/3位
//  達成率賞    … 店舗内の個人達成率 1位
//  ③ チーム賞   … その店舗が月間目標を達成した月のみ、店舗の全員に加算
// 計算式は二重に持たず、computePoints / aggregate をそのまま呼ぶ（数字がズレない）。
// =====================================================================

const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
// "2026-06" のような月文字列 → その月の初日と翌月初日（軽量化: payrollMonthFetch）
const monthRange = (m) => { const [y, mo] = m.split('-').map(Number); return [new Date(y, mo - 1, 1), new Date(y, mo, 1)]; };
const C = { gold: '#FBBF24', green: '#34D399', blue: '#38BDF8', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const yen = (n) => '¥' + Number(n || 0).toLocaleString();
const DEF = { king1: 5000, king2: 3000, king3: 2000, champion: 3000, teamBonus: 2000 };

export default function PayrollSummary() {
  const { user } = useAuth();
  const [month, setMonth] = useState(() => ym(new Date()));
  const [storeFilter, setStoreFilter] = useState('all');
  const [reports, setReports] = useState([]);
  const [cfg, setCfg] = useState(DEF);
  const [usersList, setUsersList] = useState([]);
  const [staffTargetsAll, setStaffTargetsAll] = useState([]);
  const [storeTargetsAll, setStoreTargetsAll] = useState([]);
  const [pointConfig, setPointConfig] = useState(null);
  const [excludedMids, setExcludedMids] = useState([]);
  const [loading, setLoading] = useState(false);

  // 設定・目標・ユーザーなど（軽い・常時最新でよいもの）はこれまで通り監視
  useEffect(() => {
    if (!user) return;
    const u2 = onSnapshot(doc(db, 'incentiveConfig', 'main'), s => { if (s.exists()) setCfg({ ...DEF, ...s.data() }); });
    const u3 = onSnapshot(query(collection(db, 'users')), s => setUsersList(s.docs.map(d => ({ uid: d.id, ...d.data() }))));
    const u4 = onSnapshot(query(collection(db, 'staffTargets')), s => setStaffTargetsAll(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u5 = onSnapshot(doc(db, 'pointConfig', 'main'), s => {
      if (s.exists()) { const data = s.data(); setPointConfig(data.items || {}); setExcludedMids(data.excludedMids || []); }
      else { setPointConfig(null); setExcludedMids([]); }
    });
    const u6 = onSnapshot(query(collection(db, 'storeTargets')), s => setStoreTargetsAll(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u2(); u3(); u4(); u5(); u6(); };
  }, [user]);

  // reports（実績報告）は「選んだ月ぶんだけ」取りに行く（全件監視をやめて軽量化・payrollMonthFetch）
  // 計算側(computePoints/aggregate)は _month で月を判定するため、月範囲で取っても金額は完全に一致する。
  useEffect(() => {
    if (!user) return;
    let alive = true;
    setLoading(true);
    const [ms, me] = monthRange(month);
    getDocs(query(collection(db, 'reports'), where('createdAt', '>=', ms), where('createdAt', '<', me)))
      .then(snap => {
        if (!alive) return;
        setReports(snap.docs.map(d => { const r = { id: d.id, ...d.data() }; const cd = r.createdAt?.toDate?.(); if (cd) r._month = ym(cd); return r; }));
        setLoading(false);
      })
      .catch(() => { if (alive) { setReports([]); setLoading(false); alert('データの取得に失敗しました。通信環境を確認して、もう一度お試しください。'); } });
    return () => { alive = false; };
  }, [user, month]);

  const rows = useMemo(() => {
    const cntGroups = TARGET_GROUPS.filter(g => g.unit === '件' && !g.internal);

    // --- 各スタッフのポイント（土台）。1人1回だけ計算 ---
    const pts = {};
    STAFF.forEach(name => { pts[name] = computePoints(reports, { month, staffName: name, config: pointConfig, excludedMids }); });

    // --- 各スタッフの個人達成率（達成率賞の判定用）---
    const uidByName = {}; usersList.forEach(u => { if (u.name) uidByName[u.name] = u.uid; });
    const tgtById = {}; staffTargetsAll.forEach(t => tgtById[t.id] = t);
    const rate = {};
    STAFF.forEach(name => {
      const uid = uidByName[name];
      const tdoc = uid ? tgtById[uid + '_' + month] : null;
      if (!tdoc) { rate[name] = null; return; }
      const tt = tdoc.groupTargets || {};
      const totalT = cntGroups.reduce((s, g) => s + (tt[g.id] || 0), 0);
      if (totalT <= 0) { rate[name] = null; return; }
      const ag = aggregate(reports, { staffName: name, month });
      rate[name] = ag.grandTotal / totalT;
    });

    // --- 店舗ごとのチーム賞判定（店舗達成率 ≧ 100%）---
    const stMap = {}; storeTargetsAll.forEach(t => stMap[t.id] = t);
    const storeAchieved = {};
    MAIN_STORES.forEach(st => {
      const tdoc = stMap[st.id + '_' + month];
      const tt = tdoc?.groupTargets || {};
      const totalT = cntGroups.reduce((s, g) => s + (tt[g.id] || 0), 0);
      const ag = aggregate(reports, { storeId: st.id, month });
      const r = totalT > 0 ? Math.round(ag.grandTotal / totalT * 1000) / 10 : null;
      storeAchieved[st.id] = r != null && r >= 100;
    });

    // --- スタッフを所属店ごとにまとめ、店舗内で 賞 を割り当て ---
    const byStore = {}; const noStore = [];
    STAFF.forEach(name => { const sid = staffStore(name); if (sid) (byStore[sid] = byStore[sid] || []).push(name); else noStore.push(name); });

    const kingByName = {}, champByName = {};
    const assignPool = (poolNames) => {
      // ランキング賞：点数 1位/2位/3位（0点は対象外）
      const ranked = poolNames.map(n => ({ n, p: pts[n].totalPoints })).filter(x => x.p > 0).sort((a, b) => b.p - a.p);
      ranked.forEach((x, i) => { kingByName[x.n] = i === 0 ? cfg.king1 : i === 1 ? cfg.king2 : i === 2 ? cfg.king3 : 0; });
      // 達成率賞：店舗内で達成率1位（最初の最大が勝ち＝報酬画面と同じ）
      let best = -1, bestName = null;
      poolNames.forEach(n => { const r = rate[n]; if (r != null && r > best) { best = r; bestName = n; } });
      if (bestName) champByName[bestName] = cfg.champion;
    };
    Object.values(byStore).forEach(assignPool);
    if (noStore.length) assignPool(noStore); // 所属店が無い人は全社で判定（通常は無し）

    // --- 1人ずつ合計を作る ---
    return STAFF.map(name => {
      const sid = staffStore(name);
      const base = pts[name].yen || 0;
      const king = kingByName[name] || 0;
      const champ = champByName[name] || 0;
      const team = (sid && storeAchieved[sid]) ? cfg.teamBonus : 0;
      return { name, storeId: sid, storeNm: sid ? storeName(sid) : '—', points: pts[name].totalPoints, base, king, champ, team, total: base + king + champ + team };
    });
  }, [reports, month, cfg, usersList, staffTargetsAll, storeTargetsAll, pointConfig, excludedMids]);

  const filtered = useMemo(() => (storeFilter === 'all' ? rows : rows.filter(r => r.storeId === storeFilter)), [rows, storeFilter]);
  const sorted = useMemo(() => [...filtered].sort((a, b) => b.total - a.total || (a.storeId || '').localeCompare(b.storeId || '') || a.name.localeCompare(b.name)), [filtered]);
  const grand = useMemo(() => sorted.reduce((s, r) => ({ base: s.base + r.base, king: s.king + r.king, champ: s.champ + r.champ, team: s.team + r.team, total: s.total + r.total }), { base: 0, king: 0, champ: 0, team: 0, total: 0 }), [sorted]);
  const earners = sorted.filter(r => r.total > 0).length;

  const exportCsv = () => {
    const head = ['名前', '所属店', 'ポイント', '土台', 'ランキング賞', '達成率賞', 'チーム賞', '合計'];
    const lines = [head.join(',')];
    sorted.forEach(r => lines.push([r.name, r.storeNm, r.points, r.base, r.king, r.champ, r.team, r.total].join(',')));
    lines.push(['合計', '', '', grand.base, grand.king, grand.champ, grand.team, grand.total].join(','));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = '月次インセンティブ_' + month + (storeFilter !== 'all' ? '_' + storeName(storeFilter) : '') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const th = { padding: '8px 6px', fontSize: 10, color: C.mut, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.1)' };
  const thL = { ...th, textAlign: 'left' };
  const td = { padding: '8px 6px', fontSize: 12, color: C.w2, textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.04)' };
  const tdL = { ...td, textAlign: 'left' };
  const ftd = { ...td, borderTop: '2px solid rgba(255,255,255,0.15)' };
  const sel = { padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>🧾 給与反映用：月次インセンティブ一覧</h1>
      <div style={{ fontSize: 10, color: C.mut2, marginBottom: 12 }}>確定値（社内ポイント）で自動計算。各スタッフの「報酬」画面と同じ金額です。</div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ ...sel, flex: 1, minWidth: 130 }} />
        <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} style={{ ...sel, flex: 1, minWidth: 130 }}>
          <option value="all">全店</option>
          {MAIN_STORES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, fontSize: 11, color: C.mut }}>対象 {sorted.length}人 ／ 支給あり {earners}人 ／ 合計 <span style={{ color: C.gold, fontWeight: 800, fontSize: 14 }}>{yen(grand.total)}</span></div>
        <button onClick={exportCsv} style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(52,211,153,0.12)', color: C.green, border: '1px solid rgba(52,211,153,0.3)' }}>📥 CSVで書き出し</button>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
          <thead>
            <tr>
              <th style={thL}>名前</th>
              <th style={thL}>所属店</th>
              <th style={th}>点</th>
              <th style={th}>①土台</th>
              <th style={th}>②ランク賞</th>
              <th style={th}>達成率賞</th>
              <th style={th}>③チーム賞</th>
              <th style={{ ...th, color: C.gold }}>合計</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.name} style={{ opacity: r.total > 0 ? 1 : 0.45 }}>
                <td style={tdL}>{r.name}</td>
                <td style={{ ...tdL, fontSize: 11, color: C.mut }}>{r.storeNm}</td>
                <td style={{ ...td, color: C.mut }}>{r.points}</td>
                <td style={td}>{r.base ? yen(r.base) : '—'}</td>
                <td style={{ ...td, color: r.king ? C.green : C.mut2 }}>{r.king ? yen(r.king) : '—'}</td>
                <td style={{ ...td, color: r.champ ? C.green : C.mut2 }}>{r.champ ? yen(r.champ) : '—'}</td>
                <td style={{ ...td, color: r.team ? C.green : C.mut2 }}>{r.team ? yen(r.team) : '—'}</td>
                <td style={{ ...td, color: C.gold, fontWeight: 800 }}>{yen(r.total)}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: C.mut }}>{loading ? '読み込み中…' : 'この月・この店舗のデータはまだありません'}</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...ftd, textAlign: 'left', fontWeight: 800, color: '#fff' }}>合計</td>
              <td style={ftd}></td>
              <td style={ftd}></td>
              <td style={{ ...ftd, fontWeight: 700, color: '#fff' }}>{yen(grand.base)}</td>
              <td style={{ ...ftd, fontWeight: 700, color: C.green }}>{yen(grand.king)}</td>
              <td style={{ ...ftd, fontWeight: 700, color: C.green }}>{yen(grand.champ)}</td>
              <td style={{ ...ftd, fontWeight: 700, color: C.green }}>{yen(grand.team)}</td>
              <td style={{ ...ftd, fontWeight: 900, color: C.gold, fontSize: 13 }}>{yen(grand.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ fontSize: 9, color: C.mut2, marginTop: 10, lineHeight: 1.6 }}>
        ※ ①土台＝ポイント×¥{YEN_PER_POINT}（全員）。②ランキング賞・達成率賞＝店舗内で判定。③チーム賞＝その店舗が月間目標を達成した月のみ、店舗の全員に加算。<br />
        ※ 金額の変更は「管理→報酬設定」。確定値での計算なので、月が締まったあとに確認してください。
      </div>
    </div>
  );
}
