
const STORAGE_KEY_TIMER = 'halifax_active_timer_v4';
const STORAGE_KEY_ENTRIES = 'halifax_time_entries_v1';

const state = {
  currentUser: null,
  timer: { running: false, start: null, client: null, intervalId: null },
  data: {},
  entries: [],
  lastInvoiceHTML: null
};

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

// --- Persistence ---

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ENTRIES);
    state.entries = raw ? JSON.parse(raw) : [];
  } catch (e) {
    state.entries = [];
  }
}

function saveEntries() {
  try { localStorage.setItem(STORAGE_KEY_ENTRIES, JSON.stringify(state.entries)); } catch (e) {}
}

function clearActiveTimer() {
  try { localStorage.removeItem(STORAGE_KEY_TIMER); } catch (e) {}
}

// --- Data loading ---

function loadData() {
  fetch('./assets/dummy_data.json')
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(d => {
      state.data = d;
      hydrateClients();
      checkResumeTimer();
    })
    .catch(err => alert(`Failed to load app data: ${err.message}. Try refreshing.`));
}

function hydrateClients() {
  const fill = s => {
    const el = $(s);
    if (!el) return;
    el.innerHTML = '';
    (state.data.clients || []).filter(c => !c.deleted).forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      el.appendChild(o);
    });
  };
  fill('#client-select');
  fill('#man-client');
  fill('#invoice-client');
  const g = $('#gen-invoice');
  if (g) g.disabled = false;
}

function clientName(id) {
  const c = (state.data.clients || []).find(c => c.id === id);
  return c ? c.name : id;
}

// --- Resume timer ---

function checkResumeTimer() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TIMER);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved?.user_email || !saved?.start_iso) return;
    const banner = $('#resume-banner');
    if (!banner) return;
    banner.innerHTML =
      `Timer running since ${new Date(saved.start_iso).toLocaleTimeString()} for ${escHtml(clientName(saved.client_id))}.` +
      ` <button id="resume-btn" class="ghost" style="padding:4px 10px">Resume</button>` +
      ` <button id="discard-btn" style="padding:4px 10px;background:transparent;border:1px solid #A24B4B;color:#A24B4B;border-radius:8px;cursor:pointer">Discard</button>`;
    banner.classList.remove('hidden');
    $('#resume-btn').addEventListener('click', () => resumeTimer(saved));
    $('#discard-btn').addEventListener('click', () => { clearActiveTimer(); banner.classList.add('hidden'); });
  } catch (e) {}
}

function resumeTimer(saved) {
  if (!state.currentUser) return;
  state.timer.running = true;
  state.timer.start = new Date(saved.start_iso);
  state.timer.client = saved.client_id;
  $('#client-select').value = saved.client_id;
  $('#start-stop-btn').textContent = 'Stop';
  state.timer.intervalId = setInterval(() => $('#timer-display').textContent = fmtH(new Date() - state.timer.start), 500);
  $('#resume-banner').classList.add('hidden');
}

// --- Navigation ---

function show(v) {
  ['login', 'timer', 'timesheet', 'approvals', 'invoices'].forEach(x =>
    $('#' + x + '-view')?.classList.add('hidden')
  );
  $('#' + v + '-view')?.classList.remove('hidden');
  if (v !== 'login') $('#nav').classList.remove('hidden');
  if (v === 'timesheet') renderTimesheet();
  if (v === 'approvals') renderApprovals();
}

// --- Auth ---

function login() {
  const email = $('#email').value.trim();
  const pass = $('#password').value.trim();
  const u = (state.data.users || []).find(x => x.email === email && x.password === pass);
  if (!u) return alert('Invalid credentials');
  state.currentUser = u;
  $('#active-user').textContent = `${u.name} (${u.role})`;
  show('timer');
}

function logout() {
  state.currentUser = null;
  $('#nav').classList.add('hidden');
  show('login');
}

// --- Timer ---

function fmtH(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function startStopTimer() {
  if (!state.currentUser) return;
  const btn = $('#start-stop-btn');
  if (!state.timer.running) {
    state.timer.running = true;
    state.timer.client = $('#client-select').value;
    state.timer.start = new Date();
    btn.textContent = 'Stop';
    state.timer.intervalId = setInterval(() => $('#timer-display').textContent = fmtH(new Date() - state.timer.start), 500);
    localStorage.setItem(STORAGE_KEY_TIMER, JSON.stringify({
      user_email: state.currentUser.email,
      client_id: state.timer.client,
      start_iso: state.timer.start.toISOString()
    }));
  } else {
    document.getElementById('stop-modal').classList.remove('hidden');
  }
}

function saveStop() {
  const note = $('#work-note').value.trim();
  if (!note) return alert('Please enter a brief description.');

  const end = new Date();
  const start = state.timer.start;
  const hours = roundHours((end - start) / 3600000);

  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `e${Date.now()}`,
    user_email: state.currentUser.email,
    client_id: state.timer.client,
    date: start.toISOString().slice(0, 10),
    start: start.toTimeString().slice(0, 5),
    end: end.toTimeString().slice(0, 5),
    hours,
    description: note,
    status: 'pending'
  };

  state.entries.push(entry);
  saveEntries();

  document.getElementById('stop-modal').classList.add('hidden');
  clearInterval(state.timer.intervalId);
  state.timer = { running: false, start: null, client: null, intervalId: null };
  clearActiveTimer();
  $('#start-stop-btn').textContent = 'Start';
  $('#timer-display').textContent = '00:00:00';
  $('#work-note').value = '';
}

function roundHours(raw) {
  const step = (state.data.settings?.rounding_minutes || 6) / 60;
  return Math.round(raw / step) * step;
}

// --- Modal ---

function closeStopModal() {
  const m = document.getElementById('stop-modal');
  if (m) m.classList.add('hidden');
  if (state.timer?.intervalId) clearInterval(state.timer.intervalId);
  state.timer = { running: false, start: null, client: null, intervalId: null };
  clearActiveTimer();
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeStopModal(); });
window.addEventListener('click', e => {
  const modal = document.getElementById('stop-modal');
  const card = document.getElementById('stop-modal-card');
  if (!modal || modal.classList.contains('hidden')) return;
  if (!card.contains(e.target)) closeStopModal();
});

// --- Manual Entry ---

function addManualEntry() {
  if (!state.currentUser) return;
  const date = $('#man-date').value;
  const start = $('#man-start').value;
  const end = $('#man-end').value;
  const clientId = $('#man-client').value;
  const note = $('#man-note').value.trim();

  if (!date || !start || !end || !clientId) return alert('Please fill in all fields.');
  if (!note) return alert('Please enter a description.');

  const startMs = timeToMs(start);
  const endMs = timeToMs(end);
  if (endMs <= startMs) return alert('End time must be after start time.');

  const hours = roundHours((endMs - startMs) / 3600000);

  state.entries.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `e${Date.now()}`,
    user_email: state.currentUser.email,
    client_id: clientId,
    date,
    start,
    end,
    hours,
    description: note,
    status: 'pending'
  });
  saveEntries();

  $('#man-date').value = '';
  $('#man-start').value = '';
  $('#man-end').value = '';
  $('#man-note').value = '';
}

function timeToMs(t) {
  const [h, m] = t.split(':').map(Number);
  return (h * 60 + m) * 60000;
}

// --- Timesheet ---

function renderTimesheet() {
  const tbody = $('#timesheet-table tbody');
  tbody.innerHTML = '';

  const mine = state.entries
    .filter(e => e.user_email === state.currentUser?.email)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!mine.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#A6B2AD">No entries yet.</td></tr>';
    return;
  }

  mine.forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.date}</td>
      <td>${escHtml(clientName(e.client_id))}</td>
      <td>${e.start}</td>
      <td>${e.end}</td>
      <td>${e.hours.toFixed(2)}</td>
      <td><span class="badge ${e.status}">${e.status}</span></td>
      <td>${escHtml(e.description)}</td>
      <td>${e.status === 'pending'
        ? `<button class="ghost" style="padding:4px 10px;font-size:13px" onclick="deleteEntry('${e.id}')">Delete</button>`
        : ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  state.entries = state.entries.filter(e => e.id !== id);
  saveEntries();
  renderTimesheet();
}

// --- Approvals ---

function renderApprovals() {
  const tbody = $('#approvals-table tbody');
  tbody.innerHTML = '';

  const role = state.currentUser?.role;
  const canAct = role === 'Admin' || role === 'Manager';
  const visible = state.entries
    .filter(e => canAct || e.user_email === state.currentUser?.email)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!visible.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#A6B2AD">No entries to review.</td></tr>';
    return;
  }

  visible.forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escHtml(e.user_email)}</td>
      <td>${e.date}</td>
      <td>${escHtml(clientName(e.client_id))}</td>
      <td>${e.hours.toFixed(2)}</td>
      <td>${escHtml(e.description)}</td>
      <td><span class="badge ${e.status}">${e.status}</span></td>
      <td>${canAct && e.status === 'pending' ? `
        <button class="primary" style="padding:4px 10px;font-size:13px" onclick="approveEntry('${e.id}')">Approve</button>
        <button class="ghost" style="padding:4px 10px;font-size:13px;border-color:#A24B4B;color:#A24B4B" onclick="rejectEntry('${e.id}')">Reject</button>
      ` : ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

function approveEntry(id) {
  const e = state.entries.find(x => x.id === id);
  if (e) { e.status = 'approved'; saveEntries(); renderApprovals(); }
}

function rejectEntry(id) {
  const e = state.entries.find(x => x.id === id);
  if (e) { e.status = 'rejected'; saveEntries(); renderApprovals(); }
}

// --- Invoices ---

function setupInvoices() {
  const genBtn = $('#gen-invoice');
  const dlBtn = $('#dl-invoice');
  const printBtn = $('#print-invoice');

  genBtn.addEventListener('click', () => {
    const clientId = $('#invoice-client').value;
    const month = $('#invoice-month').value;
    if (!clientId || !month) return alert('Please select a client and month.');
    const html = generateInvoice(clientId, month);
    $('#invoice-output').innerHTML = html;
    state.lastInvoiceHTML = html;
    dlBtn.disabled = false;
    printBtn.disabled = false;
  });

  dlBtn.addEventListener('click', downloadInvoice);
  printBtn.addEventListener('click', printInvoice);
}

function generateInvoice(clientId, month) {
  const client = (state.data.clients || []).find(c => c.id === clientId);
  if (!client) return '<p>Client not found.</p>';

  const [year, mon] = month.split('-').map(Number);

  const approved = state.entries.filter(e => {
    if (e.client_id !== clientId || e.status !== 'approved') return false;
    const [ey, em] = e.date.split('-').map(Number);
    return ey === year && em === mon;
  });

  if (!approved.length) {
    return '<p style="color:#A6B2AD">No approved entries for this client and month.</p>';
  }

  const byConsultant = {};
  approved.forEach(e => {
    (byConsultant[e.user_email] = byConsultant[e.user_email] || []).push(e);
  });

  const settings = state.data.settings || {};
  const monthLabel = new Date(year, mon - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  let grandTotal = 0;
  let rows = '';

  Object.entries(byConsultant).forEach(([email, entries]) => {
    const rate = getRate(email, clientId);
    entries.forEach(e => {
      const amount = e.hours * rate;
      grandTotal += amount;
      rows += `<tr>
        <td style="padding:8px">${e.date}</td>
        <td style="padding:8px">${escHtml(email)}</td>
        <td style="padding:8px">${e.start}–${e.end}</td>
        <td style="padding:8px;text-align:right">${e.hours.toFixed(2)}</td>
        <td style="padding:8px;text-align:right">$${rate.toFixed(2)}</td>
        <td style="padding:8px;text-align:right">$${amount.toFixed(2)}</td>
        <td style="padding:8px">${escHtml(e.description)}</td>
      </tr>`;
    });
  });

  return `
    <div style="border:1px solid #1E3A30;border-radius:14px;padding:24px;margin-top:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:24px">
        <div>
          <h2 style="margin:0">${escHtml(settings.company_name || 'Halifax Time')}</h2>
          <p style="color:#A6B2AD;margin:4px 0">Invoice — ${monthLabel}</p>
        </div>
        <div style="text-align:right">
          <strong>${escHtml(client.name)}</strong><br>
          <span style="color:#A6B2AD">${escHtml(client.address)}</span><br>
          <span style="color:#A6B2AD">${escHtml(client.billing_email)}</span>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="color:#D9C7A0;border-bottom:1px solid #1E3A30">
            <th style="text-align:left;padding:8px">Date</th>
            <th style="text-align:left;padding:8px">Consultant</th>
            <th style="text-align:left;padding:8px">Time</th>
            <th style="text-align:right;padding:8px">Hours</th>
            <th style="text-align:right;padding:8px">Rate</th>
            <th style="text-align:right;padding:8px">Amount</th>
            <th style="text-align:left;padding:8px">Description</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="text-align:right;margin-top:16px;font-size:18px">
        <strong>Total: $${grandTotal.toFixed(2)} ${escHtml(settings.currency || 'USD')}</strong>
      </div>
      <p style="color:#A6B2AD;font-size:12px;margin-top:16px">Terms: ${escHtml(client.terms)}</p>
    </div>`;
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
  a.href = URL.createObjectURL(blob);
  a.download = 'invoice.html';
  a.click();
}

function printInvoice() {
  if (!state.lastInvoiceHTML) return;
  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice</title><style>body{font-family:system-ui;color:#F4F6F5;background:#0A1411;padding:24px}</style></head><body>${state.lastInvoiceHTML}</body></html>`);
  w.document.close();
  w.print();
}

// --- Utilities ---

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Startup ---

function forceHideStopModal() {
  const m = document.getElementById('stop-modal');
  if (m) m.classList.add('hidden');
}
document.addEventListener('DOMContentLoaded', forceHideStopModal);

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
  setupInvoices();
}

document.addEventListener('DOMContentLoaded', () => { init(); show('login'); });
