#!/usr/bin/env bash
set -euo pipefail

# Enables Git settings that significantly reduce repeated merge conflict pain.
# Run once per machine:
#   ./scripts/setup-git-conflict-helpers.sh

git config --global rerere.enabled true
git config --global rerere.autoupdate true
git config --global pull.rebase true
git config --global rebase.autoStash true
git config --global merge.conflictstyle zdiff3

echo "Configured Git conflict helpers globally:"
echo "  rerere.enabled=true"
echo "  rerere.autoupdate=true"
echo "  pull.rebase=true"
echo "  rebase.autoStash=true"
echo "  merge.conflictstyle=zdiff3"
