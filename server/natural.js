// 自然语言解析：中文/英文时间、重复规则、优先级、标签、@人、工时、阻塞
// 返回 { cleanTitle, startAt, dueAt, allDay, priority, tags, repeat, estimateHours, blocked, mentions, matched }

import { dateStr, addDaysStr, pad2, parseDate } from './util.js';

const CN_NUM = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function cnNum(s) {
  if (/^\d+$/.test(s)) return +s;
  if (s.length === 1) return CN_NUM[s] ?? null;
  if (s.startsWith('十')) return 10 + (CN_NUM[s[1]] ?? 0);
  if (s.endsWith('十')) return (CN_NUM[s[0]] ?? 0) * 10;
  if (s.includes('十')) {
    const [a, b] = s.split('十');
    return (CN_NUM[a] ?? 0) * 10 + (CN_NUM[b] ?? 0);
  }
  return null;
}
const cnDigits = '零一二两三四五六七八九十';
const WD_CN = ['日', '一', '二', '三', '四', '五', '六'];

export function parseNatural(input, opts = {}) {
  const base = opts.base || dateStr();
  const b = parseDate(base);
  const out = {
    cleanTitle: String(input || '').trim(),
    startAt: null,
    dueAt: null,
    allDay: false,
    priority: null,
    tags: [],
    repeat: null,
    estimateHours: null,
    blocked: false,
    blockedReason: null,
    mentions: [],
    confidence: 0,
    matched: [],
  };
  if (!input) return out;
  let text = String(input);
  const matched = [];
  const eat = (m) => {
    matched.push(m.trim());
    text = text.replace(m, ' ');
  };

  // ---------- 1. 重复规则（长模式优先） ----------
  const repeatRules = [
    [/每(?:个)?工作日|每工作日/i, { kind: 'weekdays', count: 20 }],
    [/每两(?:个)?周|隔周|每两周|biweekly/i, { kind: 'biweekly', count: 10 }],
    [new RegExp(`每周[${cnDigits}]`), { kind: 'weekly', count: 12 }],
    [/每周|每星期|weekly/i, { kind: 'weekly', count: 12 }],
    [/每天|每日|each\s*day|daily/i, { kind: 'daily', count: 20 }],
    [/每月|monthly/i, { kind: 'monthly', count: 12 }],
  ];
  for (const [re, rule] of repeatRules) {
    const m = text.match(re);
    if (m) {
      out.repeat = { ...rule };
      const wd = m[0].match(new RegExp(`[${cnDigits}]`));
      if (wd && /每周|每星期/.test(m[0])) out.repeat.weekday = WD_CN.indexOf(wd[0]);
      eat(m[0]);
      break;
    }
  }

  // ---------- 2. 优先级 ----------
  for (const [re, p] of [
    [/\bP0\b|P0级|紧急|火线|特急|!{3}/i, 'urgent'],
    [/\bP1\b|P1级|高优|重要|!{2}/i, 'high'],
    [/\bP2\b|P2级|普通/i, 'med'],
    [/\bP3\b|P3级|有空再|低优/i, 'low'],
  ]) {
    const m = text.match(re);
    if (m) {
      out.priority = p;
      eat(m[0]);
      break;
    }
  }

  // ---------- 3. 标签 / @人 ----------
  for (const m of text.matchAll(/[#＃]([^\s#＃@]{1,20})/g)) out.tags.push(m[1]);
  text = text.replace(/[#＃][^\s#＃@]{1,20}/g, ' ');
  for (const m of text.matchAll(/[@＠]([^\s@＠]{1,20})/g)) out.mentions.push(m[1]);
  text = text.replace(/[@＠][^\s@＠]{1,20}/g, ' ');

  // ---------- 4. 预估工时 ----------
  const est = text.match(/[~约]?\s*(\d+(?:\.\d+)?)\s*(?:个)?\s*(小时|小時|h|H|hr|HR)/);
  if (est) {
    out.estimateHours = Math.round(parseFloat(est[1]) * 100) / 100;
    eat(est[0]);
  }
  if (!out.estimateHours) {
    const estM = text.match(/(\d+(?:\.\d+)?)\s*(分钟|min|mins)\b/i);
    if (estM) {
      out.estimateHours = Math.round((parseFloat(estM[1]) / 60) * 100) / 100;
      eat(estM[0]);
    }
  }

  // ---------- 5. 阻塞 ----------
  const blocked = text.match(/(阻塞|卡住|blocked|等待中|被挡)/i);
  if (blocked) {
    out.blocked = true;
    out.blockedReason = blocked[0];
    eat(blocked[0]);
  }

  // ---------- 6. 周几（连同「下周/本周/上周」前缀一并匹配，避免前缀吃掉「周」字） ----------
  let relDate = null;
  const wdM = text.match(new RegExp(`(本|这|下下|下|上)?\\s*(?:周|星期|礼拜)\\s*([${cnDigits}])`));
  if (wdM) {
    const prefix = wdM[1] || '';
    const raw = WD_CN.indexOf(wdM[2]); // 0=周日
    const targetIdx = raw === 0 ? 6 : raw - 1; // 周一=0 … 周日=6
    const todayIdx = (b.getDay() + 6) % 7;
    let delta;
    if (prefix === '下') delta = 7 - todayIdx + targetIdx;
    else if (prefix === '下下') delta = 14 - todayIdx + targetIdx;
    else if (prefix === '上') delta = targetIdx - todayIdx - 7;
    else {
      delta = targetIdx - todayIdx;
      if (delta < 0) delta += 7; // 无前缀取最近的将来（含今天）
    }
    relDate = addDaysStr(base, delta);
    eat(wdM[0]);
  }

  // ---------- 7. 绝对日期 ----------
  if (!relDate) {
    for (const re of [
      /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/,
      /(\d{1,2})[-/月](\d{1,2})日?(?![0-9])/,
      /(?:^|[^\d])(\d{1,2})日(?![0-9])/,
    ]) {
      const m = text.match(re);
      if (!m) continue;
      const y = m[1].length === 4 ? +m[1] : b.getFullYear();
      const mo = m[1].length === 4 ? +m[2] : +m[1];
      const d = m[1].length === 4 ? +m[3] : +m[2];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      const cand = `${y}-${pad2(mo)}-${pad2(d)}`;
      const dt = parseDate(cand);
      if (!dt || dt.getMonth() !== mo - 1 || dt.getDate() !== d) continue;
      if (m[1].length !== 4 && dt < b) {
        const nxt = new Date(y + 1, mo - 1, d);
        relDate = nxt.getMonth() === mo - 1 ? `${y + 1}-${pad2(mo)}-${pad2(d)}` : cand;
      } else {
        relDate = cand;
      }
      eat(m[0]);
      break;
    }
  }

  // ---------- 8. 相对日期 ----------
  if (!relDate) {
    for (const [re, d] of [
      [/大后天/, 3],
      [/后天/, 2],
      [/明天|明日|tomorrow/i, 1],
      [/今天|今日|today/i, 0],
      [/昨天|昨日|yesterday/i, -1],
    ]) {
      const m = text.match(re);
      if (m) {
        relDate = addDaysStr(base, d);
        eat(m[0]);
        break;
      }
    }
  }

  // ---------- 9. N 天/周/月后 ----------
  if (!relDate) {
    const later = text.match(new RegExp(`(\\d+|[${cnDigits}])\\s*(天|日|周|星期|个月)(?:之)?后`));
    if (later) {
      const n = cnNum(later[1]);
      if (n) {
        const mult = /周|星期/.test(later[2]) ? 7 : /个月/.test(later[2]) ? 30 : 1;
        relDate = addDaysStr(base, n * mult);
        eat(later[0]);
      }
    }
  }

  // ---------- 10. 本周末 / 月底 ----------
  if (!relDate) {
    const weekend = text.match(/(本|这|下下|下)?\s*周末/);
    if (weekend) {
      const cur = b.getDay();
      let toSat = (6 - cur + 7) % 7 || 7;
      if (weekend[1] === '下') toSat += 7;
      else if (weekend[1] === '下下') toSat += 14;
      relDate = addDaysStr(base, toSat);
      eat(weekend[0]);
    }
  }
  if (!relDate) {
    const monthEnd = text.match(/月底(?:之前|以前|前)?|月末(?:之前|以前|前)?/);
    if (monthEnd) {
      relDate = dateStr(new Date(b.getFullYear(), b.getMonth() + 1, 0));
      eat(monthEnd[0]);
    }
  }
  if (!relDate) {
    // 仅在「周/星期」是独立词（前为空白/标点，且带下/本/这前缀）时才当作日期，
    // 否则「周报」「周报会」等词会被误吞。
    const nextWeek = text.match(
      /(?:^|[\s，,。、;；])(下下|下|本|这)?\s*(?:周|星期)(?![一二三四五六日天末]|[㐀-鿿])/
    );
    if (nextWeek && nextWeek[1]) {
      const monday = addDaysStr(base, -((b.getDay() + 6) % 7));
      let d = monday;
      if (nextWeek[1] === '下') d = addDaysStr(monday, 7);
      else if (nextWeek[1] === '下下') d = addDaysStr(monday, 14);
      else if (!nextWeek[1]) d = addDaysStr(monday, 7); // 裸「下周」= 下周一
      relDate = d;
      eat(nextWeek[0]);
    }
  }

  // ---------- 10b. 重复规则里带了周几 → 算出首次发生日 ----------
  if (!relDate && out.repeat && out.repeat.weekday != null) {
    const todayIdx = (b.getDay() + 6) % 7;
    const targetIdx = out.repeat.weekday === 0 ? 6 : out.repeat.weekday - 1;
    let delta = targetIdx - todayIdx;
    if (delta < 0) delta += 7;
    relDate = addDaysStr(base, delta);
  }

  // ---------- 11. 时间 ----------
  let hh = null;
  let mm = 0;
  const timeRes = [
    new RegExp(
      `(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)\\s*(\\d{1,2}|[${cnDigits}])\\s*[点时:：]?\\s*(\\d{1,2}|半|整)?`
    ),
    /(\d{1,2})[:：](\d{2})/,
    new RegExp(`(\\d{1,2}|[${cnDigits}])\\s*[点时]\\s*(半|整)?`),
  ];
  for (const re of timeRes) {
    const m = text.match(re);
    if (!m) continue;
    let ok = false;
    if (/^\d{1,2}[:：]\d{2}$/.test(m[0])) {
      hh = +m[1];
      mm = +m[2];
      ok = true;
    } else {
      const md = m[1] && /凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里/.test(m[1]) ? m[1] : null;
      const hourRaw = md ? m[2] : m[1];
      hh = cnNum(hourRaw);
      if (md && /下午|傍晚|晚上|夜里|中午/.test(md) && hh != null && hh < 12) hh += 12;
      if (md && /凌晨/.test(md) && hh === 12) hh = 0;
      const minRaw = md ? m[3] : m[2];
      if (minRaw === '半') mm = 30;
      else if (minRaw === '整' || minRaw === undefined) mm = 0;
      else mm = cnNum(minRaw);
      ok = hh != null && hh >= 0 && hh <= 23;
    }
    if (ok && mm >= 0 && mm <= 59) {
      eat(m[0]);
      break;
    }
    hh = null;
    mm = 0;
  }

  // 只有时段词，没有具体时刻
  if (hh == null) {
    const md = text.match(/(下午|傍晚|晚上|夜里|中午|上午|早上|早晨)/);
    if (md) {
      const k = md[1];
      hh = /下午|傍晚|晚上|夜里|中午/.test(k) ? 14 : 9;
      mm = 0;
      eat(md[0]);
    }
  }
  if (hh == null) {
    const off = text.match(/下班前|收工前/);
    if (off) {
      hh = 18;
      mm = 0;
      eat(off[0]);
    }
  }

  // ---------- 12. 落到字段 ----------
  if (relDate) {
    if (hh == null) {
      out.dueAt = relDate;
      out.startAt = relDate;
      out.allDay = true;
      out.confidence += 1;
    } else {
      out.startAt = `${relDate}T${pad2(hh)}:${pad2(mm)}`;
      const endMin = hh * 60 + mm + 60;
      out.dueAt = `${relDate}T${pad2(Math.floor(endMin / 60) % 24)}:${pad2(endMin % 60)}`;
      out.confidence += 2;
    }
  } else if (hh != null) {
    const today = dateStr();
    const endMin = hh * 60 + mm + 60;
    out.startAt = `${today}T${pad2(hh)}:${pad2(mm)}`;
    out.dueAt = `${today}T${pad2(Math.floor(endMin / 60) % 24)}:${pad2(endMin % 60)}`;
    out.confidence += 1;
  }
  if (out.repeat && out.repeat.weekday != null) out.confidence += 1;

  // ---------- 13. 清理标题 ----------
  let clean = text
    .replace(/[~～]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,，、。.:：\-–—的]+/, '')
    .replace(/[\s,，、。.:：\-–—]+$/, '')
    .trim();
  if (clean.length < 2) clean = String(input).trim();
  out.cleanTitle = clean.slice(0, 200);
  out.matched = matched;
  return out;
}