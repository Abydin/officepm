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
// Small shared UI pieces: icons, avatars, priority, due dates, loading states
// ---------------------------------------------------------------------------

const ICONS = {
  menu: 'M3 6h18M3 12h18M3 18h18',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  right: 'M9 6l6 6-6 6',
  left: 'M15 6l-6 6 6 6',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 18h.01',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'
};
function Icon({ name }) {
  return html`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d=${ICONS[name]} /></svg>`;
}

// Assignees are stored as an email (or, on old rows, a display name). Both turn
// into a readable name: maya.okafor@x -> "Maya Okafor".
function personName(who) {
  if (!who) return '';
  const base = who.includes('@') ? who.split('@')[0] : who;
  return base.split(/[._\s-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}
function initialsOf(name) {
  const parts = name.split(' ').filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}
function Avatar({ who, size }) {
  if (!who) return html`<span class=${'avatar empty' + (size === 'lg' ? ' lg' : '')} title="Unassigned" aria-label="Unassigned">?</span>`;
  const name = personName(who);
  return html`<span class=${'avatar' + (size === 'lg' ? ' lg' : '')} title=${name} aria-label=${name}
    style=${'background:hsl(' + hueOf(name.toLowerCase()) + ' 46% 40%)'}>${initialsOf(name)}</span>`;
}

function PriorityMark({ p }) {
  if (!p) return null;
  return html`<span class="pri" data-p=${p} title=${'Priority: ' + p} role="img" aria-label=${'Priority ' + p}><i></i><i></i><i></i></span>`;
}

const isoToday = () => new Date().toISOString().slice(0, 10);
function dayDiff(iso) {
  return Math.round((new Date(iso + 'T00:00:00Z') - new Date(isoToday() + 'T00:00:00Z')) / 86400000);
}
function shortDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function DueChip({ date, done }) {
  if (!date) return null;
  const d = dayDiff(date);
  const cls = done ? '' : d < 0 ? ' late' : d <= 2 ? ' soon' : '';
  const label = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : shortDate(date);
  return html`<span class=${'due' + cls} title=${'Due ' + date}><${Icon} name="calendar" />${label}</span>`;
}

function Loading({ rows }) {
  return html`<div role="status" aria-label="Loading">
    ${Array.from({ length: rows || 3 }).map((_, i) => html`<div class="skel" key=${i} style=${'height:18px;margin-bottom:14px;width:' + (92 - i * 18) + '%'}></div>`)}
  </div>`;
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
        <h1><span class="logo-mark">O</span>OfficePM</h1>
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
// Overview dashboard (6.11)
// ---------------------------------------------------------------------------

function Stat({ n, label, tone }) {
  return html`<div class=${'panel stat' + (tone ? ' ' + tone : '')}><div class="num">${n}</div><div class="lbl">${label}</div></div>`;
}

function VelocityBars({ velocity }) {
  const max = Math.max(1, ...velocity.sprints.map((s) => s.completed));
  const unit = velocity.uses_points ? 'pts' : 'tickets';
  return html`
    <div class="velocity" role="img" aria-label=${'Velocity per sprint in ' + unit}>
      ${velocity.sprints.map((s) => html`
        <div class=${'bar' + (s.status === 'active' ? ' active' : '')} key=${s.name} title=${s.name + ': ' + s.completed + ' ' + unit + (s.status === 'active' ? ' so far' : '')}>
          <div class="plot"><span class="v">${s.completed}</span><div class="col" style=${'height:' + Math.max(3, Math.round(s.completed / max * 72)) + 'px'}></div></div>
          <span class="n">${s.name}</span>
        </div>
      `)}
    </div>
    <div class="dim" style="font-size:12px;margin-top:8px">
      ${velocity.average === null ? 'No finished sprints yet.' : 'Average ' + velocity.average + ' ' + unit + ' per finished sprint. Striped bar is the sprint in progress.'}
    </div>
  `;
}

function activityLine(a) {
  if (a.kind === 'comment') {
    return html`<span class="what"><b>${a.system ? 'GitHub' : a.who}</b> ${a.system ? 'posted on' : 'commented on'} <span class="mono">${a.key}</span><span class="snip">${a.text}</span></span>`;
  }
  return html`<span class="what"><span class="mono">${a.key}</span> is now <b>${a.text}</b><span class="snip">${a.title}</span></span>`;
}

function Overview({ onOpen }) {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    get('/api/dashboard').then((x) => { setD(x); setFailed(false); }).catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    window.addEventListener('pm:ticket-changed', load);
    return () => window.removeEventListener('pm:ticket-changed', load);
  }, [load]);

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const head = html`<div class="page-head"><div><div class="kicker">${today}</div><h2>Overview</h2></div></div>`;
  if (failed) return html`${head}<div class="error-banner">Could not load the dashboard. Check the server is running, then reload.</div>`;
  if (!d) {
    return html`${head}
      <div class="stat-row">${[0, 1, 2, 3].map((i) => html`<div class="skel" key=${i} style="height:78px"></div>`)}</div>
      <div class="skel" style="height:260px"></div>`;
  }

  const t = d.totals;
  const sp = d.sprint;
  const lastActual = sp && sp.burndown && !sp.burndown.insufficient_dates
    ? sp.burndown.points.filter((p) => p.actual !== null).pop() : null;
  const unit = sp && sp.velocity.uses_points ? 'pts' : 'tickets';
  const daysLeft = sp ? Math.max(0, dayDiff(sp.end_date)) : 0;
  const empty = d.boards.every((b) => b.total === 0);

  return html`
    ${head}
    ${empty ? html`<div class="empty-state" style="margin-bottom:16px"><strong>Nothing here yet</strong>Create a ticket on any board, or run <span class="mono">npm run seed</span> for a demo workspace.</div>` : null}
    <div class="stat-row">
      <${Stat} n=${t.open} label="Open" />
      <${Stat} n=${t.in_progress} label="In progress" />
      <${Stat} n=${t.done_7d} label="Finished in the last 7 days" tone="ok" />
      <${Stat} n=${t.blocked + t.overdue} label=${t.blocked + ' blocked, ' + t.overdue + ' overdue'} tone=${t.blocked + t.overdue ? 'warn' : ''} />
    </div>
    <div class="dash-grid">
      <div class="dash-col">
        <section class="panel" aria-label="Active sprint">
          <div class="panel-head">
            <h3>${sp ? sp.name : 'Sprint burndown'}</h3>
            ${sp ? html`<a href=${'#/p/' + sp.project_slug + '/b/' + sp.board_slug + '/backlog'}>${sp.project} · ${sp.board}</a>` : null}
          </div>
          ${!sp ? html`<div class="empty-state"><strong>No active sprint</strong>Activate a sprint from a Scrum board's Backlog to see its burndown here.</div>` : html`
            ${lastActual ? html`
              <div class="sprint-meta">
                <div><b>${lastActual.actual} ${unit}</b><span>Remaining</span></div>
                <div><b>${sp.burndown.total_scope - lastActual.actual} of ${sp.burndown.total_scope}</b><span>Done</span></div>
                <div><b>${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}</b><span>Left</span></div>
              </div>
              <${BurndownChart} points=${sp.burndown.points} totalScope=${sp.burndown.total_scope} />
            ` : html`<p class="dim">Set a start and end date on this sprint to see a burndown.</p>`}
          `}
        </section>
        ${sp ? html`
          <section class="panel" aria-label="Velocity">
            <div class="panel-head"><h3>Velocity</h3><span class="dim" style="font-size:12px">${sp.board}</span></div>
            <${VelocityBars} velocity=${sp.velocity} />
          </section>
        ` : null}
      </div>
      <div class="dash-col">
        <section class="panel" aria-label="Needs me">
          <div class="panel-head"><h3>Needs me</h3><a href="#/mine">All mine</a></div>
          ${d.needs_me.length === 0 ? html`<div class="empty-state"><strong>You are clear</strong>Nothing open is assigned to you.</div>` : html`
            <ul class="work-list">
              ${d.needs_me.map((n) => html`
                <li key=${n.key}>
                  <button class="work-item" onClick=${() => onOpen(n.key)}>
                    <${PriorityMark} p=${n.priority} />
                    <span class="t"><span class="k">${n.key}</span> ${n.title}</span>
                    ${n.blocked ? html`<span class="flag red">Blocked</span>` : null}
                    ${n.overdue ? html`<span class="flag amber">Overdue</span>` : null}
                  </button>
                </li>
              `)}
            </ul>
          `}
        </section>
        <section class="panel" aria-label="Recent activity">
          <div class="panel-head"><h3>Recent activity</h3></div>
          ${d.activity.length === 0 ? html`<div class="empty-state">No activity yet.</div>` : html`
            <ul class="activity">
              ${d.activity.map((a, i) => html`
                <li key=${i}>
                  <${Avatar} who=${a.system ? 'GitHub' : a.who} />
                  ${activityLine(a)}
                  <span class="when">${timeAgo(a.at)}</span>
                </li>
              `)}
            </ul>
          `}
        </section>
      </div>
    </div>
    <h3 style="margin:32px 0 12px">Boards</h3>
    <div class="board-cards">
      ${d.boards.map((b) => {
        const pct = (n) => (b.total ? n / b.total * 100 : 0);
        return html`
          <a class="panel panel-link board-card" key=${b.project_slug + b.board_slug} href=${'#/p/' + b.project_slug + '/b/' + b.board_slug}>
            <div class="top"><span class="proj">${b.project}</span><span class="flow-badge">${b.flow}</span></div>
            <strong style="display:block;margin:4px 0 10px">${b.board}</strong>
            <div class="progress-bar" role="img" aria-label=${b.done + ' of ' + b.total + ' done'}>
              <div class="fill done" style=${'width:' + pct(b.done) + '%'}></div>
              <div class="fill prog" style=${'width:' + pct(b.in_progress) + '%'}></div>
            </div>
            <div class="nums"><span><b>${b.open}</b> open</span><span><b>${b.in_progress}</b> active</span><span><b>${b.done}</b> done</span></div>
          </a>
        `;
      })}
    </div>
  `;
}

function MyTickets({ onOpen }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { get('/api/my-tickets').then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return html`<h2>My Tickets</h2><${Loading} />`;
  return html`
    <div class="page-head"><h2>My Tickets</h2></div>
    ${rows.length === 0 ? html`<div class="empty-state"><strong>Nothing assigned to you</strong>Tickets assigned to you show up here.</div>` : html`
      <div class="table-wrap"><table class="overview">
        <thead><tr><th>Key</th><th>Title</th><th>Board</th><th>Status</th><th>Due</th></tr></thead>
        <tbody>
          ${rows.map((t) => html`
            <tr key=${t.key} class="row-link" tabindex="0" onClick=${() => onOpen(t.key)}
                onKeyDown=${(e) => { if (e.key === 'Enter') onOpen(t.key); }}>
              <td class="mono">${t.key}</td>
              <td><${PriorityMark} p=${t.priority} /> ${t.title}</td>
              <td>${t.project_slug}/${t.board_slug}</td>
              <td><span class="status-pill"><span class="status-dot" style=${'background:' + statusColor(t.status)}></span>${t.status}</span></td>
              <td><${DueChip} date=${t.due_date} /></td>
            </tr>
          `)}
        </tbody>
      </table></div>
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
  if (!project) return html`<${Loading} />`;
  return html`
    <h2>${project.name}</h2>
    <p class="dim">${project.description}</p>
    <div class="card-grid">
      ${project.boards.map((b) => html`
        <a class="panel panel-link" key=${b.slug} href=${'#/p/' + slug + '/b/' + b.slug}>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>${b.name}</strong>
            <span class="flow-badge">${b.flow}</span>
          </div>
          <div class="dim mono" style="margin-top:4px">${b.prefix}</div>
        </a>
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

function TicketCard({ t, board, selected, dragging, onOpen, onMove, onDragStart, onDragEnd }) {
  const isDone = board.done_statuses.includes(t.status);
  const idx = board.statuses.indexOf(t.status);
  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget) return; // keys typed in the move select stay there
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpen(t.key); return; }
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault(); e.stopPropagation();
      const next = board.statuses[idx + (e.key === 'ArrowRight' ? 1 : -1)];
      if (next) onMove(t.key, next, true);
    }
  };
  return html`
    <div class=${'ticket-card' + (selected ? ' selected' : '') + (dragging ? ' dragging' : '') + (t.blocked ? ' blocked' : '')}
         data-key=${t.key} tabindex="0" role="button" draggable="true"
         aria-label=${t.key + ', ' + t.title + ', ' + t.status + (t.assignee ? ', assigned to ' + personName(t.assignee) : '')}
         onClick=${() => onOpen(t.key)} onKeyDown=${onKeyDown}
         onDragStart=${(e) => onDragStart(e, t.key)} onDragEnd=${onDragEnd}>
      <div class="card-top">
        <span class="key">${t.key}</span>
        <${PriorityMark} p=${t.priority} />
      </div>
      <div class="title">${t.title}</div>
      ${t.blocked && t.blocker_reason ? html`<div class="blocker">Blocked: ${t.blocker_reason}</div>` : null}
      ${t.labels && t.labels.length ? html`<div class="labels">${t.labels.slice(0, 3).map((l) => html`<span class="label" key=${l}>${l}</span>`)}${t.labels.length > 3 ? html`<span class="label">+${t.labels.length - 3}</span>` : null}</div>` : null}
      <div class="card-foot">
        <span class=${'tag ' + t.type}>${t.type}</span>
        ${board.points && t.points != null ? html`<span class="pill-pts" title="Story points">${t.points}</span>` : null}
        ${t.appetite ? html`<span class="chip">${t.appetite}</span>` : null}
        <${DueChip} date=${t.due_date} done=${isDone} />
        <${Avatar} who=${t.assignee} />
      </div>
      <div class="card-move" onClick=${(e) => e.stopPropagation()}>
        <select aria-label=${'Move ' + t.key + ' to'} value=${t.status} onChange=${(e) => onMove(t.key, e.target.value)}>
          ${board.statuses.map((s) => html`<option key=${s} value=${s}>${s}</option>`)}
        </select>
      </div>
    </div>
  `;
}

function BoardSkeleton() {
  return html`<div class="board-columns" role="status" aria-label="Loading board">
    ${[3, 2, 2, 1].map((n, i) => html`<div class="board-column" key=${i}>
      <div class="skel" style="height:14px;width:40%;margin:6px 6px 14px"></div>
      ${Array.from({ length: n }).map((_, j) => html`<div class="skel skel-card" key=${j}></div>`)}
    </div>`)}
  </div>`;
}

function Board({ projectSlug, boardSlug, onOpen, selectedKey }) {
  const [board, setBoard] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [dragKey, setDragKey] = useState(null);
  const [overStatus, setOverStatus] = useState(null);
  const [toast, setToast] = useState('');
  const [edge, setEdge] = useState({ l: false, r: false });
  const scrollRef = useRef(null);

  const load = useCallback(() => {
    get('/api/projects/' + projectSlug + '/boards/' + boardSlug).then(setBoard).catch(() => setBoard(null));
    get('/api/tickets?project=' + projectSlug + '&board=' + boardSlug)
      .then(setTickets).catch(() => setTickets([])).finally(() => setLoaded(true));
  }, [projectSlug, boardSlug]);

  // A different board starts from a clean, loading state rather than showing the
  // previous board's columns until the new data lands. Declared before the load
  // effect so it runs first.
  useEffect(() => { setBoard(null); setTickets([]); setLoaded(false); }, [projectSlug, boardSlug]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(t);
  }, [toast]);

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

  // Show a fade and a nudge button on whichever edge has more columns hidden.
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setEdge({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => { el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
  }, [board, loaded, measure]);
  const nudge = (dir) => { const el = scrollRef.current; if (el) el.scrollBy({ left: dir * 300, behavior: 'smooth' }); };

  const createTicket = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await post('/api/tickets', {
        project_slug: projectSlug, board_slug: boardSlug, title: newTitle.trim(),
        type: board.types[0]
      });
      setNewTitle('');
      load();
    } catch (err) { setToast(err.message); }
  };

  // Optimistic: the card jumps columns at once and snaps back, with the server's
  // reason, if the move is refused (a Waterfall board will not skip a phase).
  const moveTicket = async (key, status, refocus) => {
    const t = tickets.find((x) => x.key === key);
    if (!t || t.status === status) return;
    const before = tickets;
    setTickets((ts) => ts.map((x) => (x.key === key ? Object.assign({}, x, { status }) : x)));
    if (refocus) requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelector('[data-key="' + key + '"]');
      if (el) el.focus();
    }));
    try {
      await patch('/api/tickets/' + key, { status });
      load();
    } catch (err) {
      setTickets(before);
      setToast(err.message);
    }
  };

  const onDragStart = (e, key) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
    setDragKey(key);
  };
  const onDragEnd = () => { setDragKey(null); setOverStatus(null); };
  const dropOn = (e, status) => {
    e.preventDefault();
    const key = e.dataTransfer.getData('text/plain') || dragKey;
    setDragKey(null); setOverStatus(null);
    if (key) moveTicket(key, status);
  };

  if (!board) return html`<div class="board-view"><div class="board-header"><div class="skel" style="height:28px;width:220px"></div></div><${BoardSkeleton} /></div>`;
  const byStatus = (status) => tickets.filter((t) => t.status === status);
  const doneCount = tickets.filter((t) => board.done_statuses.includes(t.status)).length;

  return html`
    <div class="board-view">
      <div class="board-header">
        <h2>${board.name}</h2>
        <span class="flow-badge">${board.flow}</span>
        ${board.agile ? html`<span class="flow-badge">agile</span>` : null}
        ${board.has_github ? html`<span class="flow-badge">github</span>` : null}
        <span class="dim mono">${board.prefix}</span>
        ${loaded ? html`<span class="dim" style="margin-left:auto">${tickets.length} tickets · ${doneCount} done</span>` : null}
      </div>
      <form class="board-add" onSubmit=${createTicket}>
        <input aria-label="New ticket title" placeholder="New ticket title, press Enter" value=${newTitle}
          onInput=${(e) => setNewTitle(e.target.value)} />
        <button class="btn btn-primary" type="submit" disabled=${!newTitle.trim()}><${Icon} name="plus" />Create <span class="hint dim" style="color:inherit;opacity:.7">(C)</span></button>
      </form>
      ${loaded && tickets.length === 0 ? html`<div class="empty-state" style="margin-bottom:12px"><strong>No tickets on this board yet</strong>Type a title above and press Enter. Drag cards between columns to change their status.</div>` : null}
      <div class="board-scroll">
        <div class=${'board-fade l' + (edge.l ? ' on' : '')}></div>
        <div class=${'board-fade r' + (edge.r ? ' on' : '')}></div>
        <button class=${'btn btn-icon board-nudge l' + (edge.l ? ' on' : '')} aria-label="Scroll columns left" tabindex="-1" onClick=${() => nudge(-1)}><${Icon} name="left" /></button>
        <button class=${'btn btn-icon board-nudge r' + (edge.r ? ' on' : '')} aria-label="Scroll columns right" tabindex="-1" onClick=${() => nudge(1)}><${Icon} name="right" /></button>
        <div class="board-columns" ref=${scrollRef}>
          ${board.statuses.map((status) => {
            const col = byStatus(status);
            const limit = board.wip_limits && board.wip_limits[status];
            const over = limit && col.length > limit;
            return html`
              <section class=${'board-column' + (overStatus === status && dragKey ? ' drop-target' : '')} key=${status} aria-label=${status}
                   onDragOver=${(e) => { if (dragKey) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overStatus !== status) setOverStatus(status); } }}
                   onDragLeave=${(e) => { if (!e.currentTarget.contains(e.relatedTarget) && overStatus === status) setOverStatus(null); }}
                   onDrop=${(e) => dropOn(e, status)}>
                <div class="col-head">
                  <span class="status-dot" style=${'background:' + statusColor(status)}></span>
                  <span class="name">${status}</span>
                  <span class=${'count' + (over ? ' over' : '')} title=${over ? 'Over the WIP limit' : ''}>${col.length}${limit ? '/' + limit : ''}</span>
                </div>
                <div class="col-body">
                  ${col.map((t) => html`<${TicketCard} key=${t.key} t=${t} board=${board} selected=${t.key === selectedKey}
                    dragging=${dragKey === t.key} onOpen=${onOpen} onMove=${moveTicket} onDragStart=${onDragStart} onDragEnd=${onDragEnd} />`)}
                  ${col.length === 0 ? html`<div class="col-empty">${dragKey ? 'Drop here' : 'No tickets'}</div>` : null}
                </div>
              </section>
            `;
          })}
        </div>
      </div>
      ${toast ? html`<div class="toast" role="alert"><span class="status-dot"></span>${toast}</div>` : null}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Backlog (Scrum/Scrumban) and Epics (agile boards)
// ---------------------------------------------------------------------------

// Inline SVG burndown (PRD 6.9). points: [{date, ideal, actual|null}]. Scales
// to its container, so it fits the dashboard and the sprint card alike.
function BurndownChart({ points, totalScope }) {
  if (!points || points.length < 2) return html`<p class="dim">Not enough data for a burndown yet.</p>`;
  const W = 520, H = 190, L = 30, R = 12, T = 12, B = 24;
  const maxY = Math.max(totalScope, 1);
  const xFor = (i) => L + (i / (points.length - 1)) * (W - L - R);
  const yFor = (v) => T + (1 - v / maxY) * (H - T - B);
  const line = (key) => points.map((p, i) => (p[key] === null || p[key] === undefined ? '' : (i === 0 || points[i - 1][key] == null ? 'M' : 'L') + xFor(i).toFixed(1) + ',' + yFor(p[key]).toFixed(1))).join(' ');
  const actualIdx = points.map((p, i) => (p.actual !== null && p.actual !== undefined ? i : -1)).filter((i) => i >= 0);
  const lastIdx = actualIdx[actualIdx.length - 1];
  const area = actualIdx.length > 1
    ? line('actual') + ' L' + xFor(lastIdx).toFixed(1) + ',' + yFor(0) + ' L' + xFor(actualIdx[0]).toFixed(1) + ',' + yFor(0) + ' Z' : '';
  const ticks = [0, 0.5, 1].map((f) => Math.round(maxY * f));
  return html`
    <svg class="chart" viewBox=${'0 0 ' + W + ' ' + H} role="img" aria-label=${'Sprint burndown: ' + points[lastIdx].actual + ' of ' + totalScope + ' remaining'}>
      ${ticks.map((v) => html`<g key=${v}><line class="grid" x1=${L} x2=${W - R} y1=${yFor(v)} y2=${yFor(v)} /><text x=${L - 6} y=${yFor(v) + 3} text-anchor="end">${v}</text></g>`)}
      ${area ? html`<path class="area" d=${area} />` : null}
      <path class="ideal" d=${line('ideal')} />
      <path class="actual" d=${line('actual')} />
      <line class="today" x1=${xFor(lastIdx)} x2=${xFor(lastIdx)} y1=${T} y2=${H - B} />
      <circle cx=${xFor(lastIdx)} cy=${yFor(points[lastIdx].actual)} r="4" fill="var(--accent)" stroke="var(--bg-raised)" stroke-width="2" />
      <text x=${L} y=${H - 6}>${shortDate(points[0].date)}</text>
      <text x=${W - R} y=${H - 6} text-anchor="end">${shortDate(points[points.length - 1].date)}</text>
    </svg>
    <div class="legend"><span><i class="ideal"></i>Ideal</span><span><i></i>Actual, taken from each ticket's last update</span></div>
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
            <button class="btn btn-ghost" onClick=${() => setConfirmingActivate(false)}>Cancel</button>
          </div>
        </div>
      ` : null}
      ${(sprint.status === 'active' || sprint.status === 'completed') && burndown && !burndown.insufficient_dates ? html`
        <div style="margin-top:12px;max-width:640px">
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

  if (!board || !settings) return html`<${Loading} />`;
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
    <div class="table-wrap"><table class="overview">
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
    </table></div>
  `;
}

function Epics({ projectSlug, boardSlug, onOpen }) {
  const [tickets, setTickets] = useState([]);
  const [board, setBoard] = useState(null);
  useEffect(() => {
    get('/api/projects/' + projectSlug + '/boards/' + boardSlug).then(setBoard);
    get('/api/tickets?project=' + projectSlug + '&board=' + boardSlug).then(setTickets);
  }, [projectSlug, boardSlug]);
  if (!board) return html`<${Loading} />`;
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
      <button class="btn btn-ghost" onClick=${() => setOpenRetro(null)}>&larr; Back to retros</button>
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
    <div class="table-wrap"><table class="overview">
      <thead><tr><th>Name</th><th>Status</th></tr></thead>
      <tbody>
        ${list.map((r) => html`
          <tr key=${r.id} style="cursor:pointer" onClick=${() => openRetro(r.id)}>
            <td>${r.name}</td><td>${r.status}</td>
          </tr>
        `)}
      </tbody>
    </table></div>
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
      <button class="btn btn-primary" type="submit">Add link</button>
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
          <a class="btn btn-sm" href=${'/api/projects/' + projectSlug + '/files/' + f.id}>Download</a>
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
    <div class="table-wrap"><table class="overview">
      <thead><tr><th>Email</th><th>Name</th><th>Admin</th><th></th></tr></thead>
      <tbody>
        ${users.map((u) => html`
          <tr key=${u.id}>
            <td>${u.email}</td><td>${u.name}</td><td>${u.is_admin ? 'yes' : ''}</td>
            <td><button class="btn btn-sm" onClick=${() => resetPw(u.id)}>Reset password</button></td>
          </tr>
        `)}
      </tbody>
    </table></div>
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
      <div class="drawer"><div class="drawer-body"><${Loading} /></div></div>
    `;
  }

  const deleteTicket = async () => {
    if (!confirm('Delete ' + ticket.key + '? This also removes its comments, links and files.')) return;
    await del('/api/tickets/' + ticketKey);
    window.dispatchEvent(new CustomEvent('pm:ticket-changed', { detail: { project_slug: ticket.project_slug, board_slug: ticket.board_slug } }));
    onClose();
  };

  const toggleDod = async (item, done) => {
    await patch('/api/tickets/' + ticketKey + '/dod', { item, done });
    get('/api/tickets/' + ticketKey + '/dod').then(setDod);
  };

  return html`
    <div class="drawer-backdrop" onClick=${onClose}></div>
    <div class="drawer">
      <div class="drawer-header">
        <span class="key">${ticket.key}</span>
        ${ticket.level && ticket.level !== ticket.type ? html`<span class="chip">${ticket.level}</span>` : null}
        <span class="chip">${ticket.type}</span>
        <span class="spacer"></span>
        <button class="btn btn-danger btn-sm" onClick=${deleteTicket}><${Icon} name="trash" />Delete</button>
        <button class="btn btn-ghost btn-icon" onClick=${onClose} aria-label="Close ticket (Esc)" title="Close (Esc)"><${Icon} name="x" /></button>
      </div>
      <div class="drawer-body">
        <section>
          <input class="title-input" aria-label="Title" ref=${titleRef} value=${ticket.title} onBlur=${(e) => e.target.value !== ticket.title && save({ title: e.target.value })} />
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
              <label>Priority</label>
              <select value=${ticket.priority || ''} onChange=${(e) => save({ priority: e.target.value || null })}>
                <option value="">None</option>
                ${['urgent', 'high', 'medium', 'low'].map((p) => html`<option key=${p} value=${p}>${p[0].toUpperCase() + p.slice(1)}</option>`)}
              </select>
            </div>
            <div class="field">
              <label>Due date</label>
              <input type="date" value=${ticket.due_date || ''} onChange=${(e) => save({ due_date: e.target.value || null })} />
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
              <label>Labels</label>
              <input value=${(ticket.labels || []).join(', ')} placeholder="comma separated"
                onBlur=${(e) => save({ labels: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8) })} />
            </div>
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
        ${links.length ? html`<section>
          <h4>Links</h4>
          ${links.map((l) => html`<div class="link-row" key=${l.id}><a href=${l.url} target="_blank" rel="noopener">${l.title}</a></div>`)}
        </section>` : null}
        <section>
          <h4>Attachments</h4>
          <input type="file" onChange=${uploadFile} />
          ${files.map((f) => html`
            <div class="file-row" key=${f.id}>
              <span>${f.original_name}</span>
              <a class="btn btn-sm" href=${'/api/tickets/' + ticketKey + '/files/' + f.id}>Download</a>
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
            <button class="btn btn-primary btn-sm" type="submit" style="margin-top:6px" disabled=${!newComment.trim()}>Comment</button>
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
    ['/', 'Search tickets'],
    ['Drag a card', 'Move it to another column'],
    ['Alt + Left / Right', 'Move the focused card one column'],
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
  const [kbdNav, setKbdNav] = useState(false); // highlight a card only once J/K has been used
  const [boardTickets, setBoardTickets] = useState([]);
  const [pendingRetroId, setPendingRetroId] = useState(null);
  const [sprintOptions, setSprintOptions] = useState([]);
  const [showPalette, setShowPalette] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [theme, setThemeState] = useState(getTheme());
  const [navOpen, setNavOpen] = useState(false);
  const gPressedAt = useRef(0);

  useEffect(() => { get('/api/projects').then(setProjects).catch(() => setProjects([])); }, []);

  // J/K/Enter/A (10.6) walk this list, populated by Board whenever it loads.
  useEffect(() => {
    const handler = (e) => { setBoardTickets(e.detail || []); setSelectedIndex(0); };
    const reset = () => setKbdNav(false);
    window.addEventListener('hashchange', reset);
    window.addEventListener('pm:board-tickets', handler);
    return () => { window.removeEventListener('pm:board-tickets', handler); window.removeEventListener('hashchange', reset); };
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

  // Close the mobile navigation whenever the route changes.
  useEffect(() => { setNavOpen(false); }, [hash]);

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
      if (e.key === '/') { e.preventDefault(); setShowPalette(true); return; }
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
        e.preventDefault(); setKbdNav(true); setSelectedIndex((i) => Math.min(i + 1, boardTickets.length - 1)); return;
      }
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault(); setKbdNav(true); setSelectedIndex((i) => Math.max(i - 1, 0)); return;
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

  const boardRoute = parts[0] === 'p' && parts[2] === 'b' && !parts[4];
  let screen;
  if (parts[0] === 'overview' || parts[0] === '') screen = html`<${Overview} onOpen=${setTicketKey} />`;
  else if (parts[0] === 'mine') screen = html`<${MyTickets} onOpen=${setTicketKey} />`;
  else if (parts[0] === 'admin') screen = html`<${Admin} />`;
  else if (parts[0] === 'p' && parts[2] === 'docs') screen = html`<${DocsFiles} projectSlug=${parts[1]} />`;
  else if (parts[0] === 'p' && parts[2] === 'b' && parts[4] === 'backlog') screen = html`<${Backlog} projectSlug=${parts[1]} boardSlug=${parts[3]} onOpen=${setTicketKey} onOpenRetro=${(id) => { setPendingRetroId(id); navigate('#/p/' + parts[1] + '/b/' + parts[3] + '/retros'); }} />`;
  else if (parts[0] === 'p' && parts[2] === 'b' && parts[4] === 'epics') screen = html`<${Epics} projectSlug=${parts[1]} boardSlug=${parts[3]} onOpen=${setTicketKey} />`;
  else if (parts[0] === 'p' && parts[2] === 'b' && parts[4] === 'retros') screen = html`<${Retros} projectSlug=${parts[1]} boardSlug=${parts[3]} initialRetroId=${pendingRetroId} onConsumedInitial=${() => setPendingRetroId(null)} />`;
  else if (parts[0] === 'p' && parts[2] === 'b' && parts[4] === 'standup') screen = html`<${Standup} projectSlug=${parts[1]} boardSlug=${parts[3]} />`;
  else if (parts[0] === 'p' && parts[2] === 'b') screen = html`<${Board} projectSlug=${parts[1]} boardSlug=${parts[3]} onOpen=${setTicketKey} selectedKey=${ticketKey || (kbdNav ? boardTickets[selectedIndex] : null)} />`;
  else if (parts[0] === 'p') screen = html`<${ProjectOverview} slug=${parts[1]} />`;
  else screen = html`<${Overview} onOpen=${setTicketKey} />`;

  return html`
    <div class="shell">
      <header class="topbar">
        <button class="btn btn-ghost btn-icon menu-btn" aria-label="Open navigation" aria-expanded=${navOpen} onClick=${() => setNavOpen(!navOpen)}><${Icon} name="menu" /></button>
        <a class="logo" href="#/overview"><span class="logo-mark">O</span><span class="logo-text">OfficePM</span></a>
        <select class="picker" aria-label="Project" value=${parts[0] === 'p' ? parts[1] : ''}
          onChange=${(e) => navigate(e.target.value ? '#/p/' + e.target.value : '#/overview')}>
          <option value="">All projects</option>
          ${projects.map((p) => html`<option key=${p.slug} value=${p.slug}>${p.name}</option>`)}
        </select>
        ${sprintOptions.length > 0 ? html`
          <select class="picker sprint-picker" aria-label="Sprint" title="Sprints on this board, opens the backlog"
            value=${(sprintOptions.find((s) => s.status === 'active') || sprintOptions[0]).id}
            onChange=${() => navigate('#/p/' + parts[1] + '/b/' + parts[3] + '/backlog')}>
            ${sprintOptions.map((s) => html`<option key=${s.id} value=${s.id}>${s.name} · ${s.status}</option>`)}
          </select>
        ` : null}
        <span class="spacer"></span>
        <button class="search-trigger" onClick=${() => setShowPalette(true)} aria-label="Search tickets"><${Icon} name="search" /><span class="search-text">Search tickets</span><kbd>/</kbd></button>
        <button class="btn btn-ghost btn-icon" onClick=${toggleTheme} aria-label=${'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme'} title="Toggle theme"><${Icon} name=${theme === 'dark' ? 'sun' : 'moon'} /></button>
        <button class="btn btn-ghost btn-icon" onClick=${() => setShowHelp(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"><${Icon} name="help" /></button>
        <${Avatar} who=${me.name || me.email} size="lg" />
        <button class="btn btn-ghost btn-icon" onClick=${onLogout} aria-label="Sign out" title=${'Sign out ' + me.email}><${Icon} name="logout" /></button>
      </header>
      <div class="body-row">
        <nav class=${'sidebar' + (navOpen ? ' open' : '')} aria-label="Projects and boards">
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
        </nav>
        <div class=${'nav-scrim' + (navOpen ? ' open' : '')} onClick=${() => setNavOpen(false)}></div>
        <main class=${'main' + (boardRoute ? ' main-board' : '')}>${screen}</main>
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

const mount = document.getElementById('app');
mount.textContent = ''; // drop the static "Loading" placeholder, render() appends rather than replaces
render(html`<${App} />`, mount);
