#!/usr/bin/env bash
#
# provenance.sh — read-only audit of how the tools you use actually got installed.
#
# For each command it resolves the real binary (following symlinks), classifies
# which installer/manager owns it (Homebrew formula/cask, pnpm standalone, pnpm
# global, pnpm-managed Node, Volta, npm global, a macOS .pkg receipt, or a manual
# drop into /usr/local), and compares that against what mac-bootstrap's manifest
# would manage. Tools installed the "old way" are flagged for migration.
#
# This script NEVER changes the machine. Removal commands are printed as
# suggestions only — review them before running anything. The intent is to learn
# the current state so we can encode a deterministic migrate-then-bootstrap flow
# in the repo.
#
# Usage:
#   tools/provenance.sh                 # audit the default tool set
#   tools/provenance.sh node aws cdk    # audit specific commands
#   tools/provenance.sh --packages /path/to/packages.json
#   tools/provenance.sh --json          # machine-readable output for `bin/migrate`
#
# Apple Silicon macOS is the target (Homebrew at /opt/homebrew, pnpm at
# ~/Library/pnpm). It degrades gracefully when a probe tool is unavailable.

set -u

# --- configuration -----------------------------------------------------------

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" > /dev/null 2>&1 && pwd -P)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." > /dev/null 2>&1 && pwd -P)"
PACKAGES_JSON="$REPO_DIR/packages.json"

# Default tool set mirrors the commands the user reported via `which`.
DEFAULT_TOOLS="brew pnpm aws cdk node"
TOOLS=""
JSON=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --json)
      JSON=1
      shift
      ;;
    --packages)
      PACKAGES_JSON="$2"
      shift 2
      ;;
    --packages=*)
      PACKAGES_JSON="${1#*=}"
      shift
      ;;
    -h | --help)
      grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      TOOLS="$TOOLS $1"
      shift
      ;;
  esac
done

[ -n "$TOOLS" ] || TOOLS="$DEFAULT_TOOLS"

# Tool homes. Honor the env the shell already exports, fall back to the standard
# Apple Silicon locations mac-scripts / mac-bootstrap assume.
BREW_PREFIX="${HOMEBREW_PREFIX:-$(command -v brew > /dev/null 2>&1 && brew --prefix 2>/dev/null || echo /opt/homebrew)}"
PNPM_HOME_DIR="${PNPM_HOME:-$HOME/Library/pnpm}"
VOLTA_HOME_DIR="${VOLTA_HOME:-$HOME/.volta}"
NPM_GLOBAL_BIN="$(command -v npm > /dev/null 2>&1 && printf '%s/bin' "$(npm prefix -g 2>/dev/null)" || echo "")"

# --- manifest awareness ------------------------------------------------------

# Build a space-padded string of every formula/cask name mac-bootstrap manages,
# so membership is a simple substring test (works on bash 3.2, no associative
# arrays). When jq is missing, fall back to a name grep on the JSON.
MANAGED_NAMES=" "
if [ -f "$PACKAGES_JSON" ]; then
  if command -v jq > /dev/null 2>&1; then
    MANAGED_NAMES=" $(jq -r '[.formulae[].name, .casks[].name] | .[]' "$PACKAGES_JSON" 2>/dev/null | tr '\n' ' ') "
  else
    MANAGED_NAMES=" $(grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+"' "$PACKAGES_JSON" | sed -E 's/.*"([^"]+)"$/\1/' | tr '\n' ' ') "
  fi
fi

is_managed() {
  # A manifest name may be a tap path like "hashicorp/tap/terraform"; match the leaf too.
  case "$MANAGED_NAMES" in
    *" $1 "*) return 0 ;;
    *"/$1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# --- helpers -----------------------------------------------------------------

# Follow a symlink chain without relying on GNU `readlink -f` (BSD readlink on
# stock macOS only resolves one level). Prints the final real path.
follow_symlink() {
  local p="$1" target dir count=0
  while [ -L "$p" ] && [ "$count" -lt 40 ]; do
    target="$(readlink "$p")"
    case "$target" in
      /*) p="$target" ;;
      *)
        dir="$(cd -- "$(dirname -- "$p")" > /dev/null 2>&1 && pwd -P)"
        p="$dir/$target"
        ;;
    esac
    count=$((count + 1))
  done
  printf '%s\n' "$p"
}

# Render the symlink chain for display (a -> b -> c), capped for readability.
symlink_chain() {
  local p="$1" out="$1" target dir count=0
  while [ -L "$p" ] && [ "$count" -lt 40 ]; do
    target="$(readlink "$p")"
    case "$target" in
      /*) p="$target" ;;
      *)
        dir="$(cd -- "$(dirname -- "$p")" > /dev/null 2>&1 && pwd -P)"
        p="$dir/$target"
        ;;
    esac
    out="$out -> $p"
    count=$((count + 1))
  done
  printf '%s\n' "$out"
}

# Look up a macOS installer receipt that owns a path. Prints the pkgid or empty.
pkg_receipt() {
  command -v pkgutil > /dev/null 2>&1 || return 0
  pkgutil --file-info "$1" 2>/dev/null | awk -F': ' '/^pkgid:/{print $2; exit}'
}

# Globals set by classify(): MANAGER, DETAIL, REMOVE, EXPECTED.
classify() {
  local name="$1" real="$2" pkgid=""
  EXPECTED="" # what mac-bootstrap would use, when it has an opinion
  case "$name" in
    node) EXPECTED="volta (node@<defaultNode>)" ;;
  esac

  case "$real" in
    "$BREW_PREFIX"/* | /opt/homebrew/*)
      if command -v brew > /dev/null 2>&1 && brew list --formula 2>/dev/null | grep -qx "$name"; then
        MANAGER="homebrew-formula"
        REMOVE="brew uninstall $name"
      elif command -v brew > /dev/null 2>&1 && brew list --cask 2>/dev/null | grep -qx "$name"; then
        MANAGER="homebrew-cask"
        REMOVE="brew uninstall --cask $name"
      else
        MANAGER="homebrew"
        REMOVE="brew uninstall $name   # confirm whether it is a formula or cask"
      fi
      DETAIL="under $BREW_PREFIX"
      ;;
    "$PNPM_HOME_DIR"/*)
      if [ "$name" = "node" ] || [ "$name" = "npm" ] || [ "$name" = "npx" ]; then
        MANAGER="pnpm-env-node"
        DETAIL="Node provided by 'pnpm env', not Volta"
        REMOVE="pnpm env remove --global <version>   # then let bootstrap install Volta node"
      else
        MANAGER="pnpm-global"
        DETAIL="global package in $PNPM_HOME_DIR (bin name may differ from package name)"
        REMOVE="pnpm remove --global <package>   # e.g. cdk lives in package 'aws-cdk'"
      fi
      ;;
    "$VOLTA_HOME_DIR"/*)
      MANAGER="volta"
      DETAIL="Volta-managed"
      REMOVE="volta uninstall $name"
      ;;
    *)
      pkgid="$(pkg_receipt "$real")"
      if [ -n "$pkgid" ]; then
        MANAGER="macos-pkg"
        DETAIL="installer receipt: $pkgid"
        REMOVE="# remove per vendor docs, then forget the receipt: sudo pkgutil --forget $pkgid"
      elif [ -n "$NPM_GLOBAL_BIN" ] && [ "${real#"$NPM_GLOBAL_BIN"/}" != "$real" ]; then
        MANAGER="npm-global"
        DETAIL="global in $NPM_GLOBAL_BIN"
        REMOVE="npm uninstall -g $name"
      else
        case "$real" in
          "$HOME"/.local/bin/* | */pipx/*)
            MANAGER="pip/pipx"
            DETAIL="user-local Python install"
            REMOVE="pipx uninstall $name   # or pip uninstall $name"
            ;;
          /usr/bin/* | /bin/* | /sbin/* | /usr/sbin/*)
            MANAGER="system"
            DETAIL="OS-provided (SIP-protected); do not remove"
            REMOVE="# system binary — leave it alone"
            ;;
          *)
            MANAGER="manual/unknown"
            DETAIL="no receipt and no known manager owns $real"
            REMOVE="# likely a manual copy; remove by hand after confirming what put it there"
            ;;
        esac
      fi
      ;;
  esac
}

# Verdict relative to mac-bootstrap: managed-correct / migrate / unmanaged.
verdict() {
  local name="$1" manager="$2"
  # Node is managed by mac-bootstrap via Volta even though "node" is not a
  # manifest entry (the 'volta' formula + defaultNode provide it).
  if [ "$name" = "node" ]; then
    case "$manager" in
      volta) printf '%s' "OK" ;;
      *) printf '%s' "MIGRATE" ;;
    esac
    return
  fi
  if is_managed "$name"; then
    case "$manager" in
      homebrew*) printf '%s' "OK" ;;
      *) printf '%s' "MIGRATE" ;;
    esac
  else
    printf '%s' "UNMANAGED"
  fi
}

# --- report ------------------------------------------------------------------

# Escape a value for embedding in a JSON string. Backslash and double-quote are
# the only characters that appear in these fields (paths and shell commands).
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

JSON_ITEMS=""
add_json() {
  # add_json name status path real manager detail remove expected verdict
  local obj
  obj="$(printf '{"name":"%s","status":"%s","path":"%s","real":"%s","manager":"%s","detail":"%s","remove":"%s","expected":"%s","verdict":"%s"}' \
    "$(json_escape "$1")" "$(json_escape "$2")" "$(json_escape "$3")" "$(json_escape "$4")" \
    "$(json_escape "$5")" "$(json_escape "$6")" "$(json_escape "$7")" "$(json_escape "$8")" "$(json_escape "$9")")"
  if [ -z "$JSON_ITEMS" ]; then
    JSON_ITEMS="$obj"
  else
    JSON_ITEMS="$JSON_ITEMS,$obj"
  fi
}

if [ -z "$JSON" ]; then
  printf '== mac-bootstrap provenance audit ==\n'
  printf 'manifest : %s\n' "$PACKAGES_JSON"
  printf 'brew     : %s\n' "$BREW_PREFIX"
  printf 'pnpm     : %s\n' "$PNPM_HOME_DIR"
  printf 'volta    : %s\n\n' "$VOLTA_HOME_DIR"
fi

ok_list=""
migrate_list=""
unmanaged_list=""

for name in $TOOLS; do
  # Resolve how the shell sees the name first (could be alias/function/builtin).
  kind="$(type -t "$name" 2>/dev/null || echo "")"
  path="$(command -v "$name" 2>/dev/null || echo "")"

  [ -z "$JSON" ] && printf '%s\n' "--- $name ---"

  if [ -z "$path" ]; then
    if [ -n "$JSON" ]; then
      add_json "$name" "not-found" "" "" "" "" "" "" ""
    else
      printf '  status : NOT FOUND on PATH\n\n'
    fi
    continue
  fi

  if [ -z "$JSON" ] && [ "$kind" != "file" ] && [ -n "$kind" ]; then
    printf '  shell  : %s (not a plain binary)\n' "$kind"
  fi

  # Non-path resolutions (aliases/builtins) have nothing to classify by file.
  case "$path" in
    /*) : ;;
    *)
      if [ -n "$JSON" ]; then
        add_json "$name" "non-file" "$path" "" "$kind" "" "" "" ""
      else
        printf '  on PATH: %s\n\n' "$path"
      fi
      continue
      ;;
  esac

  real="$(follow_symlink "$path")"
  chain="$(symlink_chain "$path")"

  classify "$name" "$real"
  v="$(verdict "$name" "$MANAGER")"

  case "$v" in
    OK) ok_list="$ok_list $name" ;;
    MIGRATE) migrate_list="$migrate_list $name" ;;
    UNMANAGED) unmanaged_list="$unmanaged_list $name" ;;
  esac

  if [ -n "$JSON" ]; then
    add_json "$name" "found" "$path" "$real" "$MANAGER" "$DETAIL" "$REMOVE" "$EXPECTED" "$v"
    continue
  fi

  printf '  on PATH: %s\n' "$path"
  [ "$chain" != "$path" ] && printf '  resolves: %s\n' "$chain"
  printf '  manager: %s' "$MANAGER"
  [ -n "$DETAIL" ] && printf '  (%s)' "$DETAIL"
  printf '\n'
  [ -n "$EXPECTED" ] && printf '  expected: %s\n' "$EXPECTED"

  case "$v" in
    OK)
      printf '  verdict: OK — already managed the mac-bootstrap way\n'
      ;;
    MIGRATE)
      printf '  verdict: MIGRATE — managed by mac-bootstrap, but installed a different way\n'
      printf '  suggest: %s\n' "$REMOVE"
      ;;
    UNMANAGED)
      printf '  verdict: UNMANAGED — mac-bootstrap does not know this tool\n'
      printf '  suggest: keep as-is, OR add to packages.json, OR remove: %s\n' "$REMOVE"
      ;;
  esac
  printf '\n'
done

if [ -n "$JSON" ]; then
  printf '[%s]\n' "$JSON_ITEMS"
  exit 0
fi

# --- summary -----------------------------------------------------------------

printf '== summary ==\n'
printf 'OK (managed correctly):%s\n' "${ok_list:-  none}"
printf 'MIGRATE (old way -> rebootstrap):%s\n' "${migrate_list:-  none}"
printf 'UNMANAGED (decide: adopt or remove):%s\n' "${unmanaged_list:-  none}"
printf '\nNothing above was changed. Review the suggested commands before running any.\n'
