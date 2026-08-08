#!/usr/bin/env bash
set -euo pipefail

REPO="akhileshsharma99/sf-tennis-cli"
INSTALL_DIR="/usr/local/bin"
BIN_NAME="tennis"

# A `bun link`ed checkout answers to the same name. Installing alongside it
# gives you two of these that drift apart, with nothing to tell them apart.
EXISTING="$(command -v "$BIN_NAME" 2>/dev/null || true)"
if [ -n "$EXISTING" ] && [ "$EXISTING" != "${INSTALL_DIR}/${BIN_NAME}" ]; then
  echo "Warning: ${BIN_NAME} is already installed at ${EXISTING}" >&2
  echo "Installing to ${INSTALL_DIR}/${BIN_NAME} will create a second copy." >&2
  echo "If that one is a dev checkout (bun link), 'bun unlink' it first." >&2
  printf 'Continue anyway? [y/N] ' >&2
  read -r reply < /dev/tty || reply=""
  case "$reply" in
    [yY]*) ;;
    *) echo "Aborted." >&2; exit 1 ;;
  esac
fi

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
  local name="$1" sport="$2" tmp
  tmp="$(mktemp)"
  printf '#!/bin/sh\nSF_DEFAULT_SPORT=%s exec "%s/%s" "$@"\n' \
    "$sport" "$INSTALL_DIR" "$BIN_NAME" > "$tmp"
  chmod +x "$tmp"
  if [ -w "$INSTALL_DIR" ]; then
    mv "$tmp" "${INSTALL_DIR}/${name}"
  else
    sudo mv "$tmp" "${INSTALL_DIR}/${name}"
  fi
}

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
