// =====================================================================
// lineMessage.js  ―― LINE通知文の生成（ここ1か所だけ）
// 現行の形式を踏襲しつつ、回線(au/UQ)の行を追加。1台＝1通。
// =====================================================================
import { MAIN_CAT, midName, planName, optName, midShort, optShort, planShort, storeShort, outShort, modelShort, carrierShort } from '../data/masters';

const stamp = (d = new Date()) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
  ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const hhmm = (d = new Date()) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const lineLabel = (lt) => lt === 'au' ? 'au回線' : lt === 'uq' ? 'UQ回線' : '';

// ★ compact（1台＝1行・略称・見出しなし）── 通常はこちらを使用
export function buildCompactMessages({ lines, acqType, staffName, extName, proxyStaff, storeId, openStoreId, isCorrection }) {
  const t = hhmm();
  const co = (extName || '').split(':')[0];
  const person = (extName || '').split(':')[1];
  const staffTok = acqType === 'outsource'
    ? '⚠外' + outShort(co) + (person ? '/' + person : '')
    : acqType === 'proxy'
      ? '代→' + (proxyStaff || '').replace(/\s/g, '')
      : (staffName || '').replace(/\s/g, '');
  const storeTok = storeShort(storeId) + (openStoreId && openStoreId !== storeId ? '→' + storeShort(openStoreId) : '');

  return (lines || []).map((l) => {
    const lt = l.lineType ? '(' + (l.lineType === 'au' ? 'au' : 'UQ') + ')' : '';
    const mids = (l.midCats && l.midCats.length > 1) ? l.midCats.map(midShort).join('+') : midShort(l.midCat);
    const contract = (l.direction || '') + mids + lt;
    const on = (l.opts || []).map(o => ({ n: optName(o), s: optShort(o) }));
    const hogo = on.filter(o => o.n.includes('故障') || o.n.includes('AppleCare') || o.n.includes('安心')).map(o => o.s);
    const ltv = on.filter(o => /(Netflix|YouTube|Apple Music|TELASA|Ponta|使い方|サポート定額|通話|家族割|PAYカード割|DAZN|Amazon|GeForce|自宅セット)/.test(o.n)).map(o => o.s);
    const model = l.model ? (l.model === '__custom__' ? (l.customModel || '') : l.model) : '';
    const plan = (l.plans || []).map(planShort).filter(Boolean).join('+');

    const p = [t, staffTok, storeTok, contract];
    if (model) p.push(model);
    if (plan) p.push(plan);
    if (hogo.length) p.push(hogo.join('+'));
    if (ltv.length) p.push(ltv.join('+'));
    if (l.plus1c) p.push('+1c¥' + Number(l.plus1c).toLocaleString() + (l.plus1cDetail ? '(' + l.plus1cDetail + ')' : ''));
    if (l.cashback) p.push('CB¥' + Number(l.cashback).toLocaleString());
    if (l.setupFee) p.push('設定¥' + Number(l.setupFee).toLocaleString());
    if ((l.opts || []).includes('OPT_124')) p.push('FP' + (l.fpDate ? l.fpDate.slice(5).replace('-', '/') : '未定'));
    const nums = [];
    if (l.appNo) nums.push('申:' + l.appNo);
    if (l.archNo) nums.push('ARCH:' + l.archNo);
    if (nums.length) p.push(nums.join(' '));

    let msg = (isCorrection ? '📝修正 ' : '') + p.join('｜');
    if (l.imei || l.iccid) msg += '\n' + [l.imei ? 'IMEI' + l.imei : '', l.iccid ? 'ICCID' + l.iccid : ''].filter(Boolean).join(' ');
    return msg;
  });
}

export function buildDeleteMessage({ staffName, mids }) {
  return '🗑削除 ' + hhmm() + ' ' + (staffName || '').replace(/\s/g, '') + '｜' + mids + '（修正のため再入力）';
}

// ★ 縦書き・前置きあり・略称で各行を短く（単語の途中改行を防ぐ）── 通常はこちらを使用
export function buildAcqMessages({ lines, acqType, staffName, extName, proxyStaff, storeId, openStoreId, isCorrection, monthlyRates }) {
  const co = (extName || '').split(':')[0];
  const person = (extName || '').split(':')[1];
  const acqLabel = acqType === 'outsource'
    ? '⚠外 ' + outShort(co) + (person ? ' ' + person : '')
    : acqType === 'proxy'
      ? '代理→' + (proxyStaff || '').replace(/\s/g, '')
      : (staffName || '').replace(/\s/g, '');
  const storeNm = storeShort(storeId);
  const openNm = (openStoreId && openStoreId !== storeId) ? storeShort(openStoreId) : '';

  return (lines || []).map((l) => {
    const mn = MAIN_CAT.find(c => c.id === l.mainCat)?.name || '';
    const mid = (l.midCats && l.midCats.length > 1) ? l.midCats.map(midShort).join('+') : midShort(l.midCat);
    const pn = (l.plans || []).map(planShort).filter(Boolean).join('・');
    const onN = (l.opts || []).map(o => ({ n: optName(o), s: optShort(o) }));
    const hogo = onN.filter(o => o.n.includes('故障') || o.n.includes('AppleCare') || o.n.includes('安心') || o.n.includes('サポートパック')).map(o => o.s);
    const ltvOps = onN.filter(o => /(Netflix|YouTube|Apple Music|TELASA|Ponta|使い方|サポート定額|通話|家族割|PAYカード割|DAZN|Amazon|GeForce|自宅セット)/.test(o.n)).map(o => o.s);
    const t = [];
    if (isCorrection) { t.push('📝【修正】再入力報告です。'); }
    else { t.push('お疲れ様です。'); t.push('獲得報告です。'); }
    t.push('');
    t.push('[' + stamp() + '] ' + acqLabel);
    t.push('種別：' + mn);
    t.push('契約：' + (l.direction ? carrierShort(l.direction) + '→' : '') + mid + (l.lineType ? '（' + (l.lineType === 'au' ? 'au' : 'UQ') + '）' : ''));
    t.push('店舗：' + storeNm + (openNm ? '→' + openNm : ''));
    if (l.model) { t.push('機種：' + (l.model === '__custom__' ? (l.customModel || '') : modelShort(l.model))); }
    if (l.deviceColor || l.deviceStorage) t.push('色容量：' + [l.deviceColor, l.deviceStorage].filter(Boolean).join(' '));
    if (pn) t.push('プラン：' + pn);
    if (hogo.length) t.push('保証：' + hogo.join('・'));
    if (ltvOps.length) t.push('LTV：' + ltvOps.join('・'));
    // モバイル契約のとき、退店時の必須対応（その契約の有無＋スタッフの月累計率）を追記
    const _isMobile = ['MAIN_001','MAIN_002','MAIN_003','MAIN_004'].includes(l.mainCat);
    if (_isMobile && monthlyRates) {
      const _TSUWA = ['OPT_101','OPT_102','OPT_103','OPT_104'];
      const _hasTsuwa = (l.opts || []).some(o => _TSUWA.includes(o));
      t.push('通話定額成：' + (_hasTsuwa ? '有' : '無') + ' / 月累計' + (monthlyRates.callFlat || 0) + '%');
      t.push('Ponta連携：' + (l.pontaLink ? 'OK' : 'NO') + ' / 月累計' + (monthlyRates.ponta || 0) + '%');
      t.push('My au/UQログイン：' + (l.mauLogin ? 'OK' : 'NO') + ' / 月累計' + (monthlyRates.login || 0) + '%');
    }
    if (l.plus1c) t.push('+1c：¥' + Number(l.plus1c).toLocaleString() + (l.plus1cDetail ? ' ' + l.plus1cDetail : ''));
    if (l.cashback) t.push('CB：¥' + Number(l.cashback).toLocaleString());
    if (l.setupFee) t.push('設定：¥' + Number(l.setupFee).toLocaleString());
    if ((l.opts || []).includes('OPT_124')) t.push('FP：' + (l.fpDate ? l.fpDate.slice(5).replace('-', '/') : '未定'));
    if (l.appNo) t.push('申:' + l.appNo);
    if (l.archNo) t.push('ARCH:' + l.archNo);
    if (l.imei) t.push('IMEI:' + l.imei);
    if (l.iccid) t.push('ICCID:' + l.iccid);
    return t.join('\n');
  });
}
