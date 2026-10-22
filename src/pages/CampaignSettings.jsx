// =====================================================================
// CampaignSettings.jsx ―― キャンペーン／お知らせ 設定（管理者専用）
// キャンペーンの中身をプログラムからデータへ移すための画面。
// ここで作った内容がホーム画面に表示される（ホーム側の接続は 2026-08-01 予定）。
// 作らなければ何も表示されない＝他社に配っても影響なし。
// 目印: campaignSettings
// =====================================================================
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDirectory } from '../contexts/DirectoryContext';
import { db } from '../firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { MAIN_CAT, MID_CAT } from '../data/masters';

const C = { gold: '#FBBF24', green: '#34D399', blue: '#38BDF8', purple: '#A78BFA', red: '#F87171', w: '#fff', w2: '#E2E8F0', mut: '#94A3B8', mut2: '#64748B' };
const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 10 };
const label = { fontSize: 10, color: C.mut, marginBottom: 4, display: 'block' };
const inp = { width: '100%', padding: 9, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 10 };
const btn = (bg, fg) => ({ padding: '10px 14px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', border: 'none', background: bg, color: fg });

const today = () => new Date().toISOString().slice(0, 10);
const yen = (n) => '¥' + Number(n || 0).toLocaleString();

const BLANK = () => ({
  id: '',
  active: true,
  name: '',
  start: today(),
  end: today(),
  perPerson: 6,
  companyTarget: 0,
  unit: { mnpDev: 10000, mnpSim: 5000, shinDev: 4000, shinSim: 2000 },
  excluded: [],
  excludedMids: [],
});

const UNIT_FIELDS = [
  ['mnpDev', 'MNP（端末あり）'],
  ['mnpSim', 'MNP（SIMのみ）'],
  ['shinDev', '新規（端末あり）'],
  ['shinSim', '新規（SIMのみ）'],
];

export default function CampaignSettings() {
  const { user, profile } = useAuth();
  const { staffNames } = useDirectory();
  const [tab, setTab] = useState('camp');
  const [camps, setCamps] = useState([]);
  const [anns, setAnns] = useState([]);
  const [draft, setDraft] = useState(null);
  const [annDraft, setAnnDraft] = useState(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    if (!user) return;
    const u1 = onSnapshot(collection(db, 'campaigns'), s =>
      setCamps(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.start || '').localeCompare(a.start || ''))));
    const u2 = onSnapshot(collection(db, 'announcements'), s =>
      setAnns(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.start || '').localeCompare(a.start || ''))));
    return () => { u1(); u2(); };
  }, [user]);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

  const state = (c) => {
    const t = today();
    if (c.active === false) return { txt: '停止中', color: C.mut2 };
    if (t < (c.start || '')) return { txt: '開始前', color: C.blue };
    if (t > (c.end || '')) return { txt: '終了', color: C.mut2 };
    return { txt: '実施中', color: C.green };
  };

  const saveCamp = async () => {
    if (!draft.name) { flash('❌ タイトルを入れてください'); return; }
    if (draft.end < draft.start) { flash('❌ 終了日が開始日より前です'); return; }
    setSaving(true);
    try {
      const id = draft.id || ('camp_' + Date.now());
      const { id: _drop, ...body } = draft;
      await setDoc(doc(db, 'campaigns', id), {
        ...body,
        perPerson: Number(draft.perPerson) || 0,
        companyTarget: Number(draft.companyTarget) || 0,
        unit: Object.fromEntries(UNIT_FIELDS.map(([k]) => [k, Number(draft.unit?.[k]) || 0])),
        updatedAt: new Date(),
        updatedBy: profile?.name || '',
      });
      setDraft(null);
      flash('✅ 保存しました');
    } catch (e) { flash('❌ ' + e.message); }
    setSaving(false);
  };

  const delCamp = async (c) => {
    if (!confirm('「' + c.name + '」を削除します。よろしいですか？')) return;
    try { await deleteDoc(doc(db, 'campaigns', c.id)); flash('✅ 削除しました'); }
    catch (e) { flash('❌ ' + e.message); }
  };

  const saveAnn = async () => {
    if (!annDraft.body) { flash('❌ 本文を入れてください'); return; }
    setSaving(true);
    try {
      const id = annDraft.id || ('ann_' + Date.now());
      const { id: _drop, ...body } = annDraft;
      await setDoc(doc(db, 'announcements', id), { ...body, updatedAt: new Date(), updatedBy: profile?.name || '' });
      setAnnDraft(null);
      flash('✅ 保存しました');
    } catch (e) { flash('❌ ' + e.message); }
    setSaving(false);
  };

  const delAnn = async (a) => {
    if (!confirm('このお知らせを削除します。よろしいですか？')) return;
    try { await deleteDoc(doc(db, 'announcements', a.id)); flash('✅ 削除しました'); }
    catch (e) { flash('❌ ' + e.message); }
  };

  const toggleIn = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  if (!isAdmin) return <div style={{ padding: 20, color: C.red }}>このページは管理者のみ閲覧できます</div>;

  return (
    <div style={{ padding: '8px 16px' }}>
      <h1 style={{ fontSize: 16, fontWeight: 900, color: C.w, marginBottom: 4 }}>📣 キャンペーン・お知らせ設定</h1>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 10, lineHeight: 1.5 }}>
        期間を決めて登録すると、その期間だけホーム画面に表示されます。期間が過ぎると自動で消えます。
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {[['camp', '🎯 キャンペーン', camps.length], ['ann', '📢 お知らせ', anns.length]].map(([id, t, n]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: '9px 6px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: tab === id ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.02)', color: tab === id ? C.gold : C.mut2, border: tab === id ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>
            {t}（{n}件）
          </button>
        ))}
      </div>

      {msg && <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, marginBottom: 8, color: msg.startsWith('✅') ? C.green : C.red }}>{msg}</div>}

      {/* ================= キャンペーン ================= */}
      {tab === 'camp' && !draft && (
        <>
          <button onClick={() => setDraft(BLANK())} style={{ ...btn(C.gold, '#000'), width: '100%', marginBottom: 12 }}>➕ キャンペーンを作る</button>
          {camps.length === 0 && (
            <div style={{ ...card, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: C.mut }}>まだキャンペーンはありません</div>
              <div style={{ fontSize: 10, color: C.mut2, marginTop: 4 }}>作らなければホーム画面には何も表示されません</div>
            </div>
          )}
          {camps.map(c => {
            const st = state(c);
            return (
              <div key={c.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 5, color: st.color, border: '1px solid ' + st.color }}>{st.txt}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: C.w }}>{c.name}</span>
                    </div>
                    <div style={{ fontSize: 10, color: C.mut }}>
                      {c.start} 〜 {c.end}　／　1人 {c.perPerson}件　／　全社 {c.companyTarget}件
                    </div>
                    <div style={{ fontSize: 10, color: C.mut2, marginTop: 2 }}>
                      単価 {UNIT_FIELDS.map(([k, l]) => l.replace('（', '').replace('）', '') + ' ' + yen(c.unit?.[k])).join(' / ')}
                    </div>
                    {(c.excluded?.length > 0 || c.excludedMids?.length > 0) && (
                      <div style={{ fontSize: 10, color: C.purple, marginTop: 2 }}>
                        対象外：{c.excluded?.length || 0}名 ／ 商材 {c.excludedMids?.length || 0}件
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button onClick={() => setDraft({ ...BLANK(), ...c, unit: { ...BLANK().unit, ...(c.unit || {}) }, excluded: c.excluded || [], excludedMids: c.excludedMids || [] })} style={btn('rgba(56,189,248,0.12)', C.blue)}>編集</button>
                    <button onClick={() => delCamp(c)} style={btn('rgba(248,113,113,0.1)', C.red)}>削除</button>
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {tab === 'camp' && draft && (
        <>
          <div style={card}>
            <label style={label}>タイトル（ホーム画面の見出しになります）</label>
            <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="例：全員で目標を達成させよう！" style={inp} />

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={label}>開始日</label>
                <input type="date" value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} style={inp} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={label}>終了日（この日まで表示）</label>
                <input type="date" value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} style={inp} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={label}>1人あたりの目標（件）</label>
                <input type="number" value={draft.perPerson} onChange={e => setDraft({ ...draft, perPerson: e.target.value })} style={inp} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={label}>全社目標（件）</label>
                <input type="number" value={draft.companyTarget} onChange={e => setDraft({ ...draft, companyTarget: e.target.value })} style={inp} />
              </div>
            </div>

            <label style={{ ...label, marginTop: 4 }}>1件あたりの金額</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {UNIT_FIELDS.map(([k, l]) => (
                <div key={k}>
                  <div style={{ fontSize: 9, color: C.mut2, marginBottom: 3 }}>{l}</div>
                  <input type="number" value={draft.unit?.[k] ?? 0} onChange={e => setDraft({ ...draft, unit: { ...draft.unit, [k]: e.target.value } })} style={inp} />
                </div>
              ))}
            </div>

            <label style={{ ...label, marginTop: 4 }}>
              対象外にする人（頭数から外す。新人など）　選択中 {draft.excluded.length}名
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, maxHeight: 200, overflowY: 'auto', padding: 6, borderRadius: 8, background: 'rgba(0,0,0,0.2)', marginBottom: 10 }}>
              {(staffNames || []).map(n => {
                const on = draft.excluded.includes(n.replace(/[\s\u3000]+/g, ''));
                return (
                  <button key={n} onClick={() => setDraft({ ...draft, excluded: toggleIn(draft.excluded, n.replace(/[\s\u3000]+/g, '')) })}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: 6, borderRadius: 6, cursor: 'pointer', textAlign: 'left', background: on ? 'rgba(167,139,250,0.14)' : 'rgba(255,255,255,0.02)', border: on ? '1px solid rgba(167,139,250,0.35)' : '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontSize: 10 }}>{on ? '🚫' : '✓'}</span>
                    <span style={{ fontSize: 10, color: on ? C.purple : C.w2 }}>{n}</span>
                  </button>
                );
              })}
            </div>

            <label style={{ ...label, marginTop: 4 }}>
              カウントしない商材　選択中 {draft.excludedMids.length}件
            </label>
            <div style={{ maxHeight: 240, overflowY: 'auto', padding: 6, borderRadius: 8, background: 'rgba(0,0,0,0.2)', marginBottom: 10 }}>
              {MAIN_CAT.map(mc => {
                const mids = MID_CAT.filter(m => m.main === mc.id);
                if (mids.length === 0) return null;
                return (
                  <div key={mc.id} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: C.mut, marginBottom: 3 }}>{mc.name}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      {mids.map(m => {
                        const on = draft.excludedMids.includes(m.id);
                        return (
                          <button key={m.id} onClick={() => setDraft({ ...draft, excludedMids: toggleIn(draft.excludedMids, m.id) })}
                            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: 5, borderRadius: 6, cursor: 'pointer', textAlign: 'left', background: on ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.02)', border: on ? '1px solid rgba(248,113,113,0.3)' : '1px solid rgba(255,255,255,0.04)' }}>
                            <span style={{ fontSize: 10 }}>{on ? '🚫' : '✓'}</span>
                            <span style={{ fontSize: 9.5, color: on ? C.red : C.w2, textDecoration: on ? 'line-through' : 'none' }}>{m.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <button onClick={() => setDraft({ ...draft, active: !draft.active })}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 10, borderRadius: 8, cursor: 'pointer', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ width: 36, height: 20, borderRadius: 10, background: draft.active ? C.green : '#475569', position: 'relative', flexShrink: 0 }}>
                <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: draft.active ? 18 : 2, transition: 'left .15s' }} />
              </div>
              <span style={{ fontSize: 11, color: C.w2 }}>{draft.active ? '有効（期間内なら表示）' : '停止中（表示しない）'}</span>
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setDraft(null)} style={{ ...btn('rgba(255,255,255,0.04)', C.mut), flex: 1 }}>キャンセル</button>
            <button onClick={saveCamp} disabled={saving} style={{ ...btn(saving ? 'rgba(255,255,255,0.1)' : C.gold, saving ? C.mut : '#000'), flex: 2 }}>{saving ? '保存中…' : '✓ 保存する'}</button>
          </div>
        </>
      )}

      {/* ================= お知らせ ================= */}
      {tab === 'ann' && !annDraft && (
        <>
          <button onClick={() => setAnnDraft({ id: '', active: true, title: '', body: '', start: today(), end: today(), style: 'info' })} style={{ ...btn(C.gold, '#000'), width: '100%', marginBottom: 12 }}>➕ お知らせを作る</button>
          {anns.length === 0 && (
            <div style={{ ...card, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: C.mut }}>まだお知らせはありません</div>
            </div>
          )}
          {anns.map(a => {
            const st = state(a);
            return (
              <div key={a.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 5, color: st.color, border: '1px solid ' + st.color }}>{st.txt}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: C.w }}>{a.title || '(見出しなし)'}</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.w2, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{a.body}</div>
                    <div style={{ fontSize: 10, color: C.mut2, marginTop: 3 }}>{a.start} 〜 {a.end}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button onClick={() => setAnnDraft({ ...a })} style={btn('rgba(56,189,248,0.12)', C.blue)}>編集</button>
                    <button onClick={() => delAnn(a)} style={btn('rgba(248,113,113,0.1)', C.red)}>削除</button>
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {tab === 'ann' && annDraft && (
        <>
          <div style={card}>
            <label style={label}>見出し（任意）</label>
            <input value={annDraft.title} onChange={e => setAnnDraft({ ...annDraft, title: e.target.value })} placeholder="例：8月の全体会議について" style={inp} />
            <label style={label}>本文</label>
            <textarea value={annDraft.body} onChange={e => setAnnDraft({ ...annDraft, body: e.target.value })} rows={4} placeholder="スタッフ全員に伝えたい内容" style={{ ...inp, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={label}>表示開始日</label>
                <input type="date" value={annDraft.start} onChange={e => setAnnDraft({ ...annDraft, start: e.target.value })} style={inp} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={label}>表示終了日</label>
                <input type="date" value={annDraft.end} onChange={e => setAnnDraft({ ...annDraft, end: e.target.value })} style={inp} />
              </div>
            </div>
            <label style={label}>見た目</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              {[['info', 'ふつう', C.blue], ['warn', '注意', C.gold], ['good', 'お祝い', C.green]].map(([k, l, col]) => (
                <button key={k} onClick={() => setAnnDraft({ ...annDraft, style: k })} style={{ flex: 1, padding: 9, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: annDraft.style === k ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)', color: col, border: annDraft.style === k ? '1px solid ' + col : '1px solid rgba(255,255,255,0.05)' }}>{l}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setAnnDraft(null)} style={{ ...btn('rgba(255,255,255,0.04)', C.mut), flex: 1 }}>キャンセル</button>
            <button onClick={saveAnn} disabled={saving} style={{ ...btn(saving ? 'rgba(255,255,255,0.1)' : C.gold, saving ? C.mut : '#000'), flex: 2 }}>{saving ? '保存中…' : '✓ 保存する'}</button>
          </div>
        </>
      )}

      <div style={{ fontSize: 9, color: C.mut2, marginTop: 12, lineHeight: 1.7 }}>
        ※ ホーム画面への表示は 2026年8月1日 の更新で有効になります。それまでは登録しても表示されません（7月のキャンペーンは現在プログラム側で動作中）。<br />
        ※ 期間外・停止中のものは自動的に非表示になります。手作業で消す必要はありません。
      </div>
    </div>
  );
}
