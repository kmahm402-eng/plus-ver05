// =====================================================================
// Quest.jsx ―― 自走版（スタッフ用）2026-10-09 追加
//  ・毎日のホーム：今週のボス（自分で決めた作戦）／今日の敵／作戦できた？1タップ
//                  ／Style強化商材レーダー（青＝店、黄＝自分）／先月の自分と比べる
//  ・週1回の作戦会議：ふりかえり → じぶん診断 → 答え合わせ → 今週の作戦
//  既存データは読むだけ。書き込みは weeklyQuests（1人1週1件）だけ。
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useDirectory } from '../contexts/DirectoryContext';
import { computePoints, YEN_PER_POINT } from '../lib/points';
import {
  ITEMS, ITEM, STYLE, CHOICES, ACTIONS, countItems, styleRates, diagnose, choiceOfKey, avatarStage,
  norm, ymd, ym, dateOf, whoOf, weekStart, weekKeyOf, addDays, lsGet, lsSet,
} from '../lib/quest';

const C = { gold: '#FDE047', green: '#86EFAC', red: '#FCA5A5', blue: '#3B82F6', mut: '#94A3B8', mut2: '#64748B', q: '#93C5FD' };
const win = { border: '3px solid #fff', borderRadius: 8, background: '#000', padding: '8px 10px', margin: '8px 0', boxShadow: '0 0 0 2px #000, 0 0 0 4px #555' };
const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 12, marginBottom: 10 };
const btn = (on) => ({ flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 14, fontWeight: 800, cursor: 'pointer', border: '2px solid ' + (on ? '#22C55E' : '#fff'), background: on ? '#166534' : '#000', color: '#fff' });
const opt = (on) => ({ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', margin: '5px 0', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '2px solid ' + (on ? C.gold : '#555'), background: on ? '#3F3A0B' : '#000', color: '#fff' });
const ta = { width: '100%', boxSizing: 'border-box', background: '#000', color: '#fff', border: '2px solid #fff', borderRadius: 4, fontSize: 13, minHeight: 48, padding: 6, fontFamily: 'inherit' };
const next = { width: '100%', padding: 12, borderRadius: 8, fontSize: 15, fontWeight: 900, cursor: 'pointer', border: '3px solid #fff', background: '#000', color: '#fff', marginTop: 4 };
const Q = ({ children }) => <div style={{ fontSize: 13, color: C.q, fontWeight: 700, marginBottom: 4 }}>{children}</div>;
const Bar = ({ pct, color, h = 10 }) => (
  <div style={{ flex: 1, height: h, border: '2px solid #fff', borderRadius: 3, background: '#111', overflow: 'hidden' }}>
    <div style={{ width: Math.max(0, Math.min(100, pct)) + '%', height: '100%', background: color }} />
  </div>
);

// ---- レーダーチャート（黄＝自分／青＝店／白い外の線＝閾値100%） ----
export function Radar({ me, store, size = 'big' }) {
  const big = size === 'big';
  const W = big ? 360 : 220, H = big ? 240 : 150, cx = W / 2, cy = big ? 128 : 80, r = big ? 66 : 48, fs = big ? 10.5 : 10;
  const pt = (i, v) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / 5; return [cx + r * v * Math.cos(a), cy + r * v * Math.sin(a)]; };
  const poly = (vals) => vals.map((v, i) => pt(i, Math.min(1.2, v)).map((n) => n.toFixed(1)).join(',')).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, display: 'block', margin: '0 auto' }}>
      {[0.5, 1].map((lv) => <polygon key={lv} points={poly([lv, lv, lv, lv, lv])} fill="none" stroke={lv === 1 ? '#E5E7EB' : '#475569'} strokeWidth="1.5" strokeDasharray={lv === 1 ? '' : '3 3'} />)}
      {STYLE.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#475569" />; })}
      <polygon points={poly(store.map((s) => s.ach))} fill="rgba(59,130,246,.18)" stroke={C.blue} strokeWidth="2.5" />
      <polygon points={poly(me.map((s) => s.ach))} fill="rgba(253,224,71,.22)" stroke={C.gold} strokeWidth="2.5" />
      {STYLE.map((s, i) => {
        let [x, y] = pt(i, big ? 1.32 : 1.38);
        const anchor = i === 0 ? 'middle' : i <= 2 ? 'start' : 'end';
        if (i === 0) y -= big ? 14 : 0;
        if (i === 2 || i === 3) y += 2;
        const m = me[i].rate, st = store[i].rate;
        const col = (m ?? 0) < (st ?? 0) ? C.red : C.green;
        return (
          <text key={s.key} x={x} y={y} fill="#fff" fontSize={fs} fontWeight="700" textAnchor={anchor}>
            {s.label}
            {big && <tspan x={x} dy={fs + 2} fill={col}>{m == null ? '—' : m + '%'}／店{st == null ? '—' : st + '%'}</tspan>}
          </text>
        );
      })}
    </svg>
  );
}
const RadarLegend = () => (
  <div style={{ display: 'flex', justifyContent: 'center', gap: 12, fontSize: 11 }}>
    <span><b style={{ color: C.gold }}>━</b> じぶん</span><span><b style={{ color: C.blue }}>━</b> 店舗</span><span>白い線＝奨励金の基準</span>
  </div>
);

export default function Quest() {
  const { user, profile } = useAuth();
  const dir = useDirectory();
  const nav = useNavigate();
  const me = profile?.name || '';
  const myStore = dir?.staffStoreOf ? dir.staffStoreOf(me) : null;

  const now = new Date();
  const today = ymd(now);
  const month = ym(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const wStart = weekStart(now);
  const wKey = weekKeyOf(now);
  const prevWStart = addDays(wStart, -7);
  const prevWKey = ymd(prevWStart);
  const d28 = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -27); // 直近4週間（今日を含む28日）
  const loadStart = [prevWStart, monthStart, d28].reduce((a, b) => (a < b ? a : b));

  const [reports, setReports] = useState(null);
  const [cfg, setCfg] = useState({ config: null, excluded: [], loaded: false });
  const [kpiT, setKpiT] = useState({});
  const [quest, setQuest] = useState(null);       // 今週の記録
  const [prevQuest, setPrevQuest] = useState(null); // 先週の記録
  const [last, setLast] = useState(null);         // 先月の自分 {sameDay, total}
  const [tab, setTab] = useState('home');
  const [mode, setMode] = useState(() => lsGet('quest_mode') || 'game');
  const [saving, setSaving] = useState(false);

  // ---- 読み込み ----
  useEffect(() => {
    if (!user) return;
    const u1 = onSnapshot(query(collection(db, 'reports'), where('createdAt', '>=', loadStart)),
      (s) => setReports(s.docs.map((d) => { const r = { id: d.id, ...d.data() }; const cd = dateOf(r); if (cd) r._month = ym(cd); return r; })),
      () => setReports([]));
    const u2 = onSnapshot(doc(db, 'pointConfig', 'main'), (s) => {
      if (s.exists()) { const d = s.data(); setCfg({ config: d.items || null, excluded: d.excludedMids || [], loaded: true }); }
      else setCfg({ config: null, excluded: [], loaded: true });
    }, () => setCfg({ config: null, excluded: [], loaded: true }));
    const u3 = onSnapshot(doc(db, 'weeklyQuests', user.uid + '_' + wKey), (s) => setQuest(s.exists() ? s.data() : {}), () => setQuest({}));
    getDoc(doc(db, 'weeklyQuests', user.uid + '_' + prevWKey)).then((s) => setPrevQuest(s.exists() ? s.data() : null)).catch(() => {});
    getDoc(doc(db, 'staffTargets', user.uid + '_' + month)).then((s) => setKpiT(s.exists() ? s.data().kpiTargets || {} : {})).catch(() => {});
    return () => { u1(); u2(); u3(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, wKey, month]);

  // 先月の自分：1日1回だけ読む（この端末に結果を覚えておく＝読み込みを減らす）
  useEffect(() => {
    if (!user || !me || !cfg.loaded) return;
    const key = 'quest_last_' + user.uid + '_' + today;
    const hit = lsGet(key);
    if (hit) { setLast(hit); return; }
    const lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lmMonth = ym(lmStart);
    const lmDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const sameDayEnd = new Date(lmStart.getFullYear(), lmStart.getMonth(), Math.min(now.getDate(), lmDays), 23, 59, 59);
    getDocs(query(collection(db, 'reports'), where('createdAt', '>=', lmStart), where('createdAt', '<', monthStart)))
      .then((s) => {
        const mine = s.docs.map((d) => { const r = d.data(); const cd = dateOf(r); r._month = cd ? ym(cd) : lmMonth; r._d = cd; return r; })
          .filter((r) => norm(whoOf(r)) === norm(me));
        const opt = { month: lmMonth, config: cfg.config, excludedMids: cfg.excluded };
        const total = computePoints(mine, opt).totalPoints;
        const sameDay = computePoints(mine.filter((r) => r._d && r._d <= sameDayEnd), opt).totalPoints;
        const v = { sameDay, total };
        setLast(v); lsSet(key, v);
      })
      .catch(() => setLast({ sameDay: 0, total: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, me, today, cfg.loaded]);

  useEffect(() => { lsSet('quest_mode', mode); }, [mode]);

  // ---- 計算 ----
  const calc = useMemo(() => {
    if (!reports) return null;
    const isMe = (r) => norm(whoOf(r)) === norm(me);
    const inStore = (r) => myStore && dir.staffStoreOf(whoOf(r)) === myStore;
    const monthR = reports.filter((r) => r._month === month);
    const dayOf = (r) => { const d = dateOf(r); return d ? ymd(d) : ''; };
    const todayR = monthR.filter((r) => dayOf(r) === today);
    const beforeR = monthR.filter((r) => dayOf(r) < today);
    const weekR = reports.filter((r) => { const d = dateOf(r); return d && d >= wStart; });
    const prevWeekR = reports.filter((r) => { const d = dateOf(r); return d && d >= prevWStart && d < wStart; });

    // 答え合わせ・レーダーは直近4週間（月はじめでも数字がブレないように）
    const r28 = reports.filter((r) => { const d = dateOf(r); return d && d >= d28; });
    const mineM = countItems(r28, isMe);
    const storeM = countItems(r28, inStore);
    const heads = new Set(r28.filter(inStore).map((r) => norm(whoOf(r)))).size;
    const opt = { config: cfg.config, excludedMids: cfg.excluded };
    const pts = computePoints(monthR.filter(isMe), { ...opt, month }).totalPoints;

    return {
      mineM, storeM, heads, pts,
      today: countItems(todayR, isMe),
      before: countItems(beforeR, isMe),
      week: countItems(weekR, isMe),
      prevWeek: countItems(prevWeekR, isMe),
      styleMe: styleRates(mineM),
      styleStore: styleRates(storeM),
      diag: diagnose(mineM, storeM, heads),
    };
  }, [reports, me, myStore, month, today, cfg, dir]);

  // 今日の敵：個人目標の残り ÷ 今月の残り日数（今日を含む）
  const enemies = useMemo(() => {
    if (!calc) return [];
    const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
    const list = [];
    ['shinki', 'kihen', 'up', 'gold', 'denki', 'kotei'].forEach((k) => {
      const t = Number(kpiT[k] || 0); if (!t) return;
      const need = Math.ceil(Math.max(0, t - calc.before[k]) / daysLeft);
      if (need <= 0) return;
      list.push({ key: k, need, done: calc.today[k], dead: calc.today[k] >= need });
    });
    const boss = quest?.plan?.item;
    // 個人目標がない項目でも、今週の作戦の項目は「今日の敵」にする（残り÷今週の残り日数）
    if (boss && !list.some((e) => e.key === boss) && !Number(kpiT[boss] || 0)) {
      const wLeft = 7 - ((now.getDay() + 6) % 7);
      const remain = Math.max(0, quest.plan.target - (calc.week[boss] - calc.today[boss]));
      const need = Math.ceil(remain / wLeft);
      if (need > 0) list.push({ key: boss, need, done: calc.today[boss], dead: calc.today[boss] >= need });
    }
    list.sort((a, b) => (a.dead - b.dead) || ((b.key === boss) - (a.key === boss)));
    return list.slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calc, kpiT, quest]);

  const save = async (fields) => {
    if (!user) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'weeklyQuests', user.uid + '_' + wKey),
        { ...fields, uid: user.uid, staffName: me, storeId: myStore || null, weekKey: wKey, updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) { alert('保存できませんでした: ' + e.message); }
    setSaving(false);
  };

  if (!calc || quest === null) return <div style={{ padding: 24, color: C.mut, textAlign: 'center' }}>読み込み中…</div>;

  const plan = quest.plan;
  const bossDone = plan ? calc.week[plan.item] || 0 : 0;
  const todayCheck = quest.checks ? quest.checks[today] : undefined;
  const lead = last ? calc.pts - last.sameDay : null;
  const av = avatarStage(calc.pts, last?.sameDay || 0);
  const comments = quest.comments || {};
  const cmtList = [['manager', '店長'], ['director', '部長'], ['president', '社長']].filter(([k]) => comments[k]?.text);
  const low = calc.styleMe.map((s, i) => ({ ...s, gap: Math.round(((s.rate ?? 0) - (calc.styleStore[i].rate ?? 0)) * 10) / 10 }))
    .filter((s) => s.gap < 0).sort((a, b) => a.gap - b.gap).slice(0, 2);

  if (tab === 'meeting') return <Meeting {...{ calc, quest, prevQuest, save, saving, onDone: () => setTab('home') }} />;

  const game = mode === 'game';
  const Box = ({ children, style }) => <div style={{ ...(game ? win : card), ...style }}>{children}</div>;

  return (
    <div style={{ padding: '8px 14px', maxWidth: 520, margin: '0 auto', fontWeight: game ? 700 : 500 }}>
      <div style={{ display: 'flex', border: '2px solid #fff', borderRadius: 8, overflow: 'hidden', fontSize: 12, margin: '4px 0 8px' }}>
        {[['game', 'ゲーム表示'], ['simple', 'シンプル表示']].map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)} style={{ flex: 1, padding: 6, border: 'none', cursor: 'pointer', fontWeight: 800, background: mode === k ? '#fff' : 'transparent', color: mode === k ? '#000' : '#fff' }}>{l}</button>
        ))}
      </div>

      {!plan && (
        <button onClick={() => setTab('meeting')} style={{ ...next, background: '#3F3A0B', borderColor: C.gold, color: C.gold, marginBottom: 6 }}>
          🗺️ 今週の作戦会議がまだです（5分）→ はじめる
        </button>
      )}

      {/* あいぼう ／ 今月のポイント */}
      {game ? (
        <div style={{ height: 150, borderRadius: 8, position: 'relative', overflow: 'hidden', background: 'linear-gradient(#0C4A6E,#082F49 60%,#14532D 60%)' }}>
          {lead != null && <div style={{ position: 'absolute', right: 10, top: 10, background: '#fff', color: '#000', borderRadius: 10, padding: '3px 8px', fontSize: 12 }}>{lead >= 0 ? '先月の自分に勝ってる！' : '先月の自分を追いかけろ！'}</div>}
          <div style={{ position: 'absolute', left: '50%', top: 22, transform: 'translateX(-50%)', fontSize: 72, lineHeight: 1 }}>{av.icon}</div>
          <div style={{ position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)', background: 'rgba(0,0,0,.65)', padding: '3px 12px', borderRadius: 4, fontSize: 13, whiteSpace: 'nowrap' }}>
            {av.name}{av.next > 0 ? `　しんかまで あと${av.next}pt` : ''}
          </div>
        </div>
      ) : (
        <Box>
          <div style={{ fontSize: 12, color: C.mut }}>今月のポイント</div>
          <div style={{ fontSize: 26, fontWeight: 900 }}>{calc.pts} pt <span style={{ fontSize: 14, color: C.mut }}>¥{(calc.pts * YEN_PER_POINT).toLocaleString()}</span></div>
        </Box>
      )}

      {/* 今週のボス（自分で決めた作戦） */}
      {plan && (
        <Box>
          <div style={{ fontSize: 13 }}>{game ? '🐉 今週のボス ' + ITEM[plan.item].label + 'ドラゴン' : '今週の作戦'}<span style={{ color: C.mut, fontSize: 11 }}>（自分で決めた作戦）</span></div>
          <div style={{ fontSize: 12, color: C.gold, margin: '4px 0' }}>「{plan.action}」</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bar pct={game ? 100 - (bossDone / plan.target) * 100 : (bossDone / plan.target) * 100} color={game ? '#EF4444' : '#2563EB'} />
            <span style={{ fontSize: 12 }}>{game ? `のこりHP ${Math.max(0, plan.target - bossDone)}／${plan.target}` : `${bossDone}／${plan.target}件`}</span>
          </div>
          {bossDone >= plan.target && <div style={{ color: C.green, fontSize: 13, marginTop: 4 }}>{game ? '🎉 ボスを たおした！' : '🎉 今週の目標を達成！'}</div>}
        </Box>
      )}

      {/* 店長・部長からのコメント */}
      {cmtList.length > 0 && (
        <Box>
          {cmtList.map(([k, l]) => (
            <div key={k} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: C.q }}>💬 {l} {comments[k].name || ''} から</div>
              <div style={{ background: '#1E293B', borderLeft: '4px solid ' + C.gold, padding: '6px 8px', fontSize: 13, lineHeight: 1.6, borderRadius: 4 }}>{comments[k].text}</div>
            </div>
          ))}
        </Box>
      )}

      {/* 今日の敵 */}
      <Box>
        <div style={{ fontSize: 14, marginBottom: 2 }}>{game ? '⚔️ 今日の敵' : '今日のやること'}</div>
        {enemies.length === 0 && (
          <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.7 }}>
            {Object.keys(kpiT).length === 0
              ? <>個人目標を入れると、今日の敵が出ます。<button onClick={() => nav('/me')} style={{ marginLeft: 6, fontSize: 12, background: 'none', border: '1px solid #fff', color: '#fff', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>個人目標へ</button></>
              : '今日の分は、もう目標ペースに届いています。'}
          </div>
        )}
        {enemies.map((e) => (
          <div key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px dashed #333', fontSize: 13, opacity: e.dead ? 0.4 : 1, textDecoration: e.dead ? 'line-through' : 'none' }}>
            <span style={{ fontSize: 22, width: 30, textAlign: 'center' }}>{game ? ITEM[e.key].icon : (e.dead ? '✅' : '□')}</span>
            {game ? ITEM[e.key].enemy : ITEM[e.key].label}
            <span style={{ marginLeft: 'auto', color: e.dead ? '#fff' : C.gold }}>{e.dead ? (game ? 'たおした' : '完了') : `あと${e.need - e.done}${game ? '体' : '件'}`}</span>
          </div>
        ))}
      </Box>

      {/* 作戦できた？ */}
      {plan && (
        <Box>
          <Q>🌙 今日、作戦できた？（帰る前に1タップ）</Q>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={saving} onClick={() => save({ checks: { [today]: true } })} style={btn(todayCheck === true)}>できた</button>
            <button disabled={saving} onClick={() => save({ checks: { [today]: false } })} style={{ ...btn(false), borderColor: todayCheck === false ? C.red : '#fff', background: todayCheck === false ? '#7F1D1D' : '#000' }}>できなかった</button>
          </div>
          <div style={{ fontSize: 11, color: C.mut, marginTop: 4 }}>この記録が、来週月曜の「ふりかえり」に使われます</div>
        </Box>
      )}

      {/* Style強化商材 */}
      <Box style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ flex: '0 0 62%' }}><Radar me={calc.styleMe} store={calc.styleStore} size="small" /></div>
        <div style={{ fontSize: 12, lineHeight: 1.7 }}>
          <div style={{ color: C.q }}>🕸️ Style強化商材</div>
          <b style={{ color: C.gold }}>━</b> じぶん<br /><b style={{ color: C.blue }}>━</b> 店舗<br />
          {low.length === 0 ? <span style={{ color: C.green }}>全部 店以上！</span> : low.map((s) => <div key={s.key} style={{ color: C.red }}>{s.label} {s.gap}</div>)}
        </div>
      </Box>

      {/* 先月の自分と比べる */}
      {last && (
        <Box>
          <div style={{ fontSize: 13, marginBottom: 4 }}>{game ? '👻 先月の自分と きょうそう' : '先月の同じ日とくらべる'}</div>
          {[['今月', calc.pts, '#22C55E'], ['先月', last.sameDay, '#64748B']].map(([l, v, c]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '4px 0' }}>
              <span style={{ width: 34 }}>{l}</span><Bar pct={(v / Math.max(1, calc.pts, last.sameDay)) * 100} color={c} h={12} /><span style={{ width: 54, textAlign: 'right' }}>{v}pt</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: lead >= 0 ? C.green : C.red }}>
            先月の同じ日より {lead >= 0 ? '+' : ''}{lead}pt（{lead >= 0 ? '+' : '−'}¥{Math.abs(lead * YEN_PER_POINT).toLocaleString()}）　先月の合計 {last.total}pt
          </div>
        </Box>
      )}

      <button onClick={() => setTab('meeting')} style={{ ...next, marginBottom: 16 }}>{plan ? '🗺️ 今週の作戦会議を見なおす' : '🗺️ 今週の作戦会議をはじめる'}</button>
    </div>
  );
}

// =====================================================================
// 週1回の作戦会議（4ステップ）
// =====================================================================
function Meeting({ calc, quest, prevQuest, save, saving, onDone }) {
  const [step, setStep] = useState(0);
  const [good, setGood] = useState(quest.reflection?.good || '');
  const [bad, setBad] = useState(quest.reflection?.bad || '');
  const [choice, setChoice] = useState(quest.diagnosis?.choice || '');
  const [reason, setReason] = useState(quest.diagnosis?.reason || '');
  const [item, setItem] = useState(quest.plan?.item || '');
  const [action, setAction] = useState(quest.plan?.action || '');
  const [free, setFree] = useState('');
  const [target, setTarget] = useState(quest.plan?.target || 0);

  const worst = calc.diag.worst;
  const answerChoice = worst ? choiceOfKey(worst.key) : null;
  const matched = answerChoice && choice === answerChoice.id;

  useEffect(() => { if (!item && worst) setItem(worst.key); }, [worst, item]);
  // 今週の数字の候補：先週の件数をもとに3つ
  const base = Math.max(1, calc.prevWeek[item] || Math.round((calc.mineM[item] || 0) / 4));
  const nums = [base, base + 1, base + 2];
  useEffect(() => { if (!target && item) setTarget(base + 1); }, [item]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = ['ふりかえり', 'じぶん診断', '答え合わせ', '今週の作戦'];
  const prevPlan = prevQuest?.plan;
  const prevChecks = prevQuest?.checks ? Object.values(prevQuest.checks) : [];
  const fmt = (r) => (r.kind === 'vol' ? Math.round(r.me * 10) / 10 + '件' : Math.round(r.me * 10) / 10 + '%');
  const fmtAvg = (r) => (r.kind === 'vol' ? Math.round(r.avg * 10) / 10 + '件' : Math.round(r.avg * 10) / 10 + '%');
  const mark = (r) => (r.ratio >= 1 ? <b style={{ color: C.green }}>◎</b> : r.ratio >= 0.8 ? <b style={{ color: C.gold }}>△</b> : <b style={{ color: C.red }}>✕</b>);

  return (
    <div style={{ padding: '8px 14px', maxWidth: 520, margin: '0 auto', fontWeight: 700 }}>
      <div style={{ display: 'flex', gap: 4, margin: '4px 0 6px' }}>
        {steps.map((s, i) => (
          <div key={s} style={{ flex: 1, textAlign: 'center', fontSize: 10, padding: '3px 0', borderRadius: 4, border: '2px solid ' + (i < step ? '#22C55E' : i === step ? C.gold : '#555'), color: i < step ? C.green : i === step ? C.gold : C.mut, background: i === step ? '#3F3A0B' : 'transparent' }}>{i < step ? '✓ ' : ''}{s}</div>
        ))}
      </div>

      {step === 0 && (<>
        <div style={win}>
          <Q>🗡️ 先週の作戦の けっか</Q>
          {prevPlan ? (<>
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>作戦「{prevPlan.action}」</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderBottom: '1px dashed #333' }}><span>{ITEM[prevPlan.item].label}（目標{prevPlan.target}件）</span><b style={{ color: C.gold }}>{calc.prevWeek[prevPlan.item] || 0}件</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0' }}><span>作戦できた日</span><b style={{ color: C.gold }}>{prevChecks.filter(Boolean).length}日／記録{prevChecks.length}日</b></div>
          </>) : <div style={{ fontSize: 13, color: C.mut }}>先週の作戦はありません（今週が1回目）。先週の数字だけ見てみましょう。</div>}
          <div style={{ fontSize: 12, color: C.mut, marginTop: 4 }}>先週：受付{calc.prevWeek.uketsuke}件／新規・MNP{calc.prevWeek.shinki}／機変{calc.prevWeek.kihen}／ゴールド{calc.prevWeek.gold}／でんき{calc.prevWeek.denki}</div>
        </div>
        <div style={win}>
          <Q>✏️ 先週、うまくいったことは？</Q>
          <textarea style={ta} value={good} onChange={(e) => setGood(e.target.value)} placeholder="例：待ち時間にカードの話をしたら2件とれた" />
          <Q>✏️ うまくいかなかったことは？ なぜ？</Q>
          <textarea style={ta} value={bad} onChange={(e) => setBad(e.target.value)} placeholder="例：混んでいて説明の時間がとれなかった" />
        </div>
        <button disabled={saving} style={next} onClick={async () => { await save({ reflection: { good, bad } }); setStep(1); }}>▶ つぎへ</button>
      </>)}

      {step === 1 && (<>
        <div style={win}>
          <Q>🤔 じぶんの いちばんの課題は どれだと思う？</Q>
          {CHOICES.map((c) => <button key={c.id} style={opt(choice === c.id)} onClick={() => setChoice(c.id)}>{choice === c.id ? '◉ ' : ''}{c.label}</button>)}
        </div>
        <div style={win}>
          <Q>✏️ そう思った理由（ひとこと）</Q>
          <textarea style={ta} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：機変は取れてるけど、付けるものが少ない気がする" />
        </div>
        <button disabled={!choice || saving} style={{ ...next, opacity: choice ? 1 : 0.4 }} onClick={async () => { await save({ diagnosis: { choice, reason } }); setStep(2); }}>▶ 答え合わせへ</button>
        <button style={{ ...next, border: 'none', fontSize: 12, color: C.mut }} onClick={() => setStep(0)}>← もどる</button>
      </>)}

      {step === 2 && (<>
        <div style={win}>
          <Q>📊 数字が示す いちばんの課題（直近4週間・店の1人あたりとくらべて）</Q>
          {worst ? (<>
            <div style={{ fontSize: 15, color: C.gold }}>{worst.label}（あなた {fmt(worst)} → 店の平均 {fmtAvg(worst)}）</div>
            <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.9 }}>
              {calc.diag.rows.map((r) => <span key={r.key} style={{ marginRight: 10, whiteSpace: 'nowrap' }}>{r.label} {mark(r)}</span>)}
            </div>
            <div style={{ marginTop: 6, fontSize: 14, color: matched ? C.green : C.gold }}>
              {matched ? '🎯 せいかい！ 自分の見立てと同じでした' : `🔍 自分の見立て「${(CHOICES.find((c) => c.id === choice) || {}).label || ''}」とはちがいました`}
            </div>
            <div style={{ fontSize: 11, color: C.mut, marginTop: 4 }}>受付・新規・機変・UQ→auは件数で、それ以外は受付100件あたりで比べています</div>
          </>) : <div style={{ fontSize: 13, color: C.mut }}>今月の数字がまだ少ないため、判定できません。</div>}
        </div>
        <div style={{ ...win, padding: '6px 8px' }}>
          <Q>🕸️ Style強化商材（直近4週間・受付100件あたり）</Q>
          <Radar me={calc.styleMe} store={calc.styleStore} />
          <RadarLegend />
        </div>
        <div style={{ fontSize: 11, color: C.mut, margin: '2px 4px 6px' }}>💬 店長・部長のコメントは、届いたらホームに出ます</div>
        <button disabled={saving} style={next} onClick={async () => { await save({ answer: worst ? { key: worst.key, label: worst.label, matched: !!matched } : null }); setStep(3); }}>▶ 作戦を決める</button>
        <button style={{ ...next, border: 'none', fontSize: 12, color: C.mut }} onClick={() => setStep(1)}>← もどる</button>
      </>)}

      {step === 3 && (<>
        <div style={win}>
          <Q>🎯 今週たたかう項目</Q>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {ITEMS.map((it) => (
              <button key={it.key} onClick={() => { setItem(it.key); setAction(''); setTarget(0); }} style={{ padding: '6px 9px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '2px solid ' + (item === it.key ? C.gold : '#555'), background: item === it.key ? '#3F3A0B' : '#000', color: '#fff' }}>
                {it.label}{worst && worst.key === it.key ? ' ★' : ''}
              </button>
            ))}
          </div>
          {worst && <div style={{ fontSize: 11, color: C.mut, marginTop: 4 }}>★＝数字が示す課題</div>}
        </div>
        {item && (<div style={win}>
          <Q>🗺️ 今週やることを 1つ決める</Q>
          {(ACTIONS[item] || []).map((a) => <button key={a} style={opt(action === a)} onClick={() => setAction(a)}>{action === a ? '◉ ' : ''}{a}</button>)}
          <textarea style={{ ...ta, marginTop: 4 }} value={free} onChange={(e) => { setFree(e.target.value); setAction(e.target.value); }} placeholder="自分で書く（候補にないとき）" />
          <Q>🔢 今週の数字（{ITEM[item].label}）</Q>
          <div style={{ display: 'flex', gap: 6 }}>
            {nums.map((n) => <button key={n} onClick={() => setTarget(n)} style={{ flex: 1, padding: '8px 0', borderRadius: 6, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: '2px solid ' + (target === n ? C.gold : '#555'), background: target === n ? '#3F3A0B' : '#000', color: '#fff' }}>{n}件</button>)}
          </div>
          <div style={{ fontSize: 11, color: C.mut, marginTop: 4 }}>先週は {calc.prevWeek[item] || 0}件でした</div>
        </div>)}
        <button disabled={!item || !action || !target || saving} style={{ ...next, opacity: item && action && target ? 1 : 0.4 }}
          onClick={async () => { await save({ plan: { item, action, target } }); onDone(); }}>▶ けってい（今週のボスにする）</button>
        <button style={{ ...next, border: 'none', fontSize: 12, color: C.mut }} onClick={() => setStep(2)}>← もどる</button>
      </>)}
    </div>
  );
}
