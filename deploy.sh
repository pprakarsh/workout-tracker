#!/usr/bin/env bash
# Publish this folder to GitHub Pages.
#
#   1. gh auth login        (once - interactive, needs a browser)
#   2. ./deploy.sh          (creates the repo if needed, pushes, enables Pages)
#
# Re-run it any time to ship an update.
#
# Kept deliberately ASCII-only: macOS ships bash 3.2, which folds the bytes of a
# non-ASCII character that follows a variable straight into the variable name, so
# "$BRANCH..." with a Unicode ellipsis became an unbound-variable error.
set -euo pipefail

REPO_NAME="${REPO_NAME:-workout-tracker}"
EXPECTED_OWNER="${EXPECTED_OWNER:-pprakarsh}"
BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"

cd "$(dirname "$0")"

command -v gh >/dev/null || { echo "gh is not installed: brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Not logged in yet. Run: gh auth login"; exit 1; }

USER_LOGIN="$(gh api user --jq .login)"

# This machine also has a work git identity, so make sure gh is pointed at the
# intended account before creating anything.
if [ -n "${EXPECTED_OWNER}" ] && [ "${USER_LOGIN}" != "${EXPECTED_OWNER}" ]; then
  echo "gh is authenticated as '${USER_LOGIN}', not '${EXPECTED_OWNER}'."
  echo "Switch with:  gh auth switch --user ${EXPECTED_OWNER}"
  echo "Or override:  EXPECTED_OWNER=${USER_LOGIN} ./deploy.sh"
  exit 1
fi

COMMIT_EMAIL="$(git log -1 --format=%ae)"
echo "GitHub user : ${USER_LOGIN}"
echo "Repo        : ${USER_LOGIN}/${REPO_NAME}"
echo "Branch      : ${BRANCH}"
echo "Commits as  : $(git log -1 --format='%an <%ae>')"
echo

case "${COMMIT_EMAIL}" in
  *amazon.com)
    echo "Refusing to publish: the latest commit is authored with ${COMMIT_EMAIL}."
    echo "Set the personal identity first:"
    echo "  git config user.email you@personal.example"
    exit 1
    ;;
esac

# GitHub Pages on the free plan serves from a public repository.
if gh repo view "${USER_LOGIN}/${REPO_NAME}" >/dev/null 2>&1; then
  echo "Repo already exists - pushing to it."
  git remote get-url origin >/dev/null 2>&1 \
    || git remote add origin "https://github.com/${USER_LOGIN}/${REPO_NAME}.git"
  git push -u origin "${BRANCH}"
else
  echo "Creating a PUBLIC repo and pushing ${BRANCH} ..."
  gh repo create "${REPO_NAME}" --public --source=. --remote=origin --push
fi

echo
echo "Enabling GitHub Pages ..."
if gh api "repos/${USER_LOGIN}/${REPO_NAME}/pages" >/dev/null 2>&1; then
  echo "Pages already configured."
else
  gh api --method POST "repos/${USER_LOGIN}/${REPO_NAME}/pages" \
    -f "source[branch]=${BRANCH}" -f "source[path]=/" >/dev/null
  echo "Pages enabled."
fi

URL="https://${USER_LOGIN}.github.io/${REPO_NAME}/"
echo
echo "Done. The first Pages build takes a minute or two."
echo "  ${URL}"
echo
echo "On your iPhone: open that URL in Safari -> Share -> Add to Home Screen."
