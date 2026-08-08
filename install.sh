#!/usr/bin/env bash
set -euo pipefail

REPO="akhileshsharma99/sf-tennis-cli"
INSTALL_DIR="/usr/local/bin"
BIN_NAME="tennis"

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)  PLATFORM="linux" ;;
  Darwin) PLATFORM="darwin" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH_SUFFIX="x64" ;;
  arm64|aarch64) ARCH_SUFFIX="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

ASSET="tennis-${PLATFORM}-${ARCH_SUFFIX}"
URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"

echo "Downloading ${ASSET}..."
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if ! curl -fSL "$URL" -o "$TMP"; then
  echo "Download failed. Check https://github.com/${REPO}/releases for available binaries." >&2
  exit 1
fi

chmod +x "$TMP"

# Alias wrappers rather than symlinks: a bun --compile binary reports its
# build-time name in argv, so it cannot tell how it was invoked.
write_alias() {
  local name="$1" sport="$2"
  printf '#!/bin/sh\nSF_DEFAULT_SPORT=%s exec "%s/%s" "$@"\n' \
    "$sport" "$INSTALL_DIR" "$BIN_NAME" > "$TMP_ALIAS"
  chmod +x "$TMP_ALIAS"
  if [ -w "$INSTALL_DIR" ]; then
    mv "$TMP_ALIAS" "${INSTALL_DIR}/${name}"
  else
    sudo mv "$TMP_ALIAS" "${INSTALL_DIR}/${name}"
  fi
}

TMP_ALIAS="$(mktemp)"
trap 'rm -f "$TMP" "$TMP_ALIAS"' EXIT

if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "${INSTALL_DIR}/${BIN_NAME}"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "$TMP" "${INSTALL_DIR}/${BIN_NAME}"
fi

write_alias pickleball pickleball
write_alias courts all

echo "Installed ${BIN_NAME}, pickleball, courts to ${INSTALL_DIR}"
"${INSTALL_DIR}/${BIN_NAME}" --version
