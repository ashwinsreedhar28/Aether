#!/bin/bash
# Install viewer CLI globally via symlink
# Creates /usr/local/bin/viewer -> this directory's viewer script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYMLINK_PATH="/usr/local/bin/viewer"

echo "Installing viewer CLI..."
echo "  Source: $SCRIPT_DIR/viewer"
echo "  Target: $SYMLINK_PATH"

# Remove existing symlink or file if present
if [ -L "$SYMLINK_PATH" ] || [ -e "$SYMLINK_PATH" ]; then
  echo "Removing existing $SYMLINK_PATH"
  sudo rm "$SYMLINK_PATH"
fi

# Create symlink (requires sudo for /usr/local/bin)
sudo ln -s "$SCRIPT_DIR/viewer" "$SYMLINK_PATH"

if [ $? -ne 0 ]; then
  echo ""
  echo "Failed to create viewer symlink. You may need to run with sudo."
  exit 1
fi

# Install viewer-ctl CLI
CTL_SYMLINK="/usr/local/bin/viewer-ctl"
echo ""
echo "Installing viewer-ctl CLI..."
echo "  Source: $SCRIPT_DIR/viewer-ctl"
echo "  Target: $CTL_SYMLINK"

if [ -L "$CTL_SYMLINK" ] || [ -e "$CTL_SYMLINK" ]; then
  echo "Removing existing $CTL_SYMLINK"
  sudo rm "$CTL_SYMLINK"
fi

sudo ln -s "$SCRIPT_DIR/viewer-ctl" "$CTL_SYMLINK"

if [ $? -eq 0 ]; then
  echo ""
  echo "Success! You can now run:"
  echo "  viewer .           - Launch viewer"
  echo "  viewer-ctl status  - Control a running viewer"
else
  echo ""
  echo "Failed to create viewer-ctl symlink. You may need to run with sudo."
  exit 1
fi
