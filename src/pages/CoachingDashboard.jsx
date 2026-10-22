// =============================================================
// src/pages/CoachingDashboard.jsx
// 経営者ダッシュボード（Phase 2）
//  ① リアルタイム活動フィード
//  ② スタッフ別一覧（店舗フィルタ）
//  ③ 個別レーダーチャート（強み/苦手/未挑戦）＋ カルテ閲覧 ＋ 強化推奨 ＋ 軽いリアクション
//
// アクセス：管理者（masters.js の ADMINS）のみ。
// データ：plus-ver05 の Firestore（declarations / users / recommendations）。
// declarations は氏名(staffName)で持つため、氏名で users と突き合わせる。
// 追加ライブラリ不要（レーダーは自前のSVG）。
// =============================================================

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ADMINS } from '../data/masters';
import {
  STORES,
  TACTICS,
  currentMonth,
  fetchStaff,
  fetchDeclarations,
  groupDeclarationsByName,
  buildRadar,
  buildActivityFeed,
  reviewView,
  staffSelfRating,
  karuteStatus,
  timeAgo,
} from '../lib/dashboard';
import {
  addRecommendation,
  listRecommendations,
  addReaction,
} from '../lib/recommendations';

const C = {
  bg: '#f6f7f9',
  card: '#ffffff',
  line: '#e6e8ec',
  text: '#1f2733',
  sub: '#6b7280',
  brand: '#2563eb',
  strong: '#2563eb',
  weak: '#ef4444',
  none: '#cbd5e1',
  chipBg: '#eef2ff',
};

// ---------- 自前レーダーチャート（SVG） ----------
function Radar({ data, size = 280 }) {
  const ids = Object.keys(data);
  const n = ids.length;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 46;
  if (n < 3) {
    return (
      <div style={{ color: C.sub, fontSize: 13, padding: 20 }}>
        レーダー表示には3つ以上の戦術が必要です。
      </div>
    );
  }
  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i, ratio) => {
    const a = angle(i);
    return [cx + Math.cos(a) * r * ratio, cy + Math.sin(a) * r * ratio];
  };
  const rings = [0.25, 0.5, 0.75, 1].map((ratio) =>
    ids.map((_, i) => point(i, ratio).join(',')).join(' ')
  );
  const dataPts = ids
    .map((id, i) => {
      const s = data[id].score;
      const ratio = s == null ? 0.04 : Math.max(0.04, Math.min(1, s / 100));
      return point(i, ratio).join(',');
    })
    .join(' ');
  const dotColor = (id) => {
    const d = data[id];
    if (!d.tried || d.score == null) return C.none;
    if (d.score >= 70) return C.strong;
    if (d.score < 40) return C.weak;
    return '#f59e0b';
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      {rings.map((pts, idx) => (
        <polygon key={idx} points={pts} fill="none" stroke={C.line} strokeWidth="1" />
      ))}
      {ids.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={C.line} strokeWidth="1" />;
      })}
      <polygon points={dataPts} fill="rgba(37,99,235,0.14)" stroke={C.brand} strokeWidth="2" />
      {ids.map((id, i) => {
        const s = data[id].score;
        const ratio = s == null ? 0.04 : Math.max(0.04, Math.min(1, s / 100));
        const [x, y] = point(i, ratio);
        return <circle key={id} cx={x} cy={y} r="4" fill={dotColor(id)} />;
      })}
      {ids.map((id, i) => {
        const [x, y] = point(i, 1.16);
        const anchor = Math.abs(x - cx) < 8 ? 'middle' : x > cx ? 'start' : 'end';
        return (
          <text
            key={'l' + id}
            x={x}
            y={y}
            fontSize="10.5"
            fill={C.text}
            textAnchor={anchor}
            dominantBaseline="middle"
          >
            {data[id].label}
          </text>
        );
      })}
    </svg>
  );
}

// ---------- メイン ----------
export default function CoachingDashboard() {
  const auth = useAuth ? useAuth() : {};
  const profile = auth?.profile || auth?.user || {};
  const myName = profile?.name || profile?.displayName || '';
  const isAdmin = Array.isArray(ADMINS) && ADMINS.includes(myName);

  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState([]);
  const [declarations, setDeclarations] = useState([]);
  const [storeFilter, setStoreFilter] = useState('全店');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [s, d] = await Promise.all([fetchStaff(), fetchDeclarations(month)]);
        if (!alive) return;
        setStaff(s);
        setDeclarations(d);
      } catch (e) {
        console.error('dashboard load error', e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [month, isAdmin]);

  // 氏名 → 店舗
  const staffByName = useMemo(() => {
    const m = {};
    staff.forEach((s) => (m[s.name] = s));
    return m;
  }, [staff]);

  // 氏名で宣言をまとめる
  const decByName = useMemo(
    () => groupDeclarationsByName(declarations),
    [declarations]
  );

  const feed = useMemo(
    () => buildActivityFeed(declarations, staffByName),
    [declarations, staffByName]
  );

  const visibleStaff = useMemo(() => {
    let list = staff;
    if (storeFilter !== '全店') list = list.filter((s) => s.store === storeFilter);
    return [...list].sort((a, b) => (a.store || '').localeCompare(b.store || ''));
  }, [staff, storeFilter]);

  if (!isAdmin) {
    return <div style={{ padding: 24, color: C.sub }}>この画面は管理者専用です。</div>;
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text }}>
      <div
        style={{
          padding: '16px 16px 8px',
          position: 'sticky',
          top: 0,
          background: C.bg,
          zIndex: 5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>👀 経営者ダッシュボード</h2>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 8px', fontSize: 13 }}
          />
        </div>
        <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>
          指示でも放置でもなく、問いかけのための画面です。
        </div>
      </div>

      {loading && <div style={{ padding: 24, color: C.sub }}>読み込み中…</div>}

      {!loading && (
        <div style={{ padding: '0 16px 80px' }}>
          {/* ① 活動フィード */}
          <Section title="① 最近の動き">
            {feed.length === 0 && <Empty text="まだカルテの動きがありません。" />}
            {feed.slice(0, 12).map((f) => (
              <div
                key={f.id}
                style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.line}` }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {f.name}
                    <span style={{ color: C.sub, fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                      {f.store}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 2 }}>
                    {f.kind}
                    {f.tacticLabels ? `（${f.tacticLabels}）` : ''}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: C.sub, whiteSpace: 'nowrap' }}>{timeAgo(f.at)}</div>
              </div>
            ))}
          </Section>

          {/* ② スタッフ別一覧 */}
          <Section title="② スタッフ別一覧">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {['全店', ...STORES].map((s) => (
                <button
                  key={s}
                  onClick={() => setStoreFilter(s)}
                  style={{
                    border: `1px solid ${storeFilter === s ? C.brand : C.line}`,
                    background: storeFilter === s ? C.chipBg : '#fff',
                    color: storeFilter === s ? C.brand : C.text,
                    borderRadius: 999,
                    padding: '5px 12px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>

            {visibleStaff.map((s) => {
              const decs = decByName[s.name] || [];
              const st = karuteStatus(decs);
              const rating = staffSelfRating(decs);
              const stage = !st.declared ? { label: '未記入', color: C.none }
                : st.review ? { label: '総括済み', color: '#34D399' }
                : st.progress ? { label: '振り返り中', color: '#FBBF24' }
                : { label: '宣言のみ', color: '#60A5FA' };
              return (
                <div
                  key={s.id}
                  onClick={() => setSelected(s)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '11px 0',
                    borderBottom: `1px solid ${C.line}`,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: C.sub }}>{s.store}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: stage.color }}>{stage.label}</span>
                    <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                      {st.declared && <span style={{ fontSize: 9, color: C.sub }}>{st.count}件</span>}
                      {st.hasBad && <span style={{ fontSize: 9, fontWeight: 700, color: '#FB923C' }}>課題✓</span>}
                    </span>
                  </div>
                  <div style={{ fontSize: 16, width: 24, textAlign: 'center' }}>{rating}</div>
                  <div style={{ color: C.sub }}>›</div>
                </div>
              );
            })}
          </Section>
        </div>
      )}

      {selected && (
        <StaffPanel
          staff={selected}
          declarations={decByName[selected.name] || []}
          month={month}
          fromName={myName}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 12,
        padding: 14,
        marginTop: 12,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ color: C.sub, fontSize: 13, padding: '8px 0' }}>{text}</div>;
}

// ---------- 個別パネル ----------
function StaffPanel({ staff, declarations, month, fromName, onClose }) {
  const radar = useMemo(() => buildRadar(declarations), [declarations]);
  const latest = declarations[declarations.length - 1] || null;
  const rv = latest ? reviewView(latest) : null;

  const [note, setNote] = useState('');
  const [pickedTag, setPickedTag] = useState(null);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let alive = true;
    listRecommendations(staff.id)
      .then((h) => alive && setHistory(h))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [staff.id]);

  const sendRecommendation = async () => {
    if (!pickedTag) {
      setMsg('まず強化したい戦術を1つ選んでください。');
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      await addRecommendation({
        staffId: staff.id,
        staffName: staff.name,
        tagId: pickedTag.id,
        tagLabel: pickedTag.label,
        note,
        fromName,
        month,
      });
      setMsg('✅ 推奨を届けました。');
      setNote('');
      setPickedTag(null);
      setHistory(await listRecommendations(staff.id));
    } catch (e) {
      setMsg('保存に失敗しました。通信を確認してください。');
    } finally {
      setSaving(false);
    }
  };

  const react = async (emoji) => {
    try {
      await addReaction({ staffId: staff.id, declarationId: latest?.id || null, emoji, fromName, month });
      setMsg(`${emoji} を送りました。`);
    } catch (e) {
      setMsg('送信に失敗しました。');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          width: '100%',
          maxWidth: 560,
          maxHeight: '92vh',
          overflowY: 'auto',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{staff.name}</div>
            <div style={{ fontSize: 12, color: C.sub }}>
              {staff.store} ／ {month}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ border: 'none', background: '#f1f5f9', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}
          >
            閉じる
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <Radar data={radar} />
        </div>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', fontSize: 11, color: C.sub }}>
          <span><span style={{ color: C.strong }}>●</span> 強み</span>
          <span><span style={{ color: '#f59e0b' }}>●</span> 途中</span>
          <span><span style={{ color: C.weak }}>●</span> 苦手</span>
          <span><span style={{ color: C.none }}>●</span> 未挑戦</span>
        </div>

        {latest && Array.isArray(latest.tactics) && latest.tactics.length > 0 && (
          <div style={{ marginTop: 14, background: C.bg, borderRadius: 10, padding: 12, fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>🎯 今月の目標（宣言）</div>
            {latest.tactics.map((t, i) => (
              <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: i < latest.tactics.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                <div style={{ fontWeight: 700, color: C.strong, marginBottom: 2 }}>
                  {t.name || '（戦術名なし）'}{t.quantity ? ` ／ 目標 ${t.quantity}${t.unit || ''}` : ''}
                </div>
                <KV k="お客様の不安" v={t.selectedReason || '—'} />
                <KV k="提供する価値" v={t.providedValue || '—'} />
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 14, background: C.bg, borderRadius: 10, padding: 12, fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>📒 今月の振り返り</div>
          {!latest && <div style={{ color: C.sub }}>まだ記入がありません。</div>}
          {latest && rv && (
            <>
              <KV k="自己評価" v={rv.selfRating} />
              <KV k="良かったこと" v={rv.goodPoints} />
              <KV k="課題点（ダメだったこと）" v={rv.badPoints} />
              <KV k="学んだこと" v={rv.learned} />
              <KV k="来月への伝言" v={rv.nextMemo} />
            </>
          )}
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: C.sub }}>反応：</span>
          {['👍', '🔥', '💡'].map((e) => (
            <button
              key={e}
              onClick={() => react(e)}
              style={{
                border: `1px solid ${C.line}`,
                background: '#fff',
                borderRadius: 999,
                fontSize: 18,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
            >
              {e}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>🎯 来月の強化推奨を送る</div>
          <div style={{ fontSize: 12, color: C.sub, margin: '4px 0 8px' }}>
            戦術を1つ選び、ひとことコメント（任意）。スタッフは次月の宣言画面で参考として見ます。
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TACTICS.map((t) => (
              <button
                key={t.id}
                onClick={() => setPickedTag(t)}
                style={{
                  border: `1px solid ${pickedTag?.id === t.id ? C.brand : C.line}`,
                  background: pickedTag?.id === t.id ? C.chipBg : '#fff',
                  color: pickedTag?.id === t.id ? C.brand : C.text,
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ひとこと（任意）例：先月の固定が伸びていたので、来月はマネ活と組み合わせてみては？"
            rows={2}
            style={{
              width: '100%',
              marginTop: 8,
              border: `1px solid ${C.line}`,
              borderRadius: 8,
              padding: 8,
              fontSize: 13,
              boxSizing: 'border-box',
              resize: 'vertical',
            }}
          />
          <button
            onClick={sendRecommendation}
            disabled={saving}
            style={{
              marginTop: 8,
              width: '100%',
              border: 'none',
              background: C.brand,
              color: '#fff',
              borderRadius: 10,
              padding: '11px',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? '送信中…' : '推奨として届ける'}
          </button>
          {msg && <div style={{ marginTop: 8, fontSize: 13, color: C.brand }}>{msg}</div>}
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>これまでに送った推奨</div>
          {history.length === 0 && <Empty text="まだありません。" />}
          {history.map((h) => (
            <div key={h.id} style={{ borderBottom: `1px solid ${C.line}`, padding: '8px 0', fontSize: 13 }}>
              <div>
                <strong>{h.tagLabel || h.tagId}</strong>
                <span style={{ color: C.sub, fontSize: 12, marginLeft: 6 }}>{h.month || ''}</span>
              </div>
              {h.note && <div>{h.note}</div>}
              {h.staffResponse && (
                <div style={{ color: C.brand, fontSize: 12 }}>スタッフの反応：{h.staffResponse}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
      <div style={{ width: 92, color: C.sub, flexShrink: 0 }}>{k}</div>
      <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{v}</div>
    </div>
  );
}
