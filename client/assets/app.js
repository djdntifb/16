const TOKEN_KEY        = 'halifax_token_v1';
const STORAGE_KEY_TIMER = 'halifax_active_timer_v4';

const state = {
  currentUser: null,
  token: null,
  timer: { running: false, start: null, clientId: null, intervalId: null },
  settings: {},
  clients: [],
  users: [],
  rates: [],
  timesheetEntries: [],
  reportRows: [],
  lastInvoiceHTML: null,
  pendingInvoice: null,
};

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

// ─── API helper ───────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login') {
      logout();
      return;
    }
    throw Object.assign(new Error(data.detail || 'Request failed'), { status: res.status });
  }
  return data;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function login() {
  const email = $('#email').value.trim();
  const pass  = $('#password').value.trim();
  try {
    const resp = await api('POST', '/api/auth/login', { email, password: pass });
    state.token       = resp.access_token;
    state.currentUser = resp.user;
    localStorage.setItem(TOKEN_KEY, state.token);
    await loadReferenceData();
    $('#active-user').textContent = `${resp.user.name} (${resp.user.role})`;
    updateNav(resp.user.role);
    checkResumeTimer();
    show('timer');
  } catch (e) {
    alert(e.status === 401 ? 'Invalid credentials' : `Login failed: ${e.message}`);
  }
}

function logout() {
  state.token = null;
  state.currentUser = null;
  state.clients = []; state.users = []; state.rates = []; state.settings = {};
  localStorage.removeItem(TOKEN_KEY);
  clearActiveTimer();
  $('#nav').classList.add('hidden');
  show('login');
}

async function loadReferenceData() {
  const role = state.currentUser?.role;
  const fetches = [
    api('GET', '/api/clients').then(d => { state.clients = d; }),
    api('GET', '/api/settings').then(d => { state.settings = d; }),
  ];
  if (role === 'Admin' || role === 'Manager') {
    fetches.push(api('GET', '/api/users').then(d => { state.users = d; }));
    fetches.push(api('GET', '/api/rates').then(d => { state.rates = d; }));
  }
  await Promise.all(fetches);
  hydrateClients();
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function show(v) {
  ['login','timer','timesheet','reports','approvals','invoices','admin'].forEach(x =>
    $('#' + x + '-view')?.classList.add('hidden')
  );
  $('#' + v + '-view')?.classList.remove('hidden');
  if (v !== 'login') $('#nav').classList.remove('hidden');
  if (v === 'timesheet') renderTimesheet();
  if (v === 'approvals') renderApprovals();
  if (v === 'reports')   renderReports();
  if (v === 'admin')     renderAdmin();
  if (v === 'invoices')  renderInvoiceHistory();
}

function updateNav(role) {
  const rules = {
    timer: true, timesheet: true, reports: true,
    approvals: role === 'Admin' || role === 'Manager',
    invoices:  role === 'Admin',
    admin:     role === 'Admin',
  };
  Object.entries(rules).forEach(([view, visible]) => {
    const btn = $(`#nav button[data-view="${view}"]`);
    if (btn) btn.classList.toggle('nav-hidden', !visible);
  });
}

// ─── Reference data helpers ───────────────────────────────────────────────────

function hydrateClients() {
  const fill = (sel, extra) => {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = extra || '';
    state.clients.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name;
      el.appendChild(o);
    });
  };
  fill('#client-select');
  fill('#man-client');
  fill('#invoice-client');
  fill('#rpt-client', '<option value="">All Clients</option>');
  const g = $('#gen-invoice');
  if (g) g.disabled = false;
}

function clientName(id) {
  const c = state.clients.find(c => c.id === id);
  return c ? c.name : id;
}

function getRate(userId, clientId) {
  const r = state.rates
    .filter(r => r.user_id === userId && r.client_id === clientId)
    .sort((a, b) => (b.effective_from || '') > (a.effective_from || '') ? 1 : -1)[0];
  return r ? parseFloat(r.rate) : 0;
}

// ─── Resume timer ─────────────────────────────────────────────────────────────

function checkResumeTimer() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_TIMER) || 'null');
    if (!saved?.start_iso) return;
    const tz = state.settings?.timezone || 'America/New_York';
    const startDisplay = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz
    }).format(new Date(saved.start_iso));
    const banner = $('#resume-banner');
    if (!banner) return;
    banner.innerHTML =
      `Timer running since ${startDisplay} for ${escHtml(clientName(saved.client_id))}.` +
      ` <button id="resume-btn" class="ghost" style="padding:4px 10px">Resume</button>` +
      ` <button id="discard-btn" style="padding:4px 10px;background:transparent;border:1px solid #A24B4B;color:#A24B4B;border-radius:8px;cursor:pointer">Discard</button>`;
    banner.classList.remove('hidden');
    $('#resume-btn').addEventListener('click', () => resumeTimer(saved));
    $('#discard-btn').addEventListener('click', () => { clearActiveTimer(); banner.classList.add('hidden'); });
  } catch (e) {}
}

function resumeTimer(saved) {
  if (!state.currentUser) return;
  state.timer = { running: true, start: new Date(saved.start_iso), clientId: saved.client_id, intervalId: null };
  $('#client-select').value = saved.client_id;
  $('#start-stop-btn').textContent = 'Stop';
  state.timer.intervalId = setInterval(tickTimer, 500);
  setManualEntryDisabled(true);
  $('#resume-banner').classList.add('hidden');
}

function clearActiveTimer() {
  try { localStorage.removeItem(STORAGE_KEY_TIMER); } catch (e) {}
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function tickTimer() {
  $('#timer-display').textContent = fmtH(new Date() - state.timer.start);
}

function fmtH(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

function tzDate(date) {
  const tz = state.settings?.timezone || 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
}

function tzTime(date) {
  const tz = state.settings?.timezone || 'America/New_York';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function setManualEntryDisabled(disabled) {
  ['#man-date','#man-start','#man-end','#man-client','#man-note','#man-add'].forEach(s => {
    const el = $(s); if (el) el.disabled = disabled;
  });
  $('#manual-running-note')?.classList.toggle('hidden', !disabled);
}

function startStopTimer() {
  if (!state.currentUser) return;
  if (!state.timer.running) {
    state.timer.running  = true;
    state.timer.clientId = $('#client-select').value;
    state.timer.start    = new Date();
    $('#start-stop-btn').textContent = 'Stop';
    state.timer.intervalId = setInterval(tickTimer, 500);
    setManualEntryDisabled(true);
    localStorage.setItem(STORAGE_KEY_TIMER, JSON.stringify({
      user_id:   state.currentUser.id,
      client_id: state.timer.clientId,
      start_iso: state.timer.start.toISOString(),
    }));
  } else {
    $('#stop-modal').classList.remove('hidden');
    $('#work-note').focus();
  }
}

async function saveStop() {
  const note = $('#work-note').value.trim();
  if (!note) return alert('Please enter a brief description.');

  const end      = new Date();
  const start    = state.timer.start;
  const date     = tzDate(start);
  const startStr = tzTime(start);
  const endStr   = tzTime(end);

  let allowOverlap = false;
  if (hasOverlap(date, startStr, endStr, null)) {
    if (!confirm(`This overlaps an existing entry on ${date}. Save anyway?`)) return;
    allowOverlap = true;
  }

  try {
    const entry = await api('POST', '/api/entries', {
      client_id:     state.timer.clientId,
      date,
      start_time:    startStr,
      end_time:      endStr,
      description:   note,
      allow_overlap: allowOverlap,
    });

    const rawH  = (timeToMs(endStr) - timeToMs(startStr)) / 3600000;
    const hours = parseFloat(entry.hours);
    const diff  = Math.abs(hours - rawH);

    state.timesheetEntries.unshift(entry);

    $('#stop-modal').classList.add('hidden');
    clearInterval(state.timer.intervalId);
    state.timer = { running: false, start: null, clientId: null, intervalId: null };
    clearActiveTimer();
    $('#start-stop-btn').textContent = 'Start';
    $('#timer-display').textContent  = '00:00:00';
    $('#work-note').value = '';
    setManualEntryDisabled(false);

    toast(`Saved ${hours.toFixed(2)} hrs${diff > 0.001 ? ` (rounded from ${rawH.toFixed(2)})` : ''}`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ─── Stop modal ───────────────────────────────────────────────────────────────

function closeStopModal() {
  $('#stop-modal')?.classList.add('hidden');
  if (state.timer?.intervalId) clearInterval(state.timer.intervalId);
  state.timer = { running: false, start: null, clientId: null, intervalId: null };
  clearActiveTimer();
  setManualEntryDisabled(false);
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#stop-modal').classList.contains('hidden'))  closeStopModal();
  if (!$('#admin-modal').classList.contains('hidden')) closeAdminModal();
});

// ─── Keyboard shortcut: Space to start/stop timer ─────────────────────────────

document.addEventListener('keydown', e => {
  if (e.code !== 'Space') return;
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const tag = document.activeElement?.tagName;
  if (['INPUT','TEXTAREA','SELECT','BUTTON'].includes(tag)) return;
  if (!state.currentUser) return;
  if ($('#timer-view')?.classList.contains('hidden')) return;
  if (!$('#stop-modal')?.classList.contains('hidden')) return;
  e.preventDefault();
  startStopTimer();
});

window.addEventListener('click', e => {
  for (const [modalId, cardId, closeFn] of [
    ['stop-modal',  'stop-modal-card',  closeStopModal],
    ['admin-modal', 'admin-modal-card', closeAdminModal],
  ]) {
    const modal = document.getElementById(modalId);
    const card  = document.getElementById(cardId);
    if (modal && !modal.classList.contains('hidden') && !card.contains(e.target)) closeFn();
  }
});

window.addEventListener('beforeunload', e => {
  if (state.timer.running) { e.preventDefault(); e.returnValue = ''; }
});

// ─── Manual entry ─────────────────────────────────────────────────────────────

async function addManualEntry() {
  if (!state.currentUser) return;
  const date     = $('#man-date').value;
  const start    = $('#man-start').value;
  const end      = $('#man-end').value;
  const clientId = $('#man-client').value;
  const note     = $('#man-note').value.trim();

  if (!date || !start || !end || !clientId) return alert('Please fill in all fields.');
  if (!note) return alert('Please enter a description.');
  if (timeToMs(end) <= timeToMs(start)) return alert('End time must be after start time.');

  let allowOverlap = false;
  if (hasOverlap(date, start, end, null)) {
    if (!confirm(`This overlaps an existing entry on ${date}. Save anyway?`)) return;
    allowOverlap = true;
  }

  const rawH = (timeToMs(end) - timeToMs(start)) / 3600000;

  try {
    const entry = await api('POST', '/api/entries', {
      client_id: clientId, date, start_time: start, end_time: end, description: note,
      allow_overlap: allowOverlap,
    });

    const hours = parseFloat(entry.hours);
    const diff  = Math.abs(hours - rawH);

    state.timesheetEntries.unshift(entry);
    $('#man-date').value = $('#man-start').value = $('#man-end').value = $('#man-note').value = '';

    toast(`Added ${hours.toFixed(2)} hrs${diff > 0.001 ? ` (rounded from ${rawH.toFixed(2)})` : ''}`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function timeToMs(t) {
  const [h, m] = t.split(':').map(Number);
  return (h * 60 + m) * 60000;
}

function hasOverlap(date, start, end, excludeId) {
  const s = timeToMs(start), e = timeToMs(end);
  return state.timesheetEntries.some(en => {
    if (en.id === excludeId) return false;
    if (en.user_id !== state.currentUser?.id) return false;
    if (en.date !== date) return false;
    if (en.status === 'rejected') return false;
    const es = timeToMs(en.start_time.slice(0, 5));
    const ee = timeToMs(en.end_time.slice(0, 5));
    return es < e && ee > s;
  });
}

// ─── Timesheet ────────────────────────────────────────────────────────────────

async function renderTimesheet() {
  const { start, end } = getPeriodRange($('#ts-period')?.value || 'month');
  const tbody = $('#timesheet-table tbody');
  const tfoot = $('#timesheet-table tfoot');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#A6B2AD">Loading…</td></tr>';
  tfoot.innerHTML = '';

  try {
    const params = new URLSearchParams();
    if (start) params.set('period_start', start);
    if (end)   params.set('period_end', end);
    const entries = await api('GET', `/api/entries?${params}`);
    state.timesheetEntries = entries;

    const draftEntries = entries.filter(e => e.status === 'draft');
    const tsSubmitBtn = $('#ts-submit');
    if (tsSubmitBtn) {
      if (draftEntries.length > 0) {
        tsSubmitBtn.textContent = `Submit ${draftEntries.length} Draft(s)`;
        tsSubmitBtn.classList.remove('hidden');
      } else {
        tsSubmitBtn.classList.add('hidden');
      }
    }

    tbody.innerHTML = '';
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#A6B2AD">No entries for this period.</td></tr>';
      return;
    }

    let total = 0;
    entries.forEach(e => {
      const hours = parseFloat(e.hours);
      total += hours;
      const canEdit = e.status === 'draft' || e.status === 'pending';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${e.date}</td>
        <td>${escHtml(e.client.name)}</td>
        <td>${e.start_time.slice(0, 5)}</td><td>${e.end_time.slice(0, 5)}</td>
        <td>${hours.toFixed(2)}</td>
        <td><span class="badge ${e.status}">${e.status}</span></td>
        <td>${escHtml(e.description)}</td>
        <td>${canEdit
          ? `<button class="ghost" style="padding:4px 10px;font-size:13px" onclick="openEditEntry('${e.id}')">Edit</button>
             <button class="ghost" style="padding:4px 10px;font-size:13px;border-color:#A24B4B;color:#E07070" onclick="deleteEntry('${e.id}')">Delete</button>`
          : ''}</td>`;
      tbody.appendChild(tr);
    });

    tfoot.innerHTML = `<tr class="tfoot-total">
      <td colspan="4" style="text-align:right">Total</td>
      <td>${total.toFixed(2)}</td><td colspan="3"></td></tr>`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#E07070">${escHtml(e.message)}</td></tr>`;
  }
}

async function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  try {
    await api('DELETE', `/api/entries/${id}`);
    state.timesheetEntries = state.timesheetEntries.filter(e => e.id !== id);
    renderTimesheet();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ─── Edit entry ───────────────────────────────────────────────────────────────

function openEditEntry(id) {
  const entry = state.timesheetEntries.find(e => e.id === id);
  if (!entry) return;
  if (entry.status !== 'draft' && entry.status !== 'pending') return;

  const clientOptions = state.clients.map(c =>
    `<option value="${escHtml(c.id)}"${c.id === entry.client_id ? ' selected' : ''}>${escHtml(c.name)}</option>`
  ).join('');

  const bodyHtml = `
    <div class="grid-2" style="margin-bottom:12px">
      <div><label>Date</label><input id="ee-date" type="date" value="${escHtml(entry.date)}"></div>
      <div><label>Client</label><select id="ee-client">${clientOptions}</select></div>
    </div>
    <div class="grid-2" style="margin-bottom:12px">
      <div><label>Start</label><input id="ee-start" type="time" value="${escHtml(entry.start_time.slice(0, 5))}"></div>
      <div><label>End</label><input id="ee-end" type="time" value="${escHtml(entry.end_time.slice(0, 5))}"></div>
    </div>
    <div style="margin-bottom:12px"><label>Description</label><textarea id="ee-desc" rows="3">${escHtml(entry.description)}</textarea></div>`;

  openAdminModal('Edit Entry', bodyHtml, async () => {
    const date     = $('#ee-date').value;
    const start    = $('#ee-start').value;
    const end      = $('#ee-end').value;
    const clientId = $('#ee-client').value;
    const desc     = $('#ee-desc').value.trim();

    if (!date || !start || !end || !clientId) return alert('Please fill in all fields.');
    if (!desc) return alert('Please enter a description.');
    if (timeToMs(end) <= timeToMs(start)) return alert('End time must be after start time.');
    let allowOverlap = false;
    if (hasOverlap(date, start, end, id)) {
      if (!confirm(`This overlaps an existing entry on ${date}. Save anyway?`)) return;
      allowOverlap = true;
    }

    const updated = await api('PUT', `/api/entries/${id}`, {
      client_id: clientId, date, start_time: start, end_time: end, description: desc,
      allow_overlap: allowOverlap,
    });

    const idx = state.timesheetEntries.findIndex(e => e.id === id);
    if (idx !== -1) state.timesheetEntries[idx] = updated;
    closeAdminModal();
    renderTimesheet();
    toast('Entry updated');
  });
}

// ─── Submit week for approval ──────────────────────────────────────────────────

async function submitDrafts() {
  const { start, end } = getPeriodRange($('#ts-period')?.value || 'month');
  const draftCount = state.timesheetEntries.filter(e => e.status === 'draft').length;
  if (!draftCount) return;

  if (!confirm(`Submit ${draftCount} draft entr${draftCount === 1 ? 'y' : 'ies'} for approval?`)) return;

  try {
    const params = new URLSearchParams();
    if (start) params.set('period_start', start);
    if (end)   params.set('period_end', end);
    await api('POST', `/api/entries/submit-week?${params}`);
    await renderTimesheet();
    toast(`${draftCount} entr${draftCount === 1 ? 'y' : 'ies'} submitted for approval`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ─── Approvals ────────────────────────────────────────────────────────────────

function getWeekEnding(dateStr) {
  const dayIndex = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
  const endDay = dayIndex[state.settings?.week_ending || 'Sunday'];
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const daysUntil = (endDay - date.getDay() + 7) % 7;
  const end = new Date(y, m - 1, d + daysUntil);
  return `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
}

async function renderApprovals() {
  const tbody = $('#approvals-table tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#A6B2AD">Loading…</td></tr>';
  const role   = state.currentUser?.role;
  const canAct = role === 'Admin' || role === 'Manager';

  try {
    const entries = await api('GET', '/api/entries?status=pending');

    if (!entries.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#A6B2AD">${canAct ? 'No entries pending approval.' : 'No entries.'}</td></tr>`;
      return;
    }

    tbody.innerHTML = '';

    if (canAct) {
      const groups = {};
      entries.forEach(e => {
        const key = `${getWeekEnding(e.date)}|${e.user_id}`;
        (groups[key] = groups[key] || []).push(e);
      });

      Object.entries(groups).sort(([a],[b]) => a.localeCompare(b)).forEach(([key, grpEntries]) => {
        const weekEnd = key.split('|')[0];
        const totalH  = grpEntries.reduce((s, e) => s + parseFloat(e.hours), 0);
        const ids     = JSON.stringify(grpEntries.map(e => e.id));

        const hrow = document.createElement('tr');
        hrow.className = 'week-header';
        hrow.innerHTML = `
          <td colspan="5">
            <strong>Week ending ${weekEnd}</strong> &mdash; ${escHtml(grpEntries[0].user.name)}
            <span class="muted">${grpEntries.length} entries &middot; ${totalH.toFixed(2)} hrs</span>
          </td>
          <td colspan="2">
            <button class="primary"    style="padding:4px 10px;font-size:13px" onclick='bulkApprove(${ids})'>Approve All</button>
            <button class="btn-reject" style="padding:4px 10px;font-size:13px" onclick='bulkReject(${ids})'>Reject All</button>
          </td>`;
        tbody.appendChild(hrow);

        grpEntries.forEach(e => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="padding-left:24px">${escHtml(e.user.name)}</td>
            <td>${e.date}</td>
            <td>${escHtml(e.client.name)}</td>
            <td>${parseFloat(e.hours).toFixed(2)}</td>
            <td>${escHtml(e.description)}</td>
            <td><span class="badge ${e.status}">${e.status}</span></td>
            <td>
              <button class="primary"    style="padding:4px 10px;font-size:13px" onclick="approveEntry('${e.id}')">Approve</button>
              <button class="btn-reject" style="padding:4px 10px;font-size:13px" onclick="rejectEntry('${e.id}')">Reject</button>
            </td>`;
          tbody.appendChild(tr);
        });
      });
    } else {
      entries.forEach(e => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escHtml(e.user.name)}</td><td>${e.date}</td>
          <td>${escHtml(e.client.name)}</td>
          <td>${parseFloat(e.hours).toFixed(2)}</td>
          <td>${escHtml(e.description)}</td>
          <td><span class="badge ${e.status}">${e.status}</span></td>
          <td></td>`;
        tbody.appendChild(tr);
      });
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#E07070">${escHtml(e.message)}</td></tr>`;
  }
}

async function approveEntry(id) {
  try { await api('POST', `/api/entries/${id}/approve`); renderApprovals(); }
  catch (e) { toast(e.message, 'error'); }
}

async function rejectEntry(id) {
  try { await api('POST', `/api/entries/${id}/reject`); renderApprovals(); }
  catch (e) { toast(e.message, 'error'); }
}

async function bulkApprove(ids) {
  try {
    await Promise.all(ids.map(id => api('POST', `/api/entries/${id}/approve`)));
    toast(`Approved ${ids.length} entries`); renderApprovals();
  } catch (e) { toast(e.message, 'error'); renderApprovals(); }
}

async function bulkReject(ids) {
  try {
    await Promise.all(ids.map(id => api('POST', `/api/entries/${id}/reject`)));
    toast(`Rejected ${ids.length} entries`); renderApprovals();
  } catch (e) { toast(e.message, 'error'); renderApprovals(); }
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

function setupInvoices() {
  $('#gen-invoice').addEventListener('click', () => {
    const clientId = $('#invoice-client').value;
    const month    = $('#invoice-month').value;
    if (!clientId || !month) return alert('Please select a client and month.');
    previewInvoice(clientId, month);
  });
  $('#dl-invoice').addEventListener('click', downloadInvoice);
  $('#print-invoice').addEventListener('click', printInvoice);
}

function monthToRange(month) {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const pad = n => String(n).padStart(2, '0');
  return { period_start: `${y}-${pad(m)}-01`, period_end: `${y}-${pad(m)}-${pad(lastDay)}` };
}

function buildInvoiceHTML(clientId, month, invNum, entries, totalAmount) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return '<p>Client not found.</p>';
  if (!entries.length) return '<p style="color:#A6B2AD">No approved entries for this client and month.</p>';

  const [year, mon] = month.split('-').map(Number);
  const settings   = state.settings || {};
  const monthLabel = new Date(year, mon - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });

  const byConsultant = {};
  entries.forEach(e => (byConsultant[e.user_id] = byConsultant[e.user_id] || []).push(e));

  let rows = '';
  Object.entries(byConsultant).forEach(([userId, ents]) => {
    const rate = getRate(userId, clientId);
    ents.forEach(e => {
      const hours  = parseFloat(e.hours);
      const amount = hours * rate;
      rows += `<tr>
        <td style="padding:8px">${e.date}</td>
        <td style="padding:8px">${escHtml(e.user.name)}</td>
        <td style="padding:8px">${e.start_time.slice(0,5)}–${e.end_time.slice(0,5)}</td>
        <td style="padding:8px;text-align:right">${hours.toFixed(2)}</td>
        <td style="padding:8px;text-align:right">$${rate.toFixed(2)}</td>
        <td style="padding:8px;text-align:right">$${amount.toFixed(2)}</td>
        <td style="padding:8px">${escHtml(e.description)}</td>
      </tr>`;
    });
  });

  const grandTotal = parseFloat(totalAmount);

  const logoHtml = settings.logo_url
    ? `<img src="${escHtml(settings.logo_url)}" style="height:48px;margin-bottom:8px" alt="logo"><br>` : '';

  const paymentNotesHtml = settings.payment_notes
    ? `<div style="margin-top:16px;padding:12px;border:1px solid #1E3A30;border-radius:8px">
        <strong style="color:#D9C7A0">Payment Instructions</strong>
        <p style="color:#A6B2AD;font-size:13px;margin:8px 0 0">${escHtml(settings.payment_notes)}</p>
       </div>` : '';

  return `
    <div style="border:1px solid #1E3A30;border-radius:14px;padding:24px;margin-top:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:24px">
        <div>
          ${logoHtml}<h2 style="margin:0">${escHtml(settings.company_name || 'Halifax Time')}</h2>
          <p style="color:#A6B2AD;margin:4px 0">Invoice #${invNum} &mdash; ${monthLabel}</p>
        </div>
        <div style="text-align:right">
          <strong>${escHtml(client.name)}</strong><br>
          <span style="color:#A6B2AD">${escHtml(client.address || '')}</span><br>
          <span style="color:#A6B2AD">${escHtml(client.billing_email || '')}</span>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="color:#D9C7A0;border-bottom:1px solid #1E3A30">
          <th style="text-align:left;padding:8px">Date</th>
          <th style="text-align:left;padding:8px">Consultant</th>
          <th style="text-align:left;padding:8px">Time</th>
          <th style="text-align:right;padding:8px">Hours</th>
          <th style="text-align:right;padding:8px">Rate</th>
          <th style="text-align:right;padding:8px">Amount</th>
          <th style="text-align:left;padding:8px">Description</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="text-align:right;margin-top:16px;font-size:18px">
        <strong>Total: $${grandTotal.toFixed(2)} ${escHtml(settings.currency || 'USD')}</strong>
      </div>
      ${paymentNotesHtml}
      <p style="color:#A6B2AD;font-size:12px;margin-top:16px">Terms: ${escHtml(client.terms || '')}</p>
    </div>`;
}

async function previewInvoice(clientId, month) {
  const { period_start, period_end } = monthToRange(month);
  const output = $('#invoice-output');
  output.innerHTML = '<p style="color:#A6B2AD">Loading…</p>';
  $('#invoice-confirm').innerHTML = '';
  $('#invoice-confirm').classList.add('hidden');
  state.pendingInvoice = null;

  try {
    const preview = await api('POST', '/api/invoices/preview', {
      client_id: clientId, period_start, period_end,
    });

    const html = buildInvoiceHTML(clientId, month, 'PREVIEW', preview.entries, preview.total_amount);
    output.innerHTML = html;
    state.lastInvoiceHTML = html;
    $('#dl-invoice').disabled = $('#print-invoice').disabled = false;

    state.pendingInvoice = { clientId, month, period_start, period_end, entries: preview.entries, total_amount: preview.total_amount };

    const confirmDiv = $('#invoice-confirm');
    confirmDiv.innerHTML = `
      <div class="invoice-confirm-bar">
        <span style="flex:1;color:#A6B2AD">${preview.entry_count} entr${preview.entry_count === 1 ? 'y' : 'ies'} ready to invoice</span>
        <button class="primary" onclick="finalizeInvoice()">Finalize Invoice</button>
        <button class="ghost" onclick="cancelInvoicePreview()">Cancel</button>
      </div>`;
    confirmDiv.classList.remove('hidden');
  } catch (e) {
    if (e.status === 404) {
      output.innerHTML = '<p style="color:#A6B2AD">No approved entries for this client and month.</p>';
    } else {
      output.innerHTML = `<p style="color:#E07070">${escHtml(e.message)}</p>`;
    }
    state.lastInvoiceHTML = null;
  }
}

async function finalizeInvoice() {
  if (!state.pendingInvoice) return;
  const { clientId, month, period_start, period_end, entries } = state.pendingInvoice;
  try {
    const invoice = await api('POST', '/api/invoices/finalize', {
      client_id: clientId, period_start, period_end,
    });

    const html = buildInvoiceHTML(clientId, month, invoice.number, entries, invoice.total_amount);
    $('#invoice-output').innerHTML = html;
    state.lastInvoiceHTML = html;

    state.pendingInvoice = null;
    $('#invoice-confirm').innerHTML = '';
    $('#invoice-confirm').classList.add('hidden');

    toast(`Invoice #${invoice.number} generated — ${entries.length} entries marked as invoiced`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function cancelInvoicePreview() {
  state.pendingInvoice = null;
  $('#invoice-output').innerHTML = '';
  state.lastInvoiceHTML = null;
  $('#invoice-confirm').innerHTML = '';
  $('#invoice-confirm').classList.add('hidden');
  $('#dl-invoice').disabled = $('#print-invoice').disabled = true;
}

async function renderInvoiceHistory() {
  const el = $('#invoice-history');
  if (!el) return;
  el.innerHTML = '<p style="color:#A6B2AD;font-size:13px">Loading invoice history…</p>';
  try {
    const invoices = await api('GET', '/api/invoices');
    if (!invoices.length) {
      el.innerHTML = '<p style="color:#A6B2AD;font-size:13px">No invoices yet.</p>';
      return;
    }
    const rows = invoices.map(inv => {
      const total = parseFloat(inv.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const created = new Date(inv.created_at).toLocaleDateString();
      return `<tr>
        <td>#${inv.number}</td>
        <td>${escHtml(inv.client.name)}</td>
        <td>${inv.period_start} – ${inv.period_end}</td>
        <td style="text-align:right">$${total}</td>
        <td>${escHtml(inv.creator.name)}</td>
        <td>${created}</td>
      </tr>`;
    }).join('');
    el.innerHTML = `
      <h3 style="margin-bottom:12px">Invoice History</h3>
      <table class="table">
        <thead><tr>
          <th>#</th><th>Client</th><th>Period</th>
          <th style="text-align:right">Total</th>
          <th>Created By</th><th>Date</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    el.innerHTML = `<p style="color:#E07070;font-size:13px">${escHtml(e.message)}</p>`;
  }
}

function downloadInvoice() {
  if (!state.lastInvoiceHTML) return;
  const blob = new Blob(
    [`<!doctype html><html><head><meta charset="utf-8"><title>Invoice</title></head><body style="background:#0A1411;color:#F4F6F5;font-family:system-ui">${state.lastInvoiceHTML}</body></html>`],
    { type: 'text/html' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'invoice.html'; a.click();
}

function printInvoice() {
  if (!state.lastInvoiceHTML) return;
  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice</title><style>body{font-family:system-ui;color:#F4F6F5;background:#0A1411;padding:24px}</style></head><body>${state.lastInvoiceHTML}</body></html>`);
  w.document.close(); w.print();
}

// ─── Reports ──────────────────────────────────────────────────────────────────

function getPeriodRange(period) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const pad = n => String(n).padStart(2, '0');
  const ymd = (yr, mo, d) => `${yr}-${pad(mo + 1)}-${pad(d)}`;

  if (period === 'month')
    return { start: ymd(y, m, 1), end: ymd(y, m, new Date(y, m + 1, 0).getDate()) };
  if (period === 'last_month') {
    const lm = m === 0 ? 11 : m - 1, ly = m === 0 ? y - 1 : y;
    return { start: ymd(ly, lm, 1), end: ymd(ly, lm, new Date(ly, lm + 1, 0).getDate()) };
  }
  if (period === 'week') {
    const dayIndex = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
    const endDay    = dayIndex[state.settings?.week_ending || 'Sunday'];
    const daysToEnd = (endDay - now.getDay() + 7) % 7;
    const weekEnd   = new Date(y, m, now.getDate() + daysToEnd);
    const weekStart = new Date(weekEnd); weekStart.setDate(weekEnd.getDate() - 6);
    return {
      start: ymd(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()),
      end:   ymd(weekEnd.getFullYear(),   weekEnd.getMonth(),   weekEnd.getDate()),
    };
  }
  return { start: null, end: null };
}

async function renderReports() {
  const period   = $('#rpt-period')?.value || 'month';
  const clientId = $('#rpt-client')?.value || '';
  const status   = $('#rpt-status')?.value || '';
  const role     = state.currentUser?.role;
  const { start, end } = getPeriodRange(period);

  $('#rpt-summary').innerHTML   = '<div style="color:#A6B2AD">Loading…</div>';
  $('#rpt-table-wrap').innerHTML = '';

  try {
    const params = new URLSearchParams();
    if (start)    params.set('period_start', start);
    if (end)      params.set('period_end', end);
    if (clientId) params.set('client_id', clientId);
    if (status)   params.set('status', status);
    const { summary, entries } = await api('GET', `/api/reports?${params}`);
    state.reportRows = entries;

    const currency = state.settings?.currency || 'USD';
    $('#rpt-summary').innerHTML = `
      <div class="summary-cards">
        <div class="card"><div class="card-value">${parseFloat(summary.total_hours).toFixed(1)}</div><div class="card-label">Total Hours</div></div>
        <div class="card"><div class="card-value">${parseFloat(summary.approved_hours).toFixed(1)}</div><div class="card-label">Approved Hours</div></div>
        <div class="card"><div class="card-value">$${parseFloat(summary.billable_amount).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div><div class="card-label">Billable (${currency})</div></div>
        <div class="card"><div class="card-value">${summary.entry_count}</div><div class="card-label">Entries</div></div>
      </div>`;

    const byClient = {};
    entries.filter(e => e.status !== 'rejected').forEach(e => {
      (byClient[e.client_id] = byClient[e.client_id] || { name: e.client.name, hours: 0, amount: 0 });
      byClient[e.client_id].hours  += parseFloat(e.hours);
      byClient[e.client_id].amount += parseFloat(e.hours) * getRate(e.user_id, e.client_id);
    });

    const clientRows = Object.entries(byClient)
      .map(([, v]) => `<tr><td>${escHtml(v.name)}</td><td>${v.hours.toFixed(2)}</td><td>$${v.amount.toFixed(2)}</td></tr>`)
      .join('') || '<tr><td colspan="3" style="text-align:center;color:#A6B2AD">No data</td></tr>';

    let consultantSection = '';
    if (role !== 'Consultant') {
      const byUser = {};
      entries.filter(e => e.status !== 'rejected').forEach(e => {
        (byUser[e.user_id] = byUser[e.user_id] || { name: e.user.name, hours: 0, amount: 0 });
        byUser[e.user_id].hours  += parseFloat(e.hours);
        byUser[e.user_id].amount += parseFloat(e.hours) * getRate(e.user_id, e.client_id);
      });
      const userRows = Object.entries(byUser)
        .map(([, v]) => `<tr><td>${escHtml(v.name)}</td><td>${v.hours.toFixed(2)}</td><td>$${v.amount.toFixed(2)}</td></tr>`)
        .join('') || '<tr><td colspan="3" style="text-align:center;color:#A6B2AD">No data</td></tr>';
      consultantSection = `
        <h3 style="margin-top:24px">By Consultant</h3>
        <table class="table"><thead><tr><th>Consultant</th><th>Hours</th><th>Amount</th></tr></thead>
        <tbody>${userRows}</tbody></table>`;
    }

    const userCol    = role !== 'Consultant' ? '<th>User</th>' : '';
    const detailRows = entries.map(e => `<tr>
      <td>${e.date}</td>
      ${role !== 'Consultant' ? `<td>${escHtml(e.user.name)}</td>` : ''}
      <td>${escHtml(e.client.name)}</td>
      <td>${e.start_time.slice(0,5)}</td><td>${e.end_time.slice(0,5)}</td>
      <td>${parseFloat(e.hours).toFixed(2)}</td>
      <td><span class="badge ${e.status}">${e.status}</span></td>
      <td>${escHtml(e.description)}</td>
    </tr>`).join('') || `<tr><td colspan="8" style="text-align:center;color:#A6B2AD">No entries.</td></tr>`;

    $('#rpt-table-wrap').innerHTML = `
      <h3>By Client</h3>
      <table class="table"><thead><tr><th>Client</th><th>Hours</th><th>Amount</th></tr></thead>
      <tbody>${clientRows}</tbody></table>
      ${consultantSection}
      <h3 style="margin-top:24px">Detail</h3>
      <table class="table"><thead><tr><th>Date</th>${userCol}<th>Client</th><th>Start</th><th>End</th><th>Hours</th><th>Status</th><th>Description</th></tr></thead>
      <tbody>${detailRows}</tbody></table>`;
  } catch (e) {
    $('#rpt-summary').innerHTML = `<p style="color:#E07070">${escHtml(e.message)}</p>`;
  }
}

function exportCSV() {
  const role = state.currentUser?.role;
  const rows = state.reportRows || [];
  const header = ['Date', ...(role !== 'Consultant' ? ['User'] : []), 'Client', 'Start', 'End', 'Hours', 'Status', 'Description'];
  const lines = [header, ...rows.map(e => [
    e.date,
    ...(role !== 'Consultant' ? [e.user.name] : []),
    e.client.name,
    e.start_time.slice(0, 5), e.end_time.slice(0, 5),
    parseFloat(e.hours).toFixed(2), e.status, e.description,
  ])];
  const csv = lines.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'report.csv'; a.click();
}

// ─── Admin ────────────────────────────────────────────────────────────────────

let adminModalSaveCallback = null;

function openAdminModal(title, bodyHtml, onSave) {
  $('#admin-modal-title').textContent = title;
  $('#admin-modal-body').innerHTML    = bodyHtml;
  adminModalSaveCallback = onSave;
  $('#admin-modal').classList.remove('hidden');
}

function closeAdminModal() {
  $('#admin-modal').classList.add('hidden');
  adminModalSaveCallback = null;
}

function renderAdmin() {
  const active = $('.tab-btn.active')?.dataset.tab || 'clients';
  showAdminTab(active);
}

function showAdminTab(tab) {
  $$('.tab-pane').forEach(p => p.classList.add('hidden'));
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $(`#tab-${tab}`)?.classList.remove('hidden');
  if (tab === 'clients')  renderClientsTab();
  if (tab === 'users')    renderUsersTab();
  if (tab === 'rates')    renderRatesTab();
  if (tab === 'settings') renderSettingsTab();
}

// ── Clients ──

function renderClientsTab() {
  const rows = state.clients.map(c => `
    <tr>
      <td>${escHtml(c.name)}</td><td>${escHtml(c.billing_email || '')}</td>
      <td>${escHtml(c.terms || '')}</td><td>${escHtml(c.address || '')}</td>
      <td>
        <button class="ghost" style="padding:4px 10px;font-size:13px" onclick="openEditClient('${c.id}')">Edit</button>
        <button class="btn-reject" style="padding:4px 10px;font-size:13px" onclick="deleteClient('${c.id}')">Delete</button>
      </td>
    </tr>`).join('');
  $('#tab-clients').innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button class="primary" onclick="openAddClient()">+ Add Client</button></div>
    <table class="table"><thead><tr><th>Name</th><th>Billing Email</th><th>Terms</th><th>Address</th><th>Actions</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#A6B2AD">No clients.</td></tr>'}</tbody></table>`;
}

function clientForm(c = {}) {
  const terms = ['Net 15','Net 30','Net 45','Net 60'];
  return `
    <div class="grid-2" style="margin-bottom:12px">
      <div><label>Name</label><input id="cf-name" value="${escHtml(c.name||'')}"></div>
      <div><label>Billing Email</label><input id="cf-email" type="email" value="${escHtml(c.billing_email||'')}"></div>
    </div>
    <div class="grid-2">
      <div><label>Terms</label><select id="cf-terms">${terms.map(t=>`<option${t===c.terms?' selected':''}>${t}</option>`).join('')}</select></div>
      <div><label>Address</label><input id="cf-address" value="${escHtml(c.address||'')}"></div>
    </div>`;
}

function openAddClient() {
  openAdminModal('Add Client', clientForm(), async () => {
    const name = $('#cf-name').value.trim();
    if (!name) return alert('Name is required.');
    const c = await api('POST', '/api/clients', {
      name,
      billing_email: $('#cf-email').value.trim() || null,
      terms:         $('#cf-terms').value || null,
      address:       $('#cf-address').value.trim() || null,
    });
    state.clients.push(c);
    hydrateClients();
    closeAdminModal();
    renderClientsTab();
    toast('Client added');
  });
}

function openEditClient(id) {
  const c = state.clients.find(x => x.id === id);
  if (!c) return;
  openAdminModal('Edit Client', clientForm(c), async () => {
    const name = $('#cf-name').value.trim();
    if (!name) return alert('Name is required.');
    const updated = await api('PUT', `/api/clients/${id}`, {
      name,
      billing_email: $('#cf-email').value.trim() || null,
      terms:         $('#cf-terms').value || null,
      address:       $('#cf-address').value.trim() || null,
    });
    const idx = state.clients.findIndex(x => x.id === id);
    if (idx !== -1) state.clients[idx] = updated;
    hydrateClients();
    closeAdminModal();
    renderClientsTab();
    toast('Client updated');
  });
}

async function deleteClient(id) {
  if (!confirm('Delete this client?')) return;
  try {
    await api('DELETE', `/api/clients/${id}`);
    state.clients = state.clients.filter(x => x.id !== id);
    hydrateClients();
    renderClientsTab();
    toast('Client deleted');
  } catch (e) { toast(e.message, 'error'); }
}

// ── Users ──

function renderUsersTab() {
  const rows = state.users.map(u => `
    <tr>
      <td>${escHtml(u.name)}</td><td>${escHtml(u.email)}</td>
      <td><span class="badge badge-${u.role.toLowerCase()}">${u.role}</span></td>
      <td>${u.id === state.currentUser?.id
        ? '<span class="muted">Current user</span>'
        : `<button class="ghost" style="padding:4px 10px;font-size:13px" onclick="openEditUser('${u.id}')">Edit</button>
           <button class="btn-reject" style="padding:4px 10px;font-size:13px" onclick="deleteUser('${u.id}')">Delete</button>`}
      </td>
    </tr>`).join('');
  $('#tab-users').innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button class="primary" onclick="openAddUser()">+ Add User</button></div>
    <table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#A6B2AD">No users.</td></tr>'}</tbody></table>`;
}

function userForm(u = {}, lockEmail = false) {
  const roles = ['Admin','Manager','Consultant'];
  return `
    <div class="grid-2" style="margin-bottom:12px">
      <div><label>Name</label><input id="uf-name" value="${escHtml(u.name||'')}"></div>
      <div><label>Email</label><input id="uf-email" type="email" value="${escHtml(u.email||'')}" ${lockEmail ? 'readonly style="opacity:0.6"' : ''}></div>
    </div>
    <div class="grid-2">
      <div><label>Role</label><select id="uf-role">${roles.map(r=>`<option${r===u.role?' selected':''}>${r}</option>`).join('')}</select></div>
      <div><label>Password${lockEmail ? ' (leave blank to keep)' : ''}</label><input id="uf-pass" type="password" autocomplete="new-password"></div>
    </div>`;
}

function openAddUser() {
  openAdminModal('Add User', userForm(), async () => {
    const name  = $('#uf-name').value.trim();
    const email = $('#uf-email').value.trim();
    const pass  = $('#uf-pass').value.trim();
    if (!name || !email || !pass) return alert('Name, email and password are required.');
    const u = await api('POST', '/api/users', { name, email, password: pass, role: $('#uf-role').value });
    state.users.push(u);
    closeAdminModal();
    renderUsersTab();
    toast('User added');
  });
}

function openEditUser(id) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  openAdminModal('Edit User', userForm(u, true), async () => {
    const name = $('#uf-name').value.trim();
    if (!name) return alert('Name is required.');
    const body = { name, role: $('#uf-role').value };
    const pass = $('#uf-pass').value.trim();
    if (pass) body.password = pass;
    const updated = await api('PUT', `/api/users/${id}`, body);
    const idx = state.users.findIndex(x => x.id === id);
    if (idx !== -1) state.users[idx] = updated;
    closeAdminModal();
    renderUsersTab();
    toast('User updated');
  });
}

async function deleteUser(id) {
  if (!confirm('Delete this user? Their time entries will remain.')) return;
  try {
    await api('DELETE', `/api/users/${id}`);
    state.users = state.users.filter(x => x.id !== id);
    renderUsersTab();
    toast('User deleted');
  } catch (e) { toast(e.message, 'error'); }
}

// ── Rates ──

function renderRatesTab() {
  const rows = state.rates.map(r => `
    <tr>
      <td>${escHtml(r.user.name)}</td>
      <td>${escHtml(r.client.name)}</td>
      <td>$${parseFloat(r.rate).toFixed(2)}/hr</td>
      <td>${r.effective_from || ''}</td>
      <td>
        <button class="ghost" style="padding:4px 10px;font-size:13px" onclick="openEditRate('${r.id}')">Edit</button>
        <button class="btn-reject" style="padding:4px 10px;font-size:13px" onclick="deleteRate('${r.id}')">Delete</button>
      </td>
    </tr>`).join('');
  $('#tab-rates').innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button class="primary" onclick="openAddRate()">+ Add Rate</button></div>
    <table class="table"><thead><tr><th>Consultant</th><th>Client</th><th>Rate</th><th>Effective From</th><th>Actions</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#A6B2AD">No rates.</td></tr>'}</tbody></table>`;
}

function rateForm(r = {}) {
  return `
    <div class="grid-2" style="margin-bottom:12px">
      <div><label>Consultant</label><select id="rf-consultant">
        ${state.users.map(u=>`<option value="${escHtml(u.id)}"${u.id===r.user_id?' selected':''}>${escHtml(u.name)}</option>`).join('')}
      </select></div>
      <div><label>Client</label><select id="rf-client">
        ${state.clients.map(c=>`<option value="${escHtml(c.id)}"${c.id===r.client_id?' selected':''}>${escHtml(c.name)}</option>`).join('')}
      </select></div>
    </div>
    <div class="grid-2">
      <div><label>Hourly Rate ($)</label><input id="rf-rate" type="number" min="0" step="0.01" value="${parseFloat(r.rate||0)||''}"></div>
      <div><label>Effective From</label><input id="rf-eff" type="date" value="${r.effective_from||''}"></div>
    </div>`;
}

function openAddRate() {
  openAdminModal('Add Rate', rateForm(), async () => {
    const rate = parseFloat($('#rf-rate').value);
    if (isNaN(rate) || rate < 0) return alert('Enter a valid rate.');
    const r = await api('POST', '/api/rates', {
      user_id:        $('#rf-consultant').value,
      client_id:      $('#rf-client').value,
      rate,
      effective_from: $('#rf-eff').value || null,
    });
    state.rates.push(r);
    closeAdminModal();
    renderRatesTab();
    toast('Rate added');
  });
}

function openEditRate(id) {
  const r = state.rates.find(x => x.id === id);
  if (!r) return;
  openAdminModal('Edit Rate', rateForm(r), async () => {
    const rate = parseFloat($('#rf-rate').value);
    if (isNaN(rate) || rate < 0) return alert('Enter a valid rate.');
    const updated = await api('PUT', `/api/rates/${id}`, {
      rate,
      effective_from: $('#rf-eff').value || null,
    });
    const idx = state.rates.findIndex(x => x.id === id);
    if (idx !== -1) state.rates[idx] = updated;
    closeAdminModal();
    renderRatesTab();
    toast('Rate updated');
  });
}

async function deleteRate(id) {
  if (!confirm('Delete this rate?')) return;
  try {
    await api('DELETE', `/api/rates/${id}`);
    state.rates = state.rates.filter(x => x.id !== id);
    renderRatesTab();
    toast('Rate deleted');
  } catch (e) { toast(e.message, 'error'); }
}

// ── Settings ──

function renderSettingsTab() {
  const s = state.settings || {};
  const timezones = ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
    'America/Toronto','America/Vancouver','America/Halifax','Europe/London','Europe/Paris',
    'Australia/Sydney','Pacific/Auckland'];
  $('#tab-settings').innerHTML = `
    <div style="max-width:480px">
      <div style="margin-bottom:12px"><label>Company Name</label><input id="st-company" value="${escHtml(s.company_name||'')}"></div>
      <div class="grid-2" style="margin-bottom:12px">
        <div><label>Rounding (minutes)</label><select id="st-round">
          ${[6,15,30,60].map(n=>`<option${n===s.rounding_minutes?' selected':''}>${n}</option>`).join('')}
        </select></div>
        <div><label>Week Ending</label><select id="st-weekend">
          ${['Sunday','Saturday','Friday'].map(d=>`<option${d===s.week_ending?' selected':''}>${d}</option>`).join('')}
        </select></div>
      </div>
      <div class="grid-2" style="margin-bottom:12px">
        <div><label>Timezone</label><select id="st-tz">
          ${timezones.map(tz=>`<option${tz===s.timezone?' selected':''}>${tz}</option>`).join('')}
        </select></div>
        <div><label>Currency</label><select id="st-currency">
          ${['USD','CAD','EUR','GBP','AUD'].map(c=>`<option${c===s.currency?' selected':''}>${c}</option>`).join('')}
        </select></div>
      </div>
      <div style="margin-bottom:12px"><label>Company Logo URL</label><input id="st-logo" value="${escHtml(s.logo_url||'')}" placeholder="https://..."></div>
      <div style="margin-bottom:16px"><label>Payment Notes</label><textarea id="st-payment-notes" rows="3" placeholder="Payment instructions for invoices...">${escHtml(s.payment_notes||'')}</textarea></div>
      <button class="primary" onclick="saveSettings()">Save Settings</button>
    </div>`;
}

async function saveSettings() {
  try {
    const updated = await api('PUT', '/api/settings', {
      company_name:     $('#st-company').value.trim() || null,
      rounding_minutes: parseInt($('#st-round').value, 10),
      week_ending:      $('#st-weekend').value,
      timezone:         $('#st-tz').value,
      currency:         $('#st-currency').value,
      logo_url:         $('#st-logo').value.trim() || null,
      payment_notes:    $('#st-payment-notes').value.trim() || null,
    });
    state.settings = updated;
    toast('Settings saved');
  } catch (e) { toast(e.message, 'error'); }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className  = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Startup ──────────────────────────────────────────────────────────────────

async function initApp() {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) {
    state.token = saved;
    try {
      state.currentUser = await api('GET', '/api/auth/me');
      await loadReferenceData();
      $('#active-user').textContent = `${state.currentUser.name} (${state.currentUser.role})`;
      updateNav(state.currentUser.role);
      checkResumeTimer();
      show('timer');
      return;
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      state.token = null;
    }
  }
  show('login');
}

function init() {
  $('#login-btn').addEventListener('click', login);
  $('#logout').addEventListener('click', logout);
  $$('#nav button[data-view]').forEach(b =>
    b.addEventListener('click', e => show(e.target.getAttribute('data-view')))
  );
  $('#start-stop-btn').addEventListener('click', startStopTimer);
  $('#confirm-stop').addEventListener('click', saveStop);
  $('#cancel-stop').addEventListener('click', closeStopModal);
  $('#man-add').addEventListener('click', addManualEntry);
  $('#ts-period')?.addEventListener('change', renderTimesheet);
  $('#ts-submit')?.addEventListener('click', submitDrafts);
  $('#rpt-go')?.addEventListener('click', renderReports);
  $('#rpt-csv')?.addEventListener('click', exportCSV);
  $('#admin-modal-save').addEventListener('click', async () => {
    try { await adminModalSaveCallback?.(); }
    catch (e) { toast(e.message || 'Save failed', 'error'); }
  });
  $('#admin-modal-cancel').addEventListener('click', closeAdminModal);
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => showAdminTab(b.dataset.tab)));
  setupInvoices();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('stop-modal')?.classList.add('hidden');
  init();
  initApp();
});
