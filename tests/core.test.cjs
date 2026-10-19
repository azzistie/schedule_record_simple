const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../dist/core.js');
const d = '2026-10-18', base = C.dayStart(d), now = base + C.DAY - 1;
const record = (start, end, title = '工作', id = C.id()) => ({ id, start: base + start * 3600000, end: base + end * 3600000, title, category: 'work' });

test('UTC+8 date and input roundtrip independent of system timezone', () => {
  assert.equal(C.dateKey(Date.parse('2026-10-17T16:00:00Z')), d);
  assert.equal(C.parseLocal('2026-10-18T09:30'), base + 9.5 * 3600000);
  assert.equal(C.localInput(base + 9.5 * 3600000), '2026-10-18T09:30');
  assert.ok(Number.isNaN(C.parseLocal('not-a-time')));
});
test('first daily message requires an explicit anchor and resets at midnight', () => {
  const state = C.emptyState(); state.records.push(record(-2, -1));
  assert.equal(C.anchor(state, base + 10 * 3600000), null);
  state.days[d] = base + 8 * 3600000;
  assert.equal(C.anchor(state, base + 10 * 3600000), base + 8 * 3600000);
  state.records.push(record(8, 9));
  assert.equal(C.anchor(state, base + 10 * 3600000), base + 9 * 3600000);
});
test('overlap rejected by default and touching boundaries allowed', () => {
  let state = C.insertRecord(C.emptyState(), record(8, 10), { now });
  assert.throws(() => C.insertRecord(state, record(9, 11), { now }), /重叠/);
  state = C.insertRecord(state, record(10, 11), { now });
  assert.equal(state.records.length, 2);
});
test('replacement in middle splits original without losing either side or double counting', () => {
  let state = C.insertRecord(C.emptyState(), record(8, 12, '项目'), { now });
  state = C.insertRecord(state, record(9, 10, '吃饭'), { replace: true, now });
  assert.deepEqual(state.records.map(r => [r.title, (r.start-base)/3600000, (r.end-base)/3600000]), [['项目',8,9],['吃饭',9,10],['项目',10,12]]);
  assert.equal(new Set(state.records.map(r => r.id)).size, 3);
  assert.equal(C.statistics(state, '', 1, d).total, 4 * 3600000);
});
test('replacement spanning multiple activities preserves outer fragments', () => {
  let state = C.emptyState(); state.records = [record(8, 9), record(9, 10), record(10, 12)];
  state = C.insertRecord(state, record(8.5, 11, '复盘'), { replace: true, now });
  assert.deepEqual(state.records.map(r => [(r.start-base)/3600000, (r.end-base)/3600000]), [[8,8.5],[8.5,11],[11,12]]);
});
test('editing excludes itself from overlap and keeps immutable input state', () => {
  const state = C.emptyState(), original = record(8, 10); state.records.push(original);
  const updated = C.insertRecord(state, { ...original, title: '阅读' }, { now });
  assert.equal(updated.records.length, 1); assert.equal(state.records[0].title, '工作');
});
test('invalid, zero length and future intervals are rejected', () => {
  for (const r of [record(10,10),record(11,10),record(23,25),{...record(1,2),title:''},{...record(1,2),category:'bad'}]) {
    assert.throws(() => C.insertRecord(C.emptyState(), r, { now }));
  }
});
test('timeline includes every gap from midnight and clips cross-day intervals', () => {
  const s = C.emptyState(); s.records = [record(-1,1), record(2,3)];
  const rows = C.timeline(s, d, base + 4 * 3600000);
  assert.deepEqual(rows.map(r => [!!r.gap,(r.start-base)/3600000,(r.end-base)/3600000]), [[false,0,1],[true,1,2],[false,2,3],[true,3,4]]);
});
test('statistics split midnight and include zero days in the denominator', () => {
  const state = C.emptyState(); state.records = [record(-1,1, '阅读')];
  const r = C.statistics(state, '阅读', 3, d);
  assert.deepEqual(r.daily.map(d => d.ms), [0,3600000,3600000]);
  assert.equal(r.average, 7200000/3); assert.equal(r.activeAverage,3600000); assert.equal(r.count,1);
  assert.equal(C.statistics(state, '', 1, d).total,3600000);
});
test('keyword filtering supports case-insensitive descriptions and category labels', () => {
  const state = C.emptyState(); state.records = [record(8,9,'Review PR'), {...record(10,11,'阅读'),category:'study'}];
  assert.equal(C.statistics(state, 'review', 1, d).total,3600000);
  assert.equal(C.statistics(state, '学习', 1, d).total,3600000);
  assert.equal(C.statistics(state, '', 1, d,'work').count,1);
  assert.equal(C.statistics(state, '不存在', 1, d).average,0);
});
test('state restore refuses duplicate ids, overlap and malformed todos', () => {
  let s=C.emptyState();s.records=[record(8,10),record(9,11)];assert.throws(()=>C.validateState(s,now),/重叠/);
  s.records=[record(8,9,'test','same'),record(9,10,'test','same')];assert.throws(()=>C.validateState(s,now),/重复/);
  s=C.emptyState();s.todos=[{id:'a',title:'test',start:1,end:0,category:'work'}];assert.throws(()=>C.validateState(s,now));
});
test('CSV escapes quotes and neutralizes formula-leading text', () => {
  const csv=C.csv([record(8,9,'=SUM("a",1)')]);
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=SUM(""a"",1)"'));
});
test('ICS uses UTC timestamps, escapes injection and folds UTF-8 lines safely', () => {
  const s={...record(8,9,'阅读，'.repeat(40)+'\nEND:VEVENT'),notes:'a,b;c\\d',done:false};
  const ics=C.calendarFile([s]);assert.ok(ics.includes('DTSTART:20261018T000000Z'));
  assert.equal(ics.split('\r\n').filter(l=>l==='END:VEVENT').length,1);
  assert.ok(ics.includes('DESCRIPTION:a\\,b\\;c\\\\d'));
  for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75);
});
