import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DEPLOYMENT_FILE: "/tmp/certchain-test-deployment.json",
      STORAGE_DIR: "/tmp/certchain-test-storage",
      TX_TIMEOUT_MS: "8000",
      ADMIN_PRIVATE_KEY: "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
    },
  },
});
