import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, addDoc, deleteDoc, doc, serverTimestamp, query, orderBy, onSnapshot } from 'firebase/firestore';
import {
  STORES, MAIN_STORES, storeName, MAIN_CAT, MID_CAT, midName, midsByMain,
  MODELS, modelsByMaker, PLANS, OPTS, ACQ_TYPES, CONTRACT_TYPES, OUTSOURCERS, STAFF,
  LINE_REQUIRED_MIDS, PONTA_OPT, GAS_URL,
} from '../data/masters';
import { buildAcqMessages, buildDeleteMessage } from '../lib/lineMessage';
import { lineIdScore, classifyLine, PLAN_CATS, hasDevice, isMnp, essentialMetrics } from '../lib/tactical';

const C = { gold: '#FBBF24', green: '#34D399', blue: '#38BDF8', purple: '#A78BFA', red: '#F87171', w: '#fff', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const isEventStore = (id) => STORES.find(s => s.id === id)?.isEvent;
const emptyLine = () => ({ mainCat: '', midCat: '', midCats: [], lineType: '', maker: '', model: '', customModel: '', deviceColor: '', deviceStorage: '', plans: [], opts: [], pontaLink: false, mauLogin: false, imei: '', iccid: '', appNo: '', archNo: '', direction: '', plus1c: '', plus1cDetail: '', setupFee: '', cashback: '', fpDate: '' });
const lineNeedsLineType = (l) => (l.midCats || []).some(m => LINE_REQUIRED_MIDS.includes(m)) || (l.opts || []).includes(PONTA_OPT);

export default function Report() {
  const { user, profile } = useAuth();
  const [tab, setTab] = useState('new');
  const [step, setStep] = useState(1);
  const [acqType, setAcqType] = useState('self');
  const [contractType, setContractType] = useState('personal');
  const [extName, setExtName] = useState('');
  const [proxyStaff, setProxyStaff] = useState('');
  const [openStore, setOpenStore] = useState('');
  const [store, setStore] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [curLine, setCurLine] = useState(0);
  const [done, setDone] = useState(false);
  const [lastReport, setLastReport] = useState(null); // 報告完了画面で表示する直前の報告内容
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [isCorrection, setIsCorrection] = useState(false);

  useEffect(() => { if (profile?.storeId) setStore(profile.storeId); }, [profile]);
  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, 'reports'), orderBy('createdAt', 'desc')), (snap) =>
      setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [user]);

  const L = lines[curLine] || emptyLine();
  const updLine = (u) => setLines(prev => { const n = [...prev]; n[curLine] = { ...n[curLine], ...u }; return n; });
  const toggleIn = (key, id) => setLines(prev => { const n = [...prev]; const cur = n[curLine][key] || []; n[curLine] = { ...n[curLine], [key]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }; return n; });
  const addLine = () => { setLines(prev => [...prev, emptyLine()]); setCurLine(lines.length); setStep(2); };
  const rmLine = (i) => { if (lines.length <= 1) return; const n = lines.filter((_, j) => j !== i); setLines(n); setCurLine(Math.min(curLine, n.length - 1)); };
  const staffDisplayName = profile?.name || user?.displayName || user?.email || '不明';
  const reset = () => { setStep(1); setAcqType('self'); setContractType('personal'); setExtName(''); setProxyStaff(''); setStore(profile?.storeId || ''); setOpenStore(''); setLines([emptyLine()]); setCurLine(0); setDone(false); setSaving(false); };
  const canStep1 = store && (acqType === 'self' || (acqType === 'outsource' && extName) || (acqType === 'proxy' && proxyStaff));
  const filteredMid = midsByMain(L.mainCat);

  const submit = async () => {
    // 回線必須チェック（5商材/Ponta）
    for (const l of lines) if (lineNeedsLineType(l) && !l.lineType) { alert('金融・LTV商材（でんき/PAYカード/ゴールド/じぶん銀行/Ponta）は回線(au/UQ)の選択が必須です。'); return; }
    // チェック漏れ警告（モバイル契約のPonta連携・ログイン誘導）
    const MOBILE_MAINS = ['MAIN_001', 'MAIN_002', 'MAIN_003', 'MAIN_004'];
    const mobileLines = lines.filter(l => MOBILE_MAINS.includes(l.mainCat));
    // 法人契約はPonta連携・My auログインが出来ないため、未チェック警告をスキップ
    if (contractType !== 'corporate' && mobileLines.length > 0) {
      const noPonta = mobileLines.filter(l => !l.pontaLink).length;
      const noLogin = mobileLines.filter(l => !l.mauLogin).length;
      if (noPonta > 0 || noLogin > 0) {
        const lines2 = [];
        if (noPonta > 0) lines2.push('・Ponta連携 未チェック: ' + noPonta + '件');
        if (noLogin > 0) lines2.push('・My au/UQログイン誘導 未チェック: ' + noLogin + '件');
        const msg = '⚠️ 退店時の必須対応に未チェックがあります\n\n' + lines2.join('\n') + '\n\nこれらは100%実施項目です。\n本当にこの内容で確定しますか？\n\n（戻ってチェックを入れる場合は「キャンセル」）';
        if (!confirm(msg)) return;
      }
    }
    if (!confirm('この内容で報告します。よろしいですか？')) return;
    setSaving(true);
    try {
      // 複数台・MAIN_006複数選択・FPトス(OPT_124)→生保トス(MID_046)の展開
      const expanded = [];
      lines.forEach(l => {
        if (l.mainCat === 'MAIN_006' && (l.midCats || []).length > 1) {
          (l.midCats || []).forEach(mc => expanded.push({ ...l, midCat: mc }));
        } else {
          expanded.push({ ...l, midCat: l.midCat || (l.midCats || [])[0] || '' });
        }
        if ((l.opts || []).includes('OPT_124') && l.mainCat !== 'MAIN_006') {
          expanded.push({ ...emptyLine(), mainCat: 'MAIN_006', midCat: 'MID_046', fpDate: l.fpDate || '' });
        }
      });
      const linesForSave = expanded.map(l => ({
        mainCat: l.mainCat, mainCatName: MAIN_CAT.find(c => c.id === l.mainCat)?.name || '',
        midCat: l.midCat, midCatName: midName(l.midCat),
        lineType: l.lineType || '',
        maker: l.maker, model: l.model === '__custom__' ? (l.customModel || '手入力') : l.model,
        deviceColor: l.deviceColor || '', deviceStorage: l.deviceStorage || '',
        plans: l.plans || [], planNames: (l.plans || []).map(p => PLANS.find(x => x.id === p)?.name || '').filter(Boolean),
        opts: l.opts || [], optNames: (l.opts || []).map(o => OPTS.find(x => x.id === o)?.name || '').filter(Boolean),
        pontaLink: !!l.pontaLink, mauLogin: !!l.mauLogin,
        imei: l.imei || '', iccid: l.iccid || '', appNo: l.appNo || '', archNo: l.archNo || '', direction: l.direction || '',
        plus1c: l.plus1c ? Number(l.plus1c) : 0, plus1cDetail: l.plus1cDetail || '',
        setupFee: l.setupFee ? Number(l.setupFee) : 0, cashback: l.cashback ? Number(l.cashback) : 0, fpDate: l.fpDate || '',
      }));
      const capturedAcq = acqType;
      const reportData = {
        uid: user.uid,
        staffName: staffDisplayName,
        acqType, contractType,
        extName: acqType === 'outsource' ? extName : '',
        proxyStaff: acqType === 'proxy' ? proxyStaff : '',
        storeId: store,
        storeName: storeName(store),
        openStoreId: openStore || '',
        eventStoreId: isEventStore(store) ? store : '',   // 計上ルール①
        counted: acqType !== 'outsource',
        lineCount: expanded.length,
        lines: linesForSave,
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, 'reports'), reportData);
      // 月累計率（通話定額・Ponta連携・ログイン）を計算してLINE通知に含める
      const _now = new Date();
      const _cm = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0');
      const _myMonth = history.filter(r => {
        if (r.counted === false) return false;
        if ((r.proxyStaff || r.staffName) !== staffDisplayName) return false;
        const cd = r.createdAt?.toDate?.(); if (!cd) return false;
        const ym = cd.getFullYear() + '-' + String(cd.getMonth() + 1).padStart(2, '0');
        return ym === _cm;
      });
      // 今回の報告も加える（history にはまだ未反映のため）
      const _withCurrent = [..._myMonth, { lines: linesForSave, counted: true, staffName: staffDisplayName }];
      const _em = essentialMetrics(_withCurrent, { staffName: staffDisplayName });
      const monthlyRates = {
        callFlat: _em.callFlat.rate || 0,
        ponta: _em.pontaLink.rate || 0,
        login: _em.login.rate || 0,
      };
      // LINE通知（縦書き・略称・各行短く＝途中改行を防止・失敗しても無視）
      try {
        const msgs = buildAcqMessages({ lines, acqType, staffName: staffDisplayName, extName, proxyStaff, storeId: store, openStoreId: openStore, isCorrection, monthlyRates });
        msgs.forEach((m, i) => setTimeout(() => { fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ source: 'plus-manager', text: m }) }).catch(() => { }); }, i * 500));
      } catch (e) { }
      setLastReport({ lines: linesForSave, acqType: capturedAcq });
      setDone(true); setIsCorrection(false);
    } catch (e) { alert('保存エラー: ' + e.message); setSaving(false); }
  };

  const deleteReport = async (id) => {
    if (!confirm('この報告を削除しますか？削除すると元に戻せません。正しい内容で再入力してください。')) return;
    try {
      const target = history.find(r => r.id === id);
      await deleteDoc(doc(db, 'reports', id));
      if (target) {
        const nm = target.acqType === 'proxy' ? target.proxyStaff : target.staffName;
        const mids = (target.lines || []).map(l => l.midCatName).join(', ');
        fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ source: 'plus-manager', text: buildDeleteMessage({ staffName: nm, mids }) }) }).catch(() => { });
      }
      setIsCorrection(true); setTab('new'); reset();
      alert('削除しました。正しい内容で再入力してください。');
    } catch (e) { alert('削除エラー: ' + e.message); }
  };

  // ---- 小さなUI部品 ----
  const Chips = ({ items, value, selected, multi, onSelect, color = C.gold }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {items.map(it => {
        const v = typeof it === 'string' ? it : it.id;
        const n = typeof it === 'string' ? it : it.name;
        const active = multi ? (selected || []).includes(v) : value === v;
        return <button key={v} onClick={() => onSelect(v)} style={{ padding: '5px 8px', borderRadius: 7, fontSize: 9, cursor: 'pointer', background: active ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.03)', color: active ? color : C.mut, border: active ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>{multi && active ? '✓ ' : ''}{n}</button>;
      })}
    </div>
  );
  const Lbl = ({ children }) => <div style={{ fontSize: 10, color: C.mut, marginBottom: 4 }}>{children}</div>;
  const inp = { width: '100%', padding: 7, borderRadius: 7, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 11, outline: 'none', boxSizing: 'border-box' };
  const btnP = { flex: 1, padding: 10, borderRadius: 10, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: C.gold, color: '#000' };
  const btnG = { flex: 1, padding: 10, borderRadius: 10, fontSize: 12, background: 'rgba(255,255,255,0.03)', color: C.mut, border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' };

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 12 }}>📋 実績報告</h1>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[{ id: 'new', label: '＋ 新規報告' }, { id: 'history', label: '📄 履歴' }].map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); if (t.id === 'new') reset(); }} style={{ flex: 1, padding: 8, borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: tab === t.id ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.02)', color: tab === t.id ? C.gold : C.mut2, border: tab === t.id ? '1px solid rgba(251,191,36,0.2)' : '1px solid rgba(255,255,255,0.03)' }}>{t.label}</button>
        ))}
      </div>

      {tab === 'new' && (done && lastReport ? (() => {
        const MOBILE = ['MAIN_001', 'MAIN_002', 'MAIN_003', 'MAIN_004'];
        const lineScores = lastReport.lines.filter(l => MOBILE.includes(l.mainCat)).map(l => {
          const score = lineIdScore(l);
          const cat = classifyLine(l) || 'other';
          const dev = hasDevice(l); const mnp = isMnp(l);
          const rating = score >= 13 ? 'great' : score <= 2 ? 'warn' : 'normal';
          let hint = '';
          if (cat !== 'manekatsu2' && score < 19) {
            if (mnp && dev) hint = 'プランをマネ活2に切替えで19pt（最高効率）';
            else if (mnp && !dev) hint = '次回は端末提案＋マネ活2で19ptの可能性';
            else if (!mnp && dev) hint = 'MNP獲得＋マネ活2で19ptの可能性';
            else hint = 'マネ活2×MNP×端末有なら19pt（最高効率）';
          }
          return { line: l, score: Math.round(score * 10) / 10, cat, rating, hint };
        });
        const reportTotal = Math.round(lineScores.reduce((s, x) => s + x.score, 0) * 10) / 10;
        // 今月の累計（自分の報告のみ・countedのみ）
        const now = new Date();
        const cm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        let mTotal = 0, mPremium = 0, mMane = 0;
        history.forEach(r => {
          if (r.counted === false) return;
          const acq = r.proxyStaff || r.staffName; if (acq !== staffDisplayName) return;
          const cd = r.createdAt?.toDate?.(); if (!cd) return;
          const ym = cd.getFullYear() + '-' + String(cd.getMonth() + 1).padStart(2, '0');
          if (ym !== cm) return;
          (r.lines || []).forEach(line => {
            if (!MOBILE.includes(line.mainCat)) return;
            mTotal += lineIdScore(line);
            const c = classifyLine(line);
            if (c === 'manekatsu2') mMane++;
            if (c === 'manekatsu2' && isMnp(line) && hasDevice(line)) mPremium++;
          });
        });
        mTotal = Math.round(mTotal * 10) / 10;
        const outsourced = lastReport.acqType === 'outsource';
        return (
          <div>
            <div style={{ textAlign: 'center', padding: '16px 0 10px' }}>
              <div style={{ fontSize: 34 }}>{outsourced ? '⚠️' : '🎉'}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: outsourced ? C.red : C.green, marginTop: 4 }}>{outsourced ? '外注報告（カウント対象外）' : '報告完了！'}</div>
            </div>
            {!outsourced && lineScores.map((s, i) => (
              <div key={i} style={{ marginBottom: 8, padding: 11, borderRadius: 12, background: s.rating === 'great' ? 'rgba(251,191,36,0.08)' : s.rating === 'warn' ? 'rgba(248,113,113,0.06)' : 'rgba(255,255,255,0.03)', border: '1px solid ' + (s.rating === 'great' ? 'rgba(251,191,36,0.35)' : s.rating === 'warn' ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.06)') }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: C.mut }}>{i + 1}台目 ／ {s.line.midCatName}</span>
                  <span style={{ fontSize: 22, fontWeight: 900, color: s.rating === 'great' ? C.gold : s.rating === 'warn' ? C.red : C.w2 }}>{s.score}<span style={{ fontSize: 10, color: C.mut, fontWeight: 600 }}>pt</span></span>
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 9, marginBottom: 3 }}>
                  <span style={{ padding: '2px 6px', borderRadius: 4, background: PLAN_CATS[s.cat]?.color + '22', color: PLAN_CATS[s.cat]?.color, fontWeight: 700 }}>{PLAN_CATS[s.cat]?.label || '—'}</span>
                  <span style={{ padding: '2px 6px', borderRadius: 4, background: isMnp(s.line) ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.05)', color: isMnp(s.line) ? C.blue : C.mut }}>{isMnp(s.line) ? 'MNP' : '通常新規系'}</span>
                  <span style={{ padding: '2px 6px', borderRadius: 4, background: hasDevice(s.line) ? 'rgba(52,211,153,0.18)' : 'rgba(255,255,255,0.05)', color: hasDevice(s.line) ? C.green : C.mut }}>{hasDevice(s.line) ? '端末有' : 'SIMのみ'}</span>
                </div>
                {s.rating === 'great' && <div style={{ fontSize: 10, color: C.gold, fontWeight: 700, marginTop: 4 }}>⭐ 高効率契約です！この調子で。</div>}
                {s.hint && <div style={{ fontSize: 10, color: s.rating === 'warn' ? C.gold : C.mut, marginTop: 5, padding: 6, borderRadius: 6, background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)' }}>💡 {s.hint}</div>}
                {/* Ponta連携・ログインのチェック確認 */}
                {contractType !== 'corporate' && !s.line.pontaLink && <div style={{ fontSize: 9, color: C.red, marginTop: 4 }}>⚠️ Ponta連携 未チェック</div>}
                {contractType !== 'corporate' && !s.line.mauLogin && <div style={{ fontSize: 9, color: C.red, marginTop: 2 }}>⚠️ My au/UQログイン誘導 未チェック</div>}
                {contractType === 'corporate' && <div style={{ fontSize: 9, color: C.mut, marginTop: 4 }}>🏢 法人契約のため Ponta連携・ログイン誘導は対象外</div>}
              </div>
            ))}
            {!outsourced && lineScores.length > 0 && (
              <div style={{ marginBottom: 10, padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.03)', textAlign: 'center' }}>
                <span style={{ fontSize: 10, color: C.mut }}>この報告 合計: </span>
                <span style={{ fontSize: 18, fontWeight: 900, color: C.gold }}>{reportTotal}<span style={{ fontSize: 10, color: C.mut, fontWeight: 600 }}>pt</span></span>
              </div>
            )}
            {!outsourced && lineScores.length === 0 && (
              <div style={{ marginBottom: 10, padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.03)', fontSize: 11, color: C.mut, textAlign: 'center' }}>今回はモバイル契約なし（固定／LTV／PAYのみ）。IDpt計算対象外です。</div>
            )}
            {!outsourced && (
              <div style={{ marginBottom: 12, padding: 12, borderRadius: 12, background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.25)' }}>
                <div style={{ fontSize: 10, color: C.purple, marginBottom: 8, fontWeight: 700 }}>📈 {staffDisplayName}さんの今月の累計</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: C.w2 }}>マネ活2 MNP端末有（最高効率）</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: C.gold }}>{mPremium}<span style={{ fontSize: 9, color: C.mut, fontWeight: 600 }}>件 / 月15件目標</span></span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: C.w2 }}>マネ活2 全体</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: C.gold }}>{mMane}<span style={{ fontSize: 9, color: C.mut, fontWeight: 600 }}>件</span></span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 11, color: C.w2 }}>合計IDポイント</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: C.purple }}>{mTotal}<span style={{ fontSize: 9, color: C.mut, fontWeight: 600 }}>pt / 月1,492pt目標</span></span>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setDone(false); setLastReport(null); reset(); setTab('history'); }} style={btnG}>履歴を見る</button>
              <button onClick={() => { setDone(false); setLastReport(null); reset(); }} style={btnP}>＋ 次の報告</button>
            </div>
          </div>
        );
      })() : (
        <div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>{[1, 2, 3, 4, 5].map(s => <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: s <= step ? C.gold : 'rgba(255,255,255,0.05)' }} />)}</div>

          {step === 1 && (
            <div>
              <Lbl>獲得区分</Lbl>
              {ACQ_TYPES.map(a => (
                <button key={a.id} onClick={() => { setAcqType(a.id); setExtName(''); setProxyStaff(''); }} style={{ display: 'flex', gap: 8, width: '100%', padding: 8, borderRadius: 8, marginBottom: 3, textAlign: 'left', cursor: 'pointer', background: acqType === a.id ? a.color + '22' : 'rgba(255,255,255,0.02)', border: acqType === a.id ? '1px solid ' + a.color : '1px solid rgba(255,255,255,0.04)' }}>
                  <span>{a.icon}</span><div><div style={{ fontSize: 11, fontWeight: 700, color: acqType === a.id ? a.color : C.w2 }}>{a.name}</div><div style={{ fontSize: 8, color: C.mut2 }}>{a.desc}</div></div>
                </button>
              ))}
              {acqType === 'outsource' && <div style={{ margin: '8px 0' }}><Lbl>外注会社</Lbl><Chips items={OUTSOURCERS.map(c => ({ id: c, name: c }))} value={extName.split(':')[0]} onSelect={v => setExtName(v + ':' + (extName.includes(':') ? extName.split(':')[1] : ''))} /><input value={extName.includes(':') ? extName.split(':')[1] : extName} onChange={e => { const co = extName.includes(':') ? extName.split(':')[0] : ''; setExtName(co ? co + ':' + e.target.value : e.target.value); }} placeholder="担当者名" style={{ ...inp, marginTop: 4 }} /></div>}
              {acqType === 'proxy' && <div style={{ margin: '8px 0' }}><Lbl>対象スタッフ</Lbl><Chips items={STAFF.map(s => ({ id: s, name: s }))} value={proxyStaff} onSelect={setProxyStaff} /></div>}
              <div style={{ margin: '10px 0' }}><Lbl>契約種別</Lbl><div style={{ display: 'flex', gap: 6 }}>{CONTRACT_TYPES.map(c => <button key={c.id} onClick={() => setContractType(c.id)} style={{ flex: 1, padding: 8, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: contractType === c.id ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.02)', color: contractType === c.id ? C.gold : C.mut, border: contractType === c.id ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>{c.icon} {c.name}</button>)}</div></div>
              <div style={{ marginBottom: 10 }}><Lbl>獲得店舗（イベント店を選ぶとイベント計上）</Lbl><Chips items={STORES} value={store} onSelect={setStore} /></div>
              <div style={{ marginBottom: 10 }}><Lbl>開通店舗（獲得店と違う場合のみ）</Lbl><select value={openStore} onChange={e => setOpenStore(e.target.value)} style={inp}><option value="">獲得店と同じ</option>{MAIN_STORES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <button onClick={() => setStep(2)} disabled={!canStep1} style={{ ...btnP, width: '100%', background: canStep1 ? C.gold : 'rgba(255,255,255,0.05)', color: canStep1 ? '#000' : C.mut2 }}>次へ →</button>
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>② 区分・機種（{curLine + 1}/{lines.length}台目）</div>
                {lines.length > 1 && <button onClick={() => rmLine(curLine)} style={{ fontSize: 9, color: C.red, background: 'rgba(248,113,113,0.1)', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>この台を削除</button>}
              </div>
              {lines.length > 1 && <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>{lines.map((_, i) => <button key={i} onClick={() => setCurLine(i)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 9, cursor: 'pointer', background: i === curLine ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.03)', color: i === curLine ? C.gold : C.mut2, border: 'none' }}>{i + 1}台目</button>)}</div>}
              <Lbl>大分類</Lbl><Chips items={MAIN_CAT} value={L.mainCat} onSelect={v => updLine({ mainCat: v, midCat: '', midCats: [] })} />
              {L.mainCat && <div style={{ marginTop: 10 }}><Lbl>{L.mainCat === 'MAIN_006' ? '中分類（複数選択可）' : '中分類'}</Lbl>
                {L.mainCat === 'MAIN_006'
                  ? <Chips items={filteredMid} multi selected={L.midCats} onSelect={v => { const cur = L.midCats || []; const next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]; updLine({ midCats: next, midCat: next[0] || '' }); }} />
                  : <Chips items={filteredMid} value={L.midCat} onSelect={v => updLine({ midCat: v, midCats: [v] })} />}
              </div>}
              {L.mainCat === 'MAIN_002' && <div style={{ marginTop: 10 }}><input value={L.direction || ''} onChange={e => updLine({ direction: e.target.value })} placeholder="乗換元 例:docomo→" style={inp} /></div>}
              <div style={{ marginTop: 10 }}><Lbl>メーカー</Lbl><select value={L.maker} onChange={e => updLine({ maker: e.target.value, model: '' })} style={{ ...inp, background: '#1a1625' }}><option value="">-- 選択 --</option>{MODELS.map(m => <option key={m.maker} value={m.maker}>{m.maker}</option>)}</select></div>
              {L.maker && <div style={{ marginTop: 8 }}><Lbl>機種</Lbl><select value={L.model} onChange={e => updLine({ model: e.target.value })} style={{ ...inp, background: '#1a1625' }}><option value="">-- 選択 --</option>{modelsByMaker(L.maker).map(m => <option key={m} value={m}>{m}</option>)}<option value="__custom__">✏️ その他（手入力）</option></select></div>}
              {L.model === '__custom__' && <input value={L.customModel || ''} onChange={e => updLine({ customModel: e.target.value })} placeholder="機種名を入力" style={{ ...inp, marginTop: 8 }} />}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button onClick={() => setStep(1)} style={btnG}>←</button><button onClick={() => setStep(3)} disabled={L.mainCat === 'MAIN_006' ? (L.midCats || []).length === 0 : !L.midCat} style={{ ...btnP, flex: 2, background: (L.mainCat === 'MAIN_006' ? (L.midCats || []).length > 0 : L.midCat) ? C.gold : 'rgba(255,255,255,0.05)', color: (L.mainCat === 'MAIN_006' ? (L.midCats || []).length > 0 : L.midCat) ? '#000' : C.mut2 }}>次へ →</button></div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 8 }}>③ プラン（複数選択可・任意）</div>
              <Chips items={PLANS} multi selected={L.plans} onSelect={v => toggleIn('plans', v)} />
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button onClick={() => setStep(2)} style={btnG}>←</button><button onClick={() => setStep(4)} style={{ ...btnP, flex: 2 }}>次へ →</button></div>
            </div>
          )}

          {step === 4 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 8 }}>④ オプション・契約情報</div>
              <Lbl>オプション</Lbl><Chips items={OPTS} multi selected={L.opts} onSelect={v => toggleIn('opts', v)} color={C.green} />
              {['MAIN_001', 'MAIN_002', 'MAIN_003', 'MAIN_004'].includes(L.mainCat) && (
                <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.25)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, marginBottom: 6 }}>🎯 退店時の必須対応（100%実施）</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => updLine({ pontaLink: !L.pontaLink })} style={{ flex: 1, padding: 10, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: L.pontaLink ? 'rgba(52,211,153,0.18)' : 'rgba(255,255,255,0.03)', color: L.pontaLink ? C.green : C.mut, border: L.pontaLink ? '1px solid rgba(52,211,153,0.45)' : '1px solid rgba(255,255,255,0.08)' }}>{L.pontaLink ? '✓ ' : ''}Ponta連携</button>
                    <button onClick={() => updLine({ mauLogin: !L.mauLogin })} style={{ flex: 1, padding: 10, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: L.mauLogin ? 'rgba(52,211,153,0.18)' : 'rgba(255,255,255,0.03)', color: L.mauLogin ? C.green : C.mut, border: L.mauLogin ? '1px solid rgba(52,211,153,0.45)' : '1px solid rgba(255,255,255,0.08)' }}>{L.mauLogin ? '✓ ' : ''}My au/UQログイン</button>
                  </div>
                  <div style={{ fontSize: 9, color: C.mut2, marginTop: 5, lineHeight: 1.5 }}>※ Ponta連携率70%・ログイン率80%が達成目標。両方の率がスコアに反映されます。</div>
                </div>
              )}
              {lineNeedsLineType(L) && (
                <div style={{ marginTop: 10, padding: 8, borderRadius: 8, background: 'rgba(56,189,248,0.08)', border: '1px solid ' + (L.lineType ? 'rgba(56,189,248,0.3)' : 'rgba(248,113,113,0.4)') }}>
                  <Lbl>📶 回線（でんき・PAYカード・ゴールド・じぶん銀行・Pontaパスは必須）</Lbl>
                  <div style={{ display: 'flex', gap: 6 }}>{[{ v: 'au', n: 'au' }, { v: 'uq', n: 'UQ' }].map(o => <button key={o.v} onClick={() => updLine({ lineType: o.v })} style={{ flex: 1, padding: 8, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: L.lineType === o.v ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.03)', color: L.lineType === o.v ? C.blue : C.mut, border: L.lineType === o.v ? '1px solid rgba(56,189,248,0.4)' : '1px solid rgba(255,255,255,0.05)' }}>{o.n}</button>)}</div>
                  {!L.lineType && <div style={{ fontSize: 9, color: C.red, marginTop: 4 }}>⚠️ 回線（au/UQ）を選んでください</div>}
                </div>
              )}
              {(L.opts || []).includes('OPT_124') && <div style={{ marginTop: 10 }}><Lbl>📋 FP面談予定日</Lbl><input type="date" value={L.fpDate || ''} onChange={e => updLine({ fpDate: e.target.value })} style={inp} /></div>}
              <div style={{ marginTop: 10 }}><Lbl>au+1collection金額（物販）</Lbl><input type="number" value={L.plus1c || ''} onChange={e => updLine({ plus1c: e.target.value })} placeholder="例: 15000" style={inp} /><input value={L.plus1cDetail || ''} onChange={e => updLine({ plus1cDetail: e.target.value })} placeholder="詳細（例: Norton4年版）" style={{ ...inp, marginTop: 4 }} /></div>
              <div style={{ marginTop: 8 }}><Lbl>店頭設定サポート都度払い</Lbl><input type="number" value={L.setupFee || ''} onChange={e => updLine({ setupFee: e.target.value })} placeholder="例: 3800" style={inp} /></div>
              <div style={{ marginTop: 8 }}><Lbl>キャッシュバック金額</Lbl><input type="number" value={L.cashback || ''} onChange={e => updLine({ cashback: e.target.value })} placeholder="例: 30000" style={inp} /></div>
              <div style={{ marginTop: 8 }}><input value={L.imei || ''} onChange={e => updLine({ imei: e.target.value })} placeholder="IMEI" style={inp} /><input value={L.iccid || ''} onChange={e => updLine({ iccid: e.target.value })} placeholder="ICCID" style={{ ...inp, marginTop: 4 }} /></div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}><input value={L.appNo || ''} onChange={e => updLine({ appNo: e.target.value })} placeholder="申込書番号" style={inp} /><input value={L.archNo || ''} onChange={e => updLine({ archNo: e.target.value })} placeholder="ARCH番号" style={inp} /></div>
              <div style={{ display: 'flex', gap: 6, marginTop: 16 }}><button onClick={() => setStep(3)} style={btnG}>←</button><button onClick={addLine} style={{ ...btnG, border: '1px dashed rgba(251,191,36,0.3)', color: C.gold, background: 'rgba(251,191,36,0.05)' }}>+ 台追加</button><button onClick={() => setStep(5)} style={btnP}>確認 →</button></div>
            </div>
          )}

          {step === 5 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 8 }}>⑤ 確認</div>
              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 10, padding: 12, fontSize: 11, color: C.w2, lineHeight: 1.9 }}>
                <div>区分: {ACQ_TYPES.find(a => a.id === acqType)?.name}{acqType === 'outsource' ? '（' + extName + '）' : acqType === 'proxy' ? '→' + proxyStaff : ''}</div>
                <div>獲得店: {storeName(store)}{isEventStore(store) ? '（イベント計上）' : ''}{openStore ? ' / 開通先: ' + storeName(openStore) : ''}</div>
                {lines.map((l, i) => (
                  <div key={i} style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <b style={{ color: C.gold }}>{i + 1}台目</b>: {MAIN_CAT.find(c => c.id === l.mainCat)?.name} → {l.mainCat === 'MAIN_006' ? (l.midCats || []).map(midName).join(', ') : midName(l.midCat)}
                    {l.lineType && <span style={{ marginLeft: 6, fontSize: 8, fontWeight: 700, borderRadius: 4, padding: '1px 5px', background: l.lineType === 'au' ? 'rgba(56,189,248,0.15)' : 'rgba(167,139,250,0.15)', color: l.lineType === 'au' ? C.blue : C.purple }}>{l.lineType.toUpperCase()}</span>}
                    {l.model && <span> / {l.model === '__custom__' ? l.customModel : l.model}</span>}
                    {l.plus1c ? <span> / 物販¥{Number(l.plus1c).toLocaleString()}</span> : null}
                  </div>
                ))}
              </div>
              {/* Ponta連携・ログイン誘導の未チェック警告 */}
              {(() => {
                if (contractType === 'corporate') return null; // 法人契約は対象外
                const MOBILE = ['MAIN_001', 'MAIN_002', 'MAIN_003', 'MAIN_004'];
                const mob = lines.filter(l => MOBILE.includes(l.mainCat));
                if (mob.length === 0) return null;
                const noPonta = mob.filter(l => !l.pontaLink).length;
                const noLogin = mob.filter(l => !l.mauLogin).length;
                if (noPonta === 0 && noLogin === 0) return null;
                return (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.35)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.red, marginBottom: 4 }}>⚠️ 退店時の必須対応 未チェック</div>
                    <div style={{ fontSize: 10, color: C.w2, lineHeight: 1.6 }}>
                      {noPonta > 0 && <div>・Ponta連携: <b style={{ color: C.red }}>{noPonta}件</b> 未チェック</div>}
                      {noLogin > 0 && <div>・My au/UQログイン誘導: <b style={{ color: C.red }}>{noLogin}件</b> 未チェック</div>}
                    </div>
                    <div style={{ fontSize: 9, color: C.mut, marginTop: 6 }}>※ 100%実施項目です。実施した場合は「戻って」チェックを入れてください</div>
                    <button onClick={() => setStep(4)} style={{ marginTop: 8, padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(248,113,113,0.12)', color: C.red, border: '1px solid rgba(248,113,113,0.3)' }}>← 戻ってチェックを入れる</button>
                  </div>
                );
              })()}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button onClick={() => setStep(4)} style={btnG}>←</button><button onClick={submit} disabled={saving} style={{ ...btnP, flex: 2, background: saving ? 'rgba(255,255,255,0.1)' : C.green, color: saving ? C.mut : '#000' }}>{saving ? '保存中…' : '✅ 報告する'}</button></div>
            </div>
          )}
        </div>
      ))}

      {tab === 'history' && (
        <div>
          {history.length === 0 && <div style={{ fontSize: 11, color: C.mut, textAlign: 'center', padding: 20 }}>まだ報告がありません</div>}
          {history.slice(0, 60).map(h => {
            const open = expandedId === h.id;
            const acqInfo = h.acqType === 'outsource' ? '👷' + h.extName : h.acqType === 'proxy' ? '🤝→' + h.proxyStaff : '🙋自己';
            return (
              <div key={h.id} style={{ borderRadius: 10, marginBottom: 6, background: h.counted === false ? 'rgba(248,113,113,0.03)' : 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', overflow: 'hidden' }}>
                <div onClick={() => setExpandedId(open ? null : h.id)} style={{ padding: 10, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.gold }}>{h.staffName || '名前未設定'}</span>
                    <span style={{ fontSize: 9, color: C.mut2 }}>{h.createdAt?.toDate?.()?.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) || ''}</span>
                  </div>
                  <div style={{ fontSize: 10, color: C.mut }}>{acqInfo} ｜ {h.storeName} ｜ {h.lineCount}台</div>
                  <div style={{ fontSize: 10, color: C.w2, marginTop: 2 }}>{(h.lines || []).map((l, i) => <span key={i}>{i > 0 ? ' / ' : ''}{l.midCatName}{l.lineType ? '(' + l.lineType.toUpperCase() + ')' : ''}</span>)}</div>
                </div>
                {open && (
                  <div style={{ padding: '0 10px 10px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    {(h.lines || []).map((l, i) => (
                      <div key={i} style={{ fontSize: 10, color: C.w2, marginTop: 6 }}>{i + 1}台目: {l.mainCatName} → {l.midCatName} {l.model || ''}{l.plus1c ? ' / 物販¥' + Number(l.plus1c).toLocaleString() : ''}</div>
                    ))}
                    {(() => { const cd = h.createdAt?.toDate?.(); const today = cd && cd.toDateString() === new Date().toDateString(); return (today && h.uid === user.uid) ? <button onClick={() => deleteReport(h.id)} style={{ width: '100%', marginTop: 8, padding: 8, borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: 'rgba(248,113,113,0.1)', color: C.red, border: '1px solid rgba(248,113,113,0.3)' }}>🗑 削除</button> : null; })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
