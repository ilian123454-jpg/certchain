import { config } from "./config";
import { createApp } from "./app";
import { migrate } from "./db/pool";

async function main() {
  await migrate();
  createApp().listen(config.port, () => {
    console.log(`CertChain API слуша на http://localhost:${config.port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
