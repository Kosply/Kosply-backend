/**
 * @title PM2 process configuration
 * @notice Defines the staging and main processes for Kosply server.
 * @dev Staging (:3001, fork, 1 instance) is the playground: test anything
 * @dev here first. Main (:3000, cluster, max instances) serves real users
 * @dev and must only be restarted after staging passes.
 */
module.exports = {
  apps: [
    // STAGING: test anything here before promoting to main. Runs alongside main on a different port.
    {
      name: 'kosply-server-staging',
      script: './lib/server/server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'staging',
        PORT: 3001,
        CORS_ORIGIN: '*',
      },
    },
    // MAIN: serves real users, must stay stable. Never test directly here.
    {
      name: 'kosply-server-main',
      script: './lib/server/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        CORS_ORIGIN: '*',
      },
    },
  ],
};
