import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, onSnapshot, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useDirectory } from '../contexts/DirectoryContext';
import { TARGET_GROUPS } from '../data/targetGroups';

// =====================================================================
// 店舗運営プラン（月初の計画 → 日々の進捗 → 月末の振り返り）
//
//  考え方：
//   ・入力するのは「実行計画の数字」と「重点項目」だけ。
//   ・110%、1人あたり、週あたりは全部こちらで計算します。
//   ・進捗は報告データから自動。手入力させません（ズレるため）。
//   ・「このままだと何件で終わるか」を出します。進捗率だけでは手遅れになります。
// =====================================================================

const C = { gold:'#FBBF24', green:'#34D399', blue:'#38BDF8', red:'#F87171',
            purple:'#A78BFA', w:'#fff', w2:'#E2E8F0', mut:'#94A3B8', mut2:'#64748B' };
const ym = (d) => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
const monthRange = (m) => { const [y,mo]=m.split('-').map(Number); return [new Date(y,mo-1,1), new Date(y,mo,1)]; };
const yen = (n) => '¥' + Number(n||0).toLocaleString();
const norm = (s) => (s||'').replace(/[\s\u3000]+/g,'');

// 目標を入れる5項目（この5つで店の骨格が決まります）
const PLAN_ITEMS = [
  { id:'shinki',  label:'新規ID',            hint:'支援金の土台' },
  { id:'kishu',   label:'機種変更',          hint:'自然来店が中心' },
  { id:'idou',    label:'KDDI内移行',        hint:'UQ→auのアップセル' },
  { id:'net',     label:'ネットワーク（固定）', hint:'25点・LTVの約17%' },
  { id:'gold',    label:'au PAYゴールド',     hint:'発行数とゴールドの2箇所に効く' },
];
// 実績の数え方（報告データの商材IDから）
const MIDS = {
  shinki: ['MID_001','MID_002','MID_005','MID_006','MID_007','MID_008','MID_011','MID_012'],
  kishu:  ['MID_021','MID_022','MID_023','MID_024'],
  idou:   ['MID_035'],
  net:    ['MID_030','MID_065','MID_031','MID_032','MID_063'],
  gold:   ['MID_041'],
};

export default function StorePlan() {
  const { user, profile } = useAuth();
  const dir = useDirectory() || {};
  const staffNames = dir.staffNames || [];
  const staffStoreOf = dir.staffStoreOf || (() => '');
  const storeNameOf = dir.storeNameOf || ((id) => id);
  const mainStores = dir.mainStores || [];
  const [month, setMonth] = useState(() => ym(new Date()));
  const [storeId, setStoreId] = useState('__all');
  const [plans, setPlans] = useState({});      // 'STORE_x_2026-09' → プラン
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState(null);      // 編集中のプラン

  const role = String(profile?.role || '').toLowerCase();
  const isBoss = ['admin','director','owner'].some(r => role.includes(r));
  const myStore = profile?.storeId || '';

  // 店長は自店のみ。社長・部長は全店。
  const stores = useMemo(() => {
    const list = Array.isArray(mainStores) ? mainStores : [];
    return isBoss ? list : list.filter(s => s && s.id === myStore);
  }, [isBoss, mainStores, myStore]);

  useEffect(() => { if (!isBoss && myStore) setStoreId(myStore); }, [isBoss, myStore]);

  useEffect(() => {
    if (!user) return;
    const u = onSnapshot(query(collection(db,'storePlans')), s => {
      const m = {}; s.docs.forEach(d => m[d.id] = { id:d.id, ...d.data() }); setPlans(m);
    });
    return () => u();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let alive = true; setLoading(true);
    const [ms, me] = monthRange(month);
    getDocs(query(collection(db,'reports'), where('createdAt','>=',ms), where('createdAt','<',me)))
      .then(s => { if (alive) { setReports(s.docs.map(d=>({id:d.id,...d.data()}))); setLoading(false); } })
      .catch(() => { if (alive) { setReports([]); setLoading(false); } });
    return () => { alive = false; };
  }, [user, month]);

  // 月の進み具合（「このままだと何件で終わるか」の計算に使う）
  const pace = useMemo(() => {
    const [y,mo] = month.split('-').map(Number);
    const days = new Date(y, mo, 0).getDate();
    const now = new Date();
    const passed = (ym(now) === month) ? now.getDate() : (now < new Date(y,mo-1,1) ? 0 : days);
    return { days, passed, ratio: passed>0 ? passed/days : 0 };
  }, [month]);

  // 店舗ごとの実績を数える
  const actualOf = (sid) => {
    const a = {}; PLAN_ITEMS.forEach(p => a[p.id]=0);
    reports.forEach(r => {
      if (r.counted === false) return;
      const who = norm(r.proxyStaff || r.staffName);
      const home = staffStoreOf(who) || r.storeId;
      if (sid !== '__all' && home !== sid) return;
      (r.lines||[]).forEach(l => {
        for (const k of Object.keys(MIDS)) if (MIDS[k].includes(l.midCat)) { a[k]++; break; }
      });
    });
    return a;
  };

  // 1店舗ぶんの計算
  const calcOne = (sid) => {
    const p = plans[sid + '_' + month] || null;
    const act = actualOf(sid);
    const mem = (Array.isArray(staffNames) ? staffNames : []).filter(n => staffStoreOf(n) === sid);
    const kado = p?.kado || Math.max(1, mem.length - 0.5);
    const rows = PLAN_ITEMS.map(it => {
      const keikaku = p?.keikaku?.[it.id] || 0;
      const target = Math.ceil(keikaku * 1.1);
      const a = act[it.id] || 0;
      const rate = target>0 ? a/target*100 : null;
      // このままのペースだと月末いくつか
      const forecast = pace.ratio>0 ? Math.round(a / pace.ratio) : null;
      const fRate = (target>0 && forecast!=null) ? forecast/target*100 : null;
      return { ...it, keikaku, target, actual:a, rate, forecast, fRate,
               perMonth: kado>0 ? Math.ceil(target/kado*10)/10 : 0,
               perWeek: kado>0 ? Math.ceil(target/kado/4*10)/10 : 0,
               left: Math.max(0, target - a) };
    });
    const done = rows.filter(r=>r.target>0);
    const avg = done.length ? done.reduce((s,r)=>s+(r.rate||0),0)/done.length : null;
    const avgF = done.length ? done.reduce((s,r)=>s+(r.fRate||0),0)/done.length : null;
    return { sid, name: sid==='__all'?'全店':storeNameOf(sid), plan:p, rows, kado, mem:mem.length, avg, avgF };
  };

  const view = useMemo(() => calcOne(storeId), [storeId, plans, reports, month, staffNames]);
  const allStores = useMemo(() => stores.map(s => calcOne(s.id)), [stores, plans, reports, month, staffNames]);

  // 過去12ヶ月（振り返り）
  const history = useMemo(() => {
    const out = [];
    const [y,mo] = month.split('-').map(Number);
    for (let i=11;i>=0;i--) {
      const d = new Date(y, mo-1-i, 1);
      const m = ym(d);
      const p = plans[(storeId==='__all'?stores[0]?.id:storeId) + '_' + m];
      if (p) out.push({ month:m, plan:p });
    }
    return out;
  }, [plans, month, storeId, stores]);

  const openEdit = () => {
    const key = storeId + '_' + month;
    const p = plans[key];
    setEdit({
      storeId, month,
      keikaku: { ...(p?.keikaku || {}) },
      kado: p?.kado || Math.max(1, (Array.isArray(staffNames)?staffNames:[]).filter(n=>staffStoreOf(n)===storeId).length - 0.5),
      focus: [ ...(p?.focus || []) ],
      memo: p?.memo || '',
      review: p?.review || '',
    });
  };

  const save = async () => {
    if (!edit) return;
    try {
      await setDoc(doc(db,'storePlans', edit.storeId + '_' + edit.month), {
        storeId: edit.storeId, month: edit.month,
        keikaku: edit.keikaku, kado: Number(edit.kado)||1,
        focus: edit.focus, memo: edit.memo, review: edit.review,
        updatedAt: serverTimestamp(), updatedBy: profile?.name || '',
      }, { merge:true });
      setEdit(null);
    } catch (e) { alert('保存に失敗しました。\n' + (e?.message||e)); }
  };

  // 重点に選べる項目（目標5項目＋商材グループの全項目）
  const focusOptions = useMemo(() => {
    const base = PLAN_ITEMS.map(p => p.label);
    // TARGET_GROUPS の項目名は label / name / id のどれかの可能性があるため、全部を試す
    let groups = [];
    try {
      groups = (Array.isArray(TARGET_GROUPS) ? TARGET_GROUPS : [])
        .filter(g => g && !g.internal)
        .map(g => g.label || g.name || g.title || '')
        .filter(x => typeof x === 'string' && x.length > 0);
    } catch (e) { groups = []; }
    return [...new Set([...base, ...groups])];
  }, []);

  const sig = (r) => r==null ? C.mut2 : r>=100 ? C.green : r>=85 ? C.gold : C.red;
  const sigTxt = (r) => r==null ? '—' : r>=100 ? '達成' : r>=85 ? 'あと少し' : '遅れ';

  const card = { background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:12, padding:13, marginBottom:12 };
  const sel = { padding:9, borderRadius:9, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.1)', color:'#fff', fontSize:13, outline:'none', boxSizing:'border-box' };
  const inp = { ...sel, width:'100%', textAlign:'center', fontWeight:800, color:C.gold };

  return (
    <div style={{ padding:'8px 14px 40px' }}>
      <h1 style={{ fontSize:16, fontWeight:900, color:'#fff', marginBottom:3 }}>🎯 店舗運営プラン</h1>
      <div style={{ fontSize:10, color:C.mut2, marginBottom:11 }}>
        入れるのは実行計画と重点だけ。110%・1人あたり・進捗は自動で出ます。
      </div>

      <div style={{ display:'flex', gap:6, marginBottom:12 }}>
        <input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{...sel, flex:1}} />
        <select value={storeId} onChange={e=>setStoreId(e.target.value)} style={{...sel, flex:1}}>
          {isBoss && <option value="__all">全店</option>}
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* 全店ダッシュボード（社長・部長のみ） */}
      {isBoss && storeId==='__all' && (
        <div style={card}>
          <div style={{ fontSize:12, fontWeight:800, color:C.gold, marginBottom:9 }}>🏪 4店舗の状況（1秒で見渡す）</div>
          {allStores.map(s => (
            <div key={s.sid} onClick={()=>setStoreId(s.sid)}
              style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 11px', borderRadius:10, marginBottom:6, cursor:'pointer',
                       background:'rgba(255,255,255,0.03)', borderLeft:'4px solid '+sig(s.avg) }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12.5, fontWeight:800, color:'#fff' }}>{s.name}</div>
                <div style={{ fontSize:9.5, color:C.mut }}>{s.mem}名／稼働{s.kado}　{s.plan ? '' : '⚠️ 目標が未入力です'}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:18, fontWeight:900, color:sig(s.avg) }}>{s.avg!=null? s.avg.toFixed(0)+'%':'—'}</div>
                <div style={{ fontSize:9, color:C.mut2 }}>このまま {s.avgF!=null? s.avgF.toFixed(0)+'%':'—'}</div>
              </div>
              <span style={{ color:C.mut2, fontSize:15 }}>›</span>
            </div>
          ))}
          <div style={{ fontSize:9.5, color:C.mut2, marginTop:6, lineHeight:1.6 }}>
            左の色：<span style={{color:C.green}}>■</span>達成 <span style={{color:C.gold}}>■</span>あと少し(85%〜) <span style={{color:C.red}}>■</span>遅れ<br />
            「このまま」＝今のペースで月末を迎えたときの着地見込みです。
          </div>
        </div>
      )}

      {/* 1店舗の詳細 */}
      {storeId!=='__all' && (<>
        {!view.plan && (
          <div style={{ ...card, background:'rgba(251,191,36,0.07)', borderColor:'rgba(251,191,36,0.35)' }}>
            <div style={{ fontSize:12, fontWeight:800, color:C.gold, marginBottom:4 }}>⚠️ {month} の目標がまだ入っていません</div>
            <div style={{ fontSize:10.5, color:C.w2, lineHeight:1.7 }}>
              KDDIの実行計画の数字を入れるだけです。110%も1人あたりも自動で出ます。5分で終わります。
            </div>
            <button onClick={openEdit} style={{ width:'100%', marginTop:9, padding:11, border:'none', borderRadius:10, background:C.gold, color:'#000', fontSize:13, fontWeight:900, cursor:'pointer' }}>
              月初の計画を入れる
            </button>
          </div>
        )}

        {view.plan && (<>
          {/* 重点 */}
          {view.plan.focus?.length>0 && (
            <div style={{ ...card, background:'rgba(167,139,250,0.07)', borderColor:'rgba(167,139,250,0.3)' }}>
              <div style={{ fontSize:11, fontWeight:800, color:C.purple, marginBottom:6 }}>今月ここに力を入れます（朝礼で毎日これを言う）</div>
              <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                {view.plan.focus.map(f => (
                  <span key={f} style={{ padding:'5px 11px', borderRadius:999, fontSize:11.5, fontWeight:800,
                    background:'rgba(167,139,250,0.15)', color:C.purple, border:'1px solid rgba(167,139,250,0.4)' }}>{f}</span>
                ))}
              </div>
              {view.plan.memo && <div style={{ fontSize:10.5, color:C.w2, marginTop:7, lineHeight:1.6 }}>{view.plan.memo}</div>}
            </div>
          )}

          {/* 進捗 */}
          <div style={card}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:9 }}>
              <span style={{ fontSize:12, fontWeight:800, color:C.gold }}>📊 進捗</span>
              <span style={{ fontSize:10, color:C.mut }}>{pace.passed}日 / {pace.days}日（{(pace.ratio*100).toFixed(0)}%経過）</span>
            </div>
            {view.rows.map(r => (
              <div key={r.id} style={{ marginBottom:11 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:3 }}>
                  <span style={{ fontSize:11.5, fontWeight:700, color:'#fff' }}>{r.label}</span>
                  <span style={{ fontSize:10.5, color:C.mut }}>
                    <b style={{ color:sig(r.rate), fontSize:15 }}>{r.actual}</b> / {r.target}
                    <span style={{ color:C.mut2 }}>（計画{r.keikaku}）</span>
                  </span>
                </div>
                <div style={{ height:9, background:'rgba(255,255,255,0.06)', borderRadius:5, overflow:'hidden', position:'relative' }}>
                  <div style={{ height:'100%', width:Math.min(100, r.rate||0)+'%', background:sig(r.rate), borderRadius:5 }} />
                  <div style={{ position:'absolute', left:(pace.ratio*100)+'%', top:0, bottom:0, width:2, background:'rgba(255,255,255,0.5)' }} />
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:9.5, marginTop:3 }}>
                  <span style={{ color:C.mut2 }}>1人 月{r.perMonth} / 週{r.perWeek}　残り{r.left}</span>
                  <span style={{ color:sig(r.fRate), fontWeight:700 }}>
                    このまま月末 {r.forecast!=null? r.forecast : '—'}（{r.fRate!=null? r.fRate.toFixed(0)+'%':'—'}）
                  </span>
                </div>
              </div>
            ))}
            <div style={{ fontSize:9.5, color:C.mut2, marginTop:4, lineHeight:1.6, borderTop:'1px solid rgba(255,255,255,0.08)', paddingTop:6 }}>
              白い縦線＝今日の位置。バーが線より左なら遅れています。<br />
              「このまま月末」＝今のペースで進んだ場合の着地。<b style={{color:C.gold}}>ここが100%未満なら、まだ打つ手があるうちに動いてください。</b>
            </div>
          </div>

          <button onClick={openEdit} style={{ width:'100%', padding:11, marginBottom:12, borderRadius:10, background:'rgba(56,189,248,0.12)', color:C.blue, border:'1px solid rgba(56,189,248,0.3)', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>
            ✏️ 計画・重点・振り返りを直す
          </button>

          {/* 振り返り */}
          {view.plan.review && (
            <div style={card}>
              <div style={{ fontSize:11, fontWeight:800, color:C.green, marginBottom:5 }}>📝 今月の振り返り</div>
              <div style={{ fontSize:11, color:C.w2, lineHeight:1.8, whiteSpace:'pre-wrap' }}>{view.plan.review}</div>
            </div>
          )}
        </>)}

        {/* 過去の記録 */}
        {history.length>0 && (
          <div style={card}>
            <div style={{ fontSize:12, fontWeight:800, color:C.blue, marginBottom:8 }}>📅 これまでの月（重点と振り返り）</div>
            {history.slice().reverse().map(h => (
              <div key={h.month} onClick={()=>setMonth(h.month)} style={{ padding:'8px 10px', borderRadius:9, marginBottom:5, background:'rgba(255,255,255,0.02)', cursor:'pointer' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ fontSize:11.5, fontWeight:800, color:'#fff' }}>{h.month}</span>
                  <span style={{ fontSize:10, color:C.mut }}>{(h.plan.focus||[]).join('・') || '重点なし'}</span>
                </div>
                {h.plan.review && <div style={{ fontSize:10, color:C.mut, lineHeight:1.6 }}>{String(h.plan.review).slice(0,60)}{String(h.plan.review).length>60?'…':''}</div>}
              </div>
            ))}
            <div style={{ fontSize:9.5, color:C.mut2, marginTop:4 }}>※ 先月何を重点にして、結果どうだったか。並べて見ると次の月が決めやすくなります。</div>
          </div>
        )}
      </>)}

      {/* 入力画面 */}
      {edit && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:100, overflowY:'auto', padding:'16px 12px' }}>
          <div style={{ maxWidth:520, margin:'0 auto', background:'#0f1729', borderRadius:16, border:'1px solid rgba(255,255,255,0.1)', padding:16 }}>
            <div style={{ fontSize:15, fontWeight:900, color:'#fff', marginBottom:3 }}>{storeNameOf(edit.storeId)}　{edit.month}</div>
            <div style={{ fontSize:10, color:C.mut2, marginBottom:14 }}>KDDIの実行計画をそのまま入れてください。あとは自動で計算します。</div>

            <div style={{ fontSize:11.5, fontWeight:800, color:C.gold, marginBottom:7 }}>① 実行計画の数字</div>
            {PLAN_ITEMS.map(it => {
              const v = edit.keikaku[it.id] || '';
              const t = v ? Math.ceil(Number(v)*1.1) : 0;
              const k = Number(edit.kado)||1;
              return (
                <div key={it.id} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:7 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:11.5, color:'#fff', fontWeight:700 }}>{it.label}</div>
                    <div style={{ fontSize:9, color:C.mut2 }}>{it.hint}</div>
                  </div>
                  <input type="number" inputMode="numeric" value={v}
                    onChange={e=>setEdit({...edit, keikaku:{...edit.keikaku, [it.id]: e.target.value===''?'':Number(e.target.value)}})}
                    style={{ ...inp, width:76 }} />
                  <div style={{ minWidth:96, textAlign:'right' }}>
                    <div style={{ fontSize:12.5, fontWeight:900, color:C.green }}>{t? t+'件':'—'}</div>
                    <div style={{ fontSize:9, color:C.mut2 }}>{t? '1人 週'+(Math.ceil(t/k/4*10)/10):'110%'}</div>
                  </div>
                </div>
              );
            })}

            <div style={{ fontSize:11.5, fontWeight:800, color:C.gold, margin:'14px 0 7px' }}>② 実際に動ける人数</div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
              <input type="number" step="0.5" inputMode="decimal" value={edit.kado}
                onChange={e=>setEdit({...edit, kado:e.target.value})} style={{ ...inp, width:90 }} />
              <div style={{ fontSize:10, color:C.mut, lineHeight:1.5 }}>
                店長は0.5人、新人は0.5人、長期休みは0人として数えます
              </div>
            </div>

            <div style={{ fontSize:11.5, fontWeight:800, color:C.gold, margin:'14px 0 4px' }}>③ 今月の重点（3つまで）</div>
            <div style={{ fontSize:9.5, color:C.mut2, marginBottom:7 }}>選んだものを、毎日の朝礼で言います。3つに絞るほど伝わります。</div>
            <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:4, maxHeight:190, overflowY:'auto' }}>
              {focusOptions.map(f => {
                const on = edit.focus.includes(f);
                const full = edit.focus.length>=3 && !on;
                return (
                  <span key={f} onClick={()=>{ if(full) return;
                      setEdit({...edit, focus: on? edit.focus.filter(x=>x!==f) : [...edit.focus, f]}); }}
                    style={{ padding:'5px 10px', borderRadius:999, fontSize:11, fontWeight:700, cursor: full?'default':'pointer',
                      background: on?'rgba(167,139,250,0.2)':'rgba(255,255,255,0.03)',
                      color: on?C.purple : full?C.mut2:C.mut,
                      border: on?'1px solid rgba(167,139,250,0.5)':'1px solid rgba(255,255,255,0.08)' }}>
                    {on?'✓ ':''}{f}
                  </span>
                );
              })}
            </div>

            <div style={{ fontSize:11.5, fontWeight:800, color:C.gold, margin:'14px 0 5px' }}>④ そのために何をするか（任意）</div>
            <textarea value={edit.memo} onChange={e=>setEdit({...edit, memo:e.target.value})}
              placeholder="例）固定は来店客全員に一声。ゴールドはカードを勧めるとき最初からゴールドで。"
              style={{ ...sel, width:'100%', minHeight:60, textAlign:'left', color:'#fff', fontWeight:400, fontSize:12 }} />

            <div style={{ fontSize:11.5, fontWeight:800, color:C.green, margin:'14px 0 5px' }}>⑤ 月末の振り返り（月末に書く）</div>
            <textarea value={edit.review} onChange={e=>setEdit({...edit, review:e.target.value})}
              placeholder="何が効いて、何が効かなかったか。来月どうするか。"
              style={{ ...sel, width:'100%', minHeight:70, textAlign:'left', color:'#fff', fontWeight:400, fontSize:12 }} />

            <div style={{ display:'flex', gap:8, marginTop:14 }}>
              <button onClick={()=>setEdit(null)} style={{ flex:1, padding:12, borderRadius:10, background:'rgba(255,255,255,0.05)', color:C.mut, border:'none', fontSize:13, fontWeight:700, cursor:'pointer' }}>やめる</button>
              <button onClick={save} style={{ flex:2, padding:12, borderRadius:10, background:C.green, color:'#000', border:'none', fontSize:13, fontWeight:900, cursor:'pointer' }}>保存する</button>
            </div>
          </div>
        </div>
      )}

      {loading && <div style={{ textAlign:'center', color:C.mut, fontSize:11, padding:12 }}>読み込み中…</div>}
    </div>
  );
}
