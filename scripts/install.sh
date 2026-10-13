#!/usr/bin/env bash
# ============================================================================
#  SINDAR installer — Termux (Android), Linux, macOS
#
#  Termux / Linux / macOS:
#    curl -fsSL https://raw.githubusercontent.com/djoeekoe-netizen/SINDAR/main/scripts/install.sh | bash
#
#  Options (environment variables):
#    SINDAR_CHANNEL=dev|latest   release channel (default: dev)
#    SINDAR_REPO=owner/name      GitHub repository (default: djoeekoe-netizen/SINDAR)
#    SINDAR_FROM_SOURCE=1        build from a git checkout instead of the prebuilt tarball
# ============================================================================
set -euo pipefail

REPO="${SINDAR_REPO:-djoeekoe-netizen/SINDAR}"
CHANNEL="${SINDAR_CHANNEL:-dev}"
# TODO(M9): switch to "main" once the agent branch is merged.
BRANCH="${SINDAR_BRANCH:-arena/ed5f3c48-sindar}"
TGZ_URL="https://github.com/${REPO}/releases/download/${CHANNEL}/sindar-cli.tgz"
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=13

say()  { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m⚠\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✖\033[0m %s\n' "$*" >&2; exit 1; }

is_termux() {
  [ -n "${TERMUX_VERSION:-}" ] && return 0
  case "${PREFIX:-}" in *com.termux*) return 0 ;; esac
  [ -d /data/data/com.termux/files/usr ] && [ "$(uname -o 2>/dev/null || true)" = "Android" ] && return 0
  return 1
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v major minor
  v="$(node -p 'process.versions.node' 2>/dev/null || echo 0.0.0)"
  major="${v%%.*}"; minor="${v#*.}"; minor="${minor%%.*}"
  [ "$major" -gt "$MIN_NODE_MAJOR" ] && return 0
  [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -ge "$MIN_NODE_MINOR" ] && return 0
  return 1
}

echo
printf '\033[1m  SINDAR — مساعد ذكاء اصطناعي شخصي مجاني · Free personal AI agent\033[0m\n'
echo

# ---------------------------------------------------------------- Termux prep
if is_termux; then
  say "Termux detected — تم اكتشاف Termux"
  export DEBIAN_FRONTEND=noninteractive
  APT_OPTS=(-y -o Dpkg::Options::=--force-confnew -o Dpkg::Options::=--force-confdef)
  # A *full* upgrade is mandatory: Termux libraries are not version-pinned, so installing a
  # single new package on an old base (e.g. new libcurl + old openssl) breaks with
  # 'CANNOT LINK EXECUTABLE ... cannot locate symbol'. Keeping everything in sync avoids that.
  say "Upgrading Termux packages first (keeps libraries consistent) — تحديث حزم Termux أولاً…"
  say "This can take several minutes on an old install — قد يستغرق عدة دقائق"
  if ! pkg upgrade "${APT_OPTS[@]}"; then
    # 'pkg' itself needs a working curl for its mirror check; plain apt does not.
    apt update || true
    apt full-upgrade "${APT_OPTS[@]}" || warn "Package upgrade failed — continuing, but Termux may be in a mixed state"
  fi
  say "Installing Node.js LTS and git — تثبيت Node.js…"
  if ! pkg install "${APT_OPTS[@]}" nodejs-lts git; then
    apt install "${APT_OPTS[@]}" nodejs-lts git
  fi
  # Optional but recommended: device APIs (notifications, clipboard, camera…)
  pkg install "${APT_OPTS[@]}" termux-api >/dev/null 2>&1 || true
  ok "Node.js $(node -p 'process.versions.node')"
fi

# ---------------------------------------------------------------- Node check
if ! node_ok; then
  if is_termux; then
    die "Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} required. Run: pkg install nodejs-lts"
  fi
  cat >&2 <<MSG
Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} is required but was not found.
  macOS:   brew install node        (or https://nodejs.org)
  Linux:   https://nodejs.org/en/download  (or your distro's nodejs-lts package)
Then re-run this installer.
MSG
  exit 1
fi
ok "Node.js $(node -p 'process.versions.node') · npm $(npm -v)"

# ---------------------------------------------------------------- install
install_from_tarball() {
  say "Installing SINDAR (${CHANNEL}) — جارٍ التثبيت…"
  say "${TGZ_URL}"
  npm install -g "${TGZ_URL}" --no-fund --no-audit --loglevel=error
}

install_from_source() {
  say "Building SINDAR from source (${BRANCH}) — البناء من المصدر…"
  command -v git >/dev/null 2>&1 || die "git is required for a source install"
  local dir="${SINDAR_SRC_DIR:-$HOME/.sindar/src}"
  if [ -d "$dir/.git" ]; then
    git -C "$dir" fetch --depth 1 origin "$BRANCH" && git -C "$dir" checkout -q FETCH_HEAD
  else
    rm -rf "$dir"
    git clone --depth 1 --branch "$BRANCH" "https://github.com/${REPO}.git" "$dir"
  fi
  command -v pnpm >/dev/null 2>&1 || npm install -g pnpm --no-fund --no-audit --loglevel=error
  (cd "$dir" && pnpm install --frozen-lockfile && pnpm build && cd packages/cli && npm pack --pack-destination "$dir" >/dev/null)
  npm install -g "$dir"/sindar-*.tgz --no-fund --no-audit --loglevel=error
}

if [ "${SINDAR_FROM_SOURCE:-0}" = "1" ]; then
  install_from_source
else
  if ! install_from_tarball; then
    warn "Prebuilt download failed (is the repository public / does the '${CHANNEL}' release exist?)"
    say "Falling back to a source build…"
    install_from_source
  fi
fi

# ---------------------------------------------------------------- verify
hash -r 2>/dev/null || true
if ! command -v sindar >/dev/null 2>&1; then
  die "sindar was installed but is not on PATH. Open a new terminal, or add npm's global bin dir to PATH: $(npm prefix -g)/bin"
fi
ok "SINDAR $(sindar --version) installed — تم التثبيت"
echo
say "Running first health check — فحص الجاهزية:"
echo
sindar doctor || true
echo
if is_termux; then
  cat <<'MSG'
ملاحظات مهمة للجوال / Phone notes:
  • عطّل «تحسين البطارية» لتطبيق Termux حتى لا يُغلَق في الخلفية.
  • للوصول لملفاتك: termux-setup-storage
  • للتحديث لاحقاً: sindar update
MSG
fi
