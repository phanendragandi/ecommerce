// deploy/ecosystem.config.js
//
// PM2 process definition for the QuickCart Express API on the Hostinger VPS.
// Copy/symlink is not required — run PM2 directly against this file from the
// server directory:
//
//   cd /var/www/quickcart/server
//   pm2 start ../deploy/ecosystem.config.js --env production
//   pm2 save
//
// SECRETS: PM2 does NOT read server/.env for you. The app already does
// (server/src/config.ts does `import 'dotenv/config'` before anything else),
// and dotenv resolves `.env` relative to `process.cwd()`. Since `cwd` below
// is the server directory, `server/.env` (chmod 600, never committed) is
// picked up automatically the moment the process starts — no extra PM2
// config needed. Do NOT put SUPABASE_SERVICE_ROLE_KEY / RAZORPAY_* secrets
// in this file; it is committed to the repo.
//
// Sizing: assumes the smallest Hostinger VPS tier (~1 shared vCPU / 1GB RAM,
// with Nginx + fail2ban + OS also resident). 1 cluster instance is the safe
// default. If you upgrade to a 2+ vCPU / 2GB+ RAM plan, bump `instances` to
// 2 (Node's single-thread-per-process model means >1 instance is how you use
// extra cores) and raise `max_memory_restart` proportionally.

module.exports = {
  apps: [
    {
      name: 'quickcart-api',
      script: 'dist/index.js',
      cwd: '/var/www/quickcart/server',
      exec_mode: 'cluster',
      instances: 1, // bump to 2 only on a 2GB+/2-vCPU VPS — see note above
      autorestart: true,
      watch: false,
      max_memory_restart: '450M', // restart a leaking worker before OOM-killing the box
      min_uptime: '30s', // a restart faster than this counts toward...
      max_restarts: 10, // ...this crash-loop cap before PM2 stops retrying
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // stdout/stderr — rotated by pm2-logrotate (installed in setup-vps.sh),
      // not written here to avoid growing an un-rotated file by default.
      time: true,
    },
  ],
};
