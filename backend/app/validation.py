"""Strict input validation. Everything here ends up in a hostname, a git command,
a Docker label or a container environment, so we allow-list instead of block-list."""
import re

# DNS label friendly: lowercase letters, digits, single hyphens, no leading/trailing hyphen.
# The name becomes part of <name>-<owner_id>.localhost and of Traefik router names.
APP_NAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,30}$")

# Only public GitHub repos over https. No ssh, no file://, no other hosts, no
# credentials in the URL. GitHub owner names: alnum + hyphen, max 39 chars.
REPO_URL_RE = re.compile(
    r"^https://github\.com/(?P<owner>[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/"
    r"(?P<repo>[A-Za-z0-9._-]{1,100}?)(?:\.git)?/?$"
)

# Git branch names: a safe subset. Must not start with "-" (would look like a flag).
BRANCH_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._/-]{0,99}$")

ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
ENV_VALUE_MAX = 4096
ENV_MAX_VARS = 100


def parse_repo_url(url: str) -> tuple[str, str] | None:
    m = REPO_URL_RE.match(url.strip())
    if not m or m["repo"] in (".", ".."):
        return None
    return m["owner"], m["repo"]


def normalize_repo_url(url: str) -> str:
    """https://github.com/Foo/Bar.git/ -> https://github.com/foo/bar (for webhook matching)."""
    parsed = parse_repo_url(url)
    if parsed is None:
        return url.strip().lower()
    owner, repo = parsed
    return f"https://github.com/{owner}/{repo}".lower()


def valid_branch(branch: str) -> bool:
    return bool(BRANCH_RE.match(branch)) and ".." not in branch and not branch.endswith((".lock", "/"))
