/* Gestione turni - webapp (Fase 1) */
(() => {
  'use strict';

  const cfg = window.APP_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  const app = document.getElementById('app');
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
    'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const GIORNI_LUNGHI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const SHIFT_TYPE_FK = 'shift_types!shifts_shift_type_id_fkey';

  const state = {
    session: null,
    profile: null,
    tab: 'calendar',
    adminView: 'menu',
    month: firstOfMonth(new Date()),
    authMode: 'login',
    pendingCount: 0,
    settings: null,
  };

  const DEFAULT_SETTINGS = {
    font_scale: 1,
    highlight_changed: true,
    changed_color: '#1e88e5',
    type_prefs: {},
    type_order: [],
    notify_mode: 'badge',
  };
  const PALETTE = [
    '#f4c430', '#ffb300', '#ef6c00', '#e53935', '#d81b60', '#8e24aa',
    '#5e35b1', '#3949ab', '#1e88e5', '#039be5', '#00897b', '#43a047',
    '#7cb342', '#c0ca33', '#6d4c41', '#757575', '#90a4ae', '#212121',
  ];
  const FONT_SIZES = [
    { v: 0.85, label: 'Piccolo' },
    { v: 1, label: 'Normale' },
    { v: 1.25, label: 'Grande' },
    { v: 1.5, label: 'Molto grande' },
  ];

  // ------------------------------------------------------------------
  // Utilità
  // ------------------------------------------------------------------
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function iso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function fromIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function itDate(s) { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; }
  function longDate(d) { return `${GIORNI_LUNGHI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}`; }
  function initcap(s) { return String(s || '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, m => m.toUpperCase()); }

  function textOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#000';
    const n = parseInt(m[1], 16);
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255);
    return L > 0.4 ? '#111' : '#fff';
  }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function errMsg(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/Invalid login credentials/i.test(m)) return 'Email o password non corretti.';
    if (/already registered|already been registered/i.test(m)) return 'Questa email è già registrata.';
    if (/Password should be at least/i.test(m)) return 'La password è troppo corta.';
    if (/rate limit/i.test(m)) return 'Troppi tentativi, riprova tra qualche minuto.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Connessione assente. Controlla internet e riprova.';
    return m;
  }

  const eyeIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeOffIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.3 20.3 0 0 1 5.06-5.94M9.9 4.24A9.6 9.6 0 0 1 12 4c7 0 11 7 11 7a20.4 20.4 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

  function pwField(id, label, autocomplete) {
    return `<label for="${id}">${label}</label>
      <div class="pw">
        <input type="password" id="${id}" autocomplete="${autocomplete}" required>
        <button type="button" class="eye" data-eye="${id}" aria-label="Mostra password">${eyeIcon}</button>
      </div>`;
  }
  function bindEyes(root) {
    root.querySelectorAll('[data-eye]').forEach(b => {
      b.onclick = () => {
        const input = document.getElementById(b.dataset.eye);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.innerHTML = show ? eyeOffIcon : eyeIcon;
        b.setAttribute('aria-label', show ? 'Nascondi password' : 'Mostra password');
      };
    });
  }

  const isAdmin = () => state.profile?.role === 'admin';

  // ------------------------------------------------------------------
  // Impostazioni personali
  // ------------------------------------------------------------------
  async function loadSettings() {
    const { data } = await sb.from('user_settings').select('*').eq('user_id', state.session.user.id).maybeSingle();
    state.settings = { ...DEFAULT_SETTINGS, ...(data || {}) };
    applyFontScale();
  }

  function applyFontScale() {
    document.documentElement.style.setProperty('--font-scale', state.settings?.font_scale || 1);
  }

  let saveTimer;
  function saveSettings(patch) {
    Object.assign(state.settings, patch);
    applyFontScale();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const s = state.settings;
      const { error } = await sb.from('user_settings').upsert({
        user_id: state.session.user.id,
        font_scale: s.font_scale,
        highlight_changed: s.highlight_changed,
        changed_color: s.changed_color,
        type_prefs: s.type_prefs,
        type_order: s.type_order,
        notify_mode: s.notify_mode,
        updated_at: new Date().toISOString(),
      });
      toast(error ? errMsg(error) : 'Preferenze salvate');
    }, 700);
  }

  // Colore ed etichetta che QUESTO utente vede per un turno
  function look(type, changed) {
    const p = state.settings?.type_prefs?.[type.id] || {};
    let color = p.color || type.color;
    if (changed && state.settings?.highlight_changed) color = state.settings.changed_color;
    return { color, label: p.label || type.short_label };
  }

  // Ordine personale dei turni (poi l'ordine predefinito dell'admin)
  function sortTypes(list, get = x => x) {
    const order = (state.settings?.type_order || []).map(Number);
    const pos = id => { const i = order.indexOf(Number(id)); return i < 0 ? Infinity : i; };
    return list.sort((a, b) => {
      const ta = get(a), tb = get(b);
      return (pos(ta.id) - pos(tb.id)) || (ta.sort_order - tb.sort_order) || ta.name.localeCompare(tb.name, 'it');
    });
  }

  // ------------------------------------------------------------------
  // Avvio e sessione
  // ------------------------------------------------------------------
  async function loadProfile() {
    if (!state.session) { state.profile = null; return; }
    const { data, error } = await sb.from('profiles').select('*').eq('id', state.session.user.id).maybeSingle();
    if (error) { toast(errMsg(error)); }
    state.profile = data || null;
  }

  async function route() {
    if (!state.session) return renderAuth();
    await loadProfile();
    if (!state.profile) return renderStatus('Profilo non trovato', 'Il tuo account non ha un profilo. Contatta l\'amministratore.');
    if (state.profile.status === 'pending') {
      return renderStatus('Iscrizione in attesa',
        `Ciao ${esc(state.profile.first_name)}, la tua iscrizione è stata ricevuta. Potrai accedere ai turni appena l'amministratore la approverà.`, true);
    }
    if (state.profile.status === 'rejected') {
      return renderStatus('Iscrizione non approvata', 'La tua richiesta di iscrizione non è stata approvata. Per informazioni contatta l\'amministratore.');
    }
    await loadSettings();
    renderShell();
  }

  sb.auth.onAuthStateChange((event, session) => {
    const changed = (session?.user?.id || null) !== (state.session?.user?.id || null);
    state.session = session;
    if (event === 'INITIAL_SESSION' || changed) {
      if (!session) { state.tab = 'calendar'; state.adminView = 'menu'; }
      // rimanda fuori dal callback per evitare blocchi interni di supabase-js
      setTimeout(route, 0);
    }
  });

  // ------------------------------------------------------------------
  // Accesso e registrazione
  // ------------------------------------------------------------------
  function renderAuth() {
    const login = state.authMode === 'login';
    app.innerHTML = `
      <div class="auth">
        <div class="brand"><img src="icon.svg" alt=""><div><h1>Gestione turni</h1><div class="muted small">I tuoi turni, sempre con te</div></div></div>
        <div class="tabs">
          <button data-mode="login" class="${login ? 'active' : ''}">Accedi</button>
          <button data-mode="register" class="${!login ? 'active' : ''}">Registrati</button>
        </div>
        <form class="card" id="authForm" novalidate>
          ${login ? `
            <label for="email">Email</label>
            <input type="email" id="email" autocomplete="email" inputmode="email" required>
            ${pwField('password', 'Password', 'current-password')}
            <button class="btn primary block" type="submit">Accedi</button>
          ` : `
            <label for="first">Nome</label>
            <input type="text" id="first" autocomplete="given-name" required>
            <label for="last">Cognome</label>
            <input type="text" id="last" autocomplete="family-name" required>
            <label for="email">Email</label>
            <input type="email" id="email" autocomplete="email" inputmode="email" required>
            ${pwField('password', 'Password (almeno 8 caratteri)', 'new-password')}
            ${pwField('password2', 'Ripeti password', 'new-password')}
            <button class="btn primary block" type="submit">Registrati</button>
            <p class="muted small">Dopo la registrazione l'amministratore dovrà approvare la tua iscrizione.</p>
          `}
          <div class="err" id="authErr"></div>
        </form>
      </div>`;
    app.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { state.authMode = b.dataset.mode; renderAuth(); });
    bindEyes(app);
    const form = document.getElementById('authForm');
    form.onsubmit = async ev => {
      ev.preventDefault();
      const errBox = document.getElementById('authErr');
      errBox.textContent = '';
      const btn = form.querySelector('button[type=submit]');
      const email = document.getElementById('email').value.trim().toLowerCase();
      const password = document.getElementById('password').value;
      try {
        if (login) {
          if (!email || !password) throw new Error('Inserisci email e password.');
          btn.disabled = true;
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        } else {
          const first = document.getElementById('first').value.trim();
          const last = document.getElementById('last').value.trim();
          const password2 = document.getElementById('password2').value;
          if (!first || !last) throw new Error('Inserisci nome e cognome.');
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Inserisci un indirizzo email valido.');
          if (password.length < 8) throw new Error('La password deve avere almeno 8 caratteri.');
          if (password !== password2) throw new Error('Le due password non coincidono.');
          btn.disabled = true;
          const { data, error } = await sb.auth.signUp({
            email, password,
            options: { data: { first_name: first, last_name: last } },
          });
          if (error) throw error;
          if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            throw new Error('Questa email è già registrata.');
          }
        }
      } catch (e) {
        errBox.textContent = errMsg(e);
        btn.disabled = false;
      }
    };
  }

  function renderStatus(title, html, canRefresh) {
    app.innerHTML = `
      <div class="auth">
        <div class="brand"><img src="icon.svg" alt=""><h1>Gestione turni</h1></div>
        <div class="card">
          <h2>${esc(title)}</h2>
          <p>${html}</p>
          ${canRefresh ? '<button class="btn primary block" id="refresh">Controlla di nuovo</button>' : ''}
          <button class="btn block" id="logout">Esci</button>
        </div>
      </div>`;
    if (canRefresh) document.getElementById('refresh').onclick = route;
    document.getElementById('logout').onclick = () => sb.auth.signOut();
  }

  // ------------------------------------------------------------------
  // Struttura principale
  // ------------------------------------------------------------------
  function renderShell() {
    app.innerHTML = `
      <div id="view" style="display:flex;flex-direction:column;flex:1"></div>
      <nav class="bottomnav"><div class="inner">
        <button data-tab="calendar"><span class="ico">📅</span>Calendario</button>
        <button data-tab="requests"><span class="ico">🔁</span>Richieste<span class="badge" id="reqBadge" hidden></span></button>
        ${isAdmin() ? '<button data-tab="admin"><span class="ico">🛠️</span>Admin<span class="badge" id="pendingBadge" hidden></span></button>' : ''}
        <button data-tab="profile"><span class="ico">👤</span>Profilo</button>
      </div></nav>`;
    app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      if (state.tab === b.dataset.tab && b.dataset.tab === 'admin') state.adminView = 'menu';
      state.tab = b.dataset.tab;
      renderTab();
    });
    renderTab();
    refreshPendingBadge();
    refreshRequestsBadge();
  }

  function renderTab() {
    app.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    const view = document.getElementById('view');
    if (state.tab === 'admin' && isAdmin()) return renderAdmin(view);
    if (state.tab === 'profile') return renderProfile(view);
    if (state.tab === 'requests') return renderRequests(view);
    return renderCalendar(view);
  }

  async function refreshPendingBadge() {
    if (!isAdmin()) return;
    const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    state.pendingCount = count || 0;
    const b = document.getElementById('pendingBadge');
    if (b) { b.hidden = !state.pendingCount; b.textContent = state.pendingCount; }
  }

  async function refreshRequestsBadge() {
    if (!state.profile || state.profile.status !== 'approved') return;
    const me = state.session.user.id;
    const [a, b] = await Promise.all([
      sb.from('swap_requests').select('id', { count: 'exact', head: true }).eq('target_id', me).eq('status', 'pending'),
      sb.from('swap_requests').select('id', { count: 'exact', head: true }).eq('requester_id', me).eq('requester_seen', false),
    ]);
    const n = state.settings?.notify_mode === 'none' ? 0 : (a.count || 0) + (b.count || 0);
    const el = document.getElementById('reqBadge');
    if (el) { el.hidden = !n; el.textContent = n; }
  }

  // aggiorna i badge quando si torna sull'app e ogni minuto
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.profile?.status === 'approved') { refreshRequestsBadge(); refreshPendingBadge(); }
  });
  setInterval(() => {
    if (!document.hidden && state.profile?.status === 'approved') { refreshRequestsBadge(); refreshPendingBadge(); }
  }, 60000);

  const isShiftAdmin = () => ['admin', 'admin_shifts'].includes(state.profile?.role);

  // ------------------------------------------------------------------
  // Calendario
  // ------------------------------------------------------------------
  async function renderCalendar(view) {
    const m = state.month;
    const start = new Date(m);
    start.setDate(1 - ((m.getDay() + 6) % 7)); // lunedì della prima settimana
    const end = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    end.setDate(end.getDate() + (7 - ((end.getDay() + 6) % 7) - 1)); // domenica dell'ultima settimana

    view.innerHTML = `
      <div class="topbar">
        <button class="iconbtn" id="prev" aria-label="Mese precedente">‹</button>
        <div class="title" id="monthTitle">${MESI[m.getMonth()]} ${m.getFullYear()}</div>
        <button class="iconbtn" id="next" aria-label="Mese successivo">›</button>
      </div>
      <div class="content">
        <div class="weekdays">${GIORNI.map(g => `<div>${g}</div>`).join('')}</div>
        <div class="grid" id="grid"></div>
        <div style="text-align:center;margin-top:12px"><button class="btn" id="today">Oggi</button></div>
      </div>`;
    document.getElementById('prev').onclick = () => { state.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); renderCalendar(view); };
    document.getElementById('next').onclick = () => { state.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); renderCalendar(view); };
    document.getElementById('today').onclick = () => { state.month = firstOfMonth(new Date()); renderCalendar(view); };
    enableSwipe(view, d => { state.month = new Date(m.getFullYear(), m.getMonth() + d, 1); renderCalendar(view); });

    const drawGrid = (byDate) => {
      const todayIso = iso(new Date());
      const cells = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = iso(d);
        const s = byDate[key];
        const t = s?.shift_types;
        const cls = ['cell'];
        if (d.getMonth() !== m.getMonth()) cls.push('out');
        if (d.getDay() === 0) cls.push('sun');
        if (key === todayIso) cls.push('today');
        const lk = t ? look(t, s.changed) : null;
        cells.push(`<button class="${cls.join(' ')}" data-day="${key}">
          <span><span class="num">${d.getDate()}</span></span>
          ${lk ? `<span class="chip" style="background:${esc(lk.color)};color:${textOn(lk.color)}">${esc(lk.label)}</span>` : ''}
        </button>`);
      }
      const grid = document.getElementById('grid');
      if (!grid) return;
      grid.innerHTML = cells.join('');
      grid.querySelectorAll('[data-day]').forEach(c => c.onclick = () => openDay(c.dataset.day, byDate[c.dataset.day]));
    };

    drawGrid({});
    const { data, error } = await sb.from('shifts')
      .select(`date, changed, ${SHIFT_TYPE_FK}(id, name, short_label, color, category)`)
      .eq('email', state.profile.email)
      .gte('date', iso(start)).lte('date', iso(end));
    if (error) return toast(errMsg(error));
    if (state.tab !== 'calendar' || state.month !== m) return;
    const byDate = {};
    (data || []).forEach(r => { byDate[r.date] = r; });
    drawGrid(byDate);
  }

  function enableSwipe(el, onSwipe) {
    let x0 = null, y0 = null;
    el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  // ------------------------------------------------------------------
  // Vista del giorno
  // ------------------------------------------------------------------
  async function openDay(dayIso, mine) {
    const t = mine?.shift_types;
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    const accent = t ? look(t, mine.changed).color : null;
    const styleVars = accent
      ? `--day-accent:${accent};--day-accent-text:${textOn(accent)};--day-bg:color-mix(in srgb, ${accent} 14%, var(--surface));`
      : '';
    backdrop.innerHTML = `
      <div class="sheet" style="${styleVars}" role="dialog" aria-modal="true">
        <div class="sheet-head">
          <div>
            <div class="date">${longDate(fromIso(dayIso))}</div>
            <div class="mine">${t ? esc(t.name) : 'Nessun turno'}</div>
          </div>
          <button class="iconbtn" id="closeDay" aria-label="Chiudi">✕</button>
        </div>
        <div class="sheet-body" id="dayBody"><p class="muted">Caricamento…</p></div>
      </div>`;
    document.body.appendChild(backdrop);
    let dirty = false;
    const close = () => {
      backdrop.remove();
      if (dirty && state.tab === 'calendar') renderTab();
    };
    backdrop.onclick = e => { if (e.target === backdrop) close(); };
    backdrop.querySelector('#closeDay').onclick = close;
    const body = backdrop.querySelector('#dayBody');

    const [res, reg] = await Promise.all([
      sb.from('shifts')
        .select(`email, changed, ${SHIFT_TYPE_FK}(id, name, sort_order, category, color), people(display_name)`)
        .eq('date', dayIso),
      sb.rpc('registered_emails'),
    ]);
    if (res.error) { body.innerHTML = `<p class="err">${esc(errMsg(res.error))}</p>`; return; }
    const data = res.data || [];
    const registered = new Set(reg.data || []);
    if (!data.length) { body.innerHTML = '<p class="muted">Nessun turno caricato per questo giorno.</p>'; return; }

    const people = data.map(r => ({
      email: r.email,
      name: r.people?.display_name || r.email,
      type: r.shift_types,
      changed: r.changed,
      me: r.email === state.profile.email,
      registered: registered.has(r.email),
    }));
    const myRow = people.find(p => p.me);
    const canRequest = myRow && dayIso >= iso(new Date());

    const groupsOf = list => {
      const g = new Map();
      list.forEach(p => {
        if (!g.has(p.type.id)) g.set(p.type.id, { type: p.type, people: [] });
        g.get(p.type.id).people.push(p);
      });
      return sortTypes([...g.values()], x => x.type)
        .map(x => ({ ...x, people: x.people.sort((a, b) => a.name.localeCompare(b.name, 'it')) }));
    };
    const groupHead = t => `<div class="gname"><span class="dot" style="background:${esc(look(t).color)}"></span>${esc(t.name)}</div>`;

    // ---- elenco di chi fa cosa ----
    const showMain = () => {
      const sorted = groupsOf(people);
      const renderGroups = list => list.map(g => `
        <div class="group">
          ${groupHead(g.type)}
          <div class="names">${g.people.map(p => {
            const n = esc(p.name) + (p.changed ? ' <span class="swapmark" title="Turno cambiato">↔</span>' : '');
            return p.me ? `<b>${n} (tu)</b>` : n;
          }).join(', ')}</div>
        </div>`).join('');
      const pres = sorted.filter(g => g.type.category !== 'assenza');
      const ass = sorted.filter(g => g.type.category === 'assenza');
      body.innerHTML =
        (pres.length ? `<div class="section-label">In servizio</div>${renderGroups(pres)}` : '') +
        (ass.length ? `<div class="section-label">Assenze e riposi</div>${renderGroups(ass)}` : '') +
        `<div class="day-actions">
          ${canRequest ? '<button class="btn primary block" id="askSwap">🔁 Cambia turno</button>' : ''}
          ${isShiftAdmin() ? '<button class="btn block" id="adminSwap">Registra un cambio tra colleghi (admin)</button>' : ''}
          ${isAdmin() ? '<button class="btn block" id="adminSet">Modifica il turno di una persona (admin)</button>' : ''}
        </div>`;
      const q = id => body.querySelector('#' + id);
      if (q('askSwap')) q('askSwap').onclick = showPicker;
      if (q('adminSwap')) q('adminSwap').onclick = showAdminSwap;
      if (q('adminSet')) q('adminSet').onclick = showAdminSet;
    };

    // ---- scelta del collega ----
    const showPicker = () => {
      const others = people.filter(p => !p.me && p.type.id !== myRow.type.id);
      const groups = groupsOf(others);
      body.innerHTML = `
        <button class="back" id="bk">‹ Indietro</button>
        <h2>Con chi vuoi cambiare?</h2>
        <p class="muted small">Il tuo turno: <b>${esc(myRow.type.name)}</b>. Scegli il collega: prenderai il suo turno e lui il tuo.</p>
        ${groups.length ? groups.map(g => `
          <div class="group">
            ${groupHead(g.type)}
            <div class="pick">${g.people.map(p => p.registered
              ? `<button class="btn" data-pick="${esc(p.email)}">${esc(p.name)}</button>`
              : `<button class="btn" disabled title="Non registrato">${esc(p.name)} <span class="small">(non registrato)</span></button>`).join('')}</div>
          </div>`).join('') : '<p class="muted">Nessun collega con un turno diverso dal tuo in questo giorno.</p>'}`;
      body.querySelector('#bk').onclick = showMain;
      body.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => showSend(people.find(p => p.email === b.dataset.pick)));
    };

    // ---- conferma e messaggio ----
    const showSend = other => {
      body.innerHTML = `
        <button class="back" id="bk">‹ Indietro</button>
        <h2>Richiesta di cambio</h2>
        <div class="report">
          <div><b>Tu</b>: ${esc(myRow.type.name)} → <b>${esc(other.type.name)}</b></div>
          <div><b>${esc(other.name)}</b>: ${esc(other.type.name)} → <b>${esc(myRow.type.name)}</b></div>
        </div>
        <label for="msg">Messaggio (facoltativo)</label>
        <textarea id="msg" rows="3" maxlength="500" placeholder="Es. Ciao, mi faresti questo cambio?"></textarea>
        <button class="btn primary block" id="send">Invia richiesta</button>`;
      body.querySelector('#bk').onclick = showPicker;
      body.querySelector('#send').onclick = async e => {
        e.target.disabled = true;
        const { error } = await sb.rpc('create_swap_request', {
          p_date: dayIso, p_target_email: other.email, p_message: body.querySelector('#msg').value,
        });
        if (error) { e.target.disabled = false; return toast(errMsg(error)); }
        toast(`Richiesta inviata a ${other.name}`);
        showMain();
      };
    };

    const personOptions = () => groupsOf(people).flatMap(g => g.people)
      .map(p => `<option value="${esc(p.email)}">${esc(p.name)} — ${esc(p.type.name)}</option>`).join('');

    // ---- admin: scambio tra due persone ----
    const showAdminSwap = () => {
      body.innerHTML = `
        <button class="back" id="bk">‹ Indietro</button>
        <h2>Registra un cambio</h2>
        <p class="muted small">Scambia i turni di due persone in questo giorno, anche se non sono registrate.</p>
        <label>Prima persona</label><select id="pa">${personOptions()}</select>
        <label>Seconda persona</label><select id="pb">${personOptions()}</select>
        <button class="btn primary block" id="go">Scambia i turni</button>`;
      body.querySelector('#bk').onclick = showMain;
      body.querySelector('#pb').selectedIndex = Math.min(1, people.length - 1);
      body.querySelector('#go').onclick = async e => {
        const a = body.querySelector('#pa').value, b = body.querySelector('#pb').value;
        if (a === b) return toast('Scegli due persone diverse');
        e.target.disabled = true;
        const { error } = await sb.rpc('admin_swap', { p_date: dayIso, p_a: a, p_b: b });
        if (error) { e.target.disabled = false; return toast(errMsg(error)); }
        toast('Cambio registrato');
        dirty = true;
        close();
      };
    };

    // ---- admin completo: cambia direttamente un turno ----
    const showAdminSet = async () => {
      const { data: types } = await sb.from('shift_types').select('id, name, sort_order');
      const opts = sortTypes(types || []).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
      body.innerHTML = `
        <button class="back" id="bk">‹ Indietro</button>
        <h2>Modifica un turno</h2>
        <label>Persona</label><select id="pp">${personOptions()}</select>
        <label>Nuovo turno</label><select id="tt">${opts}</select>
        <button class="btn primary block" id="go">Salva</button>`;
      body.querySelector('#bk').onclick = showMain;
      const syncType = () => {
        const p = people.find(x => x.email === body.querySelector('#pp').value);
        if (p) body.querySelector('#tt').value = p.type.id;
      };
      body.querySelector('#pp').onchange = syncType;
      syncType();
      body.querySelector('#go').onclick = async e => {
        e.target.disabled = true;
        const { error } = await sb.rpc('admin_set_shift', {
          p_date: dayIso, p_email: body.querySelector('#pp').value, p_type_id: Number(body.querySelector('#tt').value),
        });
        if (error) { e.target.disabled = false; return toast(errMsg(error)); }
        toast('Turno modificato');
        dirty = true;
        close();
      };
    };

    showMain();
  }

  // ------------------------------------------------------------------
  // Richieste di cambio turno
  // ------------------------------------------------------------------
  const STATUS = {
    pending: ['In attesa', ''],
    accepted: ['Accettata', 'st-ok'],
    rejected: ['Rifiutata', 'st-no'],
    cancelled: ['Annullata', ''],
    expired: ['Scaduta', ''],
  };

  async function renderRequests(view) {
    view.innerHTML = `
      <div class="topbar"><div class="title">Richieste di cambio</div></div>
      <div class="content" id="reqList"><p class="muted">Caricamento…</p></div>`;
    const box = document.getElementById('reqList');
    const { data, error } = await sb.from('swap_requests')
      .select(`*, req:people!swap_requests_requester_email_fkey(display_name), tgt:people!swap_requests_target_email_fkey(display_name),
               rt:shift_types!swap_requests_requester_type_id_fkey(name), tt:shift_types!swap_requests_target_type_id_fkey(name)`)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { box.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
    const me = state.session.user.id;
    const incoming = data.filter(r => r.target_id === me && r.status === 'pending');
    const outgoing = data.filter(r => r.requester_id === me && r.status === 'pending');
    const history = data.filter(r => r.status !== 'pending');
    const dname = r => longDate(fromIso(r.date));
    const quote = (who, txt) => txt ? `<div class="quote"><span class="muted small">${esc(who)}:</span> ${esc(txt)}</div>` : '';

    box.innerHTML = `
      <h3>Da rispondere (${incoming.length})</h3>
      <div class="list">${incoming.map(r => `
        <div class="row" data-id="${r.id}">
          <div><b>${esc(r.req?.display_name)}</b> ti chiede un cambio</div>
          <div class="muted small" style="text-transform:capitalize">${dname(r)}</div>
          <div class="report">
            <div><b>Tu</b>: ${esc(r.tt?.name)} → <b>${esc(r.rt?.name)}</b></div>
            <div><b>${esc(r.req?.display_name)}</b>: ${esc(r.rt?.name)} → <b>${esc(r.tt?.name)}</b></div>
          </div>
          ${quote(r.req?.display_name, r.message)}
          <label>Risposta (facoltativa)</label>
          <textarea class="resp" rows="2" maxlength="500"></textarea>
          <div class="actions">
            <button class="btn primary" data-ans="yes">Accetta</button>
            <button class="btn danger" data-ans="no">Rifiuta</button>
          </div>
        </div>`).join('') || '<p class="muted">Nessuna richiesta da rispondere.</p>'}</div>

      <h3>Inviate in attesa (${outgoing.length})</h3>
      <div class="list">${outgoing.map(r => `
        <div class="row" data-id="${r.id}">
          <div>Hai chiesto a <b>${esc(r.tgt?.display_name)}</b></div>
          <div class="muted small" style="text-transform:capitalize">${dname(r)}</div>
          <div class="small" style="margin-top:6px">Tu: ${esc(r.rt?.name)} → <b>${esc(r.tt?.name)}</b></div>
          ${quote('Tu', r.message)}
          <div class="actions"><button class="btn" data-cancel>Annulla richiesta</button></div>
        </div>`).join('') || '<p class="muted">Nessuna richiesta in attesa.</p>'}</div>

      <h3>Storico</h3>
      <div class="list">${history.map(r => {
        const mine = r.requester_id === me;
        const [label, cls] = STATUS[r.status] || [r.status, ''];
        const isNew = mine && !r.requester_seen;
        return `<div class="row">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <div>${mine ? `Tu → <b>${esc(r.tgt?.display_name)}</b>` : `<b>${esc(r.req?.display_name)}</b> → te`}</div>
            <div>${isNew ? '<span class="pill st-new">Nuovo</span> ' : ''}<span class="pill ${cls}">${label}</span></div>
          </div>
          <div class="muted small" style="text-transform:capitalize">${dname(r)}</div>
          <div class="small" style="margin-top:6px">${esc(r.rt?.name)} ↔ ${esc(r.tt?.name)}</div>
          ${quote(mine ? 'Tu' : r.req?.display_name, r.message)}
          ${quote(mine ? r.tgt?.display_name : 'Tu', r.response)}
        </div>`;
      }).join('') || '<p class="muted">Ancora nessun cambio.</p>'}</div>`;

    box.querySelectorAll('[data-ans]').forEach(btn => btn.onclick = async () => {
      const row = btn.closest('.row');
      const accept = btn.dataset.ans === 'yes';
      row.querySelectorAll('button').forEach(b => { b.disabled = true; });
      const { data: res, error } = await sb.rpc('respond_swap', {
        p_id: Number(row.dataset.id), p_accept: accept, p_response: row.querySelector('.resp').value,
      });
      if (error) { toast(errMsg(error)); }
      else if (res === 'accepted') toast('Cambio accettato: il calendario è aggiornato');
      else if (res === 'expired') toast('I turni sono cambiati nel frattempo: la richiesta è scaduta');
      else toast('Richiesta rifiutata');
      renderRequests(view);
      refreshRequestsBadge();
    });
    box.querySelectorAll('[data-cancel]').forEach(btn => btn.onclick = async () => {
      const row = btn.closest('.row');
      btn.disabled = true;
      const { error } = await sb.rpc('cancel_swap', { p_id: Number(row.dataset.id) });
      toast(error ? errMsg(error) : 'Richiesta annullata');
      renderRequests(view);
    });

    // le risposte ricevute ora sono state viste
    if (data.some(r => r.requester_id === me && !r.requester_seen)) {
      await sb.rpc('mark_swaps_seen');
    }
    refreshRequestsBadge();
  }

  // ------------------------------------------------------------------
  // Profilo
  // ------------------------------------------------------------------
  function paletteHtml(current, withDefault) {
    const cur = (current || '').toLowerCase();
    return `<div class="palette">
      ${PALETTE.map(c => `<button type="button" class="sw ${c === cur ? 'sel' : ''}" data-color="${c}" style="background:${c}" aria-label="Colore ${c}"></button>`).join('')}
      <label class="sw custom" title="Altro colore"><input type="color" value="${esc(current || '#1e88e5')}">＋</label>
      ${withDefault ? '<button type="button" class="btn small-btn" data-color="">Predefinito</button>' : ''}
    </div>`;
  }

  function bindPalette(root, onPick) {
    root.querySelectorAll('[data-color]').forEach(b => b.onclick = () => onPick(b.dataset.color || null));
    const inp = root.querySelector('input[type=color]');
    if (inp) inp.onchange = () => onPick(inp.value);
  }

  async function renderProfile(view) {
    const p = state.profile;
    const s = state.settings;
    const roles = { admin: 'Admin completo', admin_shifts: 'Admin cambi turno', user: 'Utente' };
    view.innerHTML = `
      <div class="topbar"><div class="title">Profilo</div></div>
      <div class="content">
        <div class="card">
          <h2>${esc(p.first_name)} ${esc(p.last_name)}</h2>
          <div class="muted">${esc(p.email)}</div>
          <div style="margin-top:8px"><span class="pill">${roles[p.role] || p.role}</span></div>
        </div>

        <h3>Notifiche</h3>
        <div class="card">
          <label class="switch-row"><span>Badge ed email</span><input type="radio" name="nm" value="email" ${s.notify_mode === 'email' ? 'checked' : ''}></label>
          <div class="muted small">Il numerino rosso nell'app e un'email a ${esc(p.email)} per richieste di cambio, risposte e nuovi turni caricati.</div>
          <hr class="sep">
          <label class="switch-row"><span>Solo badge</span><input type="radio" name="nm" value="badge" ${s.notify_mode === 'badge' ? 'checked' : ''}></label>
          <div class="muted small">Solo il numerino rosso sulla scheda Richieste.</div>
          <hr class="sep">
          <label class="switch-row"><span>Nessuna</span><input type="radio" name="nm" value="none" ${s.notify_mode === 'none' ? 'checked' : ''}></label>
          <div class="muted small">Nessun avviso: controlli tu la scheda Richieste.</div>
        </div>

        <h3>Dimensione del testo nel calendario</h3>
        <div class="tabs" id="fontSizes">
          ${FONT_SIZES.map(f => `<button data-fs="${f.v}" class="${Number(s.font_scale) === f.v ? 'active' : ''}">${f.label}</button>`).join('')}
        </div>

        <h3>Turni cambiati</h3>
        <div class="card">
          <label class="switch-row"><span>Evidenzia con un colore diverso i turni arrivati da un cambio</span>
            <input type="checkbox" id="hl" ${s.highlight_changed ? 'checked' : ''}></label>
          <div id="hlColor" ${s.highlight_changed ? '' : 'hidden'}>
            <div class="muted small" style="margin:10px 0 6px">Colore dei turni cambiati</div>
            ${paletteHtml(s.changed_color, false)}
          </div>
        </div>

        <h3>I miei turni</h3>
        <p class="muted small">Scegli come vedere ogni turno: abbreviazione e colore valgono solo per te. Con le frecce decidi l'ordine nella vista del giorno.</p>
        <div class="list" id="types"><p class="muted">Caricamento…</p></div>
        <button class="btn block" id="resetTypes">Ripristina colori, nomi e ordine predefiniti</button>

        <button class="btn block danger" id="logout" style="margin-top:24px">Esci</button>
      </div>`;
    document.getElementById('logout').onclick = () => sb.auth.signOut();

    view.querySelectorAll('input[name=nm]').forEach(r => r.onchange = () => {
      saveSettings({ notify_mode: r.value });
      refreshRequestsBadge();
    });

    view.querySelectorAll('[data-fs]').forEach(b => b.onclick = () => {
      saveSettings({ font_scale: Number(b.dataset.fs) });
      view.querySelectorAll('[data-fs]').forEach(x => x.classList.toggle('active', x === b));
    });

    const hl = document.getElementById('hl');
    hl.onchange = () => {
      saveSettings({ highlight_changed: hl.checked });
      document.getElementById('hlColor').hidden = !hl.checked;
    };
    const hlBox = document.getElementById('hlColor');
    bindPalette(hlBox, c => {
      if (!c) return;
      saveSettings({ changed_color: c });
      hlBox.querySelectorAll('.sw').forEach(x => x.classList.toggle('sel', x.dataset.color === c));
    });

    const { data: types, error } = await sb.from('shift_types').select('id, name, short_label, color, sort_order, category');
    const box = document.getElementById('types');
    if (!box) return;
    if (error) { box.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
    if (!types.length) { box.innerHTML = '<p class="muted">Non ci sono ancora turni caricati.</p>'; return; }

    const setPref = (id, patch) => {
      const prefs = { ...s.type_prefs };
      const cur = { ...(prefs[id] || {}), ...patch };
      Object.keys(cur).forEach(k => { if (cur[k] == null || cur[k] === '') delete cur[k]; });
      if (Object.keys(cur).length) prefs[id] = cur; else delete prefs[id];
      saveSettings({ type_prefs: prefs });
    };

    const draw = () => {
      const list = sortTypes([...types]);
      box.innerHTML = list.map((t, i) => {
        const lk = look(t);
        const pref = s.type_prefs[t.id] || {};
        return `<div class="row trow" data-id="${t.id}">
          <div class="trow-head">
            <div class="order">
              <button class="iconbtn sm" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Sposta su">▲</button>
              <button class="iconbtn sm" data-move="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Sposta giù">▼</button>
            </div>
            <span class="chip big" style="background:${esc(lk.color)};color:${textOn(lk.color)}">${esc(lk.label)}</span>
            <div class="tname"><b>${esc(t.name)}</b><div class="muted small">${t.category === 'assenza' ? 'Assenza / riposo' : 'In servizio'}</div></div>
            <button class="iconbtn sm" data-open aria-label="Modifica">✎</button>
          </div>
          <div class="trow-edit" hidden>
            <label>Come lo vuoi vedere nel calendario</label>
            <input type="text" class="lbl" maxlength="12" value="${esc(pref.label || '')}" placeholder="${esc(t.short_label)}">
            <div class="muted small" style="margin:10px 0 6px">Colore</div>
            ${paletteHtml(lk.color, true)}
          </div>
        </div>`;
      }).join('');

      box.querySelectorAll('.trow').forEach(row => {
        const id = row.dataset.id;
        const t = types.find(x => String(x.id) === id);
        const refreshChip = () => {
          const lk = look(t);
          const chip = row.querySelector('.chip');
          chip.textContent = lk.label;
          chip.style.background = lk.color;
          chip.style.color = textOn(lk.color);
          row.querySelectorAll('.sw').forEach(x => x.classList.toggle('sel', x.dataset.color === lk.color.toLowerCase()));
        };
        row.querySelector('[data-open]').onclick = () => {
          const ed = row.querySelector('.trow-edit');
          ed.hidden = !ed.hidden;
        };
        row.querySelector('.lbl').oninput = e => { setPref(id, { label: e.target.value.trim() }); refreshChip(); };
        bindPalette(row.querySelector('.trow-edit'), c => { setPref(id, { color: c }); refreshChip(); });
        row.querySelectorAll('[data-move]').forEach(b => b.onclick = () => {
          const ids = sortTypes([...types]).map(x => x.id);
          const i = ids.indexOf(t.id), j = i + Number(b.dataset.move);
          if (j < 0 || j >= ids.length) return;
          [ids[i], ids[j]] = [ids[j], ids[i]];
          saveSettings({ type_order: ids });
          draw();
        });
      });
    };
    draw();

    document.getElementById('resetTypes').onclick = () => {
      if (!confirm('Ripristinare colori, nomi e ordine predefiniti dei turni?')) return;
      saveSettings({ type_prefs: {}, type_order: [] });
      draw();
    };
  }

  // ------------------------------------------------------------------
  // Admin
  // ------------------------------------------------------------------
  function adminFrame(view, title, inner) {
    view.innerHTML = `
      <div class="topbar"><div class="title">${esc(title)}</div></div>
      <div class="content">
        ${state.adminView !== 'menu' ? '<button class="back" id="backAdmin">‹ Admin</button>' : ''}
        ${inner}
      </div>`;
    const back = document.getElementById('backAdmin');
    if (back) back.onclick = () => { state.adminView = 'menu'; renderTab(); };
  }

  function renderAdmin(view) {
    const v = state.adminView;
    if (v === 'pending') return adminPending(view);
    if (v === 'users') return adminUsers(view);
    if (v === 'types') return adminTypes(view);
    if (v === 'import') return adminImport(view);
    if (v === 'backup') return adminBackup(view);
    adminFrame(view, 'Admin', `
      <div class="menu">
        <button data-go="pending"><span>Iscrizioni da approvare<span class="sub">Nuove richieste di accesso</span></span><span id="pendingPill">›</span></button>
        <button data-go="users"><span>Utenti e nomi visibili<span class="sub">Nome mostrato ai colleghi e ruoli</span></span>›</button>
        <button data-go="types"><span>Tipi di turno<span class="sub">Ordine, abbreviazione, colore, categoria</span></span>›</button>
        <button data-go="import"><span>Carica turni (CSV)<span class="sub">Sostituisce le date presenti nel file</span></span>›</button>
        <button id="exportXlsx"><span>Scarica turni (Excel)<span class="sub">File .xlsx con tutti i cambi già applicati</span></span>⬇</button>
        <button id="exportBtn"><span>Scarica turni (CSV)<span class="sub">Stesso formato del file da caricare</span></span>⬇</button>
        <button data-go="backup"><span>Backup ed email<span class="sub">Backup giornaliero in Excel e mittente delle email</span></span>›</button>
      </div>`);
    view.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { state.adminView = b.dataset.go; renderTab(); });
    document.getElementById('exportBtn').onclick = exportCsv;
    document.getElementById('exportXlsx').onclick = exportXlsx;
    const showPill = () => {
      const pill = document.getElementById('pendingPill');
      if (!pill) return;
      pill.className = state.pendingCount ? 'pill' : '';
      pill.style.cssText = state.pendingCount ? 'background:var(--danger);color:#fff' : '';
      pill.textContent = state.pendingCount || '›';
    };
    showPill();
    refreshPendingBadge().then(showPill);
  }

  async function adminPending(view) {
    adminFrame(view, 'Iscrizioni', '<div class="list" id="list"><p class="muted">Caricamento…</p></div>');
    const { data, error } = await sb.from('profiles').select('*').eq('status', 'pending').order('created_at');
    const list = document.getElementById('list');
    if (error) { list.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
    if (!data.length) { list.innerHTML = '<p class="muted">Nessuna iscrizione in attesa.</p>'; return; }
    list.innerHTML = data.map(p => `
      <div class="row" data-id="${p.id}">
        <div><b>${esc(p.first_name)} ${esc(p.last_name)}</b></div>
        <div class="muted small">${esc(p.email)}</div>
        <div class="muted small">Registrato il ${new Date(p.created_at).toLocaleString('it-IT')}</div>
        <label>Nome visibile ai colleghi</label>
        <input type="text" class="dn" value="${esc(initcap(p.last_name) || '')}">
        <div class="actions">
          <button class="btn primary" data-act="ok">Approva</button>
          <button class="btn danger" data-act="no">Rifiuta</button>
        </div>
      </div>`).join('');
    list.querySelectorAll('.row').forEach(row => {
      row.querySelectorAll('[data-act]').forEach(btn => btn.onclick = async () => {
        const approve = btn.dataset.act === 'ok';
        if (!approve && !confirm('Rifiutare questa iscrizione?')) return;
        btn.disabled = true;
        const { error } = await sb.rpc('review_user', {
          p_user: row.dataset.id, p_approve: approve, p_display_name: row.querySelector('.dn').value,
        });
        if (error) { btn.disabled = false; return toast(errMsg(error)); }
        toast(approve ? 'Iscrizione approvata' : 'Iscrizione rifiutata');
        refreshPendingBadge();
        adminPending(view);
      });
    });
  }

  async function adminUsers(view) {
    adminFrame(view, 'Utenti', '<div id="list"><p class="muted">Caricamento…</p></div>');
    const [pr, pe] = await Promise.all([
      sb.from('profiles').select('*').eq('status', 'approved').order('last_name'),
      sb.from('people').select('*').order('display_name'),
    ]);
    const list = document.getElementById('list');
    if (pr.error || pe.error) { list.innerHTML = `<p class="err">${esc(errMsg(pr.error || pe.error))}</p>`; return; }
    const people = new Map(pe.data.map(p => [p.email, p]));
    const registered = new Set(pr.data.map(p => p.email));
    const others = pe.data.filter(p => !registered.has(p.email));
    const roleSel = p => p.id === state.profile.id ? '<span class="pill">Admin completo (tu)</span>' : `
      <label>Ruolo</label>
      <select class="role">
        <option value="user" ${p.role === 'user' ? 'selected' : ''}>Utente</option>
        <option value="admin_shifts" ${p.role === 'admin_shifts' ? 'selected' : ''}>Admin cambi turno</option>
        <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Admin completo</option>
      </select>`;
    list.innerHTML = `
      <h3>Registrati (${pr.data.length})</h3>
      <div class="list">${pr.data.map(p => `
        <div class="row" data-email="${esc(p.email)}" data-id="${p.id}">
          <div><b>${esc(p.first_name)} ${esc(p.last_name)}</b></div>
          <div class="muted small">${esc(p.email)}</div>
          <label>Nome visibile</label>
          <input type="text" class="dn" value="${esc(people.get(p.email)?.display_name || '')}">
          ${roleSel(p)}
          <div class="actions"><button class="btn primary" data-save>Salva</button></div>
        </div>`).join('')}</div>
      <h3>Nei turni ma non registrati (${others.length})</h3>
      <div class="list">${others.map(p => `
        <div class="row" data-email="${esc(p.email)}">
          <div class="muted small">${esc(p.email)}</div>
          <label>Nome visibile</label>
          <input type="text" class="dn" value="${esc(p.display_name)}">
          <div class="actions"><button class="btn primary" data-save>Salva</button></div>
        </div>`).join('') || '<p class="muted">Nessuno.</p>'}</div>`;
    list.querySelectorAll('[data-save]').forEach(btn => btn.onclick = async () => {
      const row = btn.closest('.row');
      btn.disabled = true;
      try {
        const r1 = await sb.rpc('set_display_name', { p_email: row.dataset.email, p_display_name: row.querySelector('.dn').value });
        if (r1.error) throw r1.error;
        const sel = row.querySelector('.role');
        if (sel) {
          const r2 = await sb.rpc('set_role', { p_user: row.dataset.id, p_role: sel.value });
          if (r2.error) throw r2.error;
        }
        toast('Salvato');
      } catch (e) { toast(errMsg(e)); }
      btn.disabled = false;
    });
  }

  async function adminTypes(view) {
    adminFrame(view, 'Tipi di turno', `
      <p class="muted small">Il nome è quello scritto nel file. L'abbreviazione è quella predefinita nel calendario; l'ordine decide come vengono elencati i turni nella vista del giorno (numero più basso = più in alto).</p>
      <div class="list" id="list"><p class="muted">Caricamento…</p></div>`);
    const { data, error } = await sb.from('shift_types').select('*').order('sort_order').order('name');
    const list = document.getElementById('list');
    if (error) { list.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
    if (!data.length) { list.innerHTML = '<p class="muted">Nessun tipo di turno: verranno creati automaticamente al primo caricamento del CSV.</p>'; return; }
    list.innerHTML = data.map(t => `
      <div class="row typerow" data-id="${t.id}">
        <div><b>${esc(t.name)}</b></div>
        <div class="fields">
          <div><label>Abbreviazione</label><input type="text" class="sl" value="${esc(t.short_label)}" maxlength="12"></div>
          <div><label>Ordine</label><input type="number" class="so" value="${t.sort_order}" inputmode="numeric"></div>
          <div><label>Colore</label><input type="color" class="co" value="${esc(t.color)}"></div>
        </div>
        <div><label>Categoria</label>
          <select class="ca">
            <option value="presenza" ${t.category === 'presenza' ? 'selected' : ''}>Presenza (in servizio)</option>
            <option value="assenza" ${t.category === 'assenza' ? 'selected' : ''}>Assenza / riposo</option>
          </select></div>
        <div class="actions"><button class="btn primary" data-save>Salva</button></div>
      </div>`).join('');
    list.querySelectorAll('[data-save]').forEach(btn => btn.onclick = async () => {
      const row = btn.closest('.row');
      const upd = {
        short_label: row.querySelector('.sl').value.trim() || '?',
        sort_order: parseInt(row.querySelector('.so').value, 10) || 0,
        color: row.querySelector('.co').value,
        category: row.querySelector('.ca').value,
      };
      btn.disabled = true;
      const { error } = await sb.from('shift_types').update(upd).eq('id', row.dataset.id);
      btn.disabled = false;
      toast(error ? errMsg(error) : 'Salvato');
    });
  }

  // ------------------------------------------------------------------
  // CSV: lettura, controllo, importazione
  // ------------------------------------------------------------------
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const counts = { ';': (firstLine.match(/;/g) || []).length, ',': (firstLine.match(/,/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
    const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function parseDate(s) {
    s = s.trim();
    let d, m, y;
    let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
    else {
      r = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(s);
      if (!r) return null;
      d = +r[1]; m = +r[2]; y = +r[3]; if (y < 100) y += 2000;
    }
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return iso(dt);
  }

  function analyzeCsv(text) {
    const raw = parseCsv(text);
    const errors = [];
    const rows = [];
    let start = 0, ci = { date: 0, email: 1, shift: 2 };
    const head = (raw[0] || []).map(h => h.trim().toLowerCase());
    const find = names => head.findIndex(h => names.includes(h));
    if (head.some(h => ['data', 'date', 'giorno', 'email', 'e-mail', 'mail', 'dipendente', 'turno', 'shift'].includes(h))) {
      start = 1;
      ci = {
        date: find(['data', 'date', 'giorno']),
        email: find(['email', 'e-mail', 'mail', 'dipendente']),
        shift: find(['turno', 'shift', 'tipo turno', 'evento']),
      };
      if (ci.date < 0 || ci.email < 0 || ci.shift < 0) {
        return { rows: [], errors: ['Intestazione non riconosciuta: servono le colonne DATA, DIPENDENTE (o EMAIL) e TURNO.'] };
      }
    }
    const seen = new Map();
    for (let i = start; i < raw.length; i++) {
      const line = i + 1;
      const cols = raw[i];
      if (!cols.some(c => c.trim() !== '')) continue;
      const ds = (cols[ci.date] || '').trim();
      const email = (cols[ci.email] || '').trim().toLowerCase();
      const shift = (cols[ci.shift] || '').trim().replace(/\s+/g, ' ');
      const date = parseDate(ds);
      const errs = [];
      if (!date) errs.push(`data non valida "${ds}"`);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.push(`email non valida "${email}"`);
      if (!shift) errs.push('turno mancante');
      if (errs.length) { errors.push(`Riga ${line}: ${errs.join(', ')}`); continue; }
      const k = date + '|' + email;
      if (seen.has(k)) { errors.push(`Riga ${line}: ${email} ha già un turno il ${itDate(date)} (riga ${seen.get(k)})`); continue; }
      seen.set(k, line);
      rows.push({ date, email, shift });
    }
    if (!rows.length && !errors.length) errors.push('Il file non contiene turni.');
    return { rows, errors };
  }

  async function adminImport(view) {
    adminFrame(view, 'Carica turni', `
      <label class="filebox">
        <input type="file" id="file" accept=".csv,text/csv,text/plain">
        <div style="font-size:2rem">📄</div>
        <div><b>Scegli il file CSV</b></div>
        <div class="small">Colonne: DATA ; DIPENDENTE (email) ; TURNO</div>
      </label>
      <div id="result"></div>`);
    const result = document.getElementById('result');
    document.getElementById('file').onchange = async ev => {
      const f = ev.target.files[0];
      if (!f) return;
      const buf = await f.arrayBuffer();
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf); // CSV salvato senza UTF-8
      const { rows, errors } = analyzeCsv(text);
      if (errors.length) {
        result.innerHTML = `<div class="report"><b class="err">Il file contiene errori, correggili e riprova:</b>
          <ul>${errors.slice(0, 30).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
          ${errors.length > 30 ? `<div class="muted">…e altri ${errors.length - 30}</div>` : ''}</div>`;
        return;
      }
      const dates = [...new Set(rows.map(r => r.date))].sort();
      const people = new Set(rows.map(r => r.email));
      const types = [...new Set(rows.map(r => r.shift))];
      result.innerHTML = `
        <div class="report">
          <b>${esc(f.name)}</b>
          <ul>
            <li>${rows.length} turni per ${people.size} persone</li>
            <li>dal ${itDate(dates[0])} al ${itDate(dates[dates.length - 1])} (${dates.length} giorni)</li>
            <li>${types.length} tipi di turno: ${types.map(esc).join(', ')}</li>
          </ul>
          <p class="small">I turni già presenti in <b>questi ${dates.length} giorni</b> verranno sostituiti. Gli altri giorni restano invariati.</p>
        </div>
        <button class="btn primary block" id="doImport">Conferma e carica</button>`;
      document.getElementById('doImport').onclick = async e => {
        e.target.disabled = true;
        e.target.textContent = 'Caricamento…';
        const { data, error } = await sb.rpc('import_shifts', { p_rows: rows });
        if (error) { e.target.disabled = false; e.target.textContent = 'Conferma e carica'; return toast(errMsg(error)); }
        result.innerHTML = `
          <div class="report"><b class="ok">Caricamento completato</b>
            <ul>
              <li>${data.rows} turni caricati (sostituiti ${data.replaced} turni precedenti)</li>
              <li>dal ${itDate(data.from)} al ${itDate(data.to)}</li>
              ${data.new_people ? `<li>${data.new_people} nuove persone (nome visibile ricavato dall'email, modificabile in "Utenti")</li>` : ''}
              ${data.new_shift_types.length ? `<li>Nuovi tipi di turno: ${data.new_shift_types.map(esc).join(', ')}. Controlla ordine e colori in "Tipi di turno".</li>` : ''}
            </ul></div>`;
        ev.target.value = '';
      };
    };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Impossibile caricare il generatore Excel'));
      document.head.appendChild(s);
    });
  }

  // Il server restituisce al massimo 1000 righe per volta: le leggiamo a pagine
  async function fetchAllShifts() {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.rpc('export_shifts', {}).range(from, from + 999);
      if (error) return { data: null, error };
      all.push(...data);
      if (data.length < 1000) return { data: all, error: null };
    }
  }

  async function adminBackup(view) {
    adminFrame(view, 'Backup ed email', '<div id="bkBox"><p class="muted">Caricamento…</p></div>');
    const { data: s, error } = await sb.from('app_settings').select('*').eq('id', 1).single();
    const box = document.getElementById('bkBox');
    if (error) { box.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
    box.innerHTML = `
      <h3>Mittente delle email</h3>
      <div class="card">
        <p class="muted small" style="margin-top:0">L'indirizzo da cui partono notifiche e backup. Deve essere lo stesso verificato su Brevo.</p>
        <label>Email del mittente</label>
        <input type="email" id="se" value="${esc(s.sender_email || '')}" placeholder="es. turni.mnfe@gmail.com">
        <label>Nome del mittente</label>
        <input type="text" id="sn" value="${esc(s.sender_name || '')}">
      </div>

      <h3>Backup giornaliero</h3>
      <div class="card">
        <label class="switch-row"><span>Invia ogni giorno il file Excel dei turni</span>
          <input type="checkbox" id="be" ${s.backup_enabled ? 'checked' : ''}></label>
        <label>Indirizzo che riceve il backup</label>
        <input type="email" id="bm" value="${esc(s.backup_email || '')}" placeholder="es. nome.cognome@cultura.gov.it">
        <p class="muted small">Ogni mattina verso le 6 (le 7 con l'ora legale). Ultimo backup: ${s.last_backup_at ? new Date(s.last_backup_at).toLocaleString('it-IT') : 'mai'}.</p>
      </div>
      <button class="btn primary block" id="saveBk">Salva</button>
      <button class="btn block" id="testMail">Invia un'email di prova a me</button>
      <button class="btn block" id="runBk">Invia un backup adesso</button>
      <div id="bkMsg"></div>`;

    const msg = (t, ok) => { document.getElementById('bkMsg').innerHTML = `<div class="report ${ok ? 'ok' : 'err'}">${esc(t)}</div>`; };
    const save = async () => {
      const upd = {
        sender_email: document.getElementById('se').value.trim() || null,
        sender_name: document.getElementById('sn').value.trim() || 'Turni MNFE',
        backup_enabled: document.getElementById('be').checked,
        backup_email: document.getElementById('bm').value.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (upd.backup_enabled && !upd.backup_email) throw new Error('Inserisci l\'indirizzo che riceve il backup');
      const { error } = await sb.from('app_settings').update(upd).eq('id', 1);
      if (error) throw error;
    };
    const invoke = async (fn, body) => {
      const { data, error } = await sb.functions.invoke(fn, { body });
      if (error) {
        let detail = error.message;
        try { detail = (await error.context.json()).error || detail; } catch (_) { /* nessun dettaglio */ }
        throw new Error(detail);
      }
      return data;
    };
    document.getElementById('saveBk').onclick = async e => {
      e.target.disabled = true;
      try { await save(); toast('Salvato'); } catch (err) { toast(errMsg(err)); }
      e.target.disabled = false;
    };
    document.getElementById('testMail').onclick = async e => {
      e.target.disabled = true;
      try { await save(); const r = await invoke('notify', { test: true }); msg(`Email di prova inviata a ${r.to}. Controlla la posta (anche lo spam).`, true); }
      catch (err) { msg('Invio non riuscito: ' + errMsg(err), false); }
      e.target.disabled = false;
    };
    document.getElementById('runBk').onclick = async e => {
      e.target.disabled = true;
      try { await save(); const r = await invoke('daily-backup', { force: true }); msg(`Backup inviato a ${r.to} (${r.rows} righe).`, true); }
      catch (err) { msg('Backup non riuscito: ' + errMsg(err), false); }
      e.target.disabled = false;
    };
  }

  async function exportXlsx() {
    try {
      if (!window.XLSX) await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
      const { data, error } = await fetchAllShifts();
      if (error) throw error;
      if (!data.length) return toast('Non ci sono turni da scaricare');
      const rows = [['DATA', 'DIPENDENTE', 'TURNO'], ...data.map(r => [fromIso(r.date), r.email, r.shift])];
      const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: 'dd/mm/yyyy' });
      ws['!cols'] = [{ wch: 12 }, { wch: 36 }, { wch: 24 }];
      ws['!autofilter'] = { ref: `A1:C${rows.length}` };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Turni');
      XLSX.writeFile(wb, `turni_${iso(new Date())}.xlsx`);
    } catch (e) { toast(errMsg(e)); }
  }

  async function exportCsv() {
    const { data, error } = await fetchAllShifts();
    if (error) return toast(errMsg(error));
    if (!data.length) return toast('Non ci sono turni da scaricare');
    const q = v => /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = ['DATA;DIPENDENTE;TURNO', ...data.map(r => [itDate(r.date), r.email, r.shift].map(q).join(';'))];
    const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `turni_${iso(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // Le funzioni di analisi CSV sono esposte per i test
  window.__turni = { analyzeCsv, parseDate };
})();
