#!/usr/bin/env bash
# One-click setup + launch for Claude Containers (macOS / Linux).
#
# First run:  chmod +x start.sh  &&  ./start.sh
# (or just:   bash start.sh)
#
# It checks for Node.js (installing it via Homebrew on macOS if missing),
# installs the app's dependencies the first time, then launches the app.
set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  Claude Containers - setup & launch"
echo "============================================"
echo

# ---- 1. Make sure Node.js is available ----
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found on this system."
  echo
  if [ "$(uname)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    echo "Installing Node.js via Homebrew..."
    brew install node
  else
    echo "Please install Node.js LTS (18 or newer), then run this script again:"
    echo
    echo "  macOS  : download the LTS .pkg from https://nodejs.org"
    echo "           (or 'brew install node' if you use Homebrew)"
    echo "  Linux  : use your package manager, e.g. on Debian/Ubuntu:"
    echo "             curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
    echo "             sudo apt-get install -y nodejs"
    echo
    exit 1
  fi
fi

echo "Using Node $(node -v)"

# ---- 2. Install dependencies on first run ----
if [ ! -d node_modules ]; then
  echo
  echo "First run: installing dependencies with npm install..."
  echo "(this also downloads the Electron runtime and can take a minute)"
  if ! npm install; then
    echo
    echo "npm install failed."
    echo "If it failed downloading Electron specifically, a proxy/firewall may"
    echo "be blocking GitHub's release host. Try an unrestricted network, or set"
    echo "ELECTRON_MIRROR before retrying (see the README's proxy note)."
    exit 1
  fi
else
  echo "Dependencies already installed."
fi

# ---- 3. Launch ----
echo
echo "Launching Claude Containers..."
exec npm start
