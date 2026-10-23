(() => {
  'use strict';
  const C = window.CONFIG;
  const L = window.Logic;
  const live = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);
  if (live && !window.supabase) {
    document.getElementById('app').innerHTML = '<div class="center-card"><h2>Could not load</h2><p>The Supabase library did not load. Check your internet connection and refresh.</p></div>';
    return;
  }
  const api = live ? window.SupabaseApi.create(C) : window.DemoApi.create(C);
  const app = document.getElementById('app');
  const modal = document.getElementById('modal');

  // ------------------------------------------------------------------ helpers
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => `${C.CURRENCY}${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const STATUS = {
    scheduled: { label: 'Planned', cls: 'planned' },
    pending: { label: 'Waiting for approval', cls: 'pending' },
    approved: { label: 'Approved', cls: 'approved' },
    rejected: { label: 'Sent back', cls: 'rejected' },
    cancelled: { label: 'Cancelled', cls: 'cancelled' },
  };
  const ROLE_LABEL = { admin: 'Admin', teacher: 'Teacher', pending_teacher: 'Teacher (waiting)', student: 'Student', disabled: 'Disabled' };

  const S = {
    session: null, view: null,
    date: L.todayISO(), month: L.todayISO().slice(0, 7),
    profiles: [], people: [], prices: [],
    authTab: 'login', teacherFilter: '', pendingCount: 0,
  };

  const me = () => S.session?.profile;
  const role = () => me()?.role;
  const isAdmin = () => role() === 'admin';
  const isTeacher = () => role() === 'teacher';

  function personById(id) { return S.profiles.find(p => p.id === id) || S.people.find(p => p.id === id); }
  function fullName(p) { return p ? (`${p.first_name || ''} ${p.last_name || ''}`.trim() || p.username || '—') : '—'; }
  const nameOf = id => fullName(personById(id));
  const students = () => S.profiles.filter(p => p.role === 'student').sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const teachers = () => S.profiles.filter(p => ['teacher', 'admin'].includes(p.role)).sort((a, b) => fullName(a).localeCompare(fullName(b)));

  function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg; t.className = `show ${kind}`;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = ''; }, 3500);
  }

  function friendlyError(e) {
    const m = String(e?.message || e || '');
    if (m === 'CONFIRM_EMAIL_ON') return 'Account created, but "Confirm email" is still ON in Supabase. Turn it off (see the setup guide), then log in.';
    if (/Invalid login credentials/i.test(m)) return 'Wrong username or password.';
    if (/already registered|already been registered/i.test(m)) return 'This username is already taken. Please choose another one.';
    if (/Password should be at least/i.test(m)) return 'The password is too short (at least 6 characters).';
    if (/invalid/i.test(m) && /email/i.test(m)) return 'Supabase rejected the login domain. Change USERNAME_EMAIL_DOMAIN in js/config.js (see the setup guide).';
    if (/JSON object requested|0 rows/i.test(m)) return 'You are not allowed to change this.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'No connection. Check your internet and try again.';
    if (/rate limit/i.test(m)) return 'Too many tries. Please wait a minute and try again.';
    return m || 'Something went wrong.';
  }

  function download(filename, text) {
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csv = rows => rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');


  // In-page yes/no question (pop-up dialogs are blocked in some places)
  function ask(message, yes = 'Yes') {
    const dlg = document.getElementById('confirmBox');
    return new Promise(resolve => {
      dlg.innerHTML = `<div class="modal-body"><p class="ask-text"></p></div>
        <footer class="modal-foot"><span class="spacer"></span>
          <button type="button" class="btn ghost" data-ans="0">Cancel</button>
          <button type="button" class="btn primary" data-ans="1"></button></footer>`;
      dlg.querySelector('.ask-text').textContent = message;
      dlg.querySelector('[data-ans="1"]').textContent = yes;
      const done = v => { dlg.close(); resolve(v); };
      dlg.querySelectorAll('[data-ans]').forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); done(b.dataset.ans === '1'); }));
      dlg.oncancel = ev => { ev.preventDefault(); done(false); };
      dlg.showModal();
    });
  }

  // ------------------------------------------------------------------ modal
  let modalSubmit = null;
  function openModal({ title, body, submitLabel = 'Save', onSubmit, extraButtons = '', wide = false }) {
    modal.className = wide ? 'wide' : '';
    modal.innerHTML = `
      <form method="dialog" class="modal-form" novalidate>
        <header class="modal-head"><h3>${esc(title)}</h3>
          <button type="button" class="icon-btn" data-act="closeModal" aria-label="Close">✕</button></header>
        <div class="modal-body">${body}<p class="form-error" hidden></p></div>
        <footer class="modal-foot">${extraButtons}<span class="spacer"></span>
          <button type="button" class="btn ghost" data-act="closeModal">Cancel</button>
          ${onSubmit ? `<button type="submit" class="btn primary">${esc(submitLabel)}</button>` : ''}</footer>
      </form>`;
    modalSubmit = onSubmit;
    modal.showModal();
    const first = modal.querySelector('input:not([type=hidden]):not([type=checkbox]),select,textarea');
    if (first && window.matchMedia('(min-width: 700px)').matches) first.focus();
  }
  function closeModal() { if (modal.open) modal.close(); modalSubmit = null; }
  modal.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!modalSubmit) return closeModal();
    const form = ev.target, err = form.querySelector('.form-error'), btn = form.querySelector('[type=submit]');
    err.hidden = true; btn.disabled = true;
    try {
      const fd = Object.fromEntries(new FormData(form).entries());
      const keepOpen = await modalSubmit(fd, form);
      if (keepOpen !== true) closeModal();
    } catch (e) {
      err.textContent = friendlyError(e); err.hidden = false;
    } finally { btn.disabled = false; }
  });
  modal.addEventListener('click', ev => { if (ev.target === modal) closeModal(); });

  // ------------------------------------------------------------------ boot
  async function boot() {
    try { S.session = await api.getSession(); }
    catch (e) { S.session = null; toast(friendlyError(e), 'error'); }
    if (!S.session) return renderAuth();
    if (!S.session.profile) {
      app.innerHTML = `<div class="center-card"><h2>Almost there</h2>
        <p>Your login works but your profile was not created. Make sure you ran the whole <b>schema.sql</b> file in Supabase before signing up.</p>
        <button class="btn" data-act="signOut">Log out</button></div>`;
      return;
    }
    try { await loadRefs(); } catch (e) { toast(friendlyError(e), 'error'); }
    S.view = defaultView();
    render();
  }

  async function loadRefs() {
    const r = role();
    S.prices = await api.listPrices().catch(() => []);
    S.profiles = (r === 'admin' || r === 'teacher') ? await api.listProfiles() : [me()];
    S.people = await api.listPeople().catch(() => []);
  }

  function navItems() {
    if (isAdmin()) return [['planner', 'Planner'], ['approvals', 'Approvals'], ['students', 'Students'], ['teachers', 'Teachers'], ['report', 'Monthly report'], ['prices', 'Prices'], ['profile', 'My account']];
    if (isTeacher()) return [['planner', 'My day'], ['month', 'My month'], ['profile', 'My account']];
    return [['mylessons', 'My lessons'], ['profile', 'My account']];
  }
  function defaultView() { return navItems()[0][0]; }

  // ------------------------------------------------------------------ render
  function shell(inner) {
    const p = me();
    return `
      ${api.mode === 'demo' ? `<div class="demo-bar">Demo mode — fake data saved only in this browser. <button class="link" data-act="resetDemo">Reset demo</button></div>` : ''}
      <header class="top">
        <div class="brand"><span class="logo" aria-hidden="true">∑</span><span>${esc(C.SITE_NAME)}</span></div>
        <div class="who"><span class="who-name">${esc(fullName(p))}</span><span class="role-pill">${esc(ROLE_LABEL[p.role] || p.role)}</span>
          <button class="btn ghost small" data-act="signOut">Log out</button></div>
      </header>
      <nav class="tabs" aria-label="Sections">
        ${navItems().map(([k, label]) => `<button class="tab ${S.view === k ? 'active' : ''}" data-act="go" data-view="${k}">${esc(label)}${k === 'approvals' && S.pendingCount ? ` <span class="badge">${S.pendingCount}</span>` : ''}</button>`).join('')}
      </nav>
      <main id="main">${inner}</main>`;
  }

  let renderSeq = 0;
  async function render() {
    const r = role();
    if (r === 'pending_teacher' || r === 'disabled') {
      app.innerHTML = `<div class="center-card">
        <h2>${r === 'pending_teacher' ? 'Waiting for approval' : 'Account not active'}</h2>
        <p>${r === 'pending_teacher' ? 'Thanks for signing up as a teacher! The admin needs to approve your account. Check back soon.' : 'This account is not active. Please contact the admin.'}</p>
        <div class="row-gap"><button class="btn primary" data-act="refresh">Check again</button><button class="btn ghost" data-act="signOut">Log out</button></div></div>`;
      return;
    }
    const seq = ++renderSeq;
    if (isAdmin()) {
      try { S.pendingCount = (await api.listLessons({ status: 'pending' })).length; } catch { /* ignore */ }
    }
    if (seq !== renderSeq) return;
    const scrollY = window.scrollY;
    const keepScroll = app.dataset.view === S.view;
    app.innerHTML = shell('<div class="loading">Loading…</div>');
    app.dataset.view = S.view;
    let html;
    try { html = await VIEWS[S.view](); }
    catch (e) { html = `<div class="alert error">${esc(friendlyError(e))}</div>`; }
    if (seq !== renderSeq) return;
    $('#main').innerHTML = html;
    if (keepScroll) window.scrollTo(0, scrollY);
    AFTER[S.view]?.();
  }

  // ------------------------------------------------------------------ pieces
  function statusPill(s) { const x = STATUS[s] || { label: s, cls: '' }; return `<span class="pill ${x.cls}">${esc(x.label)}</span>`; }

  function studentLine(l) {
    const st = personById(l.student_id);
    const units = st?.math_units && /math/i.test(l.subject) && l.level_snapshot >= 10 && l.level_snapshot <= 12 ? ` · ${st.math_units} units` : '';
    return `${esc(nameOf(l.student_id))} <span class="muted">· ${esc(L.levelLabel(l.level_snapshot))}${units}</span>`;
  }

  function lessonCard(l, { showDate = false, showTeacher = false, showStudent = true, studentView = false } = {}) {
    const start = L.timeHM(l.starts_at), end = L.endTime(l.starts_at, l.duration_min);
    const acts = [];
    if (isAdmin()) {
      if (l.status === 'pending') {
        acts.push(`<button class="btn small success" data-act="approve" data-id="${l.id}">✓ Approve</button>`);
        acts.push(`<button class="btn small ghost" data-act="sendBack" data-id="${l.id}">Send back</button>`);
      }
      acts.push(`<button class="btn small ghost" data-act="editLesson" data-id="${l.id}">Edit</button>`);
    } else if (isTeacher() && l.teacher_id === me().id) {
      if (l.status === 'scheduled') acts.push(`<button class="btn small success" data-act="markDone" data-id="${l.id}">✓ Mark as done</button>`);
      if (['scheduled', 'pending', 'rejected'].includes(l.status)) acts.push(`<button class="btn small ghost" data-act="editLesson" data-id="${l.id}">${l.status === 'rejected' ? 'Fix & resubmit' : 'Edit'}</button>`);
    }
    return `
      <article class="lesson ${STATUS[l.status]?.cls || ''}">
        <div class="lesson-time">
          ${showDate ? `<div class="lesson-date">${esc(L.fmtDateShort(l.starts_at))}</div>` : ''}
          <div class="t1">${start}</div><div class="t2">${end}</div><div class="dur">${L.fmtHours(l.duration_min)}</div>
        </div>
        <div class="lesson-main">
          <div class="lesson-head">
            <span class="subject">${esc(l.subject)}</span>${studentView ? '' : statusPill(l.status)}
          </div>
          ${showStudent ? `<div class="lesson-who">👤 ${studentLine(l)}</div>` : ''}
          ${showTeacher ? `<div class="lesson-who">🎓 ${esc(nameOf(l.teacher_id))}</div>` : ''}
          ${l.topic ? `<div class="lesson-topic"><b>${studentView ? 'Prepare:' : 'Plan:'}</b> ${esc(l.topic)}</div>` : ''}
          ${l.teacher_note && !studentView ? `<div class="note"><b>Teacher note:</b> ${esc(l.teacher_note)}</div>` : ''}
          ${l.admin_note && !studentView ? `<div class="note warn"><b>Admin note:</b> ${esc(l.admin_note)}</div>` : ''}
          ${acts.length ? `<div class="lesson-actions">${acts.join('')}</div>` : ''}
        </div>
      </article>`;
  }

  function dayNav() {
    const isToday = S.date === L.todayISO();
    return `
      <div class="toolbar">
        <div class="day-nav">
          <button class="icon-btn" data-act="day" data-delta="-1" aria-label="Previous day">‹</button>
          <div class="day-title"><b>${esc(L.fmtDateLong(S.date))}</b>${isToday ? '<span class="today-tag">Today</span>' : ''}</div>
          <button class="icon-btn" data-act="day" data-delta="1" aria-label="Next day">›</button>
        </div>
        <div class="row-gap">
          <input type="date" class="input small" value="${S.date}" data-change="date" aria-label="Pick a date">
          ${isToday ? '' : '<button class="btn ghost small" data-act="day" data-delta="0">Today</button>'}
          <button class="btn primary small" data-act="newLesson">+ ${isAdmin() ? 'Add lesson' : 'Add a lesson I taught'}</button>
        </div>
      </div>`;
  }

  function monthNav(extra = '') {
    return `
      <div class="toolbar">
        <div class="day-nav">
          <button class="icon-btn" data-act="month" data-delta="-1" aria-label="Previous month">‹</button>
          <div class="day-title"><b>${esc(L.fmtMonth(S.month))}</b></div>
          <button class="icon-btn" data-act="month" data-delta="1" aria-label="Next month">›</button>
        </div>
        <div class="row-gap"><input type="month" class="input small" value="${S.month}" data-change="month" aria-label="Pick a month">${extra}</div>
      </div>`;
  }

  const empty = (title, text = '') => `<div class="empty"><div class="empty-icon">📅</div><b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}</div>`;

  // ------------------------------------------------------------------ views
  const VIEWS = {
    async planner() {
      const [from, to] = L.dayRange(S.date);
      const lessons = await api.listLessons(isTeacher() ? { from, to, teacherId: me().id } : { from, to });
      if (!isAdmin()) {
        const total = lessons.filter(l => l.status !== 'cancelled').reduce((s, l) => s + l.duration_min, 0);
        return `${dayNav()}
          ${lessons.length ? `<p class="summary-line">${lessons.length} lesson${lessons.length > 1 ? 's' : ''} · ${L.fmtHours(total)}</p>` : ''}
          <div class="lessons">${lessons.map(l => lessonCard(l)).join('') || empty('No lessons on this day', 'Lessons the admin plans for you will show up here.')}</div>`;
      }
      const tList = teachers();
      const filter = `<select class="input small" data-change="teacherFilter" aria-label="Filter by teacher">
          <option value="">All teachers</option>
          ${tList.map(t => `<option value="${t.id}" ${S.teacherFilter === t.id ? 'selected' : ''}>${esc(fullName(t))}</option>`).join('')}
        </select>`;
      const shown = S.teacherFilter ? lessons.filter(l => l.teacher_id === S.teacherFilter) : lessons;
      const groups = {};
      for (const l of shown) (groups[l.teacher_id] ||= []).push(l);
      const ids = Object.keys(groups).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      return `${dayNav()}
        <div class="filter-row">${filter}<span class="muted">${shown.length} lesson${shown.length === 1 ? '' : 's'}</span></div>
        ${ids.length ? `<div class="teacher-cols">${ids.map(id => {
          const ls = groups[id], mins = ls.filter(l => l.status !== 'cancelled').reduce((s, l) => s + l.duration_min, 0);
          return `<section class="col"><h3 class="col-head">🎓 ${esc(nameOf(id))} <span class="muted">${ls.length} · ${L.fmtHours(mins)}</span></h3>
            <div class="lessons">${ls.map(l => lessonCard(l)).join('')}</div></section>`;
        }).join('')}</div>` : empty('No lessons on this day', 'Press "+ Add lesson" to plan one.')}`;
    },

    async approvals() {
      const ls = await api.listLessons({ status: 'pending' });
      S.pendingCount = ls.length;
      const byDay = {};
      for (const l of ls) (byDay[L.dateISO(l.starts_at)] ||= []).push(l);
      return `
        <div class="toolbar"><div><h2 class="h2">Lessons waiting for your approval</h2>
          <p class="muted">Teachers marked these as done. Approved lessons count in the monthly report.</p></div>
          ${ls.length > 1 ? `<button class="btn success" data-act="approveAll">✓ Approve all (${ls.length})</button>` : ''}</div>
        ${ls.length ? Object.keys(byDay).sort().map(d => `
          <h3 class="day-head">${esc(L.fmtDateLong(d))}</h3>
          <div class="lessons">${byDay[d].map(l => lessonCard(l, { showTeacher: true })).join('')}</div>`).join('')
          : empty('All caught up! 🎉', 'Nothing is waiting for approval.')}`;
    },

    async students() {
      const list = students();
      const rows = list.map(p => {
        const lvl = L.currentLevel(p);
        const search = `${fullName(p)} ${p.username} ${p.phone} ${L.levelLabel(lvl)}`.toLowerCase();
        return `<tr data-search="${esc(search)}" data-level="${lvl ?? ''}">
          <td><b>${esc(fullName(p))}</b><div class="muted small">@${esc(p.username)}</div></td>
          <td>${esc(L.levelLabel(lvl))}${p.math_units && lvl >= 10 && lvl <= 12 ? ` <span class="muted">· ${p.math_units} units</span>` : ''}</td>
          <td><a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></td>
          <td class="right"><button class="btn small ghost" data-act="editPerson" data-id="${p.id}">Edit</button></td></tr>`;
      }).join('');
      return `
        <div class="toolbar"><div><h2 class="h2">Students <span class="muted">(${list.length})</span></h2>
          <p class="muted">Grades go up by one automatically every September 1st. After grade 12 they show as Graduated.</p></div></div>
        <div class="filter-row">
          <input class="input" type="search" placeholder="Search name, phone, username…" id="studentSearch" aria-label="Search students">
          <select class="input small" id="levelFilter" aria-label="Filter by grade"><option value="">All grades</option>
            ${L.LEVELS.map(l => `<option value="${l}">${esc(L.levelLabel(l))}</option>`).join('')}</select>
        </div>
        ${list.length ? `<div class="table-wrap"><table class="table" id="studentsTable">
          <thead><tr><th>Name</th><th>Grade now</th><th>Phone</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
          : empty('No students yet', 'Students appear here after they sign up on the website.')}`;
    },

    async teachers() {
      const pend = S.profiles.filter(p => p.role === 'pending_teacher');
      const list = teachers();
      const [from, to] = L.monthRange(L.todayISO().slice(0, 7));
      const ls = (await api.listLessons({ from, to })).filter(l => l.status === 'approved');
      const mins = id => ls.filter(l => l.teacher_id === id).reduce((s, l) => s + l.duration_min, 0);
      return `
        ${pend.length ? `<section class="card highlight"><h2 class="h2">New teacher sign-ups</h2>
          ${pend.map(p => `<div class="pend-row"><div><b>${esc(fullName(p))}</b> <span class="muted">@${esc(p.username)} · ${esc(p.phone)}</span></div>
            <div class="row-gap"><button class="btn small success" data-act="approveTeacher" data-id="${p.id}">Approve</button>
            <button class="btn small ghost" data-act="declineTeacher" data-id="${p.id}">Decline</button></div></div>`).join('')}</section>` : ''}
        <div class="toolbar"><div><h2 class="h2">Teachers <span class="muted">(${list.length})</span></h2>
          <p class="muted">New teachers sign up on the website with "I'm a teacher", then you approve them here.</p></div></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Name</th><th>Phone</th><th>Pay / hour</th><th>Approved this month</th><th></th></tr></thead>
          <tbody>${list.map(p => `<tr>
            <td><b>${esc(fullName(p))}</b>${p.role === 'admin' ? ' <span class="pill planned">Admin</span>' : ''}<div class="muted small">@${esc(p.username)}</div></td>
            <td><a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></td>
            <td>${money(p.pay_rate)}</td>
            <td>${L.fmtHours(mins(p.id))}</td>
            <td class="right"><button class="btn small ghost" data-act="editPerson" data-id="${p.id}">Edit</button></td></tr>`).join('')}</tbody>
        </table></div>`;
    },

    async report() {
      const [from, to] = L.monthRange(S.month);
      const all = await api.lessonsWithMoney(from, to);
      const ok = all.filter(l => l.status === 'approved');
      const waiting = all.filter(l => l.status === 'pending').length;
      const notDone = all.filter(l => l.status === 'scheduled' && new Date(l.starts_at) < new Date()).length;
      const sum = (arr, k) => arr.reduce((s, x) => s + Number(x[k] || 0), 0);
      const byT = {}, byS = {};
      for (const l of ok) { (byT[l.teacher_id] ||= []).push(l); (byS[l.student_id] ||= []).push(l); }
      const income = sum(ok, 'student_price'), pay = sum(ok, 'teacher_pay');
      S._report = { ok, byT, byS };
      const noPrices = S.prices.every(p => !Number(p.hourly_price));
      const tRows = Object.keys(byT).sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map(id => {
        const a = byT[id];
        return `<tr><td><b>${esc(nameOf(id))}</b></td><td>${a.length}</td><td>${L.fmtHours(sum(a, 'duration_min'))}</td><td><b>${money(sum(a, 'teacher_pay'))}</b></td></tr>`;
      }).join('');
      const sRows = Object.keys(byS).sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map(id => {
        const a = byS[id], p = personById(id);
        return `<tr><td><b>${esc(nameOf(id))}</b><div class="muted small">${esc(p?.phone || '')}</div></td><td>${esc(L.levelLabel(a[a.length - 1].level_snapshot))}</td><td>${a.length}</td><td>${L.fmtHours(sum(a, 'duration_min'))}</td><td><b>${money(sum(a, 'student_price'))}</b></td></tr>`;
      }).join('');
      return `${monthNav(`<button class="btn ghost small" data-act="recalc">Recalculate prices</button>`)}
        ${noPrices ? `<div class="alert warn">Your prices are still ${money(0)}. Set them in the <button class="link" data-act="go" data-view="prices">Prices</button> tab, then press "Recalculate prices".</div>` : ''}
        ${waiting ? `<div class="alert warn">${waiting} lesson${waiting > 1 ? 's are' : ' is'} still waiting for approval this month and ${waiting > 1 ? 'are' : 'is'} not counted yet. <button class="link" data-act="go" data-view="approvals">Review now</button></div>` : ''}
        ${notDone ? `<div class="alert">${notDone} planned lesson${notDone > 1 ? 's' : ''} in the past ${notDone > 1 ? 'were' : 'was'} not marked as done by the teacher yet.</div>` : ''}
        <div class="stats">
          <div class="stat"><span>Approved lessons</span><b>${ok.length}</b><small>${L.fmtHours(sum(ok, 'duration_min'))}</small></div>
          <div class="stat"><span>Students pay</span><b>${money(income)}</b><small>income</small></div>
          <div class="stat"><span>Pay teachers</span><b>${money(pay)}</b><small>expenses</small></div>
          <div class="stat good"><span>You keep</span><b>${money(income - pay)}</b><small>profit</small></div>
        </div>
        <section class="card"><div class="card-head"><h2 class="h2">Pay each teacher</h2><button class="btn small ghost" data-act="csv" data-kind="teachers">Download</button></div>
          ${tRows ? `<div class="table-wrap"><table class="table"><thead><tr><th>Teacher</th><th>Lessons</th><th>Hours</th><th>To pay</th></tr></thead><tbody>${tRows}</tbody></table></div>` : '<p class="muted">No approved lessons this month.</p>'}</section>
        <section class="card"><div class="card-head"><h2 class="h2">Collect from each student</h2><button class="btn small ghost" data-act="csv" data-kind="students">Download</button></div>
          ${sRows ? `<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Grade</th><th>Lessons</th><th>Hours</th><th>To collect</th></tr></thead><tbody>${sRows}</tbody></table></div>` : '<p class="muted">No approved lessons this month.</p>'}</section>
        ${ok.length ? `<details class="card"><summary><b>All approved lessons (${ok.length})</b></summary>
          <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Teacher</th><th>Student</th><th>Subject</th><th>Time</th><th>Price</th><th>Teacher pay</th></tr></thead>
          <tbody>${ok.map(l => `<tr><td>${esc(L.fmtDateShort(l.starts_at))}</td><td>${esc(nameOf(l.teacher_id))}</td><td>${esc(nameOf(l.student_id))}</td><td>${esc(l.subject)}</td><td>${L.timeHM(l.starts_at)} · ${L.fmtHours(l.duration_min)}</td><td>${money(l.student_price)}</td><td>${money(l.teacher_pay)}</td></tr>`).join('')}</tbody></table></div>
          <div class="card-foot"><button class="btn small ghost" data-act="csv" data-kind="lessons">Download all lessons</button></div></details>` : ''}`;
    },

    async prices() {
      S.prices = await api.listPrices();
      return `
        <div class="toolbar"><div><h2 class="h2">Prices per hour</h2>
          <p class="muted">What a student pays for one hour, based on their grade on the lesson date. A 90-minute lesson costs 1.5×. Teacher pay is set per teacher in the Teachers tab.</p></div></div>
        <section class="card"><form id="pricesForm" class="price-list">
          ${S.prices.map(g => `<label class="price-row"><span>${esc(g.label)}</span>
            <span class="money-input"><span>${esc(C.CURRENCY)}</span><input class="input" type="number" min="0" step="1" name="${esc(g.key)}" value="${Number(g.hourly_price)}"></span></label>`).join('')}
          <div class="card-foot"><button class="btn primary" type="submit">Save prices</button></div>
        </form></section>
        <p class="muted small">Changing prices does not change lessons that already exist. To apply new prices to a month, open the Monthly report and press "Recalculate prices".</p>`;
    },

    async month() {
      const [y, m] = S.month.split('-').map(Number);
      const [from, to] = L.monthRange(S.month);
      const [sum, ls] = await Promise.all([api.myMonthSummary(y, m), api.listLessons({ from, to, teacherId: me().id })]);
      const count = s => ls.filter(l => l.status === s).length;
      return `${monthNav()}
        <div class="stats">
          <div class="stat good"><span>Approved</span><b>${sum.lessons}</b><small>${L.fmtHours(sum.minutes)}</small></div>
          <div class="stat"><span>Your pay</span><b>${money(sum.pay)}</b><small>approved lessons</small></div>
          <div class="stat"><span>Waiting</span><b>${count('pending')}</b><small>for approval</small></div>
          <div class="stat ${count('rejected') ? 'bad' : ''}"><span>Sent back</span><b>${count('rejected')}</b><small>need fixing</small></div>
        </div>
        <h2 class="h2">All my lessons in ${esc(L.fmtMonth(S.month))}</h2>
        <div class="lessons">${ls.map(l => lessonCard(l, { showDate: true })).join('') || empty('No lessons this month')}</div>`;
    },

    async mylessons() {
      const today = L.todayISO();
      const [upFrom] = L.dayRange(today);
      const upTo = L.toUTC(L.addDays(today, 90));
      const pastFrom = L.toUTC(L.addDays(today, -60));
      const [up, past] = await Promise.all([
        api.listLessons({ from: upFrom, to: upTo, studentId: me().id }),
        api.listLessons({ from: pastFrom, to: upFrom, studentId: me().id }),
      ]);
      const upcoming = up.filter(l => l.status !== 'cancelled');
      const done = past.filter(l => ['approved', 'pending'].includes(l.status)).reverse();
      const p = me(), lvl = L.currentLevel(p);
      return `
        <section class="card hello"><h2 class="h2">Hi ${esc(p.first_name || p.username)} 👋</h2>
          <p class="muted">${esc(L.levelLabel(lvl))}${p.math_units && lvl >= 10 && lvl <= 12 ? ` · Math ${p.math_units} units` : ''}</p></section>
        <h2 class="h2">Upcoming lessons</h2>
        <div class="lessons">${upcoming.map(l => lessonCard(l, { showDate: true, showTeacher: true, showStudent: false, studentView: true })).join('') || empty('No upcoming lessons yet', 'When your lessons are scheduled, they will show here.')}</div>
        ${done.length ? `<h2 class="h2">Past lessons</h2><div class="lessons">${done.map(l => lessonCard(l, { showDate: true, showTeacher: true, showStudent: false, studentView: true })).join('')}</div>` : ''}`;
    },

    async profile() {
      const p = me(), lvl = L.currentLevel(p);
      return `
        <section class="card narrow"><h2 class="h2">My account</h2>
          <form id="profileForm" class="form">
            <div class="grid2">
              <label>First name<input class="input" name="first_name" value="${esc(p.first_name)}" required maxlength="60"></label>
              <label>Family name<input class="input" name="last_name" value="${esc(p.last_name)}" required maxlength="60"></label>
            </div>
            <label>Phone<input class="input" name="phone" type="tel" value="${esc(p.phone)}" maxlength="30"></label>
            <p class="muted small">Username: <b>@${esc(p.username)}</b>${p.role === 'student' ? ` · ${esc(L.levelLabel(lvl))} (only the admin can change the grade)` : ''}</p>
            <div class="card-foot"><button class="btn primary" type="submit">Save</button></div>
          </form></section>
        <section class="card narrow"><h2 class="h2">Change password</h2>
          <form id="passwordForm" class="form">
            <label>New password<input class="input" name="password" type="password" minlength="6" autocomplete="new-password" required></label>
            <label>Repeat new password<input class="input" name="password2" type="password" minlength="6" autocomplete="new-password" required></label>
            <div class="card-foot"><button class="btn" type="submit">Change password</button></div>
          </form></section>`;
    },
  };

  // after-render hooks (inputs that filter without re-rendering)
  const AFTER = {
    students() {
      const s = $('#studentSearch'), f = $('#levelFilter');
      if (!s) return;
      const apply = () => {
        const q = s.value.trim().toLowerCase(), lv = f.value;
        for (const tr of $$('#studentsTable tbody tr')) {
          tr.hidden = !(tr.dataset.search.includes(q) && (!lv || tr.dataset.level === lv));
        }
      };
      s.addEventListener('input', apply); f.addEventListener('change', apply);
    },
    prices() {
      $('#pricesForm')?.addEventListener('submit', async ev => {
        ev.preventDefault();
        try {
          const fd = new FormData(ev.target);
          for (const [k, v] of fd.entries()) await api.updatePrice(k, Math.max(0, Number(v) || 0));
          S.prices = await api.listPrices();
          toast('Prices saved', 'ok');
        } catch (e) { toast(friendlyError(e), 'error'); }
      });
    },
    profile() {
      $('#profileForm')?.addEventListener('submit', async ev => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(ev.target).entries());
        try {
          const p = await api.updateProfile(me().id, { first_name: fd.first_name.trim(), last_name: fd.last_name.trim(), phone: fd.phone.trim() });
          S.session.profile = p; render(); toast('Saved', 'ok');
        } catch (e) { toast(friendlyError(e), 'error'); }
      });
      $('#passwordForm')?.addEventListener('submit', async ev => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(ev.target).entries());
        if (fd.password.length < 6) return toast('At least 6 characters.', 'error');
        if (fd.password !== fd.password2) return toast('The two passwords are different.', 'error');
        try { await api.changePassword(fd.password); ev.target.reset(); toast('Password changed', 'ok'); }
        catch (e) { toast(friendlyError(e), 'error'); }
      });
    },
  };

  // ------------------------------------------------------------------ lesson form
  function durationOptions(cur) {
    const opts = [30, 45, 60, 75, 90, 105, 120, 150, 180];
    if (!opts.includes(cur)) opts.push(cur);
    return opts.sort((a, b) => a - b).map(m => `<option value="${m}" ${m === cur ? 'selected' : ''}>${L.fmtHours(m)}</option>`).join('');
  }

  async function lessonForm(existing) {
    const admin = isAdmin();
    const l = existing || {
      teacher_id: admin ? (S.teacherFilter || '') : me().id, student_id: '', subject: C.SUBJECTS[0],
      starts_at: L.toUTC(S.date, '16:00'), duration_min: C.DEFAULT_DURATION, status: admin ? 'scheduled' : 'pending',
      topic: '', teacher_note: '', admin_note: '',
    };
    const subjects = [...new Set([...C.SUBJECTS, l.subject].filter(Boolean))];
    const studentOpts = students().map(p => `<option value="${p.id}" ${p.id === l.student_id ? 'selected' : ''}>${esc(fullName(p))} — ${esc(L.levelLabel(L.currentLevel(p)))}</option>`).join('');
    const canDelete = existing && (admin || (existing.created_by === me().id && ['pending', 'rejected'].includes(existing.status)));
    const teacherHint = !admin ? (existing
      ? (existing.status === 'rejected' ? `<div class="alert warn">The admin sent this back${existing.admin_note ? `: “${esc(existing.admin_note)}”` : ''}. Fix it and save to resubmit.</div>` : '')
      : '<div class="alert">Lessons you add go to the admin for approval.</div>') : '';

    openModal({
      title: existing ? 'Edit lesson' : (admin ? 'Add a lesson' : 'Add a lesson I taught'),
      wide: true,
      body: `${teacherHint}
        ${admin ? `<label>Teacher<select class="input" name="teacher_id" required><option value="">Choose a teacher…</option>
          ${teachers().map(t => `<option value="${t.id}" ${t.id === l.teacher_id ? 'selected' : ''}>${esc(fullName(t))}</option>`).join('')}</select></label>` : ''}
        <label>Student<select class="input" name="student_id" required><option value="">Choose a student…</option>${studentOpts}</select></label>
        <div class="grid2">
          <label>Subject<select class="input" name="subject">${subjects.map(s => `<option ${s === l.subject ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
          <label>Duration<select class="input" name="duration_min">${durationOptions(l.duration_min)}</select></label>
        </div>
        <div class="grid2">
          <label>Date<input class="input" type="date" name="date" value="${L.dateISO(l.starts_at)}" required></label>
          <label>Start time<input class="input" type="time" name="time" step="300" value="${L.timeHM(l.starts_at)}" required></label>
        </div>
        <label>${admin ? 'Plan for the lesson (teacher and student see this)' : 'What did you teach?'}<textarea class="input" name="topic" rows="2" maxlength="500" placeholder="e.g. Bagrut 5 units – derivatives, bring the workbook">${esc(l.topic)}</textarea></label>
        <label>Teacher note<textarea class="input" name="teacher_note" rows="2" maxlength="500" placeholder="${admin ? 'Optional' : 'Optional – how did it go?'}">${esc(l.teacher_note)}</textarea></label>
        ${admin ? `<div class="grid2">
          <label>Status<select class="input" name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === l.status ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
          <label>Admin note<input class="input" name="admin_note" value="${esc(l.admin_note)}" maxlength="300" placeholder="Optional"></label></div>`
        : (existing && existing.status === 'scheduled' ? `<label class="check"><input type="checkbox" name="done" value="1"> This lesson is done — send it for approval</label>` : '')}`,
      extraButtons: canDelete ? `<button type="button" class="btn danger ghost" data-act="deleteLesson" data-id="${existing.id}">Delete</button>` : '',
      onSubmit: async fd => {
        if (admin && !fd.teacher_id) throw new Error('Please choose a teacher');
        if (!fd.student_id) throw new Error('Please choose a student');
        const data = {
          student_id: fd.student_id, subject: fd.subject, duration_min: Number(fd.duration_min),
          starts_at: L.toUTC(fd.date, fd.time), topic: fd.topic.trim(), teacher_note: fd.teacher_note.trim(),
        };
        if (admin) { data.teacher_id = fd.teacher_id; data.status = fd.status; data.admin_note = fd.admin_note.trim(); }
        else if (existing) data.status = existing.status === 'scheduled' ? (fd.done ? 'pending' : 'scheduled') : 'pending';

        // double-booking check
        const teacherId = admin ? data.teacher_id : me().id;
        const [from, to] = L.dayRange(fd.date);
        const sameDay = await api.listLessons(admin ? { from, to } : { from, to, teacherId });
        const clash = sameDay.filter(o => o.id !== existing?.id && o.status !== 'cancelled' && L.overlaps(o, data)
          && (o.teacher_id === teacherId || o.student_id === data.student_id));
        if (clash.length) {
          const what = clash.map(o => `${L.timeHM(o.starts_at)} ${nameOf(o.teacher_id)} with ${nameOf(o.student_id)}`).join('\n');
          if (!(await ask(`This overlaps with:\n${what}\n\nSave anyway?`))) return true;
        }
        if (existing) await api.updateLesson(existing.id, data); else await api.createLesson(data);
        if (!existing || L.dateISO(data.starts_at) !== S.date) S.date = fd.date;
        toast(existing ? 'Lesson saved' : (admin ? 'Lesson added' : 'Lesson sent for approval'), 'ok');
        render();
      },
    });
  }

  function personForm(p) {
    const isStudent = p.role === 'student';
    const lvl = L.currentLevel(p);
    openModal({
      title: `Edit ${fullName(p)}`,
      body: `
        <div class="grid2">
          <label>First name<input class="input" name="first_name" value="${esc(p.first_name)}" maxlength="60"></label>
          <label>Family name<input class="input" name="last_name" value="${esc(p.last_name)}" maxlength="60"></label>
        </div>
        <label>Phone<input class="input" name="phone" type="tel" value="${esc(p.phone)}" maxlength="30"></label>
        ${isStudent ? `<div class="grid2">
          <label>Grade now<select class="input" name="level"><option value="">—</option>${L.LEVELS.map(x => `<option value="${x}" ${x === lvl ? 'selected' : ''}>${esc(L.levelLabel(x))}</option>`).join('')}</select></label>
          <label>Math bagrut units<select class="input" name="math_units"><option value="">—</option>${[3, 4, 5].map(u => `<option value="${u}" ${u === p.math_units ? 'selected' : ''}>${u} units</option>`).join('')}</select></label>
        </div>` : `<label>Pay per hour (${esc(C.CURRENCY)})<input class="input" type="number" min="0" step="1" name="pay_rate" value="${Number(p.pay_rate)}"></label>`}
        <label>Account type<select class="input" name="role" ${p.id === me().id ? 'disabled' : ''}>
          ${['student', 'teacher', 'admin', 'disabled'].map(r => `<option value="${r}" ${r === p.role ? 'selected' : ''}>${esc(ROLE_LABEL[r])}</option>`).join('')}</select></label>
        <label>Private notes (only admin)<textarea class="input" name="notes" rows="2" maxlength="1000">${esc(p.notes)}</textarea></label>
        <p class="muted small">Username: @${esc(p.username)}</p>`,
      onSubmit: async fd => {
        const patch = { first_name: fd.first_name.trim(), last_name: fd.last_name.trim(), phone: fd.phone.trim(), notes: fd.notes };
        if (fd.role && p.id !== me().id) patch.role = fd.role;
        if (isStudent) {
          const newLvl = fd.level ? Number(fd.level) : null;
          if (newLvl !== lvl) { patch.level_base = newLvl; patch.level_base_year = newLvl ? L.schoolYear(L.todayISO()) : null; }
          patch.math_units = fd.math_units ? Number(fd.math_units) : null;
        } else patch.pay_rate = Math.max(0, Number(fd.pay_rate) || 0);
        const updated = await api.updateProfile(p.id, patch);
        const i = S.profiles.findIndex(x => x.id === p.id); if (i >= 0) S.profiles[i] = updated;
        toast('Saved', 'ok'); render();
      },
    });
  }

  // ------------------------------------------------------------------ auth screen
  function renderAuth() {
    const demo = api.mode === 'demo';
    const signup = S.authTab === 'signup';
    app.dataset.view = 'auth';
    app.innerHTML = `
      ${demo ? '<div class="demo-bar">Demo mode — try it with fake data. Nothing is sent anywhere.</div>' : ''}
      <div class="auth-wrap">
        <div class="auth-hero">
          <div class="logo big" aria-hidden="true">∑</div>
          <h1>${esc(C.SITE_NAME)}</h1>
          <p>Private lessons in ${esc(C.SUBJECTS.join(', ').replace(/, ([^,]*)$/, ' and $1'))} — from elementary school through Bagrut (3, 4 & 5 units) and first-year college.</p>
        </div>
        <section class="card auth-card">
          <div class="seg" role="tablist">
            <button role="tab" class="${!signup ? 'active' : ''}" data-act="authTab" data-tab="login">Log in</button>
            <button role="tab" class="${signup ? 'active' : ''}" data-act="authTab" data-tab="signup">Sign up</button>
          </div>
          ${signup ? `
          <form id="signupForm" class="form">
            <div class="seg small" role="radiogroup" aria-label="I am a">
              <label><input type="radio" name="account_type" value="student" checked> I'm a student</label>
              <label><input type="radio" name="account_type" value="teacher"> I'm a teacher</label>
            </div>
            <div class="grid2">
              <label>First name<input class="input" name="first_name" required maxlength="60" autocomplete="given-name"></label>
              <label>Family name<input class="input" name="last_name" required maxlength="60" autocomplete="family-name"></label>
            </div>
            <label>Phone number<input class="input" name="phone" type="tel" required maxlength="30" autocomplete="tel" placeholder="05X-XXXXXXX"></label>
            <div class="grid2 student-only">
              <label>Grade<select class="input" name="level">${L.LEVELS.filter(x => x <= 13).map(x => `<option value="${x}">${esc(L.levelLabel(x))}</option>`).join('')}</select></label>
              <label class="units">Math bagrut units<select class="input" name="math_units"><option value="">Not sure / none</option><option value="3">3 units</option><option value="4">4 units</option><option value="5">5 units</option></select></label>
            </div>
            <label>Username<input class="input" name="username" required pattern="[A-Za-z0-9._\\-]{3,30}" autocomplete="username" placeholder="letters and numbers, e.g. adam.n"></label>
            <label>Password<input class="input" name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="at least 6 characters"></label>
            <p class="form-error" hidden></p>
            <button class="btn primary block" type="submit">Create account</button>
          </form>` : `
          <form id="loginForm" class="form">
            <label>Username<input class="input" name="username" required autocomplete="username"></label>
            <label>Password<input class="input" name="password" type="password" ${demo ? '' : 'required'} autocomplete="current-password"></label>
            <p class="form-error" hidden></p>
            <button class="btn primary block" type="submit">Log in</button>
            <p class="muted small center">Forgot your password? Ask the admin to reset it.</p>
          </form>
          ${demo ? `<div class="demo-logins"><p class="muted small">Try the demo as:</p>
            <div class="row-gap"><button class="btn small" data-act="demoLogin" data-u="admin">Admin (you)</button>
            <button class="btn small" data-act="demoLogin" data-u="rami">Teacher</button>
            <button class="btn small" data-act="demoLogin" data-u="adam">Student</button></div></div>` : ''}`}
        </section>
      </div>`;

    const showErr = (form, e) => { const el = form.querySelector('.form-error'); el.textContent = friendlyError(e); el.hidden = false; };
    $('#loginForm')?.addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = ev.target, fd = Object.fromEntries(new FormData(f).entries()), btn = f.querySelector('button');
      btn.disabled = true;
      try { await api.signIn(fd.username.trim(), fd.password); await boot(); }
      catch (e) { showErr(f, e); } finally { btn.disabled = false; }
    });
    const sf = $('#signupForm');
    if (sf) {
      const sync = () => {
        const teacher = sf.querySelector('input[name=account_type]:checked')?.value === 'teacher';
        sf.querySelector('.student-only').hidden = teacher;
        const lv = Number(sf.querySelector('select[name=level]').value);
        sf.querySelector('.units').hidden = teacher || lv < 10 || lv > 12;
      };
      sf.addEventListener('change', sync); sync();
      sf.addEventListener('submit', async ev => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(sf).entries()), btn = sf.querySelector('button[type=submit]');
        if (!/^[A-Za-z0-9._-]{3,30}$/.test(fd.username)) return showErr(sf, 'Username: 3–30 letters, numbers, dots, dashes or underscores (no spaces).');
        if (fd.password.length < 6) return showErr(sf, 'The password is too short (at least 6 characters).');
        if (!fd.first_name.trim() || !fd.last_name.trim() || !fd.phone.trim()) return showErr(sf, 'Please fill in your name and phone number.');
        const teacher = fd.account_type === 'teacher', lv = Number(fd.level);
        btn.disabled = true;
        try {
          await api.signUp({
            account_type: fd.account_type, username: fd.username.trim(), password: fd.password,
            first_name: fd.first_name.trim(), last_name: fd.last_name.trim(), phone: fd.phone.trim(),
            level: teacher ? null : lv, math_units: !teacher && lv >= 10 && lv <= 12 ? fd.math_units : null,
          });
          await boot();
        } catch (e) { showErr(sf, e); } finally { btn.disabled = false; }
      });
    }
  }

  // ------------------------------------------------------------------ actions
  const findLesson = id => api.getLesson(id);

  const ACT = {
    go: el => { S.view = el.dataset.view; closeModal(); render(); window.scrollTo(0, 0); },
    closeModal,
    refresh: () => boot(),
    async signOut() { await api.signOut(); S.session = null; S.authTab = 'login'; renderAuth(); },
    async resetDemo() { if (!(await ask('Reset all demo data?'))) return; await api.resetDemo(); S.session = null; renderAuth(); },
    authTab: el => { S.authTab = el.dataset.tab; renderAuth(); },
    async demoLogin(el) { await api.signIn(el.dataset.u, ''); await boot(); },
    day: el => { const d = Number(el.dataset.delta); S.date = d === 0 ? L.todayISO() : L.addDays(S.date, d); render(); },
    month: el => {
      const [y, m] = S.month.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + Number(el.dataset.delta), 1));
      S.month = `${d.getUTCFullYear()}-${L.pad(d.getUTCMonth() + 1)}`; render();
    },
    newLesson: () => {
      if (!students().length) return toast('No students yet. Students need to sign up first.', 'error');
      if (isAdmin() && !teachers().length) return toast('No teachers yet.', 'error');
      lessonForm(null);
    },
    async editLesson(el) { const l = await findLesson(el.dataset.id); if (l) lessonForm(l); },
    async deleteLesson(el) {
      if (!(await ask('Delete this lesson?'))) return;
      try { await api.deleteLesson(el.dataset.id); closeModal(); toast('Lesson deleted'); render(); }
      catch (e) { toast(friendlyError(e), 'error'); }
    },
    async approve(el) {
      try { await api.updateLesson(el.dataset.id, { status: 'approved' }); toast('Approved ✓', 'ok'); render(); }
      catch (e) { toast(friendlyError(e), 'error'); }
    },
    async approveAll() {
      const ls = await api.listLessons({ status: 'pending' });
      if (!ls.length || !(await ask(`Approve all ${ls.length} lessons?`))) return;
      try { await api.updateLessons(ls.map(l => l.id), { status: 'approved' }); toast(`${ls.length} lessons approved ✓`, 'ok'); render(); }
      catch (e) { toast(friendlyError(e), 'error'); }
    },
    sendBack(el) {
      openModal({
        title: 'Send back to the teacher',
        body: `<label>What should the teacher fix?<textarea class="input" name="note" rows="3" maxlength="300" placeholder="e.g. The lesson was 60 minutes, not 90" required></textarea></label>`,
        submitLabel: 'Send back',
        onSubmit: async fd => {
          await api.updateLesson(el.dataset.id, { status: 'rejected', admin_note: fd.note.trim() });
          toast('Sent back to the teacher'); render();
        },
      });
    },
    markDone(el) {
      openModal({
        title: 'Mark lesson as done',
        body: `<p class="muted">It will be sent to the admin for approval.</p>
          <label>Note (optional)<textarea class="input" name="note" rows="2" maxlength="500" placeholder="How did it go? Homework given?"></textarea></label>`,
        submitLabel: '✓ Done',
        onSubmit: async fd => {
          const patch = { status: 'pending' };
          if (fd.note.trim()) patch.teacher_note = fd.note.trim();
          await api.updateLesson(el.dataset.id, patch);
          toast('Sent for approval ✓', 'ok'); render();
        },
      });
    },
    editPerson(el) { const p = S.profiles.find(x => x.id === el.dataset.id); if (p) personForm(p); },
    approveTeacher(el) {
      const p = S.profiles.find(x => x.id === el.dataset.id);
      openModal({
        title: `Approve ${fullName(p)} as a teacher`,
        body: `<label>Pay per hour (${esc(C.CURRENCY)})<input class="input" type="number" min="0" step="1" name="pay_rate" value="0" required></label>
          <p class="muted small">You can change this later in the Teachers tab.</p>`,
        submitLabel: 'Approve',
        onSubmit: async fd => {
          const u = await api.updateProfile(p.id, { role: 'teacher', pay_rate: Math.max(0, Number(fd.pay_rate) || 0) });
          S.profiles[S.profiles.findIndex(x => x.id === p.id)] = u;
          toast('Teacher approved ✓', 'ok'); render();
        },
      });
    },
    async declineTeacher(el) {
      if (!(await ask('Decline this teacher? Their account will be disabled.'))) return;
      try {
        const u = await api.updateProfile(el.dataset.id, { role: 'disabled' });
        S.profiles[S.profiles.findIndex(x => x.id === u.id)] = u; render();
      } catch (e) { toast(friendlyError(e), 'error'); }
    },
    async recalc() {
      if (!(await ask(`Recalculate grades and prices for all lessons in ${L.fmtMonth(S.month)} using the current prices and teacher pay?`))) return;
      try { const n = await api.recalcMoney(...L.monthRange(S.month)); toast(`Updated ${n} lessons`, 'ok'); render(); }
      catch (e) { toast(friendlyError(e), 'error'); }
    },
    csv(el) {
      const R = S._report; if (!R) return;
      const sum = (a, k) => a.reduce((s, x) => s + Number(x[k] || 0), 0);
      const kind = el.dataset.kind, ym = S.month;
      if (kind === 'teachers') download(`teachers-${ym}.csv`, csv([['Teacher', 'Phone', 'Lessons', 'Minutes', 'To pay'],
        ...Object.entries(R.byT).map(([id, a]) => [nameOf(id), personById(id)?.phone, a.length, sum(a, 'duration_min'), sum(a, 'teacher_pay')])]));
      if (kind === 'students') download(`students-${ym}.csv`, csv([['Student', 'Phone', 'Grade', 'Lessons', 'Minutes', 'To collect'],
        ...Object.entries(R.byS).map(([id, a]) => [nameOf(id), personById(id)?.phone, L.levelLabel(a[a.length - 1].level_snapshot), a.length, sum(a, 'duration_min'), sum(a, 'student_price')])]));
      if (kind === 'lessons') download(`lessons-${ym}.csv`, csv([['Date', 'Start', 'Minutes', 'Teacher', 'Student', 'Grade', 'Subject', 'Plan', 'Price', 'Teacher pay'],
        ...R.ok.map(l => [L.dateISO(l.starts_at), L.timeHM(l.starts_at), l.duration_min, nameOf(l.teacher_id), nameOf(l.student_id), L.levelLabel(l.level_snapshot), l.subject, l.topic, l.student_price, l.teacher_pay])]));
    },
  };

  document.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-act]');
    if (!el || !ACT[el.dataset.act]) return;
    ev.preventDefault();
    try { await ACT[el.dataset.act](el, ev); } catch (e) { toast(friendlyError(e), 'error'); }
  });
  document.addEventListener('change', ev => {
    const el = ev.target.closest('[data-change]');
    if (!el) return;
    const k = el.dataset.change;
    if (k === 'date' && el.value) S.date = el.value;
    if (k === 'month' && el.value) S.month = el.value;
    if (k === 'teacherFilter') S.teacherFilter = el.value;
    render();
  });

  boot();
})();
