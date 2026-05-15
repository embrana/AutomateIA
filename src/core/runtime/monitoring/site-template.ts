export const OPERATIONS_MONITORING_STYLES = `:root {
  --bg: #f6efe6;
  --panel: rgba(255, 252, 247, 0.9);
  --panel-strong: rgba(255, 255, 255, 0.96);
  --text: #16202a;
  --muted: #5f6772;
  --line: rgba(22, 32, 42, 0.12);
  --coral: #e76f51;
  --gold: #c5952d;
  --teal: #2a9d8f;
  --navy: #264653;
  --sky: #4f6d8a;
  --shadow: 0 24px 60px rgba(22, 32, 42, 0.12);
  --radius-lg: 28px;
  --radius-md: 18px;
  --radius-sm: 12px;
}

* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  min-height: 100%;
  color: var(--text);
  background:
    radial-gradient(circle at top left, rgba(231, 111, 81, 0.16), transparent 22rem),
    radial-gradient(circle at top right, rgba(42, 157, 143, 0.14), transparent 26rem),
    linear-gradient(180deg, #fbf5ed 0%, var(--bg) 100%);
  font-family: "Manrope", "Avenir Next", "Segoe UI", sans-serif;
}

body {
  padding: 32px 20px 48px;
}

.shell {
  max-width: 1380px;
  margin: 0 auto;
}

.hero {
  display: grid;
  gap: 18px;
  padding: 28px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.88), rgba(255, 248, 241, 0.94));
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 32px;
  box-shadow: var(--shadow);
}

.eyebrow {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--teal);
  font-weight: 800;
}

.hero h1 {
  margin: 0;
  font-size: clamp(2.2rem, 6vw, 4.4rem);
  line-height: 0.95;
  font-family: "Fraunces", "Iowan Old Style", Georgia, serif;
  font-weight: 700;
  letter-spacing: -0.04em;
}

.hero p {
  margin: 0;
  max-width: 70ch;
  color: var(--muted);
  font-size: 1rem;
  line-height: 1.6;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 999px;
  background: rgba(38, 70, 83, 0.08);
  color: var(--navy);
  font-size: 0.92rem;
}

.chip strong {
  color: var(--text);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  margin-top: 28px;
}

.window-switcher {
  display: inline-flex;
  gap: 8px;
  padding: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(22, 32, 42, 0.08);
  box-shadow: 0 10px 28px rgba(22, 32, 42, 0.08);
}

.window-switcher button {
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 10px 16px;
  border-radius: 999px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.window-switcher button.active {
  background: var(--navy);
  color: white;
}

.status-line {
  color: var(--muted);
  font-size: 0.94rem;
}

.grid {
  display: grid;
  gap: 20px;
  margin-top: 22px;
}

.grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.panel {
  background: var(--panel);
  border: 1px solid rgba(255, 255, 255, 0.88);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  padding: 22px;
}

.panel strong {
  color: var(--text);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 18px;
}

.panel-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-family: "Fraunces", "Iowan Old Style", Georgia, serif;
  letter-spacing: -0.03em;
}

.panel-header p {
  margin: 0;
  color: var(--muted);
  font-size: 0.92rem;
}

.stats-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.stat-card {
  padding: 16px;
  border-radius: var(--radius-md);
  background: var(--panel-strong);
  border: 1px solid rgba(22, 32, 42, 0.06);
}

.stat-card .label {
  display: block;
  color: var(--muted);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin-bottom: 10px;
}

.stat-card .value {
  display: block;
  font-size: 1.8rem;
  font-weight: 800;
  line-height: 1;
}

.stat-card .hint {
  display: block;
  margin-top: 10px;
  color: var(--muted);
  font-size: 0.9rem;
}

.bars {
  display: grid;
  gap: 14px;
}

.bar-row {
  display: grid;
  gap: 8px;
}

.bar-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.94rem;
}

.bar-track {
  height: 12px;
  width: 100%;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(38, 70, 83, 0.09);
}

.bar-fill {
  height: 100%;
  border-radius: 999px;
}

.stack {
  display: flex;
  height: 14px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(38, 70, 83, 0.09);
}

.stack > div {
  height: 100%;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.92rem;
  color: var(--muted);
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 999px;
}

.table-shell {
  overflow: auto;
  border-radius: var(--radius-md);
  border: 1px solid rgba(22, 32, 42, 0.08);
}

table {
  width: 100%;
  border-collapse: collapse;
  background: rgba(255, 255, 255, 0.72);
}

th, td {
  padding: 12px 14px;
  text-align: left;
  border-bottom: 1px solid rgba(22, 32, 42, 0.08);
  font-size: 0.94rem;
  vertical-align: top;
}

th {
  color: var(--muted);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: rgba(255, 255, 255, 0.9);
}

tr:last-child td {
  border-bottom: 0;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.status-pill.active { background: rgba(42, 157, 143, 0.16); color: #0f6b61; }
.status-pill.paused { background: rgba(79, 109, 138, 0.16); color: #36506d; }
.status-pill.sync_pending { background: rgba(231, 111, 81, 0.14); color: #b94e34; }
.status-pill.awaiting_human { background: rgba(197, 149, 45, 0.18); color: #8a6210; }
.status-pill.closed { background: rgba(38, 70, 83, 0.12); color: var(--navy); }
.status-pill.other { background: rgba(197, 149, 45, 0.14); color: #8a6210; }

.note-list {
  display: grid;
  gap: 12px;
}

.note-item {
  padding: 14px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(22, 32, 42, 0.08);
}

.note-item h3 {
  margin: 0 0 6px;
  font-size: 0.98rem;
}

.note-item p {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
}

.mini-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

@media (max-width: 1024px) {
  .grid.two,
  .grid.three,
  .mini-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  body {
    padding-inline: 14px;
  }

  .hero,
  .panel {
    padding: 18px;
    border-radius: 24px;
  }

  .hero h1 {
    font-size: 2.4rem;
  }
}`;

export const OPERATIONS_MONITORING_APP_JS = `const DATA_URL = './monitoring-data.json';

const COLORS = {
  human: '#264653',
  human_agent_interaction: '#2a9d8f',
  ai_autonomous: '#e76f51',
  implementation: '#264653',
  spec: '#c5952d',
  review: '#4f6d8a',
  bugfix: '#e76f51',
  rework: '#d62828',
  testing: '#2a9d8f',
  other: '#7a7f87',
};

const state = {
  snapshot: null,
  windowKey: '30d',
};

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatHours(value) {
  return value === null || value === undefined ? '—' : \`\${formatNumber(value, 1)}h\`;
}

function formatPercent(value) {
  return value === null || value === undefined ? '—' : \`\${formatNumber(value * 100, 0)}%\`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderWindowButtons() {
  const root = document.getElementById('window-switcher');
  root.innerHTML = ['7d', '30d', 'all'].map((key) => \`
    <button class="\${state.windowKey === key ? 'active' : ''}" data-window="\${key}">
      \${key === 'all' ? 'All Time' : key.toUpperCase()}
    </button>
  \`).join('');

  root.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      state.windowKey = button.getAttribute('data-window') || '30d';
      render();
    });
  });
}

function statCard(label, value, hint = '') {
  return \`
    <article class="stat-card">
      <span class="label">\${escapeHtml(label)}</span>
      <span class="value">\${escapeHtml(value)}</span>
      <span class="hint">\${escapeHtml(hint)}</span>
    </article>
  \`;
}

function barRow(label, value, total, color, suffix = '') {
  const width = total > 0 ? Math.max(6, Math.round((value / total) * 100)) : 0;
  return \`
    <div class="bar-row">
      <div class="bar-meta">
        <span>\${escapeHtml(label)}</span>
        <strong>\${escapeHtml(formatNumber(value, 1) + suffix)}</strong>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width: \${width}%; background: \${color};"></div>
      </div>
    </div>
  \`;
}

function stackSegment(width, color) {
  return \`<div style="width: \${Math.max(width, width > 0 ? 4 : 0)}%; background: \${color};"></div>\`;
}

function renderOverview() {
  const live = state.snapshot.live;
  const windowMetrics = state.snapshot.windows[state.windowKey];
  return \`
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Operations Overview</h2>
          <p>What is live right now plus the key health counters for the selected window.</p>
        </div>
      </div>
      <div class="stats-grid">
        \${statCard('Active Sessions', String(live.active_sessions), 'Currently running work windows')}
        \${statCard('Sync Pending', String(live.sync_pending_sessions), 'Sessions waiting for Jira sync recovery')}
        \${statCard('Pending Approvals', String(live.pending_approvals), 'Human checkpoints blocking flow')}
        \${statCard('Archive Blocked', String(live.archive_blocked_changes), 'Changes stopped before closeout')}
        \${statCard('Throughput', String(windowMetrics.throughput_changes_archived), 'Archived changes in this window')}
        \${statCard('First Pass Success', formatPercent(windowMetrics.first_pass_success_rate), 'Closed without retry loops')}
      </div>
    </section>
  \`;
}

function renderCapacity() {
  const metrics = state.snapshot.windows[state.windowKey];
  const total = Math.max(metrics.raw_hours, 0.1);
  const actor = metrics.actor_mode_hours;
  const work = metrics.work_kind_hours;

  return \`
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Capacity & Focus</h2>
          <p>Observed productive bandwidth from runtime evidence, not theoretical calendar hours.</p>
        </div>
      </div>
      <div class="mini-grid">
        <div>
          <div class="stats-grid">
            \${statCard('Raw Logged', formatHours(metrics.raw_hours), 'From timer blocks')}
            \${statCard('Jira Billed', formatHours(metrics.jira_billed_hours), 'Rounded worklog projection')}
            \${statCard('Pause Ratio', formatPercent(metrics.pause_ratio), 'Paused time versus total observed time')}
            \${statCard('Avg Block', metrics.average_block_minutes === null ? '—' : formatNumber(metrics.average_block_minutes, 0) + 'm', 'Longer blocks usually mean better focus')}
            \${statCard('Switches / Hour', metrics.context_switch_rate_per_hour === null ? '—' : formatNumber(metrics.context_switch_rate_per_hour, 2), 'Proxy for context switching')}
            \${statCard('Maintenance Reserve', formatPercent(metrics.maintenance_reserve_ratio), 'Bugfix + rework share')}
          </div>
        </div>
        <div>
          <div class="bars">
            \${barRow('Human', actor.human || 0, total, COLORS.human, 'h')}
            \${barRow('Human + AI', actor.human_agent_interaction || 0, total, COLORS.human_agent_interaction, 'h')}
            \${barRow('AI Autonomous', actor.ai_autonomous || 0, total, COLORS.ai_autonomous, 'h')}
          </div>
          <div class="legend">
            <span class="legend-item"><span class="swatch" style="background:\${COLORS.human}"></span> Human work</span>
            <span class="legend-item"><span class="swatch" style="background:\${COLORS.human_agent_interaction}"></span> Collaborative human+AI work</span>
            <span class="legend-item"><span class="swatch" style="background:\${COLORS.ai_autonomous}"></span> Autonomous AI work</span>
          </div>
          <div style="margin-top:16px" class="bars">
            \${barRow('Planning', work.spec || 0, total, COLORS.spec, 'h')}
            \${barRow('Delivery', metrics.delivery_hours, total, COLORS.implementation, 'h')}
            \${barRow('Maintenance', metrics.maintenance_hours, total, COLORS.bugfix, 'h')}
          </div>
        </div>
      </div>
    </section>
  \`;
}

function renderReliability() {
  const metrics = state.snapshot.windows[state.windowKey];
  const blockerNotes = state.snapshot.blocker_summary.slice(0, 4).map((item) => \`
    <article class="note-item">
      <h3>\${escapeHtml(item.label)} · \${escapeHtml(String(item.count))}</h3>
      <p>\${escapeHtml(item.description)}</p>
    </article>
  \`).join('');

  return \`
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Reliability & Governance</h2>
          <p>Operational health of worklog sync, approvals, and archive gating.</p>
        </div>
      </div>
      <div class="stats-grid">
        \${statCard('Sync Failure Rate', formatPercent(metrics.sync_failure_rate), 'Sessions that ended in sync trouble')}
        \${statCard('Archive Block Rate', formatPercent(metrics.archive_block_rate), 'Governed stop before closeout')}
        \${statCard('Approval Resolution', metrics.approval_resolution_hours_avg === null ? '—' : formatNumber(metrics.approval_resolution_hours_avg, 1) + 'h', 'Average time to resolve approvals')}
        \${statCard('Pending Approvals', String(state.snapshot.live.pending_approvals), 'Live queue right now')}
      </div>
      <div class="note-list" style="margin-top:16px">
        \${blockerNotes || '<article class="note-item"><h3>No dominant blockers</h3><p>No sync, approval, or archive blocker is currently dominating the runtime view.</p></article>'}
      </div>
    </section>
  \`;
}

function renderFlow() {
  const metrics = state.snapshot.windows[state.windowKey];
  const distribution = state.snapshot.change_cycle_distribution;
  const total = distribution.reduce((sum, item) => sum + item.count, 0) || 1;

  return \`
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Flow Efficiency</h2>
          <p>Where work accumulates, retries, or gets stuck before closeout.</p>
        </div>
      </div>
      <div class="stats-grid">
        \${statCard('Tracked Sessions', String(metrics.session_count), 'Sessions observed in this window')}
        \${statCard('Closed Sessions', String(metrics.closed_session_count), 'Sessions with an end timestamp')}
        \${statCard('Archived Changes', String(metrics.throughput_changes_archived), 'Throughput in this window')}
        \${statCard('Avg Blocks / Session', metrics.average_blocks_per_session === null ? '—' : formatNumber(metrics.average_blocks_per_session, 1), 'Proxy for flow fragmentation')}
      </div>
      <div class="bars" style="margin-top:18px">
        \${distribution.map((item) => barRow(item.bucket, item.count, total, COLORS.review)).join('')}
      </div>
    </section>
  \`;
}

function renderCollaboration() {
  const metrics = state.snapshot.windows[state.windowKey];
  const rows = state.snapshot.collaboration_matrix
    .filter((row) => row.window === state.windowKey && row.raw_hours > 0)
    .sort((a, b) => b.raw_hours - a.raw_hours)
    .slice(0, 10);
  const max = rows.reduce((result, row) => Math.max(result, row.raw_hours), 0.1);

  return \`
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Human + AI Collaboration</h2>
          <p>How effort splits across pure human work, collaborative work, and autonomous AI work.</p>
        </div>
      </div>
      <div class="stats-grid">
        \${statCard('Collaboration Ratio', formatPercent(metrics.collaboration_ratio), 'Joint human+AI share of raw time')}
        \${statCard('AI Leverage Ratio', metrics.ai_leverage_ratio === null ? '—' : formatNumber(metrics.ai_leverage_ratio, 2), 'Autonomous AI hours divided by human + joint hours')}
        \${statCard('Planning Hours', formatHours(metrics.planning_hours), 'Spec and discovery work')}
        \${statCard('Maintenance Hours', formatHours(metrics.maintenance_hours), 'Bugfix + rework load')}
      </div>
      <div class="bars" style="margin-top:18px">
        \${rows.map((row) => barRow(\`\${row.actor_mode} · \${row.work_kind}\`, row.raw_hours, max, COLORS[row.actor_mode] || COLORS.other, 'h')).join('')}
      </div>
    </section>
  \`;
}

function renderActiveSessions() {
  const sessions = (state.snapshot.active_sessions || []).slice(0, 12);
  const rows = sessions.map((session) => \`
    <tr>
      <td><strong>\${escapeHtml(session.ticket_key)}</strong><br><span style="color:var(--muted)">\${escapeHtml(session.summary || 'No summary')}</span></td>
      <td>\${escapeHtml(session.developer_id)}</td>
      <td><span class="status-pill \${escapeHtml((session.session_state || 'other').toLowerCase())}">\${escapeHtml(session.session_state || 'UNKNOWN')}</span><br><span style="color:var(--muted)">timer: \${escapeHtml(session.timer_status || '—')}</span></td>
      <td>\${escapeHtml(session.activity_mode || '—')} / \${escapeHtml(session.activity_kind || '—')}<br><span style="color:var(--muted)">\${escapeHtml(session.autonomy_level || '—')}</span></td>
      <td>\${escapeHtml(session.change_name || '—')}\${session.sync_error ? \`<br><span style="color:var(--coral)">\${escapeHtml(session.sync_error)}</span>\` : ''}</td>
      <td>\${escapeHtml(formatHours(session.raw_hours))}</td>
      <td>\${escapeHtml(session.started_at_local || session.started_at)}</td>
    </tr>
  \`).join('');

  return \`
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Active Sessions</h2>
          <p>Explicit view of live work windows so the current operating picture is obvious at a glance.</p>
        </div>
      </div>
      <div class="stats-grid">
        \${statCard('Running', String(state.snapshot.live.active_sessions), 'Sessions currently in progress')}
        \${statCard('Paused', String(state.snapshot.live.paused_sessions), 'Sessions intentionally paused')}
        \${statCard('Sync Pending', String(state.snapshot.live.sync_pending_sessions), 'Sessions waiting on Jira recovery')}
        \${statCard('Awaiting Human', String(state.snapshot.live.awaiting_human_sessions), 'Runtime blocked pending a human step')}
      </div>
      <div class="table-shell" style="margin-top:18px">
        <table>
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Developer</th>
              <th>Session</th>
              <th>Activity</th>
              <th>Change / Alert</th>
              <th>Raw</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            \${rows || '<tr><td colspan="7">No active sessions right now.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  \`;
}

function renderLiveRuntime() {
  const tickets = state.snapshot.live_tickets.slice(0, 12);
  const approvals = state.snapshot.pending_approvals.slice(0, 8);
  const ticketRows = tickets.map((ticket) => \`
    <tr>
      <td><strong>\${escapeHtml(ticket.ticket_key)}</strong><br><span style="color:var(--muted)">\${escapeHtml(ticket.summary || 'No summary')}</span></td>
      <td><span class="status-pill \${escapeHtml(ticket.session_state.toLowerCase())}">\${escapeHtml(ticket.session_state)}</span></td>
      <td>\${escapeHtml(ticket.activity_mode)} / \${escapeHtml(ticket.activity_kind)}</td>
      <td>\${escapeHtml(ticket.change_state || '—')}</td>
      <td>\${escapeHtml(ticket.autonomy_level)}</td>
    </tr>
  \`).join('');

  const approvalRows = approvals.map((approval) => \`
    <tr>
      <td><strong>\${escapeHtml(approval.approval_id)}</strong><br><span style="color:var(--muted)">\${escapeHtml(approval.ticket_key)}</span></td>
      <td>\${escapeHtml(approval.scope)}</td>
      <td>\${escapeHtml(approval.change_name || '—')}</td>
      <td>\${escapeHtml(approval.reason)}</td>
    </tr>
  \`).join('');

  return \`
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Live Runtime</h2>
          <p>The work currently in flight and the approval queue attached to it.</p>
        </div>
      </div>
      <div class="grid two">
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Session</th>
                <th>Activity</th>
                <th>Change</th>
                <th>Autonomy</th>
              </tr>
            </thead>
            <tbody>
              \${ticketRows || '<tr><td colspan="5">No active runtime tickets.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>Approval</th>
                <th>Scope</th>
                <th>Change</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              \${approvalRows || '<tr><td colspan="4">No pending approvals.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  \`;
}

function renderRecentSessions() {
  const rows = state.snapshot.recent_sessions.slice(0, 14).map((session) => \`
    <tr>
      <td><strong>\${escapeHtml(session.ticket_key)}</strong><br><span style="color:var(--muted)">\${escapeHtml(session.summary || 'No summary')}</span></td>
      <td>\${escapeHtml(session.developer_id)}</td>
      <td><span class="status-pill \${escapeHtml(session.status.toLowerCase())}">\${escapeHtml(session.status)}</span></td>
      <td>\${escapeHtml(session.change_name || '—')}</td>
      <td>\${escapeHtml(formatHours(session.raw_hours))}</td>
      <td>\${escapeHtml(formatHours(session.jira_billed_hours))}</td>
      <td>\${escapeHtml(session.started_at_local || session.started_at)}</td>
    </tr>
  \`).join('');

  return \`
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Recent Sessions</h2>
          <p>Last observed work sessions across the current workspace.</p>
        </div>
      </div>
      <div class="table-shell">
        <table>
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Developer</th>
              <th>Status</th>
              <th>Change</th>
              <th>Raw</th>
              <th>Billed</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            \${rows || '<tr><td colspan="7">No session history found.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  \`;
}

function render() {
  if (!state.snapshot) return;
  renderWindowButtons();

  document.getElementById('status-line').textContent = \`Window: \${state.snapshot.windows[state.windowKey].label}\`;
  document.getElementById('overview').innerHTML = renderOverview();
  document.getElementById('capacity').innerHTML = renderCapacity();
  document.getElementById('reliability').innerHTML = renderReliability();
  document.getElementById('flow').innerHTML = renderFlow();
  document.getElementById('collaboration').innerHTML = renderCollaboration();
  document.getElementById('active-sessions').innerHTML = renderActiveSessions();
  document.getElementById('live-runtime').innerHTML = renderLiveRuntime();
  document.getElementById('recent-sessions').innerHTML = renderRecentSessions();
}

async function boot() {
  const response = await fetch(DATA_URL);
  const snapshot = await response.json();
  state.snapshot = snapshot;

  document.getElementById('eyebrow').textContent = snapshot.site.label;
  document.getElementById('title').textContent = snapshot.site.title;
  document.getElementById('subtitle').textContent = snapshot.site.subtitle;
  document.getElementById('generated-at').innerHTML = \`<strong>Generated:</strong> \${escapeHtml(snapshot.generated_at)}\`;
  document.getElementById('project-root').innerHTML = \`<strong>Project:</strong> \${escapeHtml(snapshot.project_root)}\`;

  render();
}

boot().catch((error) => {
  const root = document.getElementById('app');
  root.innerHTML = \`<section class="panel"><div class="panel-header"><div><h2>Monitoring site failed to load</h2><p>\${escapeHtml(error.message || String(error))}</p></div></div></section>\`;
});`;

export function buildOperationsMonitoringHtml(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div class="shell" id="app">
      <section class="hero">
        <p class="eyebrow" id="eyebrow">Operations Monitoring</p>
        <h1 id="title">${title}</h1>
        <p id="subtitle">A static operating room for OpenSpec sessions, runtime flow, and human/AI collaboration.</p>
        <div class="hero-meta">
          <span class="chip" id="generated-at"></span>
          <span class="chip" id="project-root"></span>
        </div>
      </section>
      <div class="toolbar">
        <div class="window-switcher" id="window-switcher"></div>
        <div class="status-line" id="status-line"></div>
      </div>
      <div class="grid">
        <div id="overview"></div>
        <div id="capacity"></div>
        <div class="grid two">
          <div id="reliability"></div>
          <div id="flow"></div>
        </div>
        <div id="collaboration"></div>
        <div id="active-sessions"></div>
        <div id="live-runtime"></div>
        <div id="recent-sessions"></div>
      </div>
    </div>
    <script src="./app.js" type="module"></script>
  </body>
</html>`;
}
