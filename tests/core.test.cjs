const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
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
test('all-records timeline is continuous and newest first, including empty days', () => {
  const s=C.emptyState(); s.records=[record(8,9),record(56,57)];
  const rows=C.recordTimeline(s,{now:base+58*3600000});
  assert.deepEqual(rows.map(r=>[!!r.gap,(r.start-base)/3600000,(r.end-base)/3600000]),
    [[true,57,58],[false,56,57],[true,9,56],[false,8,9],[true,0,8]]);
  for(let i=1;i<rows.length;i++)assert.equal(rows[i].end,rows[i-1].start);
  assert.equal(rows.reduce((sum,r)=>sum+r.end-r.start,0),58*3600000);
  assert.equal(s.records.length,2,'display-only gaps must not become saved records');
});
test('all-records date filter preserves cross-day records and clips gaps to the range', () => {
  const s=C.emptyState(); s.records=[record(-1,1),record(23,25)];
  const rows=C.recordTimeline(s,{from:d,to:d,now:base+2*C.DAY});
  assert.deepEqual(rows.map(r=>[!!r.gap,(r.start-base)/3600000,(r.end-base)/3600000]),
    [[false,23,25],[true,1,23],[false,-1,1]]);
});
test('text and category filtering never turns hidden records into gaps', () => {
  const s=C.emptyState(); s.records=[record(8,9,'项目'),{...record(10,11,'阅读'),category:'study'},record(11,12,'会议')];
  for(const filter of [{keyword:'阅读'},{category:'study'}]){
    const rows=C.recordTimeline(s,{from:d,to:d,now:base+13*3600000,...filter});
    assert.deepEqual(rows.filter(r=>!r.gap).map(r=>r.title),['阅读']);
    assert.deepEqual(rows.filter(r=>r.gap).map(r=>[(r.start-base)/3600000,(r.end-base)/3600000]),
      [[12,13],[9,10],[0,8]]);
  }
});
test('empty and boundary ranges produce only elapsed gaps and never future time', () => {
  const s=C.emptyState();
  assert.deepEqual(C.recordTimeline(s,{now:base}),[]);
  const [gap]=C.recordTimeline(s,{now:base+3600000});
  assert.equal(gap.gap,true);assert.equal(gap.start,base);assert.equal(gap.end,base+3600000);
  const [pastGap]=C.recordTimeline(s,{from:d,to:d,now:base+3*C.DAY});
  assert.equal(pastGap.start,base);assert.equal(pastGap.end,base+C.DAY);
  assert.deepEqual(C.recordTimeline(s,{from:C.addDays(d,1),now:base+3600000}),[]);
});
test('activity distribution merges exact titles across categories and excludes gaps', () => {
  const rows=[record(8,9,'阅读'),{...record(10,12,' 阅读 '),category:'study'},record(12,14,'项目'),record(15,16,'读书'),
    {gap:true,start:base,end:base+8*3600000}];
  assert.deepEqual(C.activityDistribution(rows),[
    {title:'阅读',ms:3*3600000},{title:'项目',ms:2*3600000},{title:'读书',ms:3600000}
  ]);
  assert.deepEqual(C.activityDistribution([]),[]);
  assert.equal(C.activityDistribution([record(1,2,'__proto__')])[0].ms,3600000);
});
test('activity distribution uses only the selected day portion of cross-day records', () => {
  const s=C.emptyState();s.records=[record(-2,1,'阅读'),record(2,3,'阅读')];
  assert.deepEqual(C.activityDistribution(C.timeline(s,d,base+4*3600000)),[{title:'阅读',ms:2*3600000}]);
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
test('legacy todos keep their completion state and receive safe defaults on restore', () => {
  const s=C.emptyState();s.todos=[{...record(8,9),done:false},{...record(9,10),done:true}];
  const clean=C.validateState(s,now);
  assert.deepEqual(clean.todos.map(t=>[t.priority,t.progress,t.done]),[[0,0,false],[1,100,true]]);
  assert.equal(s.todos[0].priority,undefined);
  assert.equal(clean.version,1);
});
test('todo progress is authoritative, bounded and synchronized with completion', () => {
  assert.deepEqual(C.todoDetails({priority:'high',progress:40,done:true}),{priority:0,progress:40,done:false});
  assert.deepEqual(C.todoDetails({priority:'low',progress:100,done:false}),{priority:2,progress:100,done:true});
  for(const progress of [-1,101,1.5,NaN,Infinity,'50',null,true]){
    const s=C.emptyState();s.todos=[{...record(8,9),progress}];
    assert.throws(()=>C.validateState(s,now),/完成进度/);
  }
  for(const priority of ['urgent','__proto__','toString','','1',null,[],['high'],-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
    const s=C.emptyState();s.todos=[{...record(8,9),priority}];
    assert.throws(()=>C.validateState(s,now),/优先级/);
  }
});
test('todo adjustments preserve times, notes, records and other todos', () => {
  const s=C.emptyState();s.records=[record(1,2)];s.days[d]=base;
  s.todos=[{...record(8,9,'计划','todo-a'),notes:'保留备注',priority:1,progress:30,done:false},{...record(9,10,'其他待办','todo-b'),priority:0}];
  const snapshot=JSON.stringify(s);
  let next=C.updateTodo(s,'todo-a',{priority:0});
  assert.equal(next.todos[0].progress,30);
  assert.equal(next.todos[0].notes,'保留备注');
  assert.equal(next.todos[0].start,s.todos[0].start);assert.equal(next.todos[0].end,s.todos[0].end);
  assert.equal(next.records,s.records);assert.equal(next.days,s.days);assert.deepEqual(next.todos[1],{...s.todos[1],priority:1});
  next=C.updateTodo(next,'todo-a',{progress:100});assert.equal(next.todos[0].done,true);
  next=C.updateTodo(next,'todo-a',{progress:65});assert.equal(next.todos[0].done,false);
  next=C.updateTodo(next,'todo-a',{done:true});assert.equal(next.todos[0].progress,100);
  next=C.updateTodo(next,'todo-a',{done:false});assert.equal(next.todos[0].progress,0);
  assert.equal(next.todos[0].priority,0);assert.equal(JSON.stringify(s),snapshot);
  assert.throws(()=>C.updateTodo(s,'missing',{progress:50}),/不存在/);
});
test('daily todo order prioritizes urgency and preserves chronological order within each level', () => {
  const todos=[{...record(8,9,'low'),priority:'low'},record(6,7,'legacy'),{...record(12,13,'high-late'),priority:'high'},
    {...record(7,8,'medium'),priority:'medium'},{...record(10,11,'high-early'),priority:'high'}];
  assert.deepEqual(todos.slice().sort(C.compareTodos).map(t=>t.title),['high-early','high-late','legacy','medium','low']);
});
test('JSON backup roundtrips todo fields while CSV and ICS output remain unchanged', () => {
  const s=C.emptyState();s.records=[record(1,2)];s.todos=[{...record(8,9),priority:'high',progress:35,done:false,notes:'备注'}];
  const clean=C.validateState(s,now), restored=C.validateState(JSON.parse(JSON.stringify(clean)),now);
  assert.deepEqual(restored,clean);assert.equal(restored.todos[0].progress,35);assert.equal(restored.todos[0].priority,0);
  assert.equal(C.csv(clean.records),C.csv(s.records));
  const legacy=clean.todos.map(({priority,progress,...todo})=>todo);
  const stable=ics=>ics.replace(/^DTSTAMP:.*$/gm,'');
  assert.equal(stable(C.calendarFile(clean.todos)),stable(C.calendarFile(legacy)));
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
