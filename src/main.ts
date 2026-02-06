import { DeltaRestClient } from "./delta/rest.client.js";
import { DeltaWsClient } from "./delta/ws.client.js";
import { MarketCache } from "./market/market.cache.js";
import { bootstrapMarket } from "./market/bootstrap.js";
import { SYMBOLS } from "./market/symbol.registry.js";

type TickerMessage = {
  type?: string;
  price?: number | string;
  volume?: number | string;
  timestamp?: number;
};

const rest = new DeltaRestClient();
const market = new MarketCache();

const ws = new DeltaWsClient(
  (msg: TickerMessage) => {
    if (msg.type === "ticker") {
      const price = Number(msg.price);
      const volume = Number(msg.volume);
      const timestamp = Number(msg.timestamp);

      if (Number.isFinite(price) && Number.isFinite(volume) && Number.isFinite(timestamp)) {
        market.ingestTick(price, volume, timestamp);
      }
    }
  },
  () => {
    console.error("KILL SWITCH TRIGGERED");
    process.exit(1);
  }
);

async function bootstrap() {
  const symbol = SYMBOLS.BTC_USDT.symbol;
  await bootstrapMarket(rest, market, symbol);
  ws.connect();
}

bootstrap().catch((e) => {
  console.error("BOOT FAILURE", e);
  process.exit(1);
});
