const STORAGE_KEY_TIMER   = 'halifax_active_timer_v4';
const STORAGE_KEY_ENTRIES = 'halifax_time_entries_v1';
const STORAGE_KEY_ADMIN   = 'halifax_admin_data_v1';
const STORAGE_KEY_INV_NUM = 'halifax_invoice_num_v1';

const state = {
  currentUser: null,
  timer: { running: false, start: null, client: null, intervalId: null },
  data: {},
  entries: [],
  lastInvoiceHTML: null,
  reportRows: []
};

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadEntries() {
  try { state.entries = JSON.parse(localStorage.getItem(STORAGE_KEY_ENTRIES) || '[]'); }
  catch (e) { state.entries = []; }
}

function saveEntries() {
  try { localStorage.setItem(STORAGE_KEY_ENTRIES, JSON.stringify(state.entries)); } catch (e) {}
}

function clearActiveTimer() {
  try { localStorage.removeItem(STORAGE_KEY_TIMER); } catch (e) {}
}

function loadAdminOverrides() {
  try {
    const o = JSON.parse(localStorage.getItem(STORAGE_KEY_ADMIN) || 'null');
    if (!o) return;
    if (o.clients)  state.data.clients  = o.clients;
    if (o.users)    state.data.users    = o.users;
    if (o.rates)    state.data.rates    = o.rates;
    if (o.settings) state.data.settings = o.settings;
  } catch (e) {}
}

function saveAdminData() {
  try {
    localStorage.setItem(STORAGE_KEY_ADMIN, JSON.stringify({
      clients: state.data.clients,
      users:   state.data.users,
      rates:   state.data.rates,
      settings: state.data.settings
    }));
  } catch (e) {}
}

function nextInvoiceNumber() {
  const n = parseInt(localStorage.getItem(STORAGE_KEY_INV_NUM) || '1000', 10) + 1;
  localStorage.setItem(STORAGE_KEY_INV_NUM, String(n));
  return n;
}

// ─── Data loading ─────────────────────────────────────────────────────────────

function loadData() {
  fetch('./assets/dummy_data.json')
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(d => {
      state.data = d;
      loadAdminOverrides();
      hydrateClients();
      checkResumeTimer();
    })
    .catch(err => alert(`Failed to load app data: ${err.message}. Try refreshing.`));
}

function hydrateClients() {
  const clients = (state.data.clients || []).filter(c => !c.deleted);
  const fill = (sel, extra) => {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = extra || '';
    clients.forEach(c => {
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
  const c = (state.data.clients || []).find(c => c.id === id);
  return c ? c.name : id;
}

function userName(email) {
  const u = (state.data.users || []).find(u => u.email === email);
  return u ? u.name : email;
}

// ─── Resume timer ─────────────────────────────────────────────────────────────

function checkResumeTimer() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_TIMER) || 'null');
    if (!saved?.start_iso) return;
    const tz = state.data.settings?.timezone || 'America/New_York';
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
  state.timer = { running: true, start: new Date(saved.start_iso), client: saved.client_id, intervalId: null };
  $('#client-select').value = saved.client_id;
  $('#start-stop-btn').textContent = 'Stop';
  state.timer.intervalId = setInterval(tickTimer, 500);
  setManualEntryDisabled(true);
  $('#resume-banner').classList.add('hidden');
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
}

function updateNav(role) {
  const rules = {
    timer: true, timesheet: true, reports: true,
    approvals: role === 'Admin' || role === 'Manager',
    invoices:  role === 'Admin',
    admin:     role === 'Admin'
  };
  Object.entries(rules).forEach(([view, visible]) => {
    const btn = $(`#nav button[data-view="${view}"]`);
    if (btn) btn.classList.toggle('nav-hidden', !visible);
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function login() {
  const email = $('#email').value.trim();
  const pass  = $('#password').value.trim();
  const u = (state.data.users || []).find(x => x.email === email && x.password === pass && !x.deleted);
  if (!u) return alert('Invalid credentials');
  state.currentUser = u;
  $('#active-user').textContent = `${u.name} (${u.role})`;
  updateNav(u.role);
  show('timer');
}

function logout() {
  state.currentUser = null;
  $('#nav').classList.add('hidden');
  show('login');
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

function roundHours(raw) {
  const step = (state.data.settings?.rounding_minutes || 6) / 60;
  return Math.round(raw / step) * step;
}

function tzDate(date) {
  const tz = state.data.settings?.timezone || 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
}

function tzTime(date) {
  const tz = state.data.settings?.timezone || 'America/New_York';
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
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
    state.timer.running = true;
    state.timer.client  = $('#client-select').value;
    state.timer.start   = new Date();
    $('#start-stop-btn').textContent = 'Stop';
    state.timer.intervalId = setInterval(tickTimer, 500);
    setManualEntryDisabled(true);
    localStorage.setItem(STORAGE_KEY_TIMER, JSON.stringify({
      user_email: state.currentUser.email,
      client_id:  state.timer.client,
      start_iso:  state.timer.start.toISOString()
    }));
  } else {
    $('#stop-modal').classList.remove('hidden');
    $('#work-note').focus();
  }
}

function saveStop() {
  const note = $('#work-note').value.trim();
  if (!note) return alert('Please enter a brief description.');

  const end   = new Date();
  const start = state.timer.start;
  const rawH  = (end - start) / 3600000;
  const hours = roundHours(rawH);
  const date  = tzDate(start);
  const startStr = tzTime(start);
  const endStr   = tzTime(end);

  if (hasOverlap(date, startStr, endStr, null)) {
    if (!confirm(`This overlaps an existing entry on ${date}. Save anyway?`)) return;
  }

  state.entries.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `e${Date.now()}`,
    user_email: state.currentUser.email,
    client_id:  state.timer.client,
    date, start: startStr, end: endStr, hours,
    description: note, status: 'pending'
  });
  saveEntries();

  $('#stop-modal').classList.add('hidden');
  clearInterval(state.timer.intervalId);
  state.timer = { running: false, start: null, client: null, intervalId: null };
  clearActiveTimer();
  $('#start-stop-btn').textContent = 'Start';
  $('#timer-display').textContent  = '00:00:00';
  $('#work-note').value = '';
  setManualEntryDisabled(false);

  const diff = Math.abs(hours - rawH);
  toast(`Saved ${hours.toFixed(2)} hrs${diff > 0.001 ? ` (rounded from ${rawH.toFixed(2)})` : ''}`);
}

// ─── Stop modal ───────────────────────────────────────────────────────────────

function closeStopModal() {
  $('#stop-modal')?.classList.add('hidden');
  if (state.timer?.intervalId) clearInterval(state.timer.intervalId);
  state.timer = { running: false, start: null, client: null, intervalId: null };
  clearActiveTimer();
  setManualEntryDisabled(false);
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#stop-modal').classList.contains('hidden'))  closeStopModal();
  if (!$('#admin-modal').classList.contains('hidden')) closeAdminModal();
});

window.addEventListener('click', e => {
  for (const [modalId, cardId, closeFn] of [
    ['stop-modal',  'stop-modal-card',  closeStopModal],
    ['admin-modal', 'admin-modal-card', closeAdminModal]
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

function addManualEntry() {
  if (!state.currentUser) return;
  const date     = $('#man-date').value;
  const start    = $('#man-start').value;
  const end      = $('#man-end').value;
  const clientId = $('#man-client').value;
  const note     = $('#man-note').value.trim();

  if (!date || !start || !end || !clientId) return alert('Please fill in all fields.');
  if (!note) return alert('Please enter a description.');
  if (timeToMs(end) <= timeToMs(start)) return alert('End time must be after start time.');

  const rawH  = (timeToMs(end) - timeToMs(start)) / 3600000;
  const hours = roundHours(rawH);

  if (hasOverlap(date, start, end, null)) {
    if (!confirm(`This overlaps an existing entry on ${date}. Save anyway?`)) return;
  }

  state.entries.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `e${Date.now()}`,
    user_email: state.currentUser.email,
    client_id: clientId,
    date, start, end, hours, description: note, status: 'pending'
  });
  saveEntries();
  $('#man-date').value = $('#man-start').value = $('#man-end').value = $('#man-note').value = '';

  const diff = Math.abs(hours - rawH);
  toast(`Added ${hours.toFixed(2)} hrs${diff > 0.001 ? ` (rounded from ${rawH.toFixed(2)})` : ''}`);
}

function timeToMs(t) {
  const [h, m] = t.split(':').map(Number);
  return (h * 60 + m) * 60000;
}

function hasOverlap(date, start, end, excludeId) {
  const s = timeToMs(start), e = timeToMs(end);
  return state.entries.some(en =>
    en.id !== excludeId &&
    en.user_email === state.currentUser.email &&
    en.date === date &&
    timeToMs(en.start) < e && timeToMs(en.end) > s
  );
}

// ─── Timesheet ────────────────────────────────────────────────────────────────

function renderTimesheet() {
  const { start, end } = getPeriodRange($('#ts-period')?.value || 'month');
  const mine = state.entries
    .filter(e => {
      if (e.user_email !== state.currentUser?.email) return false;
      if (start && e.date < start) return false;
      if (end   && e.date > end)   return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const tbody = $('#timesheet-table tbody');
  const tfoot = $('#timesheet-table tfoot');
  tbody.innerHTML = '';

  if (!mine.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#A6B2AD">No entries for this period.</td></tr>';
    tfoot.innerHTML = '';
    return;
  }

  let total = 0;
  mine.forEach(e => {
    total += e.hours;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.date}</td>
      <td>${escHtml(clientName(e.client_id))}</td>
      <td>${e.start}</td><td>${e.end}</td>
      <td>${e.hours.toFixed(2)}</td>
      <td><span class="badge ${e.status}">${e.status}</span></td>
      <td>${escHtml(e.description)}</td>
      <td>${e.status === 'pending'
        ? `<button class="ghost" style="padding:4px 10px;font-size:13px" onclick="deleteEntry('${e.id}')">Delete</button>`
        : ''}</td>`;
    tbody.appendChild(tr);
  });

  tfoot.innerHTML = `<tr class="tfoot-total">
    <td colspan="4" style="text-align:right">Total</td>
    <td>${total.toFixed(2)}</td><td colspan="3"></td></tr>`;
}

function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  state.entries = state.entries.filter(e => e.id !== id);
  saveEntries();
  renderTimesheet();
}

// ─── Approvals ────────────────────────────────────────────────────────────────

function getWeekEnding(dateStr) {
  const dayIndex = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
  const endDay = dayIndex[state.data.settings?.week_ending || 'Sunday'];
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const daysUntil = (endDay - date.getDay() + 7) % 7;
  const end = new Date(y, m - 1, d + daysUntil);
  return `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
}

function renderApprovals() {
  const tbody = $('#approvals-table tbody');
  tbody.innerHTML = '';
  const role   = state.currentUser?.role;
  const canAct = role === 'Admin' || role === 'Manager';

  const visible = state.entries
    .filter(e => canAct ? e.status === 'pending' : e.user_email === state.currentUser?.email)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#A6B2AD">${canAct ? 'No entries pending approval.' : 'No entries.'}</td></tr>`;
    return;
  }

  if (canAct) {
    const groups = {};
    visible.forEach(e => {
      const key = `${getWeekEnding(e.date)}|${e.user_email}`;
      (groups[key] = groups[key] || []).push(e);
    });

    Object.entries(groups).sort(([a],[b]) => a.localeCompare(b)).forEach(([key, entries]) => {
      const [weekEnd, email] = key.split('|');
      const totalH = entries.reduce((s, e) => s + e.hours, 0);
      const ids = JSON.stringify(entries.map(e => e.id));

      const hrow = document.createElement('tr');
      hrow.className = 'week-header';
      hrow.innerHTML = `
        <td colspan="5">
          <strong>Week ending ${weekEnd}</strong> &mdash; ${escHtml(userName(email))}
          <span class="muted">${entries.length} entries &middot; ${totalH.toFixed(2)} hrs</span>
        </td>
        <td colspan="2">
          <button class="primary"   style="padding:4px 10px;font-size:13px" onclick='bulkApprove(${ids})'>Approve All</button>
          <button class="btn-reject" style="padding:4px 10px;font-size:13px" onclick='bulkReject(${ids})'>Reject All</button>
        </td>`;
      tbody.appendChild(hrow);

      entries.forEach(e => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="padding-left:24px">${escHtml(userName(e.user_email))}</td>
          <td>${e.date}</td>
          <td>${escHtml(clientName(e.client_id))}</td>
          <td>${e.hours.toFixed(2)}</td>
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
    visible.forEach(e => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escHtml(e.user_email)}</td><td>${e.date}</td>
        <td>${escHtml(clientName(e.client_id))}</td>
        <td>${e.hours.toFixed(2)}</td>
        <td>${escHtml(e.description)}</td>
        <td><span class="badge ${e.status}">${e.status}</span></td>
        <td></td>`;
      tbody.appendChild(tr);
    });
  }
}

function approveEntry(id) {
  const e = state.entries.find(x => x.id === id);
  if (e) { e.status = 'approved'; saveEntries(); renderApprovals(); }
}

function rejectEntry(id) {
  const e = state.entries.find(x => x.id === id);
  if (e) { e.status = 'rejected'; saveEntries(); renderApprovals(); }
}

function bulkApprove(ids) {
  ids.forEach(id => { const e = state.entries.find(x => x.id === id); if (e) e.status = 'approved'; });
  saveEntries(); toast(`Approved ${ids.length} entries`); renderApprovals();
}

function bulkReject(ids) {
  ids.forEach(id => { const e = state.entries.find(x => x.id === id); if (e) e.status = 'rejected'; });
  saveEntries(); toast(`Rejected ${ids.length} entries`); renderApprovals();
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

function setupInvoices() {
  const genBtn = $('#gen-invoice'), dlBtn = $('#dl-invoice'), printBtn = $('#print-invoice');
  genBtn.addEventListener('click', () => {
    const clientId = $('#invoice-client').value;
    const month    = $('#invoice-month').value;
    if (!clientId || !month) return alert('Please select a client and month.');
    const { html, ids } = generateInvoice(clientId, month);
    $('#invoice-output').innerHTML = html;
    state.lastInvoiceHTML = html;
    dlBtn.disabled = printBtn.disabled = false;
    if (ids.length) {
      ids.forEach(id => { const e = state.entries.find(x => x.id === id); if (e) e.status = 'invoiced'; });
      saveEntries();
      toast(`Invoice generated — ${ids.length} entries marked as invoiced`);
    }
  });
  dlBtn.addEventListener('click', downloadInvoice);
  printBtn.addEventListener('click', printInvoice);
}

function generateInvoice(clientId, month) {
  const client = (state.data.clients || []).find(c => c.id === clientId);
  if (!client) return { html: '<p>Client not found.</p>', ids: [] };

  const [year, mon] = month.split('-').map(Number);
  const approved = state.entries.filter(e => {
    if (e.client_id !== clientId || e.status !== 'approved') return false;
    const [ey, em] = e.date.split('-').map(Number);
    return ey === year && em === mon;
  });

  if (!approved.length)
    return { html: '<p style="color:#A6B2AD">No approved entries for this client and month.</p>', ids: [] };

  const byConsultant = {};
  approved.forEach(e => (byConsultant[e.user_email] = byConsultant[e.user_email] || []).push(e));

  const settings   = state.data.settings || {};
  const invNum     = nextInvoiceNumber();
  const monthLabel = new Date(year, mon - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  let grandTotal   = 0;
  let rows         = '';

  Object.entries(byConsultant).forEach(([email, entries]) => {
    const rate = getRate(email, clientId);
    entries.forEach(e => {
      const amount = e.hours * rate;
      grandTotal += amount;
      rows += `<tr>
        <td style="padding:8px">${e.date}</td>
        <td style="padding:8px">${escHtml(userName(email))}</td>
        <td style="padding:8px">${e.start}–${e.end}</td>
        <td style="padding:8px;text-align:right">${e.hours.toFixed(2)}</td>
        <td style="padding:8px;text-align:right">$${rate.toFixed(2)}</td>
        <td style="padding:8px;text-align:right">$${amount.toFixed(2)}</td>
        <td style="padding:8px">${escHtml(e.description)}</td>
      </tr>`;
    });
  });

  const html = `
    <div style="border:1px solid #1E3A30;border-radius:14px;padding:24px;margin-top:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:24px">
        <div>
          <h2 style="margin:0">${escHtml(settings.company_name || 'Halifax Time')}</h2>
          <p style="color:#A6B2AD;margin:4px 0">Invoice #${invNum} &mdash; ${monthLabel}</p>
        </div>
        <div style="text-align:right">
          <strong>${escHtml(client.name)}</strong><br>
          <span style="color:#A6B2AD">${escHtml(client.address)}</span><br>
          <span style="color:#A6B2AD">${escHtml(client.billing_email)}</span>
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
      <p style="color:#A6B2AD;font-size:12px;margin-top:16px">Terms: ${escHtml(client.terms)}</p>
    </div>`;

  return { html, ids: approved.map(e => e.id) };
}

function getRate(email, clientId) {
  const r = (state.data.rates || []).find(x => x.consultant_email === email && x.client_id === clientId);
  return r ? r.rate : 0;
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
    const endDay = dayIndex[state.data.settings?.week_ending || 'Sunday'];
    const daysToEnd = (endDay - now.getDay() + 7) % 7;
    const weekEnd   = new Date(y, m, now.getDate() + daysToEnd);
    const weekStart = new Date(weekEnd); weekStart.setDate(weekEnd.getDate() - 6);
    return {
      start: ymd(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()),
      end:   ymd(weekEnd.getFullYear(),   weekEnd.getMonth(),   weekEnd.getDate())
    };
  }
  return { start: null, end: null };
}

function renderReports() {
  const period   = $('#rpt-period')?.value || 'month';
  const clientId = $('#rpt-client')?.value || '';
  const status   = $('#rpt-status')?.value || '';
  const role     = state.currentUser?.role;
  const { start, end } = getPeriodRange(period);

  const rows = state.entries.filter(e => {
    if (role === 'Consultant' && e.user_email !== state.currentUser.email) return false;
    if (clientId && e.client_id !== clientId) return false;
    if (status   && e.status    !== status)   return false;
    if (start    && e.date      <  start)     return false;
    if (end      && e.date      >  end)       return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date));

  state.reportRows = rows;

  const totalH    = rows.reduce((s, e) => s + e.hours, 0);
  const approvedH = rows.filter(e => e.status === 'approved' || e.status === 'invoiced').reduce((s, e) => s + e.hours, 0);
  const billable  = rows
    .filter(e => e.status === 'approved' || e.status === 'invoiced')
    .reduce((s, e) => s + e.hours * getRate(e.user_email, e.client_id), 0);
  const currency  = state.data.settings?.currency || 'USD';

  $('#rpt-summary').innerHTML = `
    <div class="summary-cards">
      <div class="card"><div class="card-value">${totalH.toFixed(1)}</div><div class="card-label">Total Hours</div></div>
      <div class="card"><div class="card-value">${approvedH.toFixed(1)}</div><div class="card-label">Approved Hours</div></div>
      <div class="card"><div class="card-value">$${billable.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div><div class="card-label">Billable (${currency})</div></div>
      <div class="card"><div class="card-value">${rows.length}</div><div class="card-label">Entries</div></div>
    </div>`;

  const byClient = {};
  rows.filter(e => e.status !== 'rejected').forEach(e => {
    (byClient[e.client_id] = byClient[e.client_id] || { hours: 0, amount: 0 });
    byClient[e.client_id].hours  += e.hours;
    byClient[e.client_id].amount += e.hours * getRate(e.user_email, e.client_id);
  });

  const clientRows = Object.entries(byClient)
    .map(([id, v]) => `<tr><td>${escHtml(clientName(id))}</td><td>${v.hours.toFixed(2)}</td><td>$${v.amount.toFixed(2)}</td></tr>`)
    .join('') || '<tr><td colspan="3" style="text-align:center;color:#A6B2AD">No data</td></tr>';

  let consultantSection = '';
  if (role !== 'Consultant') {
    const byUser = {};
    rows.filter(e => e.status !== 'rejected').forEach(e => {
      (byUser[e.user_email] = byUser[e.user_email] || { hours: 0, amount: 0 });
      byUser[e.user_email].hours  += e.hours;
      byUser[e.user_email].amount += e.hours * getRate(e.user_email, e.client_id);
    });
    const userRows = Object.entries(byUser)
      .map(([email, v]) => `<tr><td>${escHtml(userName(email))}</td><td>${v.hours.toFixed(2)}</td><td>$${v.amount.toFixed(2)}</td></tr>`)
      .join('') || '<tr><td colspan="3" style="text-align:center;color:#A6B2AD">No data</td></tr>';
    consultantSection = `
      <h3 style="margin-top:24px">By Consultant</h3>
      <table class="table"><thead><tr><th>Consultant</th><th>Hours</th><th>Amount</th></tr></thead>
      <tbody>${userRows}</tbody></table>`;
  }

  const userCol = role !== 'Consultant' ? '<th>User</th>' : '';
  const detailRows = rows.map(e => `<tr>
    <td>${e.date}</td>
    ${role !== 'Consultant' ? `<td>${escHtml(userName(e.user_email))}</td>` : ''}
    <td>${escHtml(clientName(e.client_id))}</td>
    <td>${e.start}</td><td>${e.end}</td>
    <td>${e.hours.toFixed(2)}</td>
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
}

function exportCSV() {
  const role = state.currentUser?.role;
  const rows = state.reportRows || [];
  const header = ['Date', ...(role !== 'Consultant' ? ['User'] : []), 'Client', 'Start', 'End', 'Hours', 'Status', 'Description'];
  const lines = [header, ...rows.map(e => [
    e.date, ...(role !== 'Consultant' ? [e.user_email] : []),
    clientName(e.client_id), e.start, e.end, e.hours.toFixed(2), e.status, e.description
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
  $('#admin-modal-body').innerHTML = bodyHtml;
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

// Clients

function renderClientsTab() {
  const rows = (state.data.clients || []).filter(c => !c.deleted).map(c => `
    <tr>
      <td>${escHtml(c.name)}</td><td>${escHtml(c.billing_email)}</td>
      <td>${escHtml(c.terms)}</td><td>${escHtml(c.address)}</td>
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
  openAdminModal('Add Client', clientForm(), () => {
    const name = $('#cf-name').value.trim();
    if (!name) return alert('Name is required.');
    (state.data.clients = state.data.clients || []).push({
      id: `c${Date.now()}`, name, billing_email: $('#cf-email').value.trim(),
      terms: $('#cf-terms').value, address: $('#cf-address').value.trim(), deleted: false
    });
    saveAdminData(); hydrateClients(); closeAdminModal(); renderClientsTab(); toast('Client added');
  });
}

function openEditClient(id) {
  const c = state.data.clients.find(x => x.id === id);
  if (!c) return;
  openAdminModal('Edit Client', clientForm(c), () => {
    const name = $('#cf-name').value.trim();
    if (!name) return alert('Name is required.');
    c.name = name; c.billing_email = $('#cf-email').value.trim();
    c.terms = $('#cf-terms').value; c.address = $('#cf-address').value.trim();
    saveAdminData(); hydrateClients(); closeAdminModal(); renderClientsTab(); toast('Client updated');
  });
}

function deleteClient(id) {
  if (!confirm('Delete this client?')) return;
  const c = state.data.clients.find(x => x.id === id);
  if (c) { c.deleted = true; saveAdminData(); hydrateClients(); renderClientsTab(); toast('Client deleted'); }
}

// Users

function renderUsersTab() {
  const rows = (state.data.users || []).filter(u => !u.deleted).map(u => `
    <tr>
      <td>${escHtml(u.name)}</td><td>${escHtml(u.email)}</td>
      <td><span class="badge badge-${u.role.toLowerCase()}">${u.role}</span></td>
      <td>${u.email === state.currentUser?.email
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
      <div><label>Password</label><input id="uf-pass" value="${escHtml(u.password||'')}"></div>
    </div>`;
}

function openAddUser() {
  openAdminModal('Add User', userForm(), () => {
    const name = $('#uf-name').value.trim(), email = $('#uf-email').value.trim(), pass = $('#uf-pass').value.trim();
    if (!name || !email || !pass) return alert('Name, email and password are required.');
    if ((state.data.users||[]).find(x => x.email === email)) return alert('Email already in use.');
    (state.data.users = state.data.users || []).push({
      id: `u${Date.now()}`, name, email, role: $('#uf-role').value, password: pass, deleted: false
    });
    saveAdminData(); closeAdminModal(); renderUsersTab(); toast('User added');
  });
}

function openEditUser(id) {
  const u = (state.data.users||[]).find(x => x.id === id);
  if (!u) return;
  openAdminModal('Edit User', userForm(u, true), () => {
    const name = $('#uf-name').value.trim(), pass = $('#uf-pass').value.trim();
    if (!name || !pass) return alert('Name and password are required.');
    u.name = name; u.role = $('#uf-role').value; u.password = pass;
    saveAdminData(); closeAdminModal(); renderUsersTab(); toast('User updated');
  });
}

function deleteUser(id) {
  if (!confirm('Delete this user? Their time entries will remain.')) return;
  const u = (state.data.users||[]).find(x => x.id === id);
  if (u) { u.deleted = true; saveAdminData(); renderUsersTab(); toast('User deleted'); }
}

// Rates

function renderRatesTab() {
  const rows = (state.data.rates || []).map((r, i) => `
    <tr>
      <td>${escHtml(userName(r.consultant_email))}</td>
      <td>${escHtml(r.client_name || clientName(r.client_id))}</td>
      <td>$${Number(r.rate).toFixed(2)}/hr</td>
      <td>${r.effective_from || ''}</td>
      <td>
        <button class="ghost" style="padding:4px 10px;font-size:13px" onclick="openEditRate(${i})">Edit</button>
        <button class="btn-reject" style="padding:4px 10px;font-size:13px" onclick="deleteRate(${i})">Delete</button>
      </td>
    </tr>`).join('');
  $('#tab-rates').innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button class="primary" onclick="openAddRate()">+ Add Rate</button></div>
    <table class="table"><thead><tr><th>Consultant</th><th>Client</th><th>Rate</th><th>Effective From</th><th>Actions</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#A6B2AD">No rates.</td></tr>'}</tbody></table>`;
}

function rateForm(r = {}) {
  const consultants = (state.data.users||[]).filter(u => !u.deleted);
  const clients     = (state.data.clients||[]).filter(c => !c.deleted);
  return `
    <div class="grid-2" style="margin-bottom:12px">
      <div><label>Consultant</label><select id="rf-consultant">
        ${consultants.map(u=>`<option value="${escHtml(u.email)}"${u.email===r.consultant_email?' selected':''}>${escHtml(u.name)}</option>`).join('')}
      </select></div>
      <div><label>Client</label><select id="rf-client">
        ${clients.map(c=>`<option value="${escHtml(c.id)}"${c.id===r.client_id?' selected':''}>${escHtml(c.name)}</option>`).join('')}
      </select></div>
    </div>
    <div class="grid-2">
      <div><label>Hourly Rate ($)</label><input id="rf-rate" type="number" min="0" step="0.01" value="${r.rate||''}"></div>
      <div><label>Effective From</label><input id="rf-eff" type="date" value="${r.effective_from||''}"></div>
    </div>`;
}

function openAddRate() {
  openAdminModal('Add Rate', rateForm(), () => {
    const rate = parseFloat($('#rf-rate').value);
    if (isNaN(rate) || rate < 0) return alert('Enter a valid rate.');
    const clientId = $('#rf-client').value;
    (state.data.rates = state.data.rates || []).push({
      id: `r${Date.now()}`, consultant_email: $('#rf-consultant').value,
      client_id: clientId, client_name: clientName(clientId), rate, effective_from: $('#rf-eff').value
    });
    saveAdminData(); closeAdminModal(); renderRatesTab(); toast('Rate added');
  });
}

function openEditRate(index) {
  const r = (state.data.rates||[])[index];
  if (!r) return;
  openAdminModal('Edit Rate', rateForm(r), () => {
    const rate = parseFloat($('#rf-rate').value);
    if (isNaN(rate) || rate < 0) return alert('Enter a valid rate.');
    const clientId = $('#rf-client').value;
    r.consultant_email = $('#rf-consultant').value;
    r.client_id = clientId; r.client_name = clientName(clientId);
    r.rate = rate; r.effective_from = $('#rf-eff').value;
    saveAdminData(); closeAdminModal(); renderRatesTab(); toast('Rate updated');
  });
}

function deleteRate(index) {
  if (!confirm('Delete this rate?')) return;
  state.data.rates.splice(index, 1);
  saveAdminData(); renderRatesTab(); toast('Rate deleted');
}

// Settings

function renderSettingsTab() {
  const s = state.data.settings || {};
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
      <div class="grid-2" style="margin-bottom:16px">
        <div><label>Timezone</label><select id="st-tz">
          ${timezones.map(tz=>`<option${tz===s.timezone?' selected':''}>${tz}</option>`).join('')}
        </select></div>
        <div><label>Currency</label><select id="st-currency">
          ${['USD','CAD','EUR','GBP','AUD'].map(c=>`<option${c===s.currency?' selected':''}>${c}</option>`).join('')}
        </select></div>
      </div>
      <button class="primary" onclick="saveSettings()">Save Settings</button>
    </div>`;
}

function saveSettings() {
  state.data.settings = {
    ...state.data.settings,
    company_name:     $('#st-company').value.trim(),
    rounding_minutes: parseInt($('#st-round').value, 10),
    week_ending:      $('#st-weekend').value,
    timezone:         $('#st-tz').value,
    currency:         $('#st-currency').value
  };
  saveAdminData(); toast('Settings saved');
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
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

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('stop-modal')?.classList.add('hidden');
});

function init() {
  loadData();
  loadEntries();
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
  $('#rpt-go')?.addEventListener('click', renderReports);
  $('#rpt-csv')?.addEventListener('click', exportCSV);
  $('#admin-modal-save').addEventListener('click', () => adminModalSaveCallback?.());
  $('#admin-modal-cancel').addEventListener('click', closeAdminModal);
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => showAdminTab(b.dataset.tab)));
  setupInvoices();
}

document.addEventListener('DOMContentLoaded', () => { init(); show('login'); });
