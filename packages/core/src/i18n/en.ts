import type { ar } from './ar.js';

export const en: Record<keyof typeof ar, string> = {
  'doctor.title': 'SINDAR Doctor',
  'doctor.version': 'version {version} ({build})',
  'doctor.node.ok': 'Node.js v{version}',
  'doctor.node.fail': 'Node.js v{version} — requires ≥ {min}',
  'doctor.node.hint.termux': 'Upgrade with: pkg install nodejs-lts',
  'doctor.node.hint': 'Install a newer release from nodejs.org',
  'doctor.platform': 'Platform: {os} · {arch} · shell: {shell}',
  'doctor.platform.termux': 'Platform: Android (Termux {version}) · {arch} · shell: {shell}',
  'doctor.home.ok': 'SINDAR home: {home}',
  'doctor.home.created': 'Created SINDAR home for the first time: {home}',
  'doctor.home.fail': 'SINDAR home is not writable: {home}',
  'doctor.config.ok': 'Config: config.yaml · default model: {model}',
  'doctor.config.fail': 'Invalid configuration: {error}',
  'doctor.config.warn': 'Config warning: {warning}',
  'doctor.model.mock':
    'Default model is the test mock — run `sindar onboard` to pick a real (free) model',
  'doctor.db.ok': 'Database: {driver} · SQLite {sqlite} · full-text {fts} · schema v{schema}',
  'doctor.db.fts.missing': 'No full-text engine (FTS) — search will run in simple mode',
  'doctor.db.fallback': 'node:sqlite missing in this Node build — switched to sql.js automatically',
  'doctor.db.fail': 'Could not open the database: {error}',
  'doctor.providers.title': 'Providers',
  'doctor.providers.none':
    'No real provider configured yet — grab a free key from Groq or Gemini (see .env)',
  'doctor.provider.ready': '{name} — ready',
  'doctor.provider.local.ok': '{name} — running at {url}',
  'doctor.provider.local.down': '{name} — not reachable at {url} (optional)',
  'doctor.provider.nokey': '{name} — missing {env} ({free})',
  'doctor.free.local': 'local, free',
  'doctor.free.free-tier': 'free tier: {url}',
  'doctor.free.paid': 'paid, optional',
  'doctor.termux.title': 'Termux',
  'doctor.termux.wakelock.ok': 'termux-wake-lock available (keeps the brain alive in background)',
  'doctor.termux.wakelock.missing': 'termux-wake-lock not found — update the Termux app',
  'doctor.termux.api.ok': 'Termux:API installed (notifications, clipboard, camera…)',
  'doctor.termux.api.missing':
    'Termux:API not installed (optional): pkg install termux-api + the Termux:API app from F-Droid',
  'doctor.termux.storage.ok': 'Shared storage enabled (~/storage)',
  'doctor.termux.storage.missing': 'Shared storage not enabled — run: termux-setup-storage',
  'doctor.termux.battery':
    'Disable battery optimisation for Termux in Android settings so it is not killed in background',
  'doctor.resources': 'Memory: {freeMem} free of {totalMem} · Disk: {freeDisk} free',
  'doctor.resources.lowmem':
    'Low free memory ({freeMem}) — prefer a free cloud provider over a local model',
  'doctor.summary.ok': 'Result: ready ✔',
  'doctor.summary.warn': 'Result: ready with {n} warning(s)',
  'doctor.summary.fail': 'Result: {n} problem(s) need fixing',
  'update.start': 'Updating SINDAR from the {channel} channel…',
  'update.done': 'Updated. Run: sindar doctor',
  'update.fail': 'Update failed: {error}',
  'update.npm.missing': 'npm not found on PATH',
  'cli.hint':
    'Start with: sindar onboard (setup), then sindar dashboard (web UI) or sindar chat (terminal) · sindar doctor for a health check',

  // ---- chat ----
  'chat.session.new': 'New session {id} · model: {model}',
  'chat.session.resumed': 'Resumed session {id} ({count} messages) · model: {model}',
  'chat.hint':
    'Type a message and press Enter · /help for commands · /stop stops the reply · /exit quits',
  'chat.thinking': 'thinking…',
  'chat.tool.run': '⚙ {summary}',
  'chat.tool.done': '✓ {name} ({ms}ms)',
  'chat.tool.error': '✖ {name}: {error}',
  'chat.tool.repeat': 'same call repeated — skipped',
  'chat.tool.denied': '⛔ denied: {summary} ({reason})',
  'chat.tool.forbidden': 'blocked by safety rules',
  'chat.approve.title': 'SINDAR asks for permission:',
  'chat.approve.reason.exec': 'run a terminal command',
  'chat.approve.reason.write-outside': 'write a file outside the workspace',
  'chat.approve.reason.pipe-to-shell': 'download and run a script from the internet',
  'chat.approve.prompt': 'Allow? [y] yes  [n] no  [a] always for this tool in this session: ',
  'chat.cancelled': '⏹ stopped',
  'chat.model.switch': '↪ switched from {from} to {to}: {reason}',
  'chat.compress': '🗜 context compressed ({before} → {after} est. tokens)',
  'chat.usage': 'Usage: {in} in · {out} out · {calls} calls',
  'chat.usage.none': 'No usage recorded yet',
  'chat.bye': 'Bye 👋',
  'chat.error': 'Error: {error}',
  'chat.error.ratelimit':
    '⏳ The provider is busy (free-tier rate limit). Wait about {seconds}s and resend — or add a fallback model: sindar model --fallbacks …',
  'chat.error.auth': 'The provider rejected the key. Run: sindar onboard',
  'chat.error.network':
    'Cannot reach the model provider ({error}). Check internet/VPN. If Termux is in the background on Huawei/Xiaomi, allow it to run in the background: Settings → Apps → Termux → Battery → App launch → Manage manually (enable all three).',
  'chat.error.nokey': 'No API key for the model provider. Run: sindar onboard',
  'chat.undo.ok': '↶ removed your last message and its reply',
  'chat.undo.none': 'Nothing to undo',
  'chat.model.set': 'Model for this session: {model}',
  'chat.approval.set': 'Approval mode: {mode}',
  'chat.help': `Commands:
  /new            start a new session
  /model [ref]    show/change the model (e.g. groq:llama-3.3-70b-versatile)
  /approve <mode> ask | allowlist | yolo
  /usage          tokens used in this session
  /retry          resend your last message
  /undo           remove your last message and its reply
  /compress       summarize older conversation now
  /sessions       recent sessions (resume with: sindar chat -r <id>)
  /stop           stop the current reply or command (instead of Ctrl+C)
  /exit           quit`,
  'chat.oneshot.empty': 'No message given. Example: sindar chat "hello"',
  'chat.compress.done': 'compressed',
  'chat.compress.skip': 'conversation is short — nothing to compress',
  'chat.retry.none': 'No message to resend',

  // ---- onboard ----
  'onboard.title': 'SINDAR setup — a few free steps',
  'onboard.lang': 'Language / اللغة: [1] العربية  [2] English',
  'onboard.provider.title': 'Pick a model provider (all free or with a free tier):',
  'onboard.provider.local': 'local on your device',
  'onboard.provider.free': 'free tier',
  'onboard.provider.paid': 'paid',
  'onboard.provider.recommended': 'recommended',
  'onboard.provider.prompt': 'Number [{default}]: ',
  'onboard.key.url': 'Get a free key at: {url}',
  'onboard.key.prompt': 'Paste the key ({env}) and press Enter: ',
  'onboard.key.existing': 'A key is already saved ({masked}) — press Enter to keep it',
  'onboard.key.testing': 'Testing the key…',
  'onboard.key.ok': 'Key works ✓ ({ms}ms)',
  'onboard.key.fail': 'Test failed: {error}',
  'onboard.key.retry': 'Try again? [Y/n]: ',
  'onboard.key.received': 'Key received: {masked} ({len} chars)',
  'onboard.key.suspicious':
    'Warning: the key looks incomplete or masked (contains …, spaces, or is very short). Copy it from the dialog shown right after creating it — the list only shows a masked version.',
  'onboard.key.visible': 'This time the key will be shown while you paste so you can check it.',
  'onboard.key.groqhint':
    'On Groq: Create API Key → Submit → press Copy next to the key starting with gsk_ (shown only once).',
  'onboard.key.saved': 'Key saved to {file} (mode 600)',
  'onboard.local.unreachable': 'Local server not reachable at {url} — start it and retry',
  'onboard.model.title': 'Pick a model:',
  'onboard.model.prompt': 'Number or type a model name [{default}]: ',
  'onboard.model.fetching': 'Fetching model list…',
  'onboard.fallbacks': 'Fallback models when busy: {models}',
  'chat.retry.wait': '⏳ {model} is busy — waiting {seconds}s then retrying ({attempt}/3)…',
  'chat.retry.wait.network':
    '📡 Cannot reach {model} (internet?) — waiting {seconds}s then retrying ({attempt}/3)…',
  'onboard.saved': 'Saved: default model {model}',
  'onboard.test': 'Quick test…',
  'onboard.test.reply': 'Reply: {text}',
  'onboard.done': 'Ready! Start chatting with: sindar chat',
  'onboard.approval.title':
    'Command approval mode: [1] always ask (safe)  [2] allowlist  [3] run without asking',
  'onboard.aborted': 'Setup cancelled',

  // ---- model / config / sessions ----
  'model.current': 'Default model: {model}',
  'model.fallbacks': 'Fallbacks: {list}',
  'model.none': 'none',
  'model.providers': 'Providers:',
  'model.ready': 'ready',
  'model.nokey': 'no key ({env})',
  'model.set': 'Default model set to {model}',
  'model.warn.unconfigured': 'Warning: provider {provider} has no key yet — run sindar onboard',
  'model.listing': 'Models for {provider}:',
  'config.saved': 'Saved: {key} = {value}',
  'config.invalid': 'Invalid value: {error}',
  'config.path': 'Config file: {path}',
  'config.unknown': 'No such key: {key}',
  'gateway.started': 'SINDAR gateway is running at {url}',
  'gateway.already': 'SINDAR gateway was already running at {url}',
  'gateway.open.title': 'Open the web UI with this link (it contains your access token):',
  'gateway.open.termux':
    'In Termux: long-press the link → Open link. Then in the browser menu: "Add to Home screen".',
  'gateway.open.manual': 'Could not open a browser automatically — copy the link above.',
  'gateway.qr.local':
    'The gateway listens on this device only (127.0.0.1). For other devices: sindar gateway start --host 0.0.0.0',
  'gateway.foreground.hint': 'Press Ctrl+C to stop.',
  'gateway.bg.hint':
    'Running in the background. Stop: sindar gateway stop — status: sindar gateway status — log: sindar gateway logs',
  'gateway.stopping': 'Stopping…',
  'gateway.stopped': 'SINDAR gateway stopped.',
  'gateway.stop.foreign':
    'A gateway is running but was not started by me (another terminal?) — stop it there with Ctrl+C.',
  'gateway.start.failed': 'The gateway did not start. See the log: {log}',
  'gateway.status.up': 'running ✓ {url} (up {uptime})',
  'gateway.status.detail':
    'model {model} · sessions {sessions} · running {running} · pending approvals {pending} · version {version}',
  'gateway.status.pending': 'Approvals are waiting for you — open the web UI.',
  'gateway.status.down': 'not running — start it with: sindar gateway start  ({url})',
  'gateway.logs.none': 'No log yet ({file})',
  'gateway.token.rotated':
    'Access token rotated — reopen the UI from the new link (sindar dashboard).',
  'sessions.title': 'Recent sessions:',
  'sessions.none': 'No sessions yet',
  'sessions.row': '{id}  {when}  {count} msgs  {model}  {title}',
  'sessions.notfound': 'No session with id: {id}',
  'sessions.deleted': 'Deleted session {id}',
  'sessions.search.none': 'No past conversation matches "{q}"',
  'sessions.search.title': 'Conversations matching "{q}":',
  'memory.title': 'SINDAR memory',
  'memory.file': '{name} — {entries} entries, {chars}/{limit} chars',
  'memory.empty': '(empty)',
  'memory.added': 'Saved to {target} as [{id}]',
  'memory.removed': 'Removed [{id}]',
  'memory.hint':
    'Edit the files directly or use: sindar memory add "text" · sindar memory remove <id>',
  'skills.title': 'Skills ({count}) — {dir}',
  'skills.none':
    'No skills yet. Create one: sindar skills create <name>  ·  install: sindar skills install github:owner/repo/path',
  'skills.row': '{name}  v{version}  [{source}]  {description}',
  'skills.notfound': 'No skill named "{name}"',
  'skills.removed': 'Removed skill "{name}"',
  'skills.created': 'Created skill "{name}" at {path}',
  'skills.installed': 'Installed skill "{name}" from {origin}',
  'skills.fetching': 'Fetching {source} from GitHub…',
  'skills.warnings': 'Security scan found {count} warning(s):',
  'skills.danger':
    'Refused: dangerous content found. Review it and re-run with --yes to install anyway.',
  'skills.scriptsNote':
    'Scripts inside skills are never run automatically — the agent runs them through the terminal tool with your approval.',
  'skills.mode':
    'Skill auto-creation mode: {mode} (change with: sindar config set skills.autoCreate ask|auto|off)',
  'common.yes': 'yes',
  'common.no': 'no',
  'common.cancelled': 'cancelled',
};
