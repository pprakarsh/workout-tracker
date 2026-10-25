#!/usr/bin/env bash
# Publish this folder to GitHub Pages.
#
#   1. gh auth login        (once — interactive, needs a browser)
#   2. ./deploy.sh          (creates the repo if needed, pushes, enables Pages)
#
# Re-run it any time to ship an update.
set -euo pipefail

REPO_NAME="${REPO_NAME:-workout-tracker}"
BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"

cd "$(dirname "$0")"

command -v gh >/dev/null || { echo "gh is not installed: brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Not logged in yet. Run: gh auth login"; exit 1; }

USER_LOGIN="$(gh api user --jq .login)"
echo "GitHub user : $USER_LOGIN"
echo "Repo        : $USER_LOGIN/$REPO_NAME"
echo "Branch      : $BRANCH"
echo

# GitHub Pages on the free plan serves from a public repository.
if gh repo view "$USER_LOGIN/$REPO_NAME" >/dev/null 2>&1; then
  echo "Repo already exists — pushing to it."
  git remote get-url origin >/dev/null 2>&1 \
    || git remote add origin "https://github.com/$USER_LOGIN/$REPO_NAME.git"
  git push -u origin "$BRANCH"
else
  echo "Creating a PUBLIC repo and pushing $BRANCH…"
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --push
fi

echo
echo "Enabling GitHub Pages…"
if gh api "repos/$USER_LOGIN/$REPO_NAME/pages" >/dev/null 2>&1; then
  echo "Pages already configured."
else
  gh api --method POST "repos/$USER_LOGIN/$REPO_NAME/pages" \
    -f "source[branch]=$BRANCH" -f "source[path]=/" >/dev/null
  echo "Pages enabled."
fi

URL="https://$USER_LOGIN.github.io/$REPO_NAME/"
echo
echo "Done. First build takes a minute or two."
echo "  $URL"
echo
echo "On your iPhone: open that URL in Safari -> Share -> Add to Home Screen."
