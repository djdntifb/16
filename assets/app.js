
// Keep modal hidden at startup
function forceHideStopModal(){ const m=document.getElementById('stop-modal'); if(m) m.classList.add('hidden'); }
document.addEventListener('DOMContentLoaded', forceHideStopModal);

const state={currentUser:null,timer:{running:false,start:null,client:null,intervalId:null},data:{},lastInvoiceHTML:null};
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));

function clearActiveTimer(){ try{ localStorage.removeItem('halifax_active_timer_v4'); } catch(e){} }
function closeStopModal(){ const m=document.getElementById('stop-modal'); if(m) m.classList.add('hidden'); if(state.timer?.intervalId) clearInterval(state.timer.intervalId); state.timer={running:false,start:null,client:null,intervalId:null}; clearActiveTimer(); }
document.addEventListener('keydown', e => { if(e.key==='Escape') closeStopModal(); });
window.addEventListener('click', e => { const modal=document.getElementById('stop-modal'); const card=document.getElementById('stop-modal-card'); if(!modal||modal.classList.contains('hidden'))return; if(!card.contains(e.target)) closeStopModal(); });

function loadData(){ fetch('./assets/dummy_data.json').then(r=>r.json()).then(d=>{ state.data=d; hydrateClients(); }); }
function hydrateClients(){ const fill=s=>{ const el=$(s); if(!el) return; el.innerHTML=''; (state.data.clients||[]).filter(c=>!c.deleted).forEach(c=>{ const o=document.createElement('option'); o.value=c.id; o.textContent=c.name; el.appendChild(o); }); }; fill('#client-select'); fill('#man-client'); fill('#invoice-client'); }

function show(v){ ['login','timer','timesheet','approvals','invoices'].forEach(x=>$('#'+x+'-view')?.classList.add('hidden')); $('#'+v+'-view')?.classList.remove('hidden'); if(v!=='login') $('#nav').classList.remove('hidden'); }

function login(){ const email=$('#email').value.trim(), pass=$('#password').value.trim(); const u=(state.data.users||[]).find(x=>x.email===email&&x.password===pass); if(!u) return alert('Invalid credentials'); state.currentUser=u; $('#active-user').textContent=`${u.name} (${u.role})`; show('timer'); }
function logout(){ state.currentUser=null; $('#nav').classList.add('hidden'); show('login'); }

function startStopTimer(){ if(!state.currentUser) return; const btn=$('#start-stop-btn'); if(!state.timer.running){ state.timer.running=true; state.timer.client=$('#client-select').value; state.timer.start=new Date(); btn.textContent='Stop'; state.timer.intervalId=setInterval(()=>$('#timer-display').textContent=fmtH(new Date()-state.timer.start),500); localStorage.setItem('halifax_active_timer_v4', JSON.stringify({user_email:state.currentUser.email,client_id:state.timer.client,start_iso:state.timer.start.toISOString()})); } else { document.getElementById('stop-modal').classList.remove('hidden'); } }
function fmtH(ms){ const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`; }

function saveStop(){ const note=$('#work-note').value.trim(); if(!note) return alert('Please enter a brief description.'); document.getElementById('stop-modal').classList.add('hidden'); clearInterval(state.timer.intervalId); state.timer={running:false,start:null,client:null,intervalId:null}; clearActiveTimer(); $('#start-stop-btn').textContent='Start'; $('#timer-display').textContent='00:00:00'; $('#work-note').value=''; }

function addManualEntry(){ /* omitted for brevity in this minimal fix build */ }

function init(){ loadData(); $('#login-btn').addEventListener('click', login); $('#logout').addEventListener('click', logout); $$('#nav button[data-view]').forEach(b=>b.addEventListener('click',e=>show(e.target.getAttribute('data-view')))); $('#start-stop-btn').addEventListener('click', startStopTimer); $('#confirm-stop').addEventListener('click', saveStop); $('#cancel-stop').addEventListener('click', closeStopModal); }
document.addEventListener('DOMContentLoaded', ()=>{ init(); show('login'); });
