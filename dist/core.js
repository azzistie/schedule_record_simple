(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TimeCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const CATEGORIES = {
    work: { name: '工作', color: '#4b7c67' }, study: { name: '学习', color: '#8b79b5' },
    life: { name: '生活', color: '#d6a267' }, health: { name: '运动', color: '#76a3ba' },
    rest: { name: '休息', color: '#b4869c' }, other: { name: '其他', color: '#96a09b' }
  };
  const id = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const dateKey = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  const dayStart = date => Date.parse(date + 'T00:00:00+08:00');
  const addDays = (date, n) => dateKey(dayStart(date) + n * DAY);
  const time = ms => new Date(ms + 8 * 3600000).toISOString().slice(11, 16);
  const localInput = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 16);
  const parseLocal = text => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ? Date.parse(text + ':00+08:00') : NaN;
  function duration(ms, precise = false) {
    const mins = Math.floor(Math.max(0, ms) / 60000);
    if (!mins && ms > 0) return precise ? Math.floor(ms / 1000) + ' 秒' : '不足 1 分钟';
    return (mins >= 60 ? Math.floor(mins / 60) + ' 小时' : '') + (mins % 60 ? (mins >= 60 ? ' ' : '') + mins % 60 + ' 分钟' : mins ? '' : '0 分钟');
  }
  const emptyState = () => ({ version: 1, records: [], todos: [], days: {} });
  const overlap = (a, b) => a.start < b.end && b.start < a.end;
  const inferCategory = title => /工作|会议|项目|代码|编程|邮件|方案|办公|客户/.test(title) ? 'work' : /学习|读书|阅读|课程|英语|复习|考试/.test(title) ? 'study' : /跑步|健身|运动|瑜伽|游泳|散步/.test(title) ? 'health' : /睡觉|午睡|休息|游戏|电影|刷|娱乐/.test(title) ? 'rest' : /吃|饭|早餐|午餐|晚餐|洗|家务|通勤|买菜|购物/.test(title) ? 'life' : 'other';
  function validateRecord(record, now = Date.now()) {
    if (!record.title?.trim()) throw Error('请填写做了什么。');
    if (record.title.length > 500) throw Error('事情描述请控制在 500 字以内。');
    if (!Number.isFinite(record.start) || !Number.isFinite(record.end)) throw Error('请选择有效的起止时间。');
    if (record.end <= record.start) throw Error('结束时间需要晚于开始时间。');
    if (record.end > now + 1000) throw Error('记录用于已经发生的事情，未来计划请添加到日历。');
    if (record.end - record.start > 31 * DAY) throw Error('单条记录不能超过 31 天，请分段记录。');
    if (!CATEGORIES[record.category]) throw Error('请选择有效分类。');
  }
  function insertRecord(state, input, { replace = false, now = Date.now() } = {}) {
    const record = { ...input, id: input.id || id(), title: input.title.trim(), createdAt: input.createdAt || now, updatedAt: now };
    validateRecord(record, now);
    const existing = state.records.filter(r => r.id !== record.id);
    const conflicts = existing.filter(r => overlap(r, record));
    if (conflicts.length && !replace) {
      const error = Error('这个时间段与 ' + conflicts.length + ' 条记录重叠。可以调整时间，或选择覆盖重叠部分。');
      error.conflicts = conflicts; throw error;
    }
    const records = [];
    for (const old of existing) {
      if (!overlap(old, record)) records.push(old);
      else {
        if (old.start < record.start) records.push({ ...old, end: record.start, updatedAt: now });
        if (old.end > record.end) records.push({ ...old, id: old.start < record.start ? id() : old.id, start: record.end, updatedAt: now });
      }
    }
    records.push(record);
    return { ...state, records: records.sort((a, b) => a.start - b.start) };
  }
  function anchor(state, now = Date.now()) {
    const today = dateKey(now);
    const boundary = dayStart(today);
    const last = state.records.reduce((latest, r) => r.end <= now ? Math.max(latest, r.end) : latest, 0);
    const start = Math.max(boundary, state.days[today] || 0, last >= boundary ? last : 0);
    return start === boundary && !state.days[today] && last < boundary ? null : start;
  }
  function timeline(state, date, now = Date.now()) {
    const start = dayStart(date), end = Math.min(start + DAY, now);
    if (end <= start) return [];
    const records = state.records.filter(r => r.end > start && r.start < end).map(r => ({ ...r, originalStart: r.start, originalEnd: r.end, start: Math.max(start, r.start), end: Math.min(end, r.end) })).sort((a, b) => a.start - b.start);
    const rows = []; let cursor = start;
    for (const record of records) {
      if (record.start > cursor) rows.push({ id: 'gap-' + cursor, gap: true, start: cursor, end: record.start });
      rows.push(record); cursor = Math.max(cursor, record.end);
    }
    if (cursor < end) rows.push({ id: 'gap-' + cursor, gap: true, start: cursor, end });
    return rows;
  }
  function matches(record, keyword = '', category = '') {
    return (!category || record.category === category) && (!keyword.trim() || (record.title + ' ' + (CATEGORIES[record.category]?.name || '')).toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()));
  }
  function statistics(state, keyword, n, endDate = dateKey(Date.now()), category = '') {
    n = Math.max(1, Math.min(366, Math.floor(Number(n) || 7)));
    const first = addDays(endDate, 1 - n), rangeStart = dayStart(first), rangeEnd = dayStart(endDate) + DAY;
    const records = state.records.filter(r => r.start < rangeEnd && r.end > rangeStart && matches(r, keyword, category));
    const daily = Array.from({ length: n }, (_, i) => {
      const date = addDays(first, i), start = dayStart(date);
      return { date, ms: records.reduce((sum, r) => sum + Math.max(0, Math.min(r.end, start + DAY) - Math.max(r.start, start)), 0) };
    });
    const total = daily.reduce((sum, d) => sum + d.ms, 0);
    const activeDays = daily.filter(d => d.ms > 0).length;
    return { daily, total, average: total / n, activeAverage: activeDays ? total / activeDays : 0, activeDays, count: records.length, max: Math.max(0, ...daily.map(d => d.ms)) };
  }
  function validateState(input, now = Date.now()) {
    if (!input || input.version !== 1 || !Array.isArray(input.records) || !Array.isArray(input.todos) || !input.days || typeof input.days !== 'object' || Array.isArray(input.days)) throw Error('备份文件格式不正确，需要时光导出的 JSON 文件。');
    if (input.records.length > 100000 || input.todos.length > 50000) throw Error('数据量超出导入限制。');
    const ids = new Set();
    const records = input.records.map(r => {
      validateRecord(r, now);
      if (typeof r.id !== 'string' || !r.id || ids.has(r.id)) throw Error('记录编号缺失或重复。');
      ids.add(r.id); return { id: r.id, title: r.title.trim(), category: r.category, start: r.start, end: r.end, createdAt: r.createdAt || now, updatedAt: r.updatedAt || now };
    }).sort((a, b) => a.start - b.start);
    for (let i = 1; i < records.length; i++) if (overlap(records[i - 1], records[i])) throw Error('备份中存在重叠记录，请先修正。');
    const todoIds = new Set();
    const todos = input.todos.map(t => {
      if (typeof t.id !== 'string' || !t.id || todoIds.has(t.id) || !t.title?.trim() || t.title.length > 500 || !Number.isFinite(t.start) || !Number.isFinite(t.end) || t.end <= t.start || !CATEGORIES[t.category]) throw Error('待办数据格式不正确。');
      todoIds.add(t.id); return { id: t.id, title: t.title.trim(), start: t.start, end: t.end, category: t.category, done: !!t.done, notes: String(t.notes || '').slice(0, 2000), createdAt: t.createdAt || now };
    });
    const days = {};
    for (const [date, start] of Object.entries(input.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(start) || dateKey(start) !== date || start > now) throw Error('每日起点数据不正确。');
      days[date] = start;
    }
    return { version: 1, records, todos, days };
  }
  function csv(records) {
    const quote = value => '"' + String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
    const rows = [['开始日期', '开始时间', '结束日期', '结束时间', '事项', '分类', '时长（分钟）'], ...records.map(r => [dateKey(r.start), time(r.start), dateKey(r.end), time(r.end), r.title, CATEGORIES[r.category].name, ((r.end - r.start) / 60000).toFixed(2)])];
    return '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n');
  }
  function calendarFile(todos) {
    const escape = s => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const utc = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const fold = line => {
      const lines = []; let current = '', bytes = 0;
      for (const ch of line) { const n = new TextEncoder().encode(ch).length; if (bytes + n > 74) { lines.push(current); current = ' '; bytes = 1; } current += ch; bytes += n; }
      lines.push(current); return lines.join('\r\n');
    };
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shiguang//Time Journal//ZH', 'CALSCALE:GREGORIAN', ...todos.flatMap(t => ['BEGIN:VEVENT', 'UID:' + t.id + '@shiguang', 'DTSTAMP:' + utc(Date.now()), 'DTSTART:' + utc(t.start), 'DTEND:' + utc(t.end), 'SUMMARY:' + escape(t.title), 'DESCRIPTION:' + escape((t.done ? '已完成\n' : '') + (t.notes || '')), 'END:VEVENT']), 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
  }
  return { DAY, CATEGORIES, id, dateKey, dayStart, addDays, time, localInput, parseLocal, duration, emptyState, overlap, inferCategory, validateRecord, insertRecord, anchor, timeline, matches, statistics, validateState, csv, calendarFile };
});
