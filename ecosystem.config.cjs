// FriendConnect — PM2 Ecosystem Configuration
// Usage: pm2 startOrReload ecosystem.config.cjs --env production
// Docs: https://pm2.keymetrics.io/docs/usage/application-declaration/

module.exports = {
  apps: [
    {
      name: 'friendconnect-app',
      script: '.next/standalone/server.js',
      cwd: '/home/aloedu/friendconnect',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      instances: 1, // Increase for multi-core (use cluster mode)
      autorestart: true,
      max_memory_restart: '512M',
      watch: false,
      out_file: './logs/app-out.log',
      error_file: './logs/app-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000, // Graceful shutdown
      listen_timeout: 10000,
    },
    {
      name: 'friendconnect-realtime',
      script: 'mini-services/realtime/index.ts',
      cwd: '/home/aloedu/friendconnect',
      interpreter: 'bun',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1, // For multi-process, add @socket.io/redis-adapter + Redis
      autorestart: true,
      max_memory_restart: '256M',
      watch: false,
      out_file: './logs/realtime-out.log',
      error_file: './logs/realtime-error.log',
      merge_logs: true,
      kill_timeout: 5000,
    },
    {
      name: 'friendconnect-worker',
      script: 'mini-services/worker/index.ts',
      cwd: '/home/aloedu/friendconnect',
      interpreter: 'bun',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M',
      watch: false,
      out_file: './logs/worker-out.log',
      error_file: './logs/worker-error.log',
      kill_timeout: 10000, // Workers need more time to finish jobs
    },
  ],
}
