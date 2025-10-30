module.exports = {
  apps : [{
    name: 'LoadTesting',
    script: 'server.js',
    instances : '1',
    max_memory_restart: '5000M',
    exec_mode : "cluster",
    env: {
        "NODE_ENV": "production"
    }
  }]
};
