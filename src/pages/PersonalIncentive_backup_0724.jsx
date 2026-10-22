import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { computePoints, POINT_ITEMS, YEN_PER_POINT } from '../lib/points';
import { aggregate } from '../lib/aggregate';
import { TARGET_GROUPS } from '../data/targetGroups';
import { STAFF, staffStore, hasStaffStoreMap, storeName } from '../data/masters';

const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const C = { gold: '#FBBF24', green: '#34D399', blue: '#38BDF8', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };
const yen = (n) => '¥' + Number(n || 0).toLocaleString();
const DEF = { king1: 5000, king2: 3000, king3: 2000, champion: 3000, teamBonus: 2000 };

export default function PersonalIncentive() {
  const { user, profile } = useAuth();
  const [tab, setTab] = useState('me');
  const [month, setMonth] = useState(() => ym(new Date()));
  const [reports, setReports] = useState([]);
  const [cfg, setCfg] = useState(DEF);
  const [storeTargets, setStoreTargets] = useState({});
  const [usersList, setUsersList] = useState([]);
  const [staffTargetsAll, setStaffTargetsAll] = useState([]);
  const [pointConfig, setPointConfig] = useState(null);
  const [excludedMids, setExcludedMids] = useState([]);
  const me = profile?.name || user?.email || '';

  // 報告は「選んだ月だけ」読み込む（軽量化・monthRangeFetch）。月を変えるとその月を再取得
  useEffect(() => {
    if (!user || !month) return;
    const [_y, _m] = month.split('-').map(Number);
    const _start = new Date(_y, _m - 1, 1);
    const _end = new Date(_y, _m, 1);
    return onSnapshot(query(collection(db, 'reports'), where('createdAt', '>=', _start), where('createdAt', '<', _end)), (snap) =>
      setReports(snap.docs.map(d => { const r = { id: d.id, ...d.data() }; const cd = r.createdAt?.toDate?.(); if (cd) r._month = ym(cd); return r; })));
  }, [user, month]);

  useEffect(() => {
    if (!user) return;
    const u2 = onSnapshot(doc(db, 'incentiveConfig', 'main'), s => { if (s.exists()) setCfg({ ...DEF, ...s.data() }); });
    const u3 = onSnapshot(query(collection(db, 'users')), s => setUsersList(s.docs.map(d => ({ uid: d.id, ...d.data() }))));
    const u4 = onSnapshot(query(collection(db, 'staffTargets')), s => setStaffTargetsAll(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u5 = onSnapshot(doc(db, 'pointConfig', 'main'), s => {
      if (s.exists()) { const data = s.data(); setPointConfig(data.items || {}); setExcludedMids(data.excludedMids || []); }
      else { setPointConfig(null); setExcludedMids([]); }
    });
    return () => { u2(); u3(); u4(); u5(); };
  }, [user]);

  useEffect(() => {
    const ms = staffStore(profile?.name || user?.email || '');
    if (!user || !ms) { setStoreTargets({}); return; }
    return onSnapshot(doc(db, 'storeTargets', ms + '_' + month), s => setStoreTargets(s.exists() ? (s.data().groupTargets || {}) : {}));
  }, [user, profile, month]);

  const mine = useMemo(() => computePoints(reports, { month, staffName: me, config: pointConfig, excludedMids }), [reports, month, me, pointConfig, excludedMids]);

  const myStore = staffStore(me);
  const storeScoped = hasStaffStoreMap() && !!myStore;
  const pool = useMemo(() => storeScoped ? STAFF.filter(n => staffStore(n) === myStore) : STAFF, [storeScoped, myStore]);
  const ranking = useMemo(() =>
    pool.map(name => ({ name, ...computePoints(reports, { month, staffName: name, config: pointConfig, excludedMids }) }))
      .filter(s => s.totalPoints > 0)
      .sort((a, b) => b.totalPoints - a.totalPoints),
    [reports, month, pool, pointConfig, excludedMids]);

  const myIdx = ranking.findIndex(s => s.name === me);
  const kingBonus = myIdx === 0 ? cfg.king1 : myIdx === 1 ? cfg.king2 : myIdx === 2 ? cfg.king3 : 0;
  const kingLabel = myIdx === 0 ? 'ポイント王 1位' : myIdx === 1 ? '2位' : myIdx === 2 ? '3位' : '';
  const storeAgg = useMemo(() => myStore ? aggregate(reports, { storeId: myStore, month }) : null, [reports, myStore, month]);
  const storeTargetTotal = useMemo(() => TARGET_GROUPS.filter(g => g.unit === '件' && !g.internal).reduce((s, g) => s + (storeTargets[g.id] || 0), 0), [storeTargets]);
  const storeRate = storeAgg && storeTargetTotal > 0 ? Math.round(storeAgg.grandTotal / storeTargetTotal * 1000) / 10 : null;
  const storeAchieved = storeRate != null && storeRate >= 100;
  const teamBonus = storeAchieved ? cfg.teamBonus : 0;
  // 達成率チャンピオン（pool内で個人達成率1位）
  const champ = useMemo(() => {
    const uidByName = {}; usersList.forEach(u => { if (u.name) uidByName[u.name] = u.uid; });
    const tgtById = {}; staffTargetsAll.forEach(t => tgtById[t.id] = t);
    const cntGroups = TARGET_GROUPS.filter(g => g.unit === '件' && !g.internal);
    let bestRate = -1, bestName = null, myRate = null;
    for (const name of pool) {
      const uid = uidByName[name]; if (!uid) continue;
      const tdoc = tgtById[uid + '_' + month]; if (!tdoc) continue;
      const tt = tdoc.groupTargets || {};
      const totalT = cntGroups.reduce((s, g) => s + (tt[g.id] || 0), 0);
      if (totalT <= 0) continue;
      const ag = aggregate(reports, { staffName: name, month });
      const rt = ag.grandTotal / totalT;
      if (name === me) myRate = Math.round(rt * 1000) / 10;
      if (rt > bestRate) { bestRate = rt; bestName = name; }
    }
    return { name: bestName, rate: bestRate > 0 ? Math.round(bestRate * 1000) / 10 : null, myRate };
  }, [pool, reports, month, usersList, staffTargetsAll, me]);
  const champBonus = (champ.name && champ.name === me) ? cfg.champion : 0;
  const forecast = mine.yen + (kingBonus || 0) + (teamBonus || 0) + (champBonus || 0);
  const scopeLabel = storeScoped ? '店舗内（' + storeName(myStore) + '）' : '全社';
  const kingPrize = [cfg.king1, cfg.king2, cfg.king3];

  const itemsByGrp = (byItem) => {
    const order = Object.keys(POINT_ITEMS);
    const grp = { '新規ID': [], 'LTV': [] };
    order.forEach(k => { if (byItem[k]) grp[POINT_ITEMS[k].grp].push({ k, ...byItem[k], pt: POINT_ITEMS[k].pt, cap: POINT_ITEMS[k].cap }); });
    return grp;
  };
  const myGrp = itemsByGrp(mine.byItem);
  const medal = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '位';

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 12 }}>💰 報酬（インセンティブ）</h1>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[{ id: 'me', label: '自分' }, { id: 'rank', label: 'ランキング' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: 8, borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: tab === t.id ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.02)', color: tab === t.id ? C.gold : C.mut2, border: tab === t.id ? '1px solid rgba(251,191,36,0.2)' : '1px solid rgba(255,255,255,0.03)' }}>{t.label}</button>
        ))}
      </div>
      <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, marginBottom: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />

      {tab === 'me' && (
        <>
          <div style={{ ...card, textAlign: 'center', background: 'rgba(251,191,36,0.06)', borderColor: 'rgba(251,191,36,0.2)' }}>
            <div style={{ fontSize: 11, color: C.mut }}>{me}さんの今月の確定見込み</div>
            <div style={{ fontSize: 30, fontWeight: 900, color: C.gold, margin: '4px 0' }}>{yen(forecast)}</div>
            <div style={{ fontSize: 10, color: C.mut2 }}>
              土台① {yen(mine.yen)}{kingBonus > 0 ? '　＋　' + kingLabel + '賞 ' + yen(kingBonus) : ''}{champBonus > 0 ? '　＋　達成率賞 ' + yen(champBonus) : ''}{teamBonus > 0 ? '　＋　チーム賞 ' + yen(teamBonus) : ''}
            </div>
          </div>
          <div style={{ ...card }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}><span style={{ color: C.w2 }}>① 土台（{mine.totalPoints}点 × ¥{YEN_PER_POINT}）</span><span style={{ color: '#fff', fontWeight: 700 }}>{yen(mine.yen)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}><span style={{ color: C.w2 }}>② ランキング賞 {kingBonus > 0 ? '（' + kingLabel + '）' : ''}</span><span style={{ color: kingBonus > 0 ? C.green : C.mut2, fontWeight: 700 }}>{kingBonus > 0 ? yen(kingBonus) : '—'}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}><span style={{ color: C.w2 }}>達成率賞{champ.myRate != null ? ' （自分の達成率 ' + champ.myRate + '%）' : ''}</span><span style={{ color: champBonus > 0 ? C.green : C.mut2, fontWeight: champBonus > 0 ? 700 : 400, fontSize: champBonus > 0 ? 12 : 10 }}>{champBonus > 0 ? yen(champBonus) : (champ.name ? '1位: ' + champ.name + (champ.rate != null ? '（' + champ.rate + '%）' : '') : (champ.myRate == null ? '個人目標 未設定' : '—'))}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}><span style={{ color: C.w2 }}>③ チーム賞{storeRate != null ? ' （店舗達成率 ' + storeRate + '%）' : ''}</span><span style={{ color: storeAchieved ? C.green : C.mut2, fontWeight: storeAchieved ? 700 : 400, fontSize: storeAchieved ? 12 : 10 }}>{storeAchieved ? yen(teamBonus) : (myStore ? '店舗目標 達成で +' + yen(cfg.teamBonus) : '所属店未登録のため対象外')}</span></div>
          </div>
          {['新規ID', 'LTV'].map(g => myGrp[g].length > 0 && (
            <div key={g} style={card}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 8 }}>{g}</div>
              {myGrp[g].map(it => (
                <div key={it.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 11 }}>
                  <span style={{ color: C.w2 }}>{it.label} <span style={{ color: C.mut2 }}>×{it.count}</span></span>
                  <span style={{ color: '#fff', fontWeight: 700 }}>{it.points}点{it.cap != null && it.count * it.pt > it.cap ? <span style={{ color: C.gold, fontSize: 9 }}>（上限）</span> : ''}</span>
                </div>
              ))}
            </div>
          ))}
          {mine.totalPoints === 0 && <div style={{ fontSize: 11, color: C.mut, textAlign: 'center' }}>この月の獲得はまだありません</div>}
          <div style={{ fontSize: 9, color: C.mut2, textAlign: 'center' }}>※ ②ランキング賞・達成率賞・③チーム賞はすべて自動加算。金額は管理→報酬設定で変更できます。</div>
        </>
      )}

      {tab === 'rank' && (
        <>
          <div style={{ ...card }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 2 }}>🏆 ポイント王（今月）</div>
            <div style={{ fontSize: 9, color: C.mut2, marginBottom: 8 }}>範囲：{scopeLabel}</div>
            {ranking.length === 0 && <div style={{ fontSize: 11, color: C.mut }}>まだ獲得がありません</div>}
            {ranking.slice(0, 15).map((s, i) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 12 }}>
                <span style={{ color: i < 3 ? C.gold : (s.name === me ? C.blue : C.w2), fontWeight: i < 3 || s.name === me ? 800 : 500 }}><span style={{ display: 'inline-block', width: 28 }}>{medal(i)}</span>{s.name}{s.name === me ? '★' : ''}</span>
                <span style={{ color: C.mut, fontSize: 11 }}>{s.totalPoints}点{i < 3 ? <span style={{ color: C.green, fontWeight: 700 }}>　賞 {yen(kingPrize[i])}</span> : ''}</span>
              </div>
            ))}
          </div>
          {!storeScoped && <div style={{ fontSize: 9, color: C.mut2, textAlign: 'center' }}>※ 今は全社通しの順位です。店舗内にするには所属店マスタ（masters.js の STAFF_STORE_MAP）の登録が必要です。</div>}
        </>
      )}
    </div>
  );
}
