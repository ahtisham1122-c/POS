module.exports = {
  apps: [
    {
      name: 'noon-dairy-api',
      script: 'dist/src/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      // Graceful shutdown — wait up to 10 s for in-flight requests before killing
      kill_timeout: 10000,
      listen_timeout: 15000,
      // Restart delay prevents crash loops from hammering the DB
      restart_delay: 3000,
      max_restarts: 10,
      // Log to files so you can tail them with: pm2 logs noon-dairy-api
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
