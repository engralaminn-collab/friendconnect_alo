module.exports = {
  apps: [
    {
      // ── Main FriendConnect App ──
      name: 'friendconnect',
      script: '.next/standalone/server.js',
      cwd: '/home/aloedu/friendconnect',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3014,
        HOSTNAME: '0.0.0.0',
      },
      out_file: './logs/app-out.log',
      error_file: './logs/app-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      listen_timeout: 15000,
    },
    {
      // ── Socket / Realtime Server ──
      name: 'friendconnect-socket',
      script: 'socket-server.js',
      cwd: '/home/aloedu/friendconnect',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '256M',
      watch: false,
      env: {
        NODE_ENV: 'production',
        SOCKET_PORT: 3114,
      },
      out_file: './logs/socket-out.log',
      error_file: './logs/socket-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
    },
  ],
}
