const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const date = '2026-10-28', base = C.dayStart(date), now = base + 10 * C.DAY;
const task = (id, priority, day = 0, hour = 9) => ({ id, title: id, start: base + day * C.DAY + hour * 3600000,
  end: base + day * C.DAY + (hour + 1) * 3600000, category: 'work', notes: '备注', progress: 35, done: false, createdAt: base,
  ...(priority === undefined ? {} : { priority }) });
const queue = (state, day = 0) => state.todos.filter(t => C.dateKey(t.start) === C.addDays(date, day)).sort(C.compareTodos);
const ids = (state, day = 0) => queue(state, day).map(t => t.id);
const stateWith = (...todos) => ({ ...C.emptyState(), todos });
const checkRanks = (state, day = 0) => assert.deepEqual(queue(state, day).map(t => t.priority), queue(state, day).map((_, i) => i));

test('default creation appends consecutive priorities starting at zero, regardless of start time', () => {
  let s = C.emptyState();
  s = C.insertTodo(s, task('a', undefined, 0, 12));
  s = C.insertTodo(s, task('b', undefined, 0, 8));
  s = C.insertTodo(s, task('c', undefined, 1, 10));
  assert.deepEqual(ids(s), ['a', 'b']);
  assert.deepEqual(ids(s, 1), ['c']);checkRanks(s);checkRanks(s, 1);
});
test('new todo takes the requested occupied position and shifts every following todo', () => {
  const original = stateWith(task('a', 0), task('b', 1), task('c', 2));
  let s = C.insertTodo(original, task('new', 1, 0, 20));
  assert.deepEqual(ids(s), ['a', 'new', 'b', 'c']);checkRanks(s);
  s = C.insertTodo(s, task('first', 0));
  assert.deepEqual(ids(s), ['first', 'a', 'new', 'b', 'c']);checkRanks(s);
  assert.deepEqual(original.todos.map(t => t.priority), [0, 1, 2]);
});
test('moving up, down or to the same position uses the final requested position', () => {
  let s = stateWith(task('a', 0), task('b', 1), task('c', 2), task('d', 3));
  s = C.updateTodo(s, 'd', { priority: 1 });
  assert.deepEqual(ids(s), ['a', 'd', 'b', 'c']);checkRanks(s);
  s = C.updateTodo(s, 'a', { priority: 3 });
  assert.deepEqual(ids(s), ['d', 'b', 'c', 'a']);checkRanks(s);
  const before = JSON.stringify(s);
  s = C.updateTodo(s, 'b', { priority: 1 });
  assert.equal(JSON.stringify(s), before);
  s = C.updateTodo(s, 'b', { priority: 0 });
  assert.deepEqual(ids(s), ['b', 'd', 'c', 'a']);checkRanks(s);
});
test('out-of-range positive positions append without gaps; invalid values cannot change state', () => {
  const s = stateWith(task('a', 0), task('b', 1), task('c', 2));
  const appended = C.insertTodo(s, task('new', 999));
  assert.deepEqual(ids(appended), ['a', 'b', 'c', 'new']);checkRanks(appended);
  const moved = C.updateTodo(s, 'a', { priority: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(ids(moved), ['b', 'c', 'a']);checkRanks(moved);
  const snapshot = JSON.stringify(s);
  for (const priority of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '', '1', null, true]) {
    assert.throws(() => C.updateTodo(s, 'a', { priority }), /优先级/);
  }
  assert.equal(JSON.stringify(s), snapshot);
});
test('deleting the first, middle, last or only todo compacts its day and preserves other days', () => {
  let s = stateWith(task('a', 0), task('b', 1), task('c', 2), task('other', 0, 1));
  const other = s.todos[3];
  s = C.deleteTodo(s, 'b');assert.deepEqual(ids(s), ['a', 'c']);checkRanks(s);
  s = C.deleteTodo(s, 'a');assert.deepEqual(ids(s), ['c']);checkRanks(s);
  s = C.deleteTodo(s, 'c');assert.deepEqual(ids(s), []);
  assert.equal(s.todos[0], other);
  s = C.insertTodo(s, task('fresh'));assert.equal(queue(s)[0].priority, 0);
});
test('editing date and position compacts the source day and inserts into the destination day', () => {
  const original = stateWith(task('a', 0), task('b', 1), task('x', 0, 1), task('y', 1, 1));
  const moved = C.insertTodo(original, { ...original.todos[0], start: base + C.DAY + 12 * 3600000,
    end: base + C.DAY + 13 * 3600000, priority: 1 });
  assert.deepEqual(ids(moved), ['b']);assert.deepEqual(ids(moved, 1), ['x', 'a', 'y']);
  checkRanks(moved);checkRanks(moved, 1);
  assert.equal(moved.todos.find(t => t.id === 'a').notes, '备注');
  assert.equal(moved.todos.find(t => t.id === 'a').progress, 35);
});
test('legacy priorities migrate in their prior order and numeric backups repair duplicate or missing ranks', () => {
  const s = stateWith(task('low', 'low'), task('legacy', undefined, 0, 8), task('high', 'high', 0, 14),
    task('medium', 'medium', 0, 10), task('tomorrow', 'high', 1));
  const clean = C.validateState(s, now);
  assert.deepEqual(ids(clean), ['high', 'legacy', 'medium', 'low']);checkRanks(clean);checkRanks(clean, 1);
  const duplicates = C.validateState(stateWith(task('late', 7, 0, 12), task('early', 7, 0, 8), task('first', 3)), now);
  assert.deepEqual(ids(duplicates), ['first', 'early', 'late']);checkRanks(duplicates);
  assert.deepEqual(C.validateState(JSON.parse(JSON.stringify(clean)), now), clean);
  assert.deepEqual(clean.todos.map(t => t.id), s.todos.map(t => t.id), 'storage and export array order is preserved');
});
test('progress, completion and description edits keep priority order and unrelated time data', () => {
  let s = stateWith(task('a', 0), task('b', 1), task('c', 2));
  s.records = [{ ...task('record', 0), start: base, end: base + 60000 }];s.days[date] = base;
  const records = s.records, days = s.days;
  s = C.updateTodo(s, 'b', { progress: 100 });assert.equal(s.todos[1].done, true);
  s = C.updateTodo(s, 'b', { done: false });assert.equal(s.todos[1].progress, 0);
  s = C.insertTodo(s, { ...s.todos[1], title: '改名', start: base + 2 * 3600000, end: base + 3 * 3600000 });
  assert.deepEqual(ids(s), ['a', 'b', 'c']);checkRanks(s);
  assert.equal(s.records, records);assert.equal(s.days, days);
});
test('UTC+8 midnight assigns independent queues and keeps cross-day todos on their start day', () => {
  const a = { ...task('a', 0), start: base + C.DAY - 60000, end: base + C.DAY + 60000 };
  let s = C.insertTodo(C.emptyState(), a);
  s = C.insertTodo(s, { ...task('b'), start: base + C.DAY, end: base + C.DAY + 60000 });
  assert.equal(s.todos[0].priority, 0);assert.equal(s.todos[1].priority, 0);
});
test('repeated insertion, movement and deletion agree with an independent queue model after reload', () => {
  let s = C.emptyState(), model = [], seed = 42, serial = 0;
  const random = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let step = 0; step < 150; step++) {
    const operation = model.length ? random(3) : 0;
    if (operation === 0) {
      const id = 'item-' + serial++, position = random(model.length + 3);
      s = C.insertTodo(s, task(id, position));model.splice(Math.min(position, model.length), 0, id);
    } else if (operation === 1) {
      const id = model[random(model.length)], position = random(model.length + 3);
      s = C.updateTodo(s, id, { priority: position });model.splice(model.indexOf(id), 1);model.splice(Math.min(position, model.length), 0, id);
    } else {
      const id = model[random(model.length)];s = C.deleteTodo(s, id);model.splice(model.indexOf(id), 1);
    }
    s = C.validateState(JSON.parse(JSON.stringify(s)), now);
    assert.deepEqual(ids(s), model, 'operation ' + step);checkRanks(s);
  }
});
