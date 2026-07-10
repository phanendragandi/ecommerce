#!/usr/bin/env bash
#
# deploy/setup-vps.sh — one-time(ish) provisioning for the QuickCart Express
# API on a fresh Ubuntu Hostinger VPS. Written to be safe to re-run: each
# step checks current state before changing anything, so re-running after a
# partial failure (or to pick up a later revision of this script) should not
# break an already-provisioned box.
#
# IMPORTANT — HOSTING TYPE CHECK:
#   This script requires root/sudo, a real Linux kernel, systemd, and the
#   ability to bind arbitrary ports and run long-lived background processes
#   (PM2). If what you were sold is Hostinger SHARED hosting (cPanel/hPanel
#   "Web Hosting" plans, no SSH root access, no systemd) it CANNOT run a
#   persistent Node/Express API — shared hosting is PHP/CGI-style
#   request-per-invocation only. You need a Hostinger **VPS** plan
#   (KVM/VPS tier) with root SSH access for this deploy target. If you are
#   not sure which you bought, stop and check the Hostinger panel for an
#   "SSH Access" / "VPS" section with a root password before proceeding.
#
# USAGE (as root, once you have SSH'd into the fresh VPS):
#   scp deploy/setup-vps.sh root@<VPS_IP>:/root/setup-vps.sh
#   ssh root@<VPS_IP>
#   chmod +x /root/setup-vps.sh
#   DEPLOY_USER=deploy REPO_URL=git@github.com:<you>/quickcart.git ./setup-vps.sh
#
# Placeholders you must fill in (env vars, or edit the defaults below):
#   DEPLOY_USER   — non-root Linux user that will own the app + run PM2 (default: deploy)
#   REPO_URL      — git remote to clone, e.g. git@github.com:<org>/quickcart.git
#   APP_DIR       — where the repo lives (default: /var/www/quickcart)
#   GIT_BRANCH    — branch to deploy (default: main)
#
# This script does NOT run certbot (needs a live DNS record first — see
# deploy/RUNBOOK.md) and does NOT write server/.env (secrets — do that by
# hand, see RUNBOOK.md "server/.env" step).

set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
REPO_URL="${REPO_URL:-<REPO_URL>}"          # e.g. git@github.com:<org>/quickcart.git
APP_DIR="${APP_DIR:-/var/www/quickcart}"
GIT_BRANCH="${GIT_BRANCH:-main}"

if [[ $EUID -ne 0 ]]; then
  echo "Run this script as root (sudo -i, then run it)." >&2
  exit 1
fi

echo "=== [1/11] apt update + base packages ==="
apt-get update -y
apt-get install -y curl git ufw fail2ban nginx ca-certificates gnupg python3-certbot-nginx

echo "=== [2/11] create non-root deploy user (idempotent) ==="
if id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "User '$DEPLOY_USER' already exists, skipping useradd."
else
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  usermod -aG sudo "$DEPLOY_USER"
  echo "Created user '$DEPLOY_USER'."
fi

echo "=== [3/11] SSH key auth for $DEPLOY_USER + disable password login ==="
DEPLOY_HOME="/home/$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
if [[ ! -f "$DEPLOY_HOME/.ssh/authorized_keys" ]]; then
  touch "$DEPLOY_HOME/.ssh/authorized_keys"
fi
chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh/authorized_keys"
cat <<'NOTE'
  >> ACTION REQUIRED before you log out of the root session: <<
  Append your public SSH key to:
    /home/'"$DEPLOY_USER"'/.ssh/authorized_keys
  e.g. from your local machine:
    ssh-copy-id -i ~/.ssh/<your_key>.pub deploy@<VPS_IP>
  Verify `ssh deploy@<VPS_IP>` works with the KEY (no password prompt)
  BEFORE disabling password auth below, or you can lock yourself out.
NOTE
read -r -p "Have you confirmed key-based SSH login for '$DEPLOY_USER' works? [y/N] " confirm
if [[ "${confirm:-N}" =~ ^[Yy]$ ]]; then
  sed -i \
    -e 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' \
    -e 's/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' \
    /etc/ssh/sshd_config
  systemctl reload ssh || systemctl reload sshd
  echo "Password login disabled; root login restricted to key auth."
else
  echo "Skipped disabling password auth — re-run this script (or apply the sed lines manually) once key auth is confirmed."
fi

echo "=== [4/11] UFW firewall: allow only 22, 80, 443 ==="
ufw allow 22/tcp comment 'ssh'
ufw allow 80/tcp comment 'http'
ufw allow 443/tcp comment 'https'
ufw --force enable
ufw status verbose

echo "=== [5/11] fail2ban: default sshd jail ==="
if [[ ! -f /etc/fail2ban/jail.local ]]; then
  cat <<'EOF' >/etc/fail2ban/jail.local
[sshd]
enabled = true
port = 22
backend = systemd
maxretry = 5
bantime = 1h
findtime = 10m
EOF
  echo "Wrote /etc/fail2ban/jail.local (sshd jail)."
else
  echo "/etc/fail2ban/jail.local already exists, leaving it as-is."
fi
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "=== [6/11] Node 20 via NodeSource (system-wide, not nvm — simpler for a single-app VPS + PM2 startup) ==="
if command -v node >/dev/null 2>&1 && [[ "$(node -v)" == v20* ]]; then
  echo "Node 20 already installed ($(node -v)), skipping."
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "=== [7/11] PM2 (global) ==="
if command -v pm2 >/dev/null 2>&1; then
  echo "PM2 already installed ($(pm2 -v)), skipping npm i -g."
else
  npm install -g pm2
fi

echo "=== [8/11] app directory + clone/update repo as $DEPLOY_USER ==="
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$(dirname "$APP_DIR")"
if [[ -d "$APP_DIR/.git" ]]; then
  echo "$APP_DIR already a git checkout — fetching latest instead of cloning."
  sudo -u "$DEPLOY_USER" git -C "$APP_DIR" fetch origin
  sudo -u "$DEPLOY_USER" git -C "$APP_DIR" checkout "$GIT_BRANCH"
  sudo -u "$DEPLOY_USER" git -C "$APP_DIR" pull origin "$GIT_BRANCH"
else
  if [[ "$REPO_URL" == "<REPO_URL>" ]]; then
    echo "REPO_URL not set — skipping clone. Re-run with REPO_URL=git@github.com:<org>/quickcart.git" >&2
  else
    sudo -u "$DEPLOY_USER" git clone --branch "$GIT_BRANCH" "$REPO_URL" "$APP_DIR"
  fi
fi

echo "=== [9/11] build /server ==="
if [[ -d "$APP_DIR/server" ]]; then
  sudo -u "$DEPLOY_USER" bash -c "cd '$APP_DIR/server' && npm ci && npm run build"
  echo "Built server/dist. NOTE: server/.env does not exist yet — the app will"
  echo "fail to start (config.ts throws on missing required vars) until you"
  echo "create it by hand per deploy/RUNBOOK.md, chmod 600."
else
  echo "$APP_DIR/server not found yet (repo not cloned?) — skipping build step."
fi

echo "=== [10/11] pm2 startup (boot persistence) ==="
# `pm2 startup` prints a systemd command that must be run as root — capture
# and execute it automatically so this step is truly idempotent/unattended.
STARTUP_CMD="$(sudo -u "$DEPLOY_USER" pm2 startup systemd -u "$DEPLOY_USER" --hp "$DEPLOY_HOME" | tail -n1)"
if [[ "$STARTUP_CMD" == sudo* ]]; then
  eval "$STARTUP_CMD"
  echo "pm2 startup registered."
else
  echo "Could not auto-detect the pm2 startup command; run 'pm2 startup' manually as $DEPLOY_USER and follow its printed instructions."
fi

echo "=== [11/11] pm2-logrotate module (log rotation, see RUNBOOK.md Ops section) ==="
if sudo -u "$DEPLOY_USER" pm2 list 2>/dev/null | grep -q pm2-logrotate; then
  echo "pm2-logrotate already installed, skipping."
else
  sudo -u "$DEPLOY_USER" pm2 install pm2-logrotate
  sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:max_size 10M
  sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:retain 14
  sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:compress true
fi

cat <<EOF

=== Base provisioning done. Remaining MANUAL steps (see deploy/RUNBOOK.md): ===
  1. Create $APP_DIR/server/.env (chmod 600) with real secrets.
  2. Point DNS: A record for the API subdomain -> this VPS's IP.
  3. Install the Nginx site (deploy/nginx-quickcart-api.conf) and reload nginx.
  4. Run certbot for the API domain (HTTP-01 needs the DNS record from #2 live first).
  5. As $DEPLOY_USER: cd $APP_DIR/server && pm2 start ../deploy/ecosystem.config.js --env production && pm2 save.
EOF
