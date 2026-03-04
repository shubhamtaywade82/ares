module.exports = {
  apps: [
    {
      name: "ares-bot",
      script: "node_modules/.bin/tsx",
      args: "-r dotenv/config src/main.ts",
      watch: false,
      autorestart: true,
      restart_delay: 5000, // 5 seconds wait before restart to avoid hitting rate limits
      max_restarts: 50,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        TRADING_MODE: "paper"
      },
      env_live: {
        NODE_ENV: "production",
        TRADING_MODE: "live"
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true
    }
  ]
};
