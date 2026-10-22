// =====================================================================
// botMessage.js ―― BOT送信用の日次進捗テキスト生成
// 現行Admin.jsxのsendToBotロジックを新システム用に再構築
// =====================================================================
import { MAIN_CAT, midName, storeShort } from '../data/masters';

const normName = (n) => (n || '?').replace(/[\s　]+/g, '').replace('香央里', '香央理');
const acqLabel = (r) => r.acqType === 'outsource' ? (r.extName || '外注') :
                       r.acqType === 'proxy' ? (r.proxyStaff || '') :
                       (r.staffName || '?');

// 大分類の短縮形
const MC_SHORT = {
  '新規': '新規',
  'MNP': 'MNP',
  '機種変更': '機変',
  'アップセル': 'UP',
  'その他': '他',
  '金融・コンテンツ': '金融',
};

// midShort用のかぶり辞書（旧BOT送信用の短縮形）
const MID_SHORT_BOT = {
  'au PAYゴールド': 'ゴールド',
  'au PAYG_RU': 'ランクアップ',
  'au PAY カード': 'シルバー',
  'auじぶん銀行': 'じ銀',
  'auでんき': 'でんき',
  'YouTube Premium': 'YT',
  'Apple Music': 'AM',
  'Netflix': 'NF',
  'TELASA': 'TEL',
  'Google AI Pro': 'GAI',
  'おうちサポート': 'おうち',
  'わんにゃんサポート': 'わんにゃん',
  'auホームでんき': 'でんき',
  '自転車サポート': '自転車',
  '店頭サポート定額': 'サポ定',
  'アクセサリー': 'ACC',
  'Apple製品': 'Apple',
  'FPトス': 'FP',
  'Amazonプライム': 'Amz',
  '保証': '保証',
  '持込保証': '持保',
  'UQ番号移行': '番移',
  'UQ番号移行(リクープ)': '番移R',
  'auひかり': '光',
  'ビッグローブ光': 'BL',
  'WiMAX': 'WX',
};
const midShortBot = (midNameStr) => {
  for (const [k, v] of Object.entries(MID_SHORT_BOT)) {
    if ((midNameStr || '').includes(k)) return v;
  }
  return midNameStr || '?';
};

// 集計対象外（ノイズ除去）：UQリクープ、タブレット新規 は本文の⭐リストから除外
// O19〜59の新規（au/UQ・H/S・持込）はキャンペーン・目標の対象外なので、実績の件数と⭐リストから必ず除外（2026-09-25）
const O19_MIDS = ['MID_003', 'MID_004', 'MID_009', 'MID_010', 'MID_015'];
const EXCLUDE_FROM_LIST = ['MID_057', 'MID_016', ...O19_MIDS];

/**
 * 日次進捗BOTメッセージを生成
 * @param {Array} reports - Firestoreから読み込んだreports
 * @param {Date} targetDate - 対象日（その日0:00〜翌0:00を集計）
 * @returns {string} BOT送信用テキスト
 */
export function buildBotProgressMessage(reports, targetDate = new Date()) {
  const t0 = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const t1 = new Date(t0); t1.setDate(t1.getDate() + 1);
  const now = new Date();

  const fil = reports.filter(r => {
    const d = r.createdAt?.toDate?.();
    return d && d >= t0 && d < t1;
  });

  // 大分類別カウント
  const mcCount = {};
  fil.forEach(r => (r.lines || []).forEach(l => {
    if (EXCLUDE_FROM_LIST.includes(l.midCat)) return;
    const mc = l.mainCatName || MAIN_CAT.find(c => c.id === l.mainCat)?.name || '?';
    mcCount[mc] = (mcCount[mc] || 0) + 1;
  }));

  const lines = [];
  lines.push('📊 日次進捗(' + (t0.getMonth() + 1) + '/' + t0.getDate() + ') ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'));
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('■ 実績');
  const mcLine = MAIN_CAT.map(mc => {
    const cnt = mcCount[mc.name] || 0;
    if (cnt === 0) return null;
    const unit = ['MAIN_005', 'MAIN_006'].includes(mc.id) ? '件' : '台';
    return (MC_SHORT[mc.name] || mc.name) + cnt + unit;
  }).filter(Boolean).join(' ');
  lines.push('・' + (mcLine || 'まだ実績なし'));
  lines.push('');

  // 大分類ごとの⭐リスト
  MAIN_CAT.forEach(mc => {
    const reps = fil.filter(r => (r.lines || []).some(l => (l.mainCatName || MAIN_CAT.find(c => c.id === l.mainCat)?.name) === mc.name && !EXCLUDE_FROM_LIST.includes(l.midCat)));
    if (reps.length === 0) return;
    lines.push('●' + (MC_SHORT[mc.name] || mc.name));
    reps.forEach(r => {
      (r.lines || []).forEach(l => {
        const mcName = l.mainCatName || MAIN_CAT.find(c => c.id === l.mainCat)?.name;
        if (mcName !== mc.name) return;
        if (EXCLUDE_FROM_LIST.includes(l.midCat)) return;
        if (!l.midCat) return;
        const shop = storeShort(r.storeId);
        const who = acqLabel(r);
        if (mc.name === 'その他' || mc.name === '金融・コンテンツ') {
          const detail = midShortBot(l.midCatName || midName(l.midCat));
          lines.push('⭐' + who + '/' + shop + '/' + detail);
        } else {
          lines.push('⭐' + who + '/' + shop + '/' + (MC_SHORT[mc.name] || mc.name));
        }
      });
    });
  });

  // タブレット新規（独立セクション）
  const tabReps = fil.filter(r => (r.lines || []).some(l => l.midCat === 'MID_016'));
  if (tabReps.length > 0) {
    lines.push('●タブレット');
    tabReps.forEach(r => {
      (r.lines || []).forEach(l => {
        if (l.midCat !== 'MID_016') return;
        const shop = storeShort(r.storeId);
        const who = acqLabel(r);
        lines.push('⭐' + who + '/' + shop + '/タブ新規');
      });
    });
  }

  lines.push('------------------------');

  // プラワン集計（スタッフ別）
  const plus1Staff = {};
  fil.forEach(r => (r.lines || []).forEach(l => {
    if (l.plus1c && Number(l.plus1c) > 0) {
      const nm = r.acqType === 'outsource' ? (r.extName || '外注') : normName(r.acqType === 'proxy' ? r.proxyStaff : r.staffName);
      plus1Staff[nm] = (plus1Staff[nm] || 0) + Number(l.plus1c);
    }
  }));
  const plus1Total = Object.values(plus1Staff).reduce((s, v) => s + v, 0);
  if (plus1Total > 0) {
    lines.push('■ プラワン: ¥' + plus1Total.toLocaleString());
    Object.entries(plus1Staff).sort((a, b) => b[1] - a[1]).forEach(([nm, amt]) => {
      lines.push('  ' + nm + ': ¥' + amt.toLocaleString());
    });
  }

  // +1C単価（総販ベース）
  const souhanMains = ['MAIN_001', 'MAIN_002', 'MAIN_003', 'MAIN_004'];
  let souhanTotal = 0;
  const souhanStaff = {};
  fil.filter(r => r.counted !== false).forEach(r => {
    const nm = normName(r.acqType === 'proxy' ? r.proxyStaff : r.staffName);
    (r.lines || []).forEach(l => {
      if (souhanMains.includes(l.mainCat) && !O19_MIDS.includes(l.midCat)) {   // O19〜59は総販からも除外
        souhanTotal++;
        souhanStaff[nm] = (souhanStaff[nm] || 0) + 1;
      }
    });
  });
  if (souhanTotal > 0 && plus1Total > 0) {
    const avgTanka = Math.round(plus1Total / souhanTotal);
    lines.push('');
    lines.push('■ +1C単価: ¥' + avgTanka.toLocaleString() + '/台' + (avgTanka >= 25000 ? ' ✅' : ' ⚠️目標¥25,000'));
    lines.push('  スタッフ別:');
    Object.entries(souhanStaff).sort((a, b) => b[1] - a[1]).forEach(([nm, cnt]) => {
      const p1 = plus1Staff[nm] || 0;
      const t = cnt > 0 ? Math.round(p1 / cnt) : 0;
      lines.push('  ' + nm + ': ¥' + t.toLocaleString() + '/台(' + cnt + '台)' + (t >= 25000 ? ' ✅' : ''));
    });
  }

  lines.push('━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}
