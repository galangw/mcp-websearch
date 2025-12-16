module.exports = {
  apps: [{
    name: 'mcp-websearch',
    script: './index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      MCP_TRANSPORT: 'http',
      PORT: 3000,
      SEARCHAPI_KEY: 'your-api-key-here'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M'
  }]
};
