/* 时光 · 无依赖浏览器客户端 */
(async function () {
  'use strict';
  const C = TimeCore, $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paths = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
    chart: '<path d="M4 3v17h17M8 15v-4M13 15V6M18 15V9"/>', calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
    settings: '<path d="m9 3-1 3-3 1v4l2 2-1 3 3 3 3-1 3 1 3-3-1-3 2-2V7l-3-1-1-3Z"/><circle cx="12" cy="11" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', chevron: '<path d="m9 5 7 7-7 7"/>',
    leaf: '<path d="M20 3c-9-1-16 3-16 9a7 7 0 0 0 7 7c6 0 9-7 9-16ZM4 21 15 10"/>', edit: '<path d="m15 4 5 5M4 15 15 4a3 3 0 0 1 5 5L9 20l-6 1Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16h.01"/>', trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    message: '<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 1-7a8 8 0 1 1 18-4Z"/><path d="M7 10h10M7 14h6"/>', cloud: '<path d="M7 18a5 5 0 1 1 0-10 7 7 0 0 1 13 3 4 4 0 0 1-1 7Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1"/>', upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>', link: '<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M13 8l2-2a4 4 0 1 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
    book: '<path d="M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Zm0 0v15"/>', refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 2M4 17l2 2a8 8 0 0 0 13-2"/>'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.clock}</svg>`;
  const views = { today: ['今日记录', 'clock'], records: ['全部记录', 'table'], stats: ['时间洞察', 'chart'], calendar: ['待办日历', 'calendar'], settings: ['数据与设置', 'settings'] };
  const KEY = 'shiguang-data-v1', TOKEN = 'shiguang-server-key';
  let view = views[location.hash.slice(1)] ? location.hash.slice(1) : 'today';
  let state = C.emptyState(), revision = 0, server = false, demo = false, realState = null, busy = false, ready = false, storageError = '';
  let today = C.dateKey(Date.now()), selectedDate = today, calendarDate = today, calendarMonth = today.slice(0, 7);
  let draft = '', draftCategory = '', recordQuery = '', recordCategory = '', fromDate = '', toDate = '', page = 1;
  let statsQuery = '', statsCategory = '', statsDays = 7, statsEnd = today;
  let toastTimer;
  const safeStorage = { get(key) { try { return localStorage.getItem(key); } catch { return null; } }, set(key, value) { localStorage.setItem(key, value); } };
  draft = safeStorage.get('shiguang-draft') || '';
  let token = safeStorage.get(TOKEN) || '';
  if (location.hash.startsWith('#key=')) { token = decodeURIComponent(location.hash.slice(5)); try { safeStorage.set(TOKEN, token); } catch {} history.replaceState(null, '', location.pathname); }
  const catOptions = (current = '', auto = false) => `${auto ? '<option value="">自动分类</option>' : ''}${Object.entries(C.CATEGORIES).map(([id, cat]) => `<option value="${id}" ${current === id ? 'selected' : ''}>${cat.name}</option>`).join('')}`;
  const categoryBadge = category => `<span class="category-badge" style="--cat:${C.CATEGORIES[category].color}">${C.CATEGORIES[category].name}</span>`;
  const dateLabel = date => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(C.dayStart(date)));
  const shortDuration = ms => ms >= 3600000 ? `${(ms / 3600000).toFixed(1)}<small>小时</small>` : `${Math.floor(ms / 60000)}<small>分钟</small>`;
  const modal = $('#modal');
  function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('visible'); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
  function renderError(error) { const target = $('#form-error'); if (target) { target.hidden = false; target.textContent = error.message; } else toast(error.message); }
  function download(extension, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = C.exportFilename(extension); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...options.headers }, signal: AbortSignal.timeout(12000) });
    const data = await response.json();
    if (!response.ok) { const e = Error(data.error || '保存失败，请稍后重试。'); e.status = response.status; throw e; }
    return data;
  }
  function readLocal() { const raw = safeStorage.get(KEY); if (!raw) return { state: C.emptyState(), revision: 0 }; const data = JSON.parse(raw); return { state: C.validateState(data.state), revision: data.revision || 0 }; }
  async function refresh(silent = false) {
    if (demo || busy || !ready || modal.open) return;
    try { const result = server ? await api('/api/state') : readLocal(); if (result.revision !== revision) { state = result.state; revision = result.revision; render(); if (!silent) toast('已更新到最新数据'); } } catch (e) { if (!silent) toast(server ? '无法连接服务，已保留当前页面和输入。' : e.message); }
  }
  async function save(next) {
    if (busy) throw Error('上一条正在保存，请稍候。');
    if (!ready || storageError) throw Error(storageError || '数据还未加载，请稍候。');
    busy = true;
    try {
      const clean = C.validateState(next);
      if (demo) { state = clean; return; }
      if (server) {
        try { const result = await api('/api/state', { method: 'PUT', headers: { 'If-Match': String(revision) }, body: JSON.stringify(clean) }); state = result.state; revision = result.revision; }
        catch (e) { if (e.status === 409) { const fresh = await api('/api/state'); state = fresh.state; revision = fresh.revision; render(); throw Error('另一台设备更新了数据，已刷新。你的输入已保留，请再保存一次。'); } throw e; }
      } else {
        const write = () => { const latest = readLocal(); if (latest.revision !== revision) { state = latest.state; revision = latest.revision; render(); throw Error('另一页更新了数据，已刷新。请再保存一次。'); } const nextRevision = revision + 1; safeStorage.set(KEY, JSON.stringify({ state: clean, revision: nextRevision })); state = clean; revision = nextRevision; };
        if (navigator.locks) await navigator.locks.request('shiguang-write', write); else write();
      }
    } catch (error) { if (error.name === 'QuotaExceededError' || error.name === 'SecurityError') throw Error('浏览器无法保存数据。请导出备份，或通过本地服务使用。'); throw error; }
    finally { busy = false; }
  }
  function renderNav() {
    $('#navigation').innerHTML = Object.entries(views).map(([key, [name, glyph]]) => `<button class="nav-button ${view === key ? 'active' : ''} ${key === 'settings' ? 'mobile-settings' : ''}" data-view="${key}" ${view === key ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${name}</span></button>`).join('');
    $('#settings-nav').innerHTML = icon('settings') + '数据与设置'; $('#settings-nav').classList.toggle('active', view === 'settings');
    $('#page-label').textContent = views[view][0];
    $('#storage-label').textContent = demo ? '演示模式 · 不保存' : server ? '本地服务 · 多端同步' : '数据保存在此浏览器';
    $('#banner').innerHTML = demo ? '<div class="demo-banner">正在查看演示数据，操作不会影响你的真实记录。<button data-action="exit-demo">返回我的记录</button></div>' : storageError ? `<div class="demo-banner">${escape(storageError)}</div>` : '';
  }
  function heading(title, subtitle = '', actions = '') { return `<div class="page-heading"><div><h1>${title}</h1>${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}</div><div class="heading-actions">${actions}</div></div>`; }
  function metric(label, value, caption, glyph) { return `<div class="card metric"><div class="metric-top"><span>${label}</span>${icon(glyph)}</div><div class="metric-value">${value}</div>${caption ? `<p class="metric-caption">${caption}</p>` : ''}</div>`; }
  function empty(glyph, title, description, action = '') { return `<div class="empty-state"><div class="empty-icon">${icon(glyph)}</div><h3>${title}</h3><p>${description}</p>${action}</div>`; }
  function recordsTable(rows, full = false) {
    return `<div class="table-scroll"><table><thead><tr><th>${full ? '日期 / 时间' : '时间段'}</th><th>做了什么</th><th>分类</th><th>时长</th><th><span class="sr-only">操作</span></th></tr></thead><tbody>${rows.map(r => r.gap ? `<tr class="gap-row"><td class="time-cell">${full ? `<span class="date-small">${C.dateKey(r.start)}</span>` : ''}${C.time(r.start)} — ${C.time(r.end)}${C.dateKey(r.start) !== C.dateKey(r.end) ? '<span class="date-small">至 ' + C.dateKey(r.end) + '</span>' : ''}</td><td colspan="2"><span class="gap-label">尚未记录</span></td><td class="duration-cell">${C.duration(r.end-r.start)}</td><td class="row-actions"><button class="text-button" data-action="fill-gap" data-start="${r.start}" data-end="${r.end}">补录 ${icon('plus')}</button></td></tr>` : `<tr><td class="time-cell">${full ? `<span class="date-small">${C.dateKey(r.start)}</span>` : ''}${C.time(r.start)} — ${C.time(r.end)}${C.dateKey(r.start) !== C.dateKey(r.end) ? '<span class="date-small">至 ' + C.dateKey(r.end) + '</span>' : ''}</td><td class="activity-cell"><span class="category-dot" style="background:${C.CATEGORIES[r.category].color}"></span>${escape(r.title)}</td><td>${categoryBadge(r.category)}</td><td class="duration-cell">${C.duration(r.end-r.start)}</td><td class="row-actions"><button class="icon-button" data-action="edit-record" data-id="${escape(r.id)}" aria-label="编辑 ${escape(r.title)}">${icon('edit')}</button><button class="icon-button" data-action="delete-record" data-id="${escape(r.id)}" aria-label="删除 ${escape(r.title)}">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function distribution(rows) {
    const groups = C.activityDistribution(rows);
    const data = groups.map((group, index) => {
      const shade = Math.round(38 + index * 148 / Math.max(1, groups.length - 1));
      return { ...group, color: `rgb(${shade}, ${shade}, ${shade})` };
    });
    const total = data.reduce((sum, c) => sum+c.ms, 0); let acc = 0;
    const gradient = data.map(c => { const start=acc; acc+=c.ms/total*100; return `${c.color} ${start}% ${acc}%`; }).join(',');
    return `<div class="distribution-content"><div class="donut-wrap"><div class="donut" role="img" aria-label="按做了什么汇总的事项时长，明细见下方" ${total ? `style="background:conic-gradient(${gradient})"` : ''}></div><div class="donut-text">${(total/3600000).toFixed(1)}<span>小时已记录</span></div></div><div class="legend">${data.length ? data.map(c => `<div class="legend-row"><b><span class="category-dot" style="background:${c.color}"></span><span class="legend-title">${escape(c.title)}</span></b><span class="legend-duration">${Math.round(c.ms/total*100)}% · ${C.duration(c.ms)}</span></div>`).join('') : '<p class="muted-empty">暂无统计数据</p>'}</div></div>`;
  }
  function miniTodos(date, limit = 3) {
    const start = C.dayStart(date), todos = state.todos.filter(t => t.start < start+C.DAY && t.end > start).sort(C.compareTodos).slice(0,limit);
    return todos.length ? todos.map(t => {
      const details=C.todoDetails(t), id=escape(t.id), title=escape(t.title);
      return `<div class="mini-todo ${details.done ? 'done' : ''}"><input type="checkbox" ${details.done?'checked':''} data-todo="${id}" aria-label="完成 ${title}"><div class="mini-todo-body"><div class="mini-todo-title">${title}</div><div class="mini-todo-time">${C.time(t.start)} — ${C.time(t.end)}</div><div class="todo-priority-row"><label>优先级<input type="number" min="0" step="1" value="${details.priority}" required data-todo-priority="${id}" aria-label="${title}的优先级"></label><span class="todo-progress-text">进度 <output>${details.progress}%</output></span></div><input class="todo-progress-slider" type="range" min="0" max="100" step="1" value="${details.progress}" data-todo-progress="${id}" aria-label="${title}的完成进度" aria-valuetext="${details.progress}%"></div>${limit > 3 ? `<div class="todo-controls"><button class="icon-button" data-action="edit-todo" data-id="${id}" aria-label="编辑待办">${icon('edit')}</button><button class="icon-button" data-action="delete-todo" data-id="${id}" aria-label="删除待办">${icon('trash')}</button></div>` : ''}</div>`;
    }).join('') : empty('calendar', '暂无待办', '点击下方按钮添加待办。', `<button class="button soft" data-action="new-todo" data-date="${date}">${icon('plus')} 添加待办</button>`);
  }
  function renderToday() {
    const now=Date.now(), rows=C.timeline(state,selectedDate,now), records=rows.filter(r=>!r.gap), total=records.reduce((s,r)=>s+r.end-r.start,0), todayAnchor=C.anchor(state,now), gap=rows.filter(r=>r.gap).reduce((s,r)=>s+r.end-r.start,0);
    const latest=records.at(-1), trailingGap=latest && rows.at(-1)?.gap ? rows.at(-1) : null;
    const displayRows=rows.filter(r=>r!==trailingGap).reverse();
    const dayOfWeek = (new Date(C.dayStart(today)+8*3600000).getUTCDay()+6)%7;
    return heading('饥饿', dateLabel(today), `<div class="date-pill">${icon('sun')}<span id="live-clock">${C.time(now)}</span></div><button class="button" data-action="new-record">${icon('plus')} 手动补录</button>`)+
    `<div class="dashboard"><div class="main-column">${!state.records.length && !demo ? `<div class="welcome-strip"><span>首次发送消息时，请设置今天的记时起点。</span><button class="text-button" data-action="demo">看看示例 ${icon('arrow')}</button></div>`:''}
    <section class="card composer"><div class="composer-top"><span class="soft-icon">${icon('message')}</span><h2>刚刚，做了什么？</h2></div><form id="quick-form"><label class="sr-only" for="quick-title">刚刚做了什么</label><textarea id="quick-title" maxlength="500" placeholder="例如：完成了项目方案，或者散步、读了几页书…" required>${escape(draft)}</textarea><div class="composer-bottom"><div class="composer-meta"><label class="sr-only" for="quick-category">活动分类</label><select id="quick-category">${catOptions(draftCategory,true)}</select><span class="keyboard-hint">Ctrl / ⌘ + Enter 发送</span></div><button class="button primary" type="submit" ${busy?'disabled':''}>记录这一段 ${icon('arrow')}</button></div><p class="anchor-hint" id="anchor-hint">${todayAnchor ? `将记录 ${C.time(todayAnchor)} 至发送时刻 · 已过去 ${C.duration(now-todayAnchor)}`:'今天还没有起点，发送第一条时会请你选择开始时间。'}</p></form><div class="quick-tags"><span>快速填入</span>${['专注工作','阅读学习','吃饭休息','散步运动'].map(t=>`<button class="tag-button" data-action="quick-tag" data-text="${t}">${t}</button>`).join('')}<button class="text-button" data-action="set-start">${todayAnchor?'调整起点':'开始今天'} ${icon('clock')}</button></div></section>
    <div class="metric-grid">${metric('已记录时间',shortDuration(total),dateLabel(selectedDate),'clock')}${metric('完成的事情',`${records.length}<small>件</small>`,'','check')}${metric('最近做的一件事',`<span class="metric-activity">${latest?escape(latest.title):'等待记录'}</span>`,latest?`${C.time(latest.start)} — ${C.time(latest.end)}`:'','leaf')}</div>
    <section class="card timeline-card"><div class="card-header"><h2>一天的时间线<span class="count-badge">${records.length} 条</span></h2><div class="timeline-tools"><label class="sr-only" for="timeline-date">查看日期</label><input type="date" id="timeline-date" value="${selectedDate}" max="${today}"></div></div>${recordsTable(displayRows)}${trailingGap?`<div class="trailing-gap"><span>最近记录之后 · ${C.time(trailingGap.start)} — ${C.time(trailingGap.end)} 尚未记录</span><button class="text-button" data-action="fill-gap" data-start="${trailingGap.start}" data-end="${trailingGap.end}">补录 ${icon('plus')}</button></div>`:''}<div class="table-foot"><span>最新记录在前 · 空档不计入统计</span><span>未记录 ${C.duration(gap)}</span></div></section></div>
    <aside class="side-column"><section class="card small-panel"><div class="panel-title"><h2>事项时长</h2>${icon('chart')}</div><p class="distribution-note">按“做了什么”汇总，相同事项合并</p>${distribution(rows)}</section><section class="card small-panel"><div class="panel-title"><h2>今日待办</h2><button class="text-button" data-view="calendar">日历 ${icon('arrow')}</button></div><div class="week-strip">${Array.from({length:7},(_,i)=>{const d=C.addDays(today,i-dayOfWeek);return `<button class="week-day ${d===today?'active':''}" data-action="calendar-date" data-date="${d}"><b>${['一','二','三','四','五','六','日'][i]}</b><span>${Number(d.slice(8))}</span></button>`}).join('')}</div>${miniTodos(today)}</section></aside></div>`;
  }
  function filteredRecords() { return state.records.filter(r=>C.matches(r,recordQuery,recordCategory)&&(!fromDate||r.end>C.dayStart(fromDate))&&(!toDate||r.start<C.dayStart(toDate)+C.DAY)).sort((a,b)=>b.start-a.start); }
  function renderRecords() {
    const filtered=filteredRecords(), rows=C.recordTimeline(state,{from:fromDate,to:toDate,keyword:recordQuery,category:recordCategory}), pages=Math.max(1,Math.ceil(rows.length/30)); page=Math.min(page,pages);
    const gap=rows.filter(r=>r.gap).reduce((sum,r)=>sum+r.end-r.start,0);
    const total=filtered.reduce((s,r)=>s+Math.max(0,Math.min(r.end,toDate?C.dayStart(toDate)+C.DAY:Infinity)-Math.max(r.start,fromDate?C.dayStart(fromDate):-Infinity)),0);
    return heading('聚焦','',`<button class="button" data-action="export-csv">${icon('download')} 导出 CSV</button><button class="button primary" data-action="new-record">${icon('plus')} 补录</button>`)+`<section class="card"><form id="record-filters" class="filters"><label class="search-field">搜索事项<input name="query" placeholder="输入关键词，如：阅读、工作…" value="${escape(recordQuery)}"></label><label>开始日期<input name="from" type="date" value="${fromDate}" max="${today}"></label><label>结束日期<input name="to" type="date" value="${toDate}" max="${today}"></label><label>分类<select name="category"><option value="">全部分类</option>${catOptions(recordCategory)}</select></label><button class="button primary" type="submit">筛选</button><button class="text-button" type="button" data-action="reset-records">重置</button></form><p class="filter-note">共 ${filtered.length} 条记录 · 所选日期内合计 ${C.duration(total)} · 尚未记录 ${C.duration(gap)}<br>空档按全部真实记录计算，可直接补录；CSV 仅导出实际记录，保留完整时间段。</p>${rows.length?recordsTable(rows.slice((page-1)*30,page*30),true):empty('book','还没有匹配的时间记录','换个关键词，或者从今日记录开始写下第一件事。')}<div class="pagination"><span>第 ${page} / ${pages} 页 · 每页最多 30 行（含空档）</span><div><button class="button" data-action="prev-page" ${page===1?'disabled':''}>上一页</button><button class="button" data-action="next-page" ${page===pages?'disabled':''}>下一页</button></div></div></section>`;
  }
  function chart(daily, kind) {
    const w=560,h=230,left=42,right=12,top=18,bottom=38,plotW=w-left-right,plotH=h-top-bottom,max=Math.max(1,...daily.map(d=>d.ms/3600000)),ceil=Math.ceil(max*2)/2;
    const x=i=>left+(i+.5)*plotW/daily.length,y=ms=>top+plotH*(1-ms/3600000/ceil);
    const ticks=Array.from({length:5},(_,i)=>{const value=ceil*i/4, yy=top+plotH*(1-i/4);return `<line x1="${left}" x2="${w-right}" y1="${yy}" y2="${yy}" stroke="#e7e7e7" stroke-dasharray="3 4"/><text x="${left-10}" y="${yy+4}" text-anchor="end" font-size="10" fill="#777777">${value.toFixed(1)}</text>`}).join('');
    const labels=daily.map((d,i)=>i===0||i===daily.length-1||i%Math.max(1,Math.ceil(daily.length/7))===0?`<text x="${x(i)}" y="${h-13}" text-anchor="middle" fill="#777777" font-size="10">${d.date.slice(5).replace('-','/')}</text>`:'').join('');
    const points=daily.map((d,i)=>`${x(i)},${y(d.ms)}`).join(' '),first=x(0),last=x(daily.length-1),baseline=top+plotH;
    const marks=kind==='line'?`<polygon points="${first},${baseline} ${points} ${last},${baseline}" fill="#eeeeee"/><polyline points="${points}" fill="none" stroke="#252525" stroke-width="2.5" stroke-linejoin="round"/>${daily.map((d,i)=>`<circle cx="${x(i)}" cy="${y(d.ms)}" r="${daily.length>60?1.5:3}" fill="#252525"><title>${d.date}：${C.duration(d.ms)}</title></circle>`).join('')}`:daily.map((d,i)=>`<rect x="${x(i)-plotW/daily.length*.3}" y="${y(d.ms)}" width="${plotW/daily.length*.6}" height="${baseline-y(d.ms)}" rx="${daily.length>50?1:3}" fill="${d.ms===Math.max(...daily.map(d=>d.ms))?'#252525':'#b7b7b7'}"><title>${d.date}：${C.duration(d.ms)}</title></rect>`).join('');
    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${kind==='line'?'折线':'柱状'}图：${daily.length} 天每日时长，单位小时。详细数据见下方表格。">${ticks}${marks}${labels}</svg>`;
  }
  function renderStats() {
    const result=C.statistics(state,statsQuery,statsDays,statsEnd,statsCategory);
    return heading('意志')+`<div class="section-stack"><section class="card"><form class="filters" id="stats-filters"><label class="search-field">想了解哪件事？<input name="query" value="${escape(statsQuery)}" placeholder="输入关键词，如：阅读；留空查看全部"></label><label>分类<select name="category"><option value="">全部分类</option>${catOptions(statsCategory)}</select></label><label class="number-field">过去 N 天<input type="number" name="days" min="1" max="366" value="${statsDays}" required></label><label>截至日期<input type="date" name="end" max="${today}" value="${statsEnd}" required></label><button class="button primary">查看统计 ${icon('arrow')}</button></form><div class="filter-note">${C.addDays(statsEnd,1-statsDays)} 至 ${statsEnd} · 含截至当天 · 日均包含未记录的日期 · 跨天记录按实际时间拆分</div></section><div class="stats-grid">${metric('累计投入',shortDuration(result.total),`${result.count} 条匹配记录`,'clock')}${metric('每日平均',shortDuration(result.average),`总时长 ÷ ${statsDays} 个自然日`,'chart')}${metric('有投入的日子',`${result.activeDays}<small>/ ${statsDays} 天</small>`,'至少有一条匹配记录','calendar')}${metric('单日最高',shortDuration(result.max),result.max?result.daily.find(d=>d.ms===result.max).date:'还没有匹配数据','leaf')}</div><div class="chart-grid"><section class="card chart-panel"><div class="chart-heading"><h2>投入的变化</h2><span>每日时长 / 小时</span></div>${chart(result.daily,'line')}</section><section class="card chart-panel"><div class="chart-heading"><h2>每日时长</h2><span>每日时长 / 小时</span></div>${chart(result.daily,'bar')}</section></div><section class="card chart-panel"><div class="chart-heading"><h2>${result.total?'统计摘要':'还没有找到匹配的记录'}</h2><button class="text-button" data-action="export-stats">${icon('download')} 导出每日统计</button></div><p class="subtitle">${result.total?`在有投入的 ${result.activeDays} 天里，你平均每天花了 ${C.duration(result.activeAverage)}。${statsQuery?'关键词：'+escape(statsQuery)+'。':''}`:'试试其他关键词，或先记录几件做过的事情。没有记录的日期会显示为 0。'}</p><details class="chart-details"><summary>查看每日明细</summary><div class="table-scroll"><table><thead><tr><th>日期</th><th>时长</th><th>分钟</th></tr></thead><tbody>${result.daily.map(d=>`<tr><td>${d.date}</td><td>${C.duration(d.ms)}</td><td>${(d.ms/60000).toFixed(2)}</td></tr>`).join('')}</tbody></table></div></details></section></div>`;
  }
  function renderCalendar() {
    const first=calendarMonth+'-01',offset=(new Date(C.dayStart(first)+8*3600000).getUTCDay()+6)%7,start=C.addDays(first,-offset);
    const cells=Array.from({length:42},(_,i)=>{const date=C.addDays(start,i),a=C.dayStart(date),items=state.todos.filter(t=>t.start<a+C.DAY&&t.end>a).sort(C.compareTodos);return `<button class="calendar-day ${date.slice(0,7)!==calendarMonth?'outside':''} ${date===today?'today':''} ${date===calendarDate?'selected':''}" data-action="select-day" data-date="${date}" aria-label="${date}，${items.length} 项待办" aria-pressed="${date===calendarDate}"><span class="day-num">${Number(date.slice(8))}</span>${items.slice(0,2).map(t=>`<span class="calendar-event ${t.done?'complete':''}" style="--cat:${C.CATEGORIES[t.category].color}">${escape(t.title)}</span>`).join('')}${items.length>2?`<span class="more-events">+${items.length-2} 项</span>`:''}</button>`}).join('');
    const count=state.todos.filter(t=>C.dateKey(t.start)===calendarDate).length;
    return heading('无畏','',`<button class="button primary" data-action="new-todo" data-date="${calendarDate}">${icon('plus')} 新建待办</button>`)+`<div class="calendar-layout"><section class="card calendar-card"><div class="calendar-top"><h2>${calendarMonth.slice(0,4)} 年 ${Number(calendarMonth.slice(5))} 月</h2><div class="month-nav"><button class="icon-button" data-action="prev-month" aria-label="上个月"><span style="transform:rotate(180deg)">${icon('chevron')}</span></button><button class="button" data-action="calendar-today">今天</button><button class="icon-button" data-action="next-month" aria-label="下个月">${icon('chevron')}</button></div></div><div class="calendar-weekdays">${['周一','周二','周三','周四','周五','周六','周日'].map(d=>`<span>${d}</span>`).join('')}</div><div class="calendar-grid">${cells}</div><p class="subtle" style="margin-top:17px">点击日期查看安排 · 完成待办不会自动计入实际用时</p></section><section class="card agenda"><h2>${dateLabel(calendarDate)}</h2><p class="subtle" style="margin:5px 0 17px">${count?`${count} 项待办`:'暂无待办'}</p>${miniTodos(calendarDate,9999)}<div class="agenda-foot"><button class="button soft full-width" data-action="new-todo" data-date="${calendarDate}">${icon('plus')} 添加这一天的待办</button></div></section></div>`;
  }
  function renderSettings() {
    return heading('对抗')+`<div class="settings-grid"><section class="card setting-card"><h2>${icon('cloud')} 数据保存</h2><div class="storage-mode">${server?'本地服务 · 多端同步':'浏览器本地保存'}</div><p>${server?'记录保存在运行服务的电脑 SQLite 数据库中。同一 Wi-Fi 下的手机与电脑可共用数据；电脑上的服务需要保持运行。':'记录保存在当前浏览器，刷新或关闭后仍会保留。不同设备、浏览器或网址之间不会自动同步，清除浏览器数据会删除记录。'}</p><button class="button" data-action="refresh">${icon('refresh')} 刷新数据</button>${server?'<button class="button soft" data-action="connection">'+icon('link')+' 手机连接方式</button>':''}<div class="info-box">${server?'同一账号标识不是云端账号；此服务使用设备访问码。请只把连接地址分享给你自己。':'想让手机和电脑共用记录？在电脑上运行项目内的「start.ps1」，再在同一 Wi-Fi 下打开连接地址。'}</div></section><section class="card setting-card"><h2>${icon('download')} 备份与迁移</h2><p>JSON 备份包含全部时间记录、每日起点和待办，可以完整恢复。CSV 方便在 Excel 或其他表格工具中汇总。</p><button class="button primary" data-action="export-json">${icon('download')} 导出完整备份</button><button class="button" data-action="import-json">${icon('upload')} 导入备份</button><button class="button" data-action="export-all-csv">${icon('table')} 全部记录 CSV</button><input type="file" id="import-file" accept=".json,application/json" hidden><p class="subtle" style="margin-top:15px">当前共 ${state.records.length} 条时间记录、${state.todos.length} 项待办。建议定期备份。</p></section><section class="card setting-card"><h2>${icon('calendar')} 日历与手机使用</h2><p>内置日历支持未来待办、编辑和完成标记。日历计划与实际用时分别保存；做完后，回到「今日记录」发送消息即可记时。</p><button class="button" data-action="export-ics">${icon('download')} 导出待办日历 .ics</button><div class="info-box">手机打开网页后，可从浏览器菜单选择「添加到主屏幕」。本地 HTTP 地址可能仅支持快捷方式；离线网页缓存需要 HTTPS 或 localhost。日历目前不提供系统推送提醒。</div></section><section class="card setting-card"><h2>${icon('book')} 记时约定</h2><ol class="setting-list"><li>每天首次记录时，选择今天从几点开始。</li><li>随后每条消息记录「上一条结束 → 发送时刻」。</li><li>跨午夜后重新选择起点；手动补录可跨日期。</li><li>重叠补录可覆盖指定时段，保留前后剩余部分。</li><li>统计采用北京时间 UTC+8，日均包含零记录日。</li></ol><button class="button soft" data-action="help">使用说明</button><button class="text-button" data-action="demo">查看演示数据 ${icon('arrow')}</button></section></div>`;
  }
  function render() { renderNav(); $('#main').innerHTML = ({today:renderToday,records:renderRecords,stats:renderStats,calendar:renderCalendar,settings:renderSettings})[view](); }
  function navigate(next) { if(!views[next])return; view=next; history.replaceState(null,'','#'+next); render(); window.scrollTo({top:0,behavior:'instant'}); }
  function showModal(title,subtitle,body) { $('#modal-content').innerHTML=`<div class="modal-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><div class="modal-body">${body}</div>`; if(!modal.open)modal.showModal(); }
  function formError(){return '<div id="form-error" class="inline-error" hidden role="alert"></div>';}
  function recordTimeField(name, label, value) {
    const time=C.time(value), [hour, minute]=time.split(':');
    const options=(count, selected)=>Array.from({length:count},(_,i)=>{
      const number=String(i).padStart(2,'0');
      return `<option value="${number}" ${number===selected?'selected':''}>${number}</option>`;
    }).join('');
    return `<fieldset class="record-time-field"><legend>${label}</legend><details class="time-picker"><summary aria-label="选择${label}"><span data-time-display>${time}</span>${icon('chevron')}</summary><div class="time-picker-options"><label>小时<select name="${name}-hour" size="5" aria-label="${label}小时">${options(24,hour)}</select></label><label>分钟<select name="${name}-minute" size="5" aria-label="${label}分钟">${options(60,minute)}</select></label></div></details><label class="record-date-label">日期<input type="date" name="${name}-date" value="${C.dateKey(value)}" required aria-label="${label}日期"></label></fieldset>`;
  }
  function recordTimestamp(form, get, name) {
    const value=get(name+'-date')+'T'+get(name+'-hour')+':'+get(name+'-minute');
    const original=Number(form.dataset[name]);
    // Editing just the description must not round existing second-level boundaries.
    return C.localInput(original)===value ? original : C.parseLocal(value);
  }
  function openRecord(record, start, end) {
    const now=Date.now(); const r=record||{title:'',category:'other',start:start??C.anchor(state,now)??now-3600000,end:end??now};
    showModal(record?'编辑这段时间':'补上一段时间','点击大号时间选择小时和分钟；所有时间均为北京时间。',`<form id="record-form" data-id="${record?escape(record.id):''}" data-start="${r.start}" data-end="${r.end}"><label>做了什么<input name="title" value="${escape(r.title)}" required maxlength="500" placeholder="例如：阅读、散步、完成工作"></label><div class="form-row record-time-row">${recordTimeField('start','开始时间',r.start)}${recordTimeField('end','结束时间',r.end)}</div><label>分类<select name="category">${catOptions(r.category)}</select></label><label class="checkbox-label"><input type="checkbox" name="replace">覆盖重叠部分，保留原记录前后的时间</label><p class="modal-help">没有勾选时，遇到重叠会提示你调整，不会修改原记录。</p>${formError()}<div class="modal-actions"><button class="button" type="button" data-action="close-modal">取消</button><button class="button primary">保存记录</button></div></form>`);
  }
  let pendingQuickEnd=null;
  function openStart(withQuick=false) {
    const now=Date.now(),existing=C.anchor(state,now),start=existing||Math.min(now,C.dayStart(today)+9*3600000);
    pendingQuickEnd=withQuick?now:null;
    showModal(withQuick?'今天，从几点开始？':'设置今天的记时起点',withQuick?'第一条消息将记录从起点到刚才发送消息的时间。':'起点只决定下一条消息从哪里开始，不会改变已有记录。',`<form id="start-form"><label>今天的开始时间<input name="start" type="time" value="${C.time(start)}" required></label><p class="modal-help">起点之前的时间会保留为「尚未记录」，你可以之后补录。${existing?'已有记录时，起点不能早于最后一条结束时间。':''}</p>${formError()}<div class="modal-actions"><button class="button" type="button" data-action="close-modal">取消</button><button class="button primary">${withQuick?'设置起点并记录':'保存起点'}</button></div></form>`);
  }
  function openTodo(todo,date=calendarDate) {
    const now=Date.now(),defaultStart=date===today?Math.ceil((now+60000)/1800000)*1800000:C.dayStart(date)+9*3600000;
    const t=todo||{title:'',category:'work',start:defaultStart,end:defaultStart+3600000,notes:'',priority:state.todos.filter(item=>C.dateKey(item.start)===C.dateKey(defaultStart)).length}, details=C.todoDetails(t);
    showModal(todo?'编辑待办':'新建待办','计划不会占用实际记录；完成后再按真实用时记录。',`<form id="todo-form" data-id="${todo?escape(todo.id):''}"><label>想做什么<input name="title" value="${escape(t.title)}" maxlength="500" required placeholder="例如：整理一周计划"></label><div class="form-row"><label>开始时间<input type="datetime-local" name="start" value="${C.localInput(t.start)}" required></label><label>结束时间<input type="datetime-local" name="end" value="${C.localInput(t.end)}" required></label></div><label>分类<select name="category">${catOptions(t.category)}</select></label><div class="form-row"><label>优先级（从 0 开始）<input type="number" name="priority" min="0" step="1" value="${details.priority}" required></label><label>完成进度（%）<input type="number" name="progress" min="0" max="100" step="1" value="${details.progress}" required></label></div><p class="modal-help todo-priority-help">按开始日期独立排序；填入序号即可插入该位置，其余顺移，超出范围排在末尾。</p><p class="modal-help todo-progress-help">100% 表示已完成；勾选完成设为 100%，取消勾选重置为 0%。</p><label>备注（可选）<textarea name="notes" rows="3" maxlength="2000">${escape(t.notes)}</textarea></label>${formError()}<div class="modal-actions"><button class="button" type="button" data-action="close-modal">取消</button><button class="button primary">保存待办</button></div></form>`);
  }
  function confirmDelete(kind,id) { const item=(kind==='record'?state.records:state.todos).find(r=>r.id===id); if(!item)return; showModal('删除这'+(kind==='record'?'条记录':'项待办')+'？','删除后可以从你之前导出的备份恢复。',`<p style="overflow-wrap:anywhere">${escape(item.title)}</p>${formError()}<div class="modal-actions"><button class="button" data-action="close-modal">取消</button><button class="button danger" data-action="confirm-delete" data-kind="${kind}" data-id="${escape(id)}">确认删除</button></div>`); }
  function showHelp(){showModal('使用说明','记录、补录、统计与待办',`<ol class="help-steps"><li><strong>设置今天的起点</strong>比如 09:00 开始一天；09:40 发送“吃早餐”，就记录 09:00—09:40。</li><li><strong>每做完一件事，就发一句</strong>10:20 发送“阅读”，自动记录 09:40—10:20。输入框接受事项描述，时间由发送时刻确定。</li><li><strong>手动补录</strong>点击「手动补录」指定日期、起止时间和事项；文本中的时间不会自动解析。</li><li><strong>统计与日历</strong>在全部记录里筛选导出，在时间洞察查看过去 N 天的投入，在日历里安排待办。</li></ol><button class="button primary full-width" data-action="close-modal">开始记录</button>`);}
  function demoState() {
    const s=C.emptyState(),now=Date.now();
    for(let i=13;i>=0;i--){const d=C.addDays(today,-i),start=C.dayStart(d);const tasks=[['早餐与通勤','life',8,9],['专注工作 · 项目方案','work',9,10.5+(i%3)*.25],['阅读','study',11,11.5+(i%2)*.25],['午餐和休息','life',12,13],['项目讨论与整理','work',14,15.5],['散步','health',17,17.5]];for(const [title,category,a,b]of tasks){const rs=start+a*3600000,re=Math.min(now-60000,start+b*3600000);if(re>rs)s.records.push({id:C.id(),title,category,start:rs,end:re,createdAt:rs});}s.days[d]=Math.min(now,start+8*3600000);}
    for(let i=0;i<5;i++){const start=C.dayStart(C.addDays(today,i))+[19,10,15,9,20][i]*3600000;s.todos.push({id:C.id(),title:['读完今天的 20 页书','梳理下周的工作安排','去公园散步','一小时专注学习','做晚饭'][i],category:['study','work','health','study','life'][i],start,end:start+3600000,done:false,notes:'',createdAt:now});}return s;
  }
  document.addEventListener('input',e=>{if(e.target.id==='quick-title'){draft=e.target.value;try{safeStorage.set('shiguang-draft',draft);}catch{}}if(e.target.id==='quick-category')draftCategory=e.target.value;});
  document.addEventListener('input',e=>{
    if(e.target.dataset.todoProgress){
      e.target.closest('.mini-todo-body').querySelector('output').textContent=e.target.value+'%';
      e.target.setAttribute('aria-valuetext',e.target.value+'%');
    }
  });
  document.addEventListener('keydown',e=>{if(e.target.id==='quick-title'&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!e.isComposing){e.preventDefault();$('#quick-form').requestSubmit();}});
  document.addEventListener('change',async e=>{
    if(e.target.closest('.time-picker-options')){
      const picker=e.target.closest('.time-picker'), selects=picker.querySelectorAll('select');
      picker.querySelector('[data-time-display]').textContent=selects[0].value+':'+selects[1].value;
    }
    if(e.target.id==='timeline-date'){selectedDate=e.target.value||today;render();}
    const control=e.target, todoId=control.dataset.todo||control.dataset.todoPriority||control.dataset.todoProgress;
    if(todoId){
      const controlKind=control.dataset.todo?'todo':control.dataset.todoPriority?'todoPriority':'todoProgress';
      const restoreFocus=document.activeElement===control, previousView=view;
      const changes=control.dataset.todo?{done:control.checked}:control.dataset.todoPriority?{priority:Number(control.value)}:{progress:Number(control.value)};
      const message=control.dataset.todo?(control.checked?'待办已完成，实际用时可在今日记录中填写。':'已恢复为未完成'):control.dataset.todoPriority?'优先级已更新':'完成进度已更新';
      try{
        if(control.dataset.todoPriority&&(!control.value.trim()||!control.checkValidity()))throw Error('优先级需要是从 0 开始的整数。');
        control.disabled=true;
        await save(C.updateTodo(state,todoId,changes));render();toast(message);
        if(restoreFocus&&view===previousView){
          const replacement=Array.from(document.querySelectorAll('[data-todo],[data-todo-priority],[data-todo-progress]')).find(el=>el.dataset[controlKind]===todoId);
          replacement?.focus({preventScroll:true});
        }
      }catch(error){render();toast(error.message);}
    }
    if(e.target.id==='import-file'&&e.target.files[0]){const file=e.target.files[0];try{if(file.size>20*1024*1024)throw Error('备份不能超过 20 MB。');const raw=JSON.parse(await file.text()),imported=C.validateState(raw.state||raw);window.pendingImport=imported;showModal('恢复这份备份？','这会替换当前的全部记录与待办。建议先导出当前备份。',`<p>备份包含 ${imported.records.length} 条记录、${imported.todos.length} 项待办。</p>${formError()}<div class="modal-actions"><button class="button" data-action="export-json">先导出当前数据</button><button class="button primary" data-action="confirm-import">确认替换</button></div>`);}catch(error){toast('导入失败：'+error.message);}e.target.value='';}
  });
  document.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.target;if(!form.id)return;const fd=new FormData(form),get=name=>String(fd.get(name)||'');
    const submit=form.querySelector('button[type=submit],button:not([type])');
    try{
      if(form.id==='quick-form'){
        draft=$('#quick-title').value.trim();draftCategory=$('#quick-category').value;
        if(!draft)throw Error('请填写刚刚做了什么。');
        const now=Date.now(),start=C.anchor(state,now);if(start===null){openStart(true);return;}
        if(submit)submit.disabled=true;
        await save(C.insertRecord(state,{title:draft,category:draftCategory||C.inferCategory(draft),start,end:now}));draft='';try{safeStorage.set('shiguang-draft','');}catch{}selectedDate=today;render();toast('已记录这一段时间');
      }else if(form.id==='start-form'){
        const start=C.parseLocal(today+'T'+get('start')),now=pendingQuickEnd||Date.now(),last=state.records.filter(r=>r.end<=now&&r.end>=C.dayStart(today)).reduce((m,r)=>Math.max(m,r.end),0);
        if(!Number.isFinite(start)||start>now||start<last)throw Error('起点需要在今天，且不早于最后一条记录的结束时间、不晚于现在。');
        let next={...state,days:{...state.days,[today]:start}};
        if(pendingQuickEnd){next=C.insertRecord(next,{title:draft,category:draftCategory||C.inferCategory(draft),start,end:pendingQuickEnd});}
        if(submit)submit.disabled=true;await save(next);if(pendingQuickEnd){draft='';try{safeStorage.set('shiguang-draft','');}catch{}}pendingQuickEnd=null;modal.close();render();toast('已保存');
      }else if(form.id==='record-form'){
        const old=state.records.find(r=>r.id===form.dataset.id);const next=C.insertRecord(state,{...old,title:get('title'),category:get('category'),start:recordTimestamp(form,get,'start'),end:recordTimestamp(form,get,'end')},{replace:fd.has('replace')});if(submit)submit.disabled=true;await save(next);modal.close();render();toast('时间记录已保存');
      }else if(form.id==='todo-form'){
        const start=C.parseLocal(get('start')),end=C.parseLocal(get('end'));if(!get('title').trim())throw Error('请填写待办事项。');if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('结束时间需要晚于开始时间。');
        if(!get('progress').trim())throw Error('请填写完成进度。');
        if(!get('priority').trim())throw Error('请填写优先级。');
        const details=C.todoDetails({priority:Number(get('priority')),progress:Number(get('progress'))});
        const old=state.todos.find(t=>t.id===form.dataset.id),todo={id:old?.id||C.id(),title:get('title').trim(),category:get('category'),start,end,...details,notes:get('notes'),createdAt:old?.createdAt||Date.now()};
        if(submit)submit.disabled=true;await save(C.insertTodo(state,todo));modal.close();render();toast('日历待办已保存');
      }else if(form.id==='record-filters'){
        if(get('from')&&get('to')&&get('from')>get('to'))throw Error('开始日期不能晚于结束日期。');recordQuery=get('query');recordCategory=get('category');fromDate=get('from');toDate=get('to');page=1;render();
      }else if(form.id==='stats-filters'){statsQuery=get('query');statsCategory=get('category');statsDays=Math.max(1,Math.min(366,Number(get('days'))||7));statsEnd=get('end')||today;render();}
      else if(form.id==='access-form'){token=get('key').trim();await api('/api/state');safeStorage.set(TOKEN,token);modal.close();await initialize();}
    }catch(error){renderError(error);}finally{if(submit)submit.disabled=false;}
  });
  document.addEventListener('click',async e=>{
    const button=e.target.closest('[data-view],[data-action]');if(!button)return;if(button.dataset.view){navigate(button.dataset.view);return;}const a=button.dataset.action;
    try{
      if(a==='close-modal'){modal.close();pendingQuickEnd=null;}
      else if(a==='new-record')openRecord();
      else if(a==='fill-gap')openRecord(null,Number(button.dataset.start),Number(button.dataset.end));
      else if(a==='edit-record')openRecord(state.records.find(r=>r.id===button.dataset.id));
      else if(a==='delete-record')confirmDelete('record',button.dataset.id);
      else if(a==='delete-todo')confirmDelete('todo',button.dataset.id);
      else if(a==='confirm-delete'){button.disabled=true;const field=button.dataset.kind==='record'?'records':'todos';await save(field==='todos'?C.deleteTodo(state,button.dataset.id):{...state,records:state.records.filter(r=>r.id!==button.dataset.id)});modal.close();render();toast('已删除');}
      else if(a==='set-start')openStart();
      else if(a==='quick-tag'){draft=button.dataset.text;$('#quick-title').value=draft;$('#quick-title').focus();}
      else if(a==='new-todo')openTodo(null,button.dataset.date||calendarDate);
      else if(a==='edit-todo')openTodo(state.todos.find(t=>t.id===button.dataset.id));
      else if(a==='calendar-date'){calendarDate=button.dataset.date;calendarMonth=calendarDate.slice(0,7);navigate('calendar');}
      else if(a==='select-day'){calendarDate=button.dataset.date;calendarMonth=calendarDate.slice(0,7);render();}
      else if(a==='calendar-today'){calendarDate=today;calendarMonth=today.slice(0,7);render();}
      else if(a==='prev-month'||a==='next-month'){const d=new Date(calendarMonth+'-15T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+(a==='prev-month'?-1:1));calendarMonth=d.toISOString().slice(0,7);render();}
      else if(a==='prev-page'||a==='next-page'){page+=a==='prev-page'?-1:1;render();}
      else if(a==='reset-records'){recordQuery=recordCategory=fromDate=toDate='';page=1;render();}
      else if(a==='export-csv'||a==='export-all-csv'){const records=a==='export-csv'?filteredRecords():state.records;download('csv',C.csv(records),'text/csv;charset=utf-8');toast('CSV 已导出');}
      else if(a==='export-json')download('json',JSON.stringify({app:'shiguang',exportedAt:new Date().toISOString(),timezone:'Asia/Shanghai',state},null,2),'application/json');
      else if(a==='import-json')$('#import-file').click();
      else if(a==='confirm-import'){button.disabled=true;await save(window.pendingImport);delete window.pendingImport;modal.close();render();toast('备份恢复完成');}
      else if(a==='export-stats'){const r=C.statistics(state,statsQuery,statsDays,statsEnd,statsCategory);download('csv','\uFEFF日期,时长（分钟）,时长（小时）\r\n'+r.daily.map(d=>[d.date,(d.ms/60000).toFixed(2),(d.ms/3600000).toFixed(3)].join(',')).join('\r\n'),'text/csv;charset=utf-8');}
      else if(a==='export-ics')download('ics',C.calendarFile(state.todos),'text/calendar;charset=utf-8');
      else if(a==='help')showHelp();
      else if(a==='refresh'){await refresh();toast('已刷新');}
      else if(a==='demo'){if(!demo){realState=state;state=C.validateState(demoState());demo=true;}navigate('today');}
      else if(a==='exit-demo'){state=realState;realState=null;demo=false;render();await refresh(true);}
      else if(a==='connection'){const info=await api('/api/info');showModal('在手机上打开时光','手机与这台电脑需要连接同一 Wi-Fi。',`<p class="modal-help">在手机浏览器输入以下地址。连接地址包含你的访问码，请只在自己的设备使用。</p>${info.urls.map(url=>`<label style="margin-top:18px">手机连接地址<input readonly value="${escape(url+'/#key='+token)}" aria-label="手机连接地址"></label>`).join('')}<p class="modal-help">电脑需保持开机并运行服务。首次访问如被防火墙阻止，请允许 Python 访问专用网络。</p><div class="modal-actions"><button class="button primary" data-action="close-modal">知道了</button></div>`);}
    }catch(error){renderError(error);button.disabled=false;}
  });
  $('#help-button').innerHTML=icon('help');$('#help-button').dataset.action='help';
  modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close();}});
  window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(views[next]&&next!==view){view=next;render();}});
  window.addEventListener('storage',e=>{if(e.key===KEY&&!server)refresh(true);});
  window.addEventListener('focus',()=>refresh(true));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
  async function initialize(){
    storageError=''; ready=false;
    server=safeStorage.get('shiguang-mode')==='server';
    try{
      if(location.protocol!=='file:'){
        try{const response=await fetch('/api/health',{cache:'no-store',signal:AbortSignal.timeout(2500)});const health=await response.json();if(health.service==='shiguang'){server=true;try{safeStorage.set('shiguang-mode','server');}catch{}}}catch{}
      }
      if(server){const result=await api('/api/state');state=C.validateState(result.state);revision=result.revision;}
      else{const result=readLocal();state=result.state;revision=result.revision;try{safeStorage.set('shiguang-storage-check','1');localStorage.removeItem('shiguang-storage-check');}catch{throw Error('当前浏览器禁用了本地存储，请允许存储或使用本地服务。');}}
      ready=true;render();
    }catch(error){
      if(error.status===401){render();showModal('输入服务访问码','访问码在电脑上的服务启动窗口中。',`<form id="access-form"><label>访问码<input name="key" type="password" required autocomplete="off"></label>${formError()}<div class="modal-actions"><button class="button primary">连接</button></div></form>`);}
      else{storageError=server?'无法加载服务数据。请确认服务正在运行，然后刷新。':'本地数据未能读取：'+error.message+' 原数据没有被改动。';render();}
    }
  }
  await initialize();
  setInterval(()=>{const now=Date.now(),nextToday=C.dateKey(now);if(nextToday!==today){if(selectedDate===today)selectedDate=nextToday;if(statsEnd===today)statsEnd=nextToday;today=nextToday;render();}if($('#live-clock'))$('#live-clock').textContent=C.time(now);if($('#anchor-hint')){const start=C.anchor(state,now);$('#anchor-hint').textContent=start?`将记录 ${C.time(start)} 至发送时刻 · 已过去 ${C.duration(now-start)}`:'今天还没有起点，发送第一条时会请你选择开始时间。';}},15000);
  setInterval(()=>{if(server&&!document.hidden&&!modal.open)refresh(true);},30000);
  if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
