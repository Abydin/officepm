import {
  html, render, useState, useEffect, useRef, useMemo, useCallback
} from '/vendor/htm-preact.module.js';

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

async function api(path, opts) {
  const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts, {
    headers: Object.assign({}, opts && opts.body && !(opts.body instanceof FormData)
      ? { 'Content-Type': 'application/json' } : {}, opts && opts.headers)
  }));
  let body = null;
  try { body = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error((body && body.error) || ('HTTP ' + res.status));
  return body;
}
const get = (p) => api(p);
const post = (p, data) => api(p, { method: 'POST', body: JSON.stringify(data || {}) });
const patch = (p, data) => api(p, { method: 'PATCH', body: JSON.stringify(data || {}) });
const del = (p) => api(p, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function getTheme() {
  try { return localStorage.getItem('pm_theme') || 'dark'; } catch (e) { return 'dark'; }
}
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('pm_theme', t); } catch (e) { /* ignore */ }
}
setTheme(getTheme());

// ---------------------------------------------------------------------------
// Small router (hash based)
// ---------------------------------------------------------------------------

function useHashRoute() {
  const [hash, setHash] = useState(location.hash || '#/overview');
  useEffect(() => {
    const onChange = () => setHash(location.hash || '#/overview');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}
function navigate(path) { location.hash = path; }

// ---------------------------------------------------------------------------
// Status color heuristic (10.2: status-colored accents)
// ---------------------------------------------------------------------------

function statusColor(status) {
  const s = (status || '').toLowerCase();
  if (/done|shipped|deployed|passed|published|resolved/.test(s)) return 'var(--c-green)';
  if (/review|qa|verify|testing/.test(s)) return 'var(--c-cyan)';
  if (/progress|building|implementation/.test(s)) return 'var(--c-blue)';
  if (/fail|blocked/.test(s)) return 'var(--c-red)';
  if (/design|cooldown/.test(s)) return 'var(--c-purple)';
  if (/waiting|triaged|ready/.test(s)) return 'var(--c-amber)';
  return 'var(--c-gray)';
}

function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const s = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// ---------------------------------------------------------------------------
// Login screen (10.4)
// ---------------------------------------------------------------------------

function Login({ onLoggedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const me = await post('/api/login', { email, password });
      onLoggedIn(me);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return html`
    <div class="login-wrap">
      <form class="login-card" onSubmit=${submit}>
        <h1>OfficePM</h1>
        <p class="dim" style="margin-top:-8px">One Node process. One SQLite file.</p>
        ${err ? html`<div class="error-banner">${err}</div>` : null}
        <div class="field">
          <label>Email</label>
          <input type="email" required value=${email} onInput=${(e) => setEmail(e.target.value)} autofocus />
        </div>
        <div class="field">
          <label>Password</label>
          <input type="password" required value=${password} onInput=${(e) => setPassword(e.target.value)} />
        </div>
        <button class="btn btn-primary" type="submit" disabled=${busy} style="width:100%;justify-content:center">
          ${busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Overview (6.11)
// ---------------------------------------------------------------------------

function Overview() {
  const [rows, setRows] = useState(null);
  useEffect(() => { get('/api/overview').then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return html`<p class="dim">Loading...</p>`;
  return html`
    <h2>Overview</h2>
    <table class="overview">
      <thead><tr><th>Project</th><th>Board</th><th>Open</th><th>In Progress</th><th>Done (7d)</th></tr></thead>
      <tbody>
        ${rows.map((r) => html`
          <tr key=${r.project_slug + r.board_slug}
              style="cursor:pointer" onClick=${() => navigate('#/p/' + r.project_slug + '/b/' + r.board_slug)}>
            <td>${r.project}</td>
            <td>${r.board}</td>
            <td>${r.open}</td>
            <td>${r.in_progress}</td>
            <td>${r.done_7d}</td>
          </tr>
        `)}
      </tbody>
    </table>
  `;
}

function MyTickets({ onOpen }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { get('/api/my-tickets').then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return html`<p class="dim">Loading...</p>`;
  return html`
    <h2>My Tickets</h2>
    ${rows.length === 0 ? html`<p class="dim">Nothing assigned to you. Nice.</p>` : html`
      <table class="overview">
        <thead><tr><th>Key</th><th>Title</th><th>Board</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map((t) => html`
            <tr key=${t.key} style="cursor:pointer" onClick=${() => onOpen(t.key)}>
              <td class="mono">${t.key}</td><td>${t.title}</td>
              <td>${t.project_slug}/${t.board_slug}</td>
              <td><span class="status-dot" style=${'background:' + statusColor(t.status)}></span> ${t.status}</td>
            </tr>
          `)}
        </tbody>
      </table>
    `}
  `;
}

// ---------------------------------------------------------------------------
// Project overview
// ---------------------------------------------------------------------------

function ProjectOverview({ slug }) {
  const [project, setProject] = useState(null);
  const [docs, setDocs] = useState([]);
  useEffect(() => {
    get('/api/projects/' + slug).then(setProject).catch(() => setProject(null));
    get('/api/projects/' + slug + '/docs').then(setDocs).catch(() => setDocs([]));
  }, [slug]);
  if (!project) return html`<p class="dim">Loading...</p>`;
  return html`
    <h2>${project.name}</h2>
    <p class="dim">${project.description}</p>
    <div class="card-grid">
      ${project.boards.map((b) => html`
        <div class="panel" key=${b.slug} style="cursor:pointer" onClick=${() => navigate('#/p/' + slug + '/b/' + b.slug)}>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>${b.name}</strong>
            <span class="flow-badge">${b.flow}</span>
          </div>
          <div class="dim mono" style="margin-top:4px">${b.prefix}</div>
        </div>
      `)}
    </div>
    <h3 style="margin-top:32px">Docs & Links</h3>
    <div class="card-grid">
      ${docs.map((d) => html`
        <div class="panel" key=${d.id}>
          <strong>${d.title}</strong>
          <div class="dim" style="margin-top:4px">${d.kind}${d.url ? html` · <a href=${d.url} target="_blank" rel="noopener">open</a>` : null}</div>
          ${d.body ? html`<p style="margin-bottom:0">${d.body}</p>` : null}
        </div>
      `)}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Board (flow-adaptive, 10.4 / 6.8)
// ---------------------------------------------------------------------------

function Board({ projectSlug, boardSlug, onOpen, selectedKey }) {
  const [board, setBoard] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [newTitle, setNewTitle] = useState('');

  const load = useCallback(() => {
    get('/api/projects/' + projectSlug + '/boards/' + boardSlug).then(setBoard).catch(() => setBoard(null));
    get('/api/tickets?project=' + projectSlug + '&board=' + boardSlug).then(setTickets).catch(() => setTickets([]));
  }, [projectSlug, boardSlug]);

  useEffect(load, [load]);

  // Expose the flattened, on-screen ticket order so the Shell's J/K/Enter/A
  // shortcuts (10.6) have something to walk. Column order == board.statuses.
  useEffect(() => {
    if (!board) return;
    const ordered = board.statuses.flatMap((s) => tickets.filter((t) => t.status === s).map((t) => t.key));
    window.dispatchEvent(new CustomEvent('pm:board-tickets', { detail: ordered }));
  }, [board, tickets]);

  useEffect(() => {
    const handler = (e) => {
      const t = e.detail;
      if (t.project_slug !== projectSlug || t.board_slug !== boardSlug) return;
      load();
    };
    window.addEventListener('pm:ticket-changed', handler);
    return () => window.removeEventListener('pm:ticket-changed', handler);
  }, [load, projectSlug, boardSlug]);

  const createTicket = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await post('/api/tickets', {
      project_slug: projectSlug, board_slug: boardSlug, title: newTitle.trim(),
      type: board.types[0]
    });
    setNewTitle('');
    load();
  };

  const moveTicket = async (key, status) => {
    await patch('/api/tickets/' + key, { status });
    load();
  };

  if (!board) return html`<p class="dim">Loading board...</p>`;
  const byStatus = (status) => tickets.filter((t) => t.status === status);

  return html`
    <div class="board-header">
      <h2 style="margin:0">${board.name}</h2>
      <span class="flow-badge">${board.flow}</span>
      ${board.agile ? html`<span class="flow-badge">agile</span>` : null}
      ${board.has_github ? html`<span class="flow-badge">github</span>` : null}
      <span class="dim mono">${board.prefix}</span>
    </div>
    <form class="toolbar" onSubmit=${createTicket}>
      <input placeholder="New ticket title, press Enter" value=${newTitle}
        onInput=${(e) => setNewTitle(e.target.value)} style="flex:1;padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
      <button class="btn btn-primary" type="submit">+ Create (C)</button>
    </form>
    <div class="board-columns">
      ${board.statuses.map((status) => {
        const col = byStatus(status);
        const limit = board.wip_limits && board.wip_limits[status];
        const over = limit && col.length > limit;
        return html`
          <div class="board-column" key=${status}>
            <div class="col-head">
              <span>${status}</span>
              <span class=${'count' + (over ? ' over' : '')}>${col.length}${limit ? '/' + limit : ''}</span>
            </div>
            ${col.map((t) => html`
              <div class=${'ticket-card' + (t.key === selectedKey ? ' selected' : '')} key=${t.key}
                   onClick=${() => onOpen(t.key)}>
                <div class="key">${t.key}${t.blocked ? html` <span class="status-dot blocked" title="blocked"></span>` : null}</div>
                <div class="title">${t.title}</div>
                <div class="meta">
                  <span class="status-dot" style=${'background:' + statusColor(t.status)}></span>
                  ${t.type}
                  ${board.points && t.points != null ? html` · ${t.points}pt` : null}
                  ${t.appetite ? html` · ${t.appetite}` : null}
                  ${t.assignee ? html` · ${t.assignee.split('@')[0]}` : null}
                </div>
                <div class="toolbar" style="margin:6px 0 0" onClick=${(e) => e.stopPropagation()}>
                  <select value=${t.status} onChange=${(e) => moveTicket(t.key, e.target.value)}>
                    ${board.statuses.map((s) => html`<option key=${s} value=${s}>${s}</option>`)}
                  </select>
                </div>
              </div>
            `)}
          </div>
        `;
      })}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Backlog (Scrum/Scrumban) and Epics (agile boards)
// ---------------------------------------------------------------------------

// Inline SVG burndown (PRD 6.9). points: [{date, ideal, actual|null}].
function BurndownChart({ points, totalScope }) {
  if (!points || points.length < 2) return html`<p class="dim">Not enough data for a burndown yet.</p>`;
  const W = 480, H = 140, PAD = 24;
  const maxY = Math.max(totalScope, 1);
  const xFor = (i) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const yFor = (v) => H - PAD - (v / maxY) * (H - PAD * 2);
  const idealPath = points.map((p, i) => (i === 0 ? 'M' : 'L') + xFor(i) + ',' + yFor(p.ideal)).join(' ');
  const actualPts = points.filter((p) => p.actual !== null && p.actual !== undefined);
  const actualPath = actualPts.map((p, i) => (i === 0 ? 'M' : 'L') + xFor(points.indexOf(p)) + ',' + yFor(p.actual)).join(' ');
  return html`
    <svg width=${W} height=${H} viewBox=${'0 0 ' + W + ' ' + H} role="img" aria-label="Sprint burndown chart">
      <line x1=${PAD} y1=${H - PAD} x2=${W - PAD} y2=${H - PAD} stroke="var(--border)" />
      <line x1=${PAD} y1=${PAD} x2=${PAD} y2=${H - PAD} stroke="var(--border)" />
      <path d=${idealPath} fill="none" stroke="var(--c-gray)" stroke-width="2" stroke-dasharray="4,4" />
      <path d=${actualPath} fill="none" stroke="var(--c-blue)" stroke-width="2" />
      <text x=${PAD} y="14" font-size="10" fill="var(--text-dim)">${totalScope} scope</text>
      <text x=${W - PAD} y="14" font-size="10" fill="var(--text-dim)" text-anchor="end">0</text>
    </svg>
    <div class="dim" style="font-size:11px">
      <span style="color:var(--c-gray)">- - -</span> ideal
      <span style="display:inline-block;width:14px;height:2px;background:var(--c-blue);vertical-align:middle;margin-left:12px"></span> actual (approximated from each ticket's last update, no daily snapshots stored)
    </div>
  `;
}

function SprintCard({ projectSlug, boardSlug, board, sprint, tickets, dorItems, onChanged, onOpenRetro }) {
  const [confirmingActivate, setConfirmingActivate] = useState(false);
  const [dorChecked, setDorChecked] = useState({});
  const [burndown, setBurndown] = useState(null);
  const [retroId, setRetroId] = useState(null);

  const inSprint = tickets.filter((t) => t.sprint_id === sprint.id);
  const done = inSprint.filter((t) => board.done_statuses.includes(t.status));
  const pct = inSprint.length ? Math.round(done.length / inSprint.length * 100) : 0;
  const totalPoints = (list) => list.reduce((sum, t) => sum + (t.points || 0), 0);
  const allDorChecked = dorItems.length === 0 || dorItems.every((item) => dorChecked[item]);

  useEffect(() => {
    if (sprint.status === 'active' || sprint.status === 'completed') {
      get('/api/sprints/' + sprint.id + '/burndown').then(setBurndown).catch(() => setBurndown(null));
    }
  }, [sprint.id, sprint.status]);

  useEffect(() => {
    if (sprint.status === 'completed') {
      get('/api/projects/' + projectSlug + '/boards/' + boardSlug + '/retros').then((retros) => {
        const match = retros.find((r) => r.sprint_id === sprint.id);
        setRetroId(match ? match.id : null);
      }).catch(() => {});
    }
  }, [sprint.status, sprint.id]);

  const activate = async () => {
    try {
      await patch('/api/sprints/' + sprint.id, { status: 'active' });
      setConfirmingActivate(false);
      onChanged();
    } catch (e) { alert(e.message); }
  };
  const complete = async () => {
    await patch('/api/sprints/' + sprint.id, { status: 'completed' });
    onChanged();
  };

  return html`
    <div class="panel" key=${sprint.id} style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>${sprint.name}</strong>
        <span class="flow-badge">${sprint.status}</span>
      </div>
      <div class="dim" style="margin:6px 0">
        ${inSprint.length} tickets${board.points ? ' · ' + totalPoints(inSprint) + 'pt' : ''}
        ${sprint.start_date ? html` · ${sprint.start_date} to ${sprint.end_date || '?'}` : ''}
      </div>
      <div class="progress-bar"><div class="fill" style=${'width:' + pct + '%'}></div></div>
      <div class="toolbar" style="margin-top:8px">
        ${sprint.status === 'planned' ? html`
          <button class="btn" onClick=${() => setConfirmingActivate(true)}>Activate</button>
        ` : null}
        ${sprint.status === 'active' ? html`<button class="btn" onClick=${complete}>Mark Completed</button>` : null}
        ${sprint.status === 'completed' && retroId ? html`
          <button class="btn" onClick=${() => onOpenRetro(retroId)}>View Retro &rarr;</button>
        ` : null}
        ${sprint.status === 'completed' && !retroId ? html`<span class="dim">Retro creating...</span>` : null}
      </div>
      ${confirmingActivate ? html`
        <div class="panel" style="margin-top:8px;background:var(--bg)">
          <strong>Definition of Ready</strong>
          <p class="dim" style="margin:4px 0">Board-level checklist on sprint entry (PRD 6.9). Not persisted per sprint, it is a gate for this action.</p>
          ${dorItems.length === 0 ? html`<p class="dim">No Definition of Ready configured for this board.</p>` : dorItems.map((item) => html`
            <div class="dod-item" key=${item}>
              <input type="checkbox" checked=${!!dorChecked[item]}
                onChange=${(e) => setDorChecked(Object.assign({}, dorChecked, { [item]: e.target.checked }))} />
              <span>${item}</span>
            </div>
          `)}
          <div class="toolbar" style="margin-top:8px">
            <button class="btn btn-primary" disabled=${!allDorChecked} onClick=${activate}>Confirm Activate</button>
            <button class="btn" onClick=${() => setConfirmingActivate(false)}>Cancel</button>
          </div>
        </div>
      ` : null}
      ${(sprint.status === 'active' || sprint.status === 'completed') && burndown && !burndown.insufficient_dates ? html`
        <div style="margin-top:12px">
          <${BurndownChart} points=${burndown.points} totalScope=${burndown.total_scope} />
        </div>
      ` : null}
      ${(sprint.status === 'active' || sprint.status === 'completed') && burndown && burndown.insufficient_dates ? html`
        <p class="dim" style="margin-top:8px">Set a start and end date on this sprint to see a burndown.</p>
      ` : null}
    </div>
  `;
}

function Backlog({ projectSlug, boardSlug, onOpen, onOpenRetro }) {
  const [board, setBoard] = useState(null);
  const [settings, setSettings] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [velocity, setVelocity] = useState(null);
  const [newSprint, setNewSprint] = useState({ name: '', start_date: '', end_date: '', kind: '' });

  const load = useCallback(() => {
    get('/api/projects/' + projectSlug + '/boards/' + boardSlug).then(setBoard);
    get('/api/projects/' + projectSlug + '/boards/' + boardSlug + '/settings').then(setSettings);
    get('/api/tickets?project=' + projectSlug + '&board=' + boardSlug).then(setTickets);
    get('/api/projects/' + projectSlug + '/boards/' + boardSlug + '/sprints').then(setSprints);
  }, [projectSlug, boardSlug]);
  useEffect(load, [load]);

  useEffect(() => {
    get('/api/projects/' + projectSlug + '/boards/' + boardSlug).then((b) => {
      if (b.flow === 'scrumban') {
        get('/api/projects/' + projectSlug + '/boards/' + boardSlug + '/velocity').then(setVelocity);
      }
    });
  }, [projectSlug, boardSlug]);

  if (!board || !settings) return html`<p class="dim">Loading...</p>`;
  const backlogTickets = tickets.filter((t) => !t.sprint_id);
  const totalPoints = (list) => list.reduce((sum, t) => sum + (t.points || 0), 0);
  const sprintNoun = board.flow === 'shapeup' ? 'Cycle' : board.flow === 'waterfall' ? 'Phase' : 'Sprint';
  // Section 6.10 lengths: 14-day sprint, 6-week cycle, 2-week cooldown. The
  // form shows them rather than starting blank, and the server applies the same
  // numbers when a caller omits the dates.
  const DEFAULT_DAYS = { sprint: 14, cycle: 42, cooldown: 14, phase: 14 };
  const chosenKind = newSprint.kind || (board.flow === 'shapeup' ? 'cycle'
    : board.flow === 'waterfall' ? 'phase' : 'sprint');
  const addDays = (iso, days) => {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const defaultStart = new Date().toISOString().slice(0, 10);
  const startValue = newSprint.start_date || defaultStart;
  const endValue = newSprint.end_date || addDays(startValue, DEFAULT_DAYS[chosenKind] || 14);

  const createSprint = async (e) => {
    e.preventDefault();
    if (!newSprint.name.trim()) return;
    await post('/api/projects/' + projectSlug + '/boards/' + boardSlug + '/sprints', {
      name: newSprint.name.trim(),
      kind: chosenKind,
      start_date: startValue,
      end_date: endValue
    });
    setNewSprint({ name: '', start_date: '', end_date: '', kind: '' });
    load();
  };

  return html`
    <h2>Backlog · ${board.name}</h2>
    ${velocity ? html`
      <div class="panel" style="margin-bottom:16px">
        <strong>Velocity</strong>
        <p class="dim" style="margin:4px 0">
          ${velocity.average_velocity === null ? 'Not enough completed cycles yet.' :
            'Average ' + velocity.average_velocity + (velocity.uses_points ? ' points' : ' tickets') + ' completed per cycle, across ' + velocity.sprints.length + ' completed cycle(s).'}
        </p>
      </div>
    ` : null}
    <h3>${sprintNoun}s / Cycles</h3>
    <form class="toolbar" onSubmit=${createSprint}>
      <input placeholder=${'New ' + sprintNoun.toLowerCase() + ' name'} value=${newSprint.name}
        onInput=${(e) => setNewSprint(Object.assign({}, newSprint, { name: e.target.value }))}
        style="padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
      ${board.flow === 'shapeup' ? html`
        <select value=${chosenKind} onChange=${(e) => setNewSprint(Object.assign({}, newSprint, { kind: e.target.value, end_date: '' }))}
          title="Shape Up runs a 6-week cycle followed by a 2-week cooldown">
          <option value="cycle">Cycle (6 weeks)</option>
          <option value="cooldown">Cooldown (2 weeks)</option>
        </select>
      ` : null}
      <input type="date" value=${startValue} onInput=${(e) => setNewSprint(Object.assign({}, newSprint, { start_date: e.target.value, end_date: '' }))} />
      <input type="date" value=${endValue} onInput=${(e) => setNewSprint(Object.assign({}, newSprint, { end_date: e.target.value }))} />
      <button class="btn btn-primary" type="submit">+ Create ${board.flow === 'shapeup' ? (chosenKind === 'cooldown' ? 'Cooldown' : 'Cycle') : sprintNoun}</button>
    </form>
    ${sprints.map((s) => html`
      <${SprintCard} key=${s.id} projectSlug=${projectSlug} boardSlug=${boardSlug} board=${board} sprint=${s}
        tickets=${tickets} dorItems=${settings.definition_of_ready || []} onChanged=${load} onOpenRetro=${onOpenRetro} />
    `)}
    <h3 style="margin-top:24px">Unscheduled Backlog (${backlogTickets.length}${board.points ? ' · ' + totalPoints(backlogTickets) + 'pt' : ''})</h3>
    <table class="overview">
      <thead><tr><th>Key</th><th>Title</th><th>Type</th>${board.points ? html`<th>Points</th>` : null}<th>Status</th></tr></thead>
      <tbody>
        ${backlogTickets.map((t) => html`
          <tr key=${t.key} style="cursor:pointer" onClick=${() => onOpen(t.key)}>
            <td class="mono">${t.key}</td><td>${t.title}</td><td>${t.type}</td>
            ${board.points ? html`<td>${t.points ?? ''}</td>` : null}
            <td>${t.status}</td>
          </tr>
        `)}
      </tbody>
    </table>
  `;
}

function Epics({ projectSlug, boardSlug, onOpen }) {
  const [tickets, setTickets] = useState([]);
  const [board, setBoard] = useState(null);
  useEffect(() => {
    get('/api/projects/' + projectSlug + '/boards/' + boardSlug).then(setBoard);
    get('/api/tickets?project=' + projectSlug + '&board=' + boardSlug).then(setTickets);
  }, [projectSlug, boardSlug]);
  if (!board) return html`<p class="dim">Loading...</p>`;
  const epics = tickets.filter((t) => t.level === 'epic');
  return html`
    <h2>Epics · ${board.name}</h2>
    ${epics.length === 0 ? html`<p class="dim">No epics on this board yet.</p>` : null}
    ${epics.map((epic) => {
      const children = tickets.filter((t) => t.parent_key === epic.key);
      const done = children.filter((t) => board.done_statuses.includes(t.status));
      const pct = children.length ? Math.round(done.length / children.length * 100) : 0;
      return html`
        <div class="panel" style="margin-bottom:16px" key=${epic.key}>
          <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onClick=${() => onOpen(epic.key)}>
            <strong class="mono">${epic.key}</strong>
            <span>${epic.title}</span>
            <span class="dim">${done.length}/${children.length}</span>
          </div>
          <div class="progress-bar" style="margin-top:8px"><div class="fill" style=${'width:' + pct + '%'}></div></div>
        </div>
      `;
    })}
  `;
}

// ---------------------------------------------------------------------------
// Retros (6.9)
// ---------------------------------------------------------------------------

function Retros({ projectSlug, boardSlug, initialRetroId, onConsumedInitial }) {
  const [list, setList] = useState([]);
  const [open, setOpenRetro] = useState(null);
  const [cards, setCards] = useState([]);
  const [draft, setDraft] = useState({ well: '', didnt: '', actions: '' });

  const loadList = useCallback(() => {
    get('/api/projects/' + projectSlug + '/boards/' + boardSlug + '/retros').then(setList);
  }, [projectSlug, boardSlug]);
  useEffect(loadList, [loadList]);

  const openRetro = async (id) => {
    const r = await get('/api/retros/' + id);
    setOpenRetro(r);
    setCards(r.cards);
  };

  // Reached from Backlog's "View Retro" button (PRD 6.10: retro auto-created
  // on sprint completion must be reachable from the UI, not just the API).
  useEffect(() => {
    if (initialRetroId) {
      openRetro(initialRetroId);
      onConsumedInitial && onConsumedInitial();
    }
    // eslint-disable-next-line
  }, [initialRetroId]);

  const addCard = async (column) => {
    if (!draft[column].trim()) return;
    await post('/api/retros/' + open.id + '/cards', { column, body: draft[column].trim() });
    setDraft(Object.assign({}, draft, { [column]: '' }));
    const r = await get('/api/retros/' + open.id);
    setCards(r.cards);
  };

  if (open) {
    const col = (name) => cards.filter((c) => c.column_name === name);
    return html`
      <button class="btn" onClick=${() => setOpenRetro(null)}>&larr; Back to retros</button>
      <h2>${open.name}</h2>
      <div class="retro-columns">
        ${['well', 'didnt', 'actions'].map((c) => html`
          <div key=${c}>
            <h4>${c === 'well' ? 'Went well' : c === 'didnt' ? "Didn't go well" : 'Action items'}</h4>
            ${col(c).map((card) => html`<div class="retro-card" key=${card.id}>${card.body}<div class="dim" style="margin-top:4px">- ${card.author}</div></div>`)}
            <input placeholder="Add a card..." value=${draft[c]}
              onInput=${(e) => setDraft(Object.assign({}, draft, { [c]: e.target.value }))}
              onKeyDown=${(e) => { if (e.key === 'Enter') addCard(c); }}
              style="width:100%;margin-top:8px;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
          </div>
        `)}
      </div>
    `;
  }

  return html`
    <h2>Retros</h2>
    ${list.length === 0 ? html`<p class="dim">No retros yet. One is auto-created when a sprint completes.</p>` : null}
    <table class="overview">
      <thead><tr><th>Name</th><th>Status</th></tr></thead>
      <tbody>
        ${list.map((r) => html`
          <tr key=${r.id} style="cursor:pointer" onClick=${() => openRetro(r.id)}>
            <td>${r.name}</td><td>${r.status}</td>
          </tr>
        `)}
      </tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------------
// Standup (6.9: auto-generated from ticket activity)
// ---------------------------------------------------------------------------

function Standup({ projectSlug, boardSlug }) {
  const [tickets, setTickets] = useState([]);
  useEffect(() => { get('/api/tickets?project=' + projectSlug + '&board=' + boardSlug).then(setTickets); }, [projectSlug, boardSlug]);
  const byAssignee = {};
  for (const t of tickets) {
    const who = t.assignee || 'Unassigned';
    (byAssignee[who] = byAssignee[who] || []).push(t);
  }
  return html`
    <h2>Standup</h2>
    <p class="dim">Auto-generated from ticket status and recent activity, no manual entry.</p>
    ${Object.keys(byAssignee).map((who) => html`
      <div class="panel" style="margin-bottom:12px" key=${who}>
        <strong>${who}</strong>
        <ul>
          ${byAssignee[who].map((t) => html`
            <li key=${t.key}><span class="mono">${t.key}</span> ${t.title} - ${t.status}
              ${t.blocked ? html` <span style="color:var(--c-red)">(blocked: ${t.blocker_reason || 'no reason given'})</span>` : null}
              <span class="dim"> · updated ${timeAgo(t.updated_at)}</span>
            </li>
          `)}
        </ul>
      </div>
    `)}
  `;
}

// ---------------------------------------------------------------------------
// Docs & Files
// ---------------------------------------------------------------------------

function DocsFiles({ projectSlug }) {
  const [docs, setDocs] = useState([]);
  const [files, setFiles] = useState([]);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  const load = useCallback(() => {
    get('/api/projects/' + projectSlug + '/docs').then(setDocs);
    get('/api/projects/' + projectSlug + '/files').then(setFiles);
  }, [projectSlug]);
  useEffect(load, [load]);

  const addLink = async (e) => {
    e.preventDefault();
    if (!title.trim() || !url.trim()) return;
    await post('/api/projects/' + projectSlug + '/docs', { title, kind: 'link', url });
    setTitle(''); setUrl(''); load();
  };

  const uploadFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api('/api/projects/' + projectSlug + '/files', { method: 'POST', body: fd });
      load();
    } catch (err) {
      alert(err.message);
    }
    e.target.value = '';
  };

  return html`
    <h2>Docs & Files</h2>
    <form class="toolbar" onSubmit=${addLink}>
      <input placeholder="Title" value=${title} onInput=${(e) => setTitle(e.target.value)} style="padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
      <input placeholder="https://..." value=${url} onInput=${(e) => setUrl(e.target.value)} style="flex:1;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
      <button class="btn" type="submit">Add link</button>
    </form>
    <div class="card-grid" style="margin-bottom:24px">
      ${docs.map((d) => html`
        <div class="panel" key=${d.id}>
          <strong>${d.title}</strong>
          <div class="dim">${d.kind}${d.url ? html` · <a href=${d.url} target="_blank" rel="noopener">open</a>` : null}</div>
        </div>
      `)}
    </div>
    <h3>Files (max 100/project, 25MB each, no .exe/.sh/.bat/.cmd/.js/.html)</h3>
    <input type="file" onChange=${uploadFile} />
    <div style="margin-top:12px">
      ${files.map((f) => html`
        <div class="file-row" key=${f.id}>
          <span>${f.original_name} <span class="dim">(${Math.round(f.size_bytes / 1024)} KB, ${f.uploaded_by})</span></span>
          <a class="btn" href=${'/api/projects/' + projectSlug + '/files/' + f.id}>Download</a>
        </div>
      `)}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Admin (6.12)
// ---------------------------------------------------------------------------

function Admin() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ email: '', name: '', password: '', is_admin: false });
  const [projectsRaw, setProjectsRaw] = useState(null);
  const [err, setErr] = useState('');

  const load = () => get('/api/users').then(setUsers).catch(() => {});
  useEffect(load, []);
  useEffect(() => { get('/api/admin/projects').then(setProjectsRaw).catch(() => {}); }, []);

  const createUser = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await post('/api/users', form);
      setForm({ email: '', name: '', password: '', is_admin: false });
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const resetPw = async (id) => {
    const pw = prompt('New password (min 6 chars):');
    if (!pw) return;
    try { await patch('/api/users/' + id + '/password', { password: pw }); alert('Password reset.'); }
    catch (e2) { alert(e2.message); }
  };

  return html`
    <h2>Admin</h2>
    <h3>Users</h3>
    <table class="overview">
      <thead><tr><th>Email</th><th>Name</th><th>Admin</th><th></th></tr></thead>
      <tbody>
        ${users.map((u) => html`
          <tr key=${u.id}>
            <td>${u.email}</td><td>${u.name}</td><td>${u.is_admin ? 'yes' : ''}</td>
            <td><button class="btn" onClick=${() => resetPw(u.id)}>Reset password</button></td>
          </tr>
        `)}
      </tbody>
    </table>
    <h3 style="margin-top:24px">Create user</h3>
    ${err ? html`<div class="error-banner">${err}</div>` : null}
    <form class="toolbar" onSubmit=${createUser}>
      <input placeholder="email" value=${form.email} onInput=${(e) => setForm(Object.assign({}, form, { email: e.target.value }))}
        style="padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
      <input placeholder="name" value=${form.name} onInput=${(e) => setForm(Object.assign({}, form, { name: e.target.value }))}
        style="padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
      <input placeholder="password" type="password" value=${form.password} onInput=${(e) => setForm(Object.assign({}, form, { password: e.target.value }))}
        style="padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
      <label class="dim"><input type="checkbox" checked=${form.is_admin} onChange=${(e) => setForm(Object.assign({}, form, { is_admin: e.target.checked }))} /> admin</label>
      <button class="btn btn-primary" type="submit">Create</button>
    </form>
    <h3 style="margin-top:24px">Boards (read-only, edit projects.json + restart to change)</h3>
    <pre class="panel mono" style="overflow:auto;max-height:320px">${projectsRaw ? JSON.stringify(projectsRaw, null, 2) : 'Loading...'}</pre>
  `;
}

// ---------------------------------------------------------------------------
// Ticket Drawer (10.5)
// ---------------------------------------------------------------------------

function TicketDrawer({ ticketKey, onClose, boards, focusTitle }) {
  const [ticket, setTicket] = useState(null);
  const [comments, setComments] = useState([]);
  const [links, setLinks] = useState([]);
  const [files, setFiles] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [board, setBoard] = useState(null);
  const [dod, setDod] = useState([]);
  const [ghEvents, setGhEvents] = useState([]);
  const titleRef = useRef(null);

  // Opened with the E shortcut: put the caret in the title, which is the field
  // someone reaches for first. The drawer loads comments, links, files and the
  // DoD in separate requests that each re-render it, so focusing the instant
  // the ticket arrives loses the caret again. Wait for those to settle, then
  // focus once.
  useEffect(() => {
    if (!focusTitle || !ticket) return;
    const t = setTimeout(() => {
      if (titleRef.current) {
        titleRef.current.focus();
        titleRef.current.select();
      }
    }, 350);
    return () => clearTimeout(t);
  }, [focusTitle, ticket && ticket.key]);

  const load = useCallback(async () => {
    const t = await get('/api/tickets/' + ticketKey);
    setTicket(t);
    const b = await get('/api/projects/' + t.project_slug + '/boards/' + t.board_slug);
    setBoard(b);
    get('/api/tickets/' + ticketKey + '/comments').then(setComments);
    get('/api/tickets/' + ticketKey + '/links').then(setLinks);
    get('/api/tickets/' + ticketKey + '/files').then(setFiles);
    if (b.agile) get('/api/tickets/' + ticketKey + '/dod').then(setDod);
    if (b.has_github) get('/api/tickets/' + ticketKey + '/github').then(setGhEvents);
  }, [ticketKey]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = (e) => { if (e.detail.key === ticketKey) load(); };
    window.addEventListener('pm:ticket-single-changed', handler);
    return () => window.removeEventListener('pm:ticket-single-changed', handler);
  }, [ticketKey, load]);

  const save = async (fields) => {
    await patch('/api/tickets/' + ticketKey, fields);
    load();
    window.dispatchEvent(new CustomEvent('pm:ticket-changed', { detail: { project_slug: ticket.project_slug, board_slug: ticket.board_slug } }));
  };

  const addComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    await post('/api/tickets/' + ticketKey + '/comments', { body: newComment.trim() });
    setNewComment('');
    get('/api/tickets/' + ticketKey + '/comments').then(setComments);
  };

  const uploadFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api('/api/tickets/' + ticketKey + '/files', { method: 'POST', body: fd });
      get('/api/tickets/' + ticketKey + '/files').then(setFiles);
    } catch (err) { alert(err.message); }
    e.target.value = '';
  };

  if (!ticket || !board) {
    return html`
      <div class="drawer-backdrop" onClick=${onClose}></div>
      <div class="drawer"><div class="drawer-body"><p class="dim">Loading...</p></div></div>
    `;
  }

  const toggleDod = async (item, done) => {
    await patch('/api/tickets/' + ticketKey + '/dod', { item, done });
    get('/api/tickets/' + ticketKey + '/dod').then(setDod);
  };

  return html`
    <div class="drawer-backdrop" onClick=${onClose}></div>
    <div class="drawer">
      <div class="drawer-header">
        <span class="key">${ticket.key}</span>
        ${ticket.level ? html`<span class="chip">${ticket.level}</span>` : null}
        <span class="chip">${ticket.type}</span>
        <span class="spacer"></span>
        <button class="btn" onClick=${onClose}>Esc</button>
      </div>
      <div class="drawer-body">
        <section>
          <input ref=${titleRef} value=${ticket.title} onBlur=${(e) => e.target.value !== ticket.title && save({ title: e.target.value })}
            style="width:100%;font-size:16px;font-weight:600;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
        </section>
        <section>
          <h4>Fields</h4>
          <div class="field-grid">
            <div class="field">
              <label>Status</label>
              <select value=${ticket.status} onChange=${(e) => save({ status: e.target.value })}>
                ${board.statuses.map((s) => html`<option key=${s} value=${s}>${s}</option>`)}
              </select>
            </div>
            <div class="field">
              <label>Assignee</label>
              <input value=${ticket.assignee || ''} placeholder="email" onBlur=${(e) => save({ assignee: e.target.value || null })} />
            </div>
            <div class="field">
              <label>QA owner</label>
              <input value=${ticket.qa_owner || ''} onBlur=${(e) => save({ qa_owner: e.target.value || null })} />
            </div>
            <div class="field">
              <label>Sprint ID</label>
              <input value=${ticket.sprint_id || ''} onBlur=${(e) => save({ sprint_id: e.target.value || null })} />
            </div>
            ${board.points ? html`
              <div class="field">
                <label>Points</label>
                <input type="number" value=${ticket.points ?? ''} onBlur=${(e) => save({ points: e.target.value ? Number(e.target.value) : null })} />
              </div>
            ` : null}
            ${board.flow === 'shapeup' ? html`
              <div class="field">
                <label>Appetite</label>
                <input value=${ticket.appetite || ''} placeholder="2 weeks / 6 weeks" onBlur=${(e) => save({ appetite: e.target.value || null })} />
              </div>
            ` : null}
            ${board.agile ? html`
              <div class="field">
                <label>Level</label>
                <select value=${ticket.level || 'task'} onChange=${(e) => save({ level: e.target.value })}>
                  ${['epic', 'story', 'task', 'bug'].map((l) => html`<option key=${l} value=${l}>${l}</option>`)}
                </select>
              </div>
            ` : null}
            <div class="field">
              <label>Parent key</label>
              <input value=${ticket.parent_key || ''} onBlur=${(e) => save({ parent_key: e.target.value || null })} />
            </div>
          </div>
        </section>
        ${board.agile ? html`
          <section>
            <h4>Blockers</h4>
            <label><input type="checkbox" checked=${ticket.blocked} onChange=${(e) => save({ blocked: e.target.checked })} /> Blocked</label>
            ${ticket.blocked ? html`
              <input placeholder="reason" value=${ticket.blocker_reason || ''} onBlur=${(e) => save({ blocker_reason: e.target.value })}
                style="width:100%;margin-top:8px;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
            ` : null}
          </section>
        ` : null}
        ${board.agile && dod.length > 0 ? html`
          <section>
            <h4>Definition of Done</h4>
            ${dod.map((d) => html`
              <div class="dod-item" key=${d.item}>
                <input type="checkbox" checked=${d.done} onChange=${(e) => toggleDod(d.item, e.target.checked)} />
                <span>${d.item}</span>
              </div>
            `)}
          </section>
        ` : null}
        <section>
          <h4>Description</h4>
          <textarea rows="4" value=${ticket.description || ''} onBlur=${(e) => save({ description: e.target.value })}
            style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)"></textarea>
        </section>
        ${ticket.level === 'story' ? html`
          <section>
            <h4>Acceptance Criteria</h4>
            <textarea rows="3" placeholder="one per line"
              value=${(ticket.acceptance_criteria || []).join('\n')}
              onBlur=${(e) => save({ acceptance_criteria: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
              style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)"></textarea>
          </section>
        ` : null}
        ${board.has_github ? html`
          <section>
            <h4>GitHub</h4>
            ${ghEvents.length === 0 ? html`<p class="dim">No PR, deploy or release events yet for this ticket.</p>` : ghEvents.map((g) => html`
              <div class="comment" key=${g.id}>
                <span class="chip">${g.kind}</span> ${g.repo} · ${g.ref}${g.environment ? ' · ' + g.environment : ''}
                <span class="when">${timeAgo(g.created_at)}</span>
                ${g.url ? html`<div><a href=${g.url} target="_blank" rel="noopener">${g.url}</a></div>` : null}
              </div>
            `)}
          </section>
        ` : null}
        <section>
          <h4>Links</h4>
          ${links.map((l) => html`<div class="link-row" key=${l.id}><a href=${l.url} target="_blank" rel="noopener">${l.title}</a></div>`)}
        </section>
        <section>
          <h4>Attachments</h4>
          <input type="file" onChange=${uploadFile} />
          ${files.map((f) => html`
            <div class="file-row" key=${f.id}>
              <span>${f.original_name}</span>
              <a class="btn" href=${'/api/tickets/' + ticketKey + '/files/' + f.id}>Download</a>
            </div>
          `)}
        </section>
        <section>
          <h4>Comments</h4>
          ${comments.map((c) => html`
            <div class=${'comment' + (c.source === 'system' ? ' system' : '')} key=${c.id}>
              <span class="author">${c.author}</span><span class="when">${timeAgo(c.created_at)}</span>
              <div>${c.body}</div>
            </div>
          `)}
          <form onSubmit=${addComment} style="margin-top:8px">
            <textarea rows="2" placeholder="Add a comment..." value=${newComment} onInput=${(e) => setNewComment(e.target.value)}
              style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)"></textarea>
            <button class="btn" type="submit" style="margin-top:6px">Comment</button>
          </form>
        </section>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Command Palette (10.6)
// ---------------------------------------------------------------------------

function CommandPalette({ onClose, projects, onOpenTicket, onCreate }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);

  // Search on the server, capped, and debounced. This used to GET every ticket
  // in the instance on every keystroke and filter in the browser, which is a
  // full table transfer per character once a board has real volume.
  useEffect(() => {
    const needle = q.trim();
    if (!needle) { setResults([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      get('/api/tickets?limit=8&q=' + encodeURIComponent(needle))
        .then((rows) => { if (!cancelled) setResults(rows); })
        .catch(() => { if (!cancelled) setResults([]); });
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  return html`
    <div class="palette-backdrop" onClick=${onClose}>
      <div class="palette" onClick=${(e) => e.stopPropagation()}>
        <input ref=${inputRef} placeholder="Search tickets, or type a command..." value=${q}
          onInput=${(e) => setQ(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Escape') onClose(); }} />
        <div class="results">
          ${!q.trim() ? html`
            <div class="result" onClick=${() => { onClose(); onCreate(); }}>+ Create ticket</div>
          ` : results.map((t) => html`
            <div class="result" key=${t.key} onClick=${() => { onClose(); onOpenTicket(t.key); }}>
              <span class="mono">${t.key}</span><span>${t.title}</span>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

function ShortcutsHelp({ onClose }) {
  const rows = [
    ['Cmd/Ctrl+K', 'Command palette'],
    ['C', 'Create ticket (on a board)'],
    ['G then B', 'Go to Board'],
    ['G then S', 'Go to Sprints/Backlog'],
    ['G then R', 'Go to Retros'],
    ['J / K', 'Next / previous ticket'],
    ['Enter', 'Open selected ticket'],
    ['E', 'Open selected ticket, focused for editing'],
    ['A', 'Assign selected ticket to me'],
    ['/', 'Focus search'],
    ['?', 'Show this help'],
    ['Esc', 'Close drawer / dialog']
  ];
  return html`
    <div class="palette-backdrop" onClick=${onClose}>
      <div class="palette" onClick=${(e) => e.stopPropagation()} style="padding:16px">
        <h3 style="margin-top:0">Keyboard shortcuts</h3>
        <div class="shortcuts-grid">
          ${rows.flatMap(([k, d]) => [html`<kbd key=${k + '-k'}>${k}</kbd>`, html`<span key=${k + '-d'}>${d}</span>`])}
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Shell / App root
// ---------------------------------------------------------------------------

function Shell({ me, onLogout }) {
  const hash = useHashRoute();
  const [projects, setProjects] = useState([]);
  const [ticketKey, setTicketKey] = useState(null);
  const [editIntent, setEditIntent] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [boardTickets, setBoardTickets] = useState([]);
  const [pendingRetroId, setPendingRetroId] = useState(null);
  const [sprintOptions, setSprintOptions] = useState([]);
  const [showPalette, setShowPalette] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [theme, setThemeState] = useState(getTheme());
  const searchRef = useRef(null);
  const gPressedAt = useRef(0);

  useEffect(() => { get('/api/projects').then(setProjects).catch(() => setProjects([])); }, []);

  // J/K/Enter/A (10.6) walk this list, populated by Board whenever it loads.
  useEffect(() => {
    const handler = (e) => { setBoardTickets(e.detail || []); setSelectedIndex(0); };
    window.addEventListener('pm:board-tickets', handler);
    return () => window.removeEventListener('pm:board-tickets', handler);
  }, []);

  // SSE subscription -> re-broadcast as DOM CustomEvents for components to react to
  useEffect(() => {
    const es = new EventSource('/api/events');
    const relay = (name) => (e) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent('pm:ticket-changed', { detail: data }));
        window.dispatchEvent(new CustomEvent('pm:ticket-single-changed', { detail: data }));
      } catch (err) { /* ignore */ }
    };
    es.addEventListener('ticket.created', relay('ticket.created'));
    es.addEventListener('ticket.updated', relay('ticket.updated'));
    es.addEventListener('ticket.deleted', relay('ticket.deleted'));
    return () => es.close();
  }, []);

  const parts = hash.replace('#/', '').split('/');
  // routes: overview | mine | p/:slug | p/:slug/b/:board | p/:slug/b/:board/backlog|epics|retros|standup | p/:slug/docs | admin

  // Topbar Sprint dropdown (PRD 10.3). Lists the current board's sprints/
  // cycles/phases; picking one jumps to Backlog, where the sprint's detail
  // (progress, burndown, activate/complete) actually lives.
  useEffect(() => {
    if (parts[0] === 'p' && parts[2] === 'b' && parts[3]) {
      get('/api/projects/' + parts[1] + '/boards/' + parts[3] + '/sprints').then(setSprintOptions).catch(() => setSprintOptions([]));
    } else {
      setSprintOptions([]);
    }
  }, [parts[0], parts[1], parts[3]]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next); setThemeState(next);
  };

  // Keyboard shortcuts (10.6)
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape') {
        if (ticketKey) setTicketKey(null);
        else if (showPalette) setShowPalette(false);
        else if (showHelp) setShowHelp(false);
        return;
      }
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setShowPalette(true); return;
      }
      if (e.key === '/') { e.preventDefault(); searchRef.current && searchRef.current.focus(); return; }
      if (e.key === '?') { setShowHelp(true); return; }
      if (e.key.toLowerCase() === 'g') { gPressedAt.current = Date.now(); return; }
      if (Date.now() - gPressedAt.current < 900) {
        const k = e.key.toLowerCase();
        if (k === 'b' && parts[0] === 'p') { window.location.hash = '#/p/' + parts[1] + '/b/' + (parts[3] || ''); }
        if (k === 's' && parts[0] === 'p') { window.location.hash = '#/p/' + parts[1] + '/b/' + parts[3] + '/backlog'; }
        if (k === 'r' && parts[0] === 'p') { window.location.hash = '#/p/' + parts[1] + '/b/' + parts[3] + '/retros'; }
        gPressedAt.current = 0;
        return;
      }
      if (e.key.toLowerCase() === 'c' && parts[0] === 'p' && parts[2] === 'b') {
        // handled inline by Board's own create form; here we just focus it
        const input = document.querySelector('.toolbar input');
        input && input.focus();
        return;
      }
      if (!boardTickets.length) return;
      if (e.key.toLowerCase() === 'j') {
        e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, boardTickets.length - 1)); return;
      }
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); return;
      }
      if (e.key === 'Enter') {
        const key = boardTickets[selectedIndex];
        if (key) { setEditIntent(false); setTicketKey(key); }
        return;
      }
      // 10.6 "E: edit". The drawer edits in place, so editing is opening it
      // with the first field focused rather than a separate mode.
      if (e.key.toLowerCase() === 'e') {
        const key = ticketKey || boardTickets[selectedIndex];
        if (key) { setEditIntent(true); setTicketKey(key); }
        return;
      }
      if (e.key.toLowerCase() === 'a') {
        const key = ticketKey || boardTickets[selectedIndex];
        if (key) patch('/api/tickets/' + key, { assignee: me.email }).then(() => {
          window.dispatchEvent(new CustomEvent('pm:ticket-single-changed', { detail: { key } }));
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ticketKey, showPalette, showHelp, parts.join('/'), boardTickets, selectedIndex, me.email]);

  let screen;
  if (parts[0] === 'overview' || parts[0] === '') screen = html`<${Overview} />`;
  else if (parts[0] === 'mine') screen = html`<${MyTickets} onOpen=${setTicketKey} />`;
  else if (parts[0] === 'admin') screen = html`<${Admin} />`;
  else if (parts[0] === 'p' && parts[2] === 'docs') screen = html`<${DocsFiles} projectSlug=${parts[1]} />`;
  else if (parts[0] === 'p' && parts[2] === 'b' && parts[4] === 'backlog') screen = html`<${Backlog} projectSlug=${parts[1]} boardSlug=${parts[3]} onOpen=${setTicketKey} onOpenRetro=${(id) => { setPendingRetroId(id); navigate('#/p/' + parts[1] + '/b/' + parts[3] + '/retros'); }} />`;
  else if (parts[0] === 'p' && parts[2] === 'b' && parts[4] === 'epics') screen = html`<${Epics} projectSlug=${parts[1]} boardSlug=${parts[3]} onOpen=${setTicketKey} />`;
  else if (parts[0] === 'p' && parts[2] === 'b' && parts[4] === 'retros') screen = html`<${Retros} projectSlug=${parts[1]} boardSlug=${parts[3]} initialRetroId=${pendingRetroId} onConsumedInitial=${() => setPendingRetroId(null)} />`;
  else if (parts[0] === 'p' && parts[2] === 'b' && parts[4] === 'standup') screen = html`<${Standup} projectSlug=${parts[1]} boardSlug=${parts[3]} />`;
  else if (parts[0] === 'p' && parts[2] === 'b') screen = html`<${Board} projectSlug=${parts[1]} boardSlug=${parts[3]} onOpen=${setTicketKey} selectedKey=${ticketKey || boardTickets[selectedIndex]} />`;
  else if (parts[0] === 'p') screen = html`<${ProjectOverview} slug=${parts[1]} />`;
  else screen = html`<${Overview} />`;

  return html`
    <div class="shell">
      <div class="topbar">
        <span class="logo">OfficePM</span>
        <select onChange=${(e) => navigate('#/p/' + e.target.value)} value=${parts[0] === 'p' ? parts[1] : ''}>
          <option value="">Project...</option>
          ${projects.map((p) => html`<option key=${p.slug} value=${p.slug}>${p.name}</option>`)}
        </select>
        ${sprintOptions.length > 0 ? html`
          <select onChange=${(e) => { if (e.target.value) navigate('#/p/' + parts[1] + '/b/' + parts[3] + '/backlog'); e.target.value = ''; }}>
            <option value="">Sprint...</option>
            ${sprintOptions.map((s) => html`<option key=${s.id} value=${s.id}>${s.name} (${s.status})</option>`)}
          </select>
        ` : null}
        <input ref=${searchRef} type="search" placeholder="/ to search" onFocus=${() => setShowPalette(true)} readOnly />
        <span class="spacer"></span>
        <span class="theme-toggle btn" onClick=${toggleTheme} title="Toggle theme">${theme === 'dark' ? 'Dark' : 'Light'}</span>
        <span class="btn" onClick=${() => setShowHelp(true)}>?</span>
        <span class="avatar" title=${me.email} onClick=${onLogout}>${(me.name || me.email)[0].toUpperCase()}</span>
      </div>
      <div class="body-row">
        <div class="sidebar">
          <a class=${'nav-item' + (parts[0] === 'overview' || parts[0] === '' ? ' active' : '')} href="#/overview">Overview</a>
          <a class=${'nav-item' + (parts[0] === 'mine' ? ' active' : '')} href="#/mine">My Tickets</a>
          ${me.isAdmin ? html`<a class=${'nav-item' + (parts[0] === 'admin' ? ' active' : '')} href="#/admin">Admin</a>` : null}
          ${projects.map((p) => html`
            <div key=${p.slug}>
              <h4>${p.name}</h4>
              ${p.boards.map((b) => html`
                <a class=${'nav-item' + (parts[0] === 'p' && parts[1] === p.slug && parts[3] === b.slug ? ' active' : '')}
                   href=${'#/p/' + p.slug + '/b/' + b.slug}>${b.name}</a>
              `)}
              <a class="nav-item dim" href=${'#/p/' + p.slug + '/docs'}>Docs & Files</a>
            </div>
          `)}
        </div>
        <div class="main">${screen}</div>
      </div>
      ${ticketKey ? html`<${TicketDrawer} ticketKey=${ticketKey} focusTitle=${editIntent}
        onClose=${() => { setTicketKey(null); setEditIntent(false); }} />` : null}
      ${showPalette ? html`<${CommandPalette} onClose=${() => setShowPalette(false)} onOpenTicket=${setTicketKey}
          onCreate=${() => { const input = document.querySelector('.toolbar input'); input && input.focus(); }} />` : null}
      ${showHelp ? html`<${ShortcutsHelp} onClose=${() => setShowHelp(false)} />` : null}
    </div>
  `;
}

function App() {
  const [me, setMe] = useState(undefined); // undefined = checking, null = anon, obj = logged in

  useEffect(() => {
    get('/api/me').then(setMe).catch(() => setMe(null));
  }, []);

  if (me === undefined) return html`<p class="dim" style="padding:24px">Loading OfficePM...</p>`;
  if (!me) return html`<${Login} onLoggedIn=${setMe} />`;
  return html`<${Shell} me=${me} onLogout=${async () => { await post('/api/logout'); setMe(null); }} />`;
}

render(html`<${App} />`, document.getElementById('app'));
