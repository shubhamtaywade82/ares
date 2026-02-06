import { DeltaRestClient } from "./delta/rest.client.js";
import { DeltaWsClient } from "./delta/ws.client.js";

const rest = new DeltaRestClient();

const ws = new DeltaWsClient(
  (msg: { type?: string }) => {
    // routed later to candle builder / order store
    console.log("WS:", msg.type ?? "unknown");
  },
  () => {
    console.error("KILL SWITCH TRIGGERED");
    process.exit(1);
  }
);

async function bootstrap() {
  await rest.getProducts(); // sanity check auth
  ws.connect();
}

bootstrap().catch((e) => {
  console.error("BOOT FAILURE", e);
  process.exit(1);
});
