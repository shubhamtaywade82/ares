import { DeltaRestClient } from "../delta/rest.client.js";

export async function fetchLivePerpetualFutures(rest: DeltaRestClient) {
  const res = await rest.getProducts({
    contract_types: "perpetual_futures",
    states: "live",
  });

  return res.result.filter(
    (p: { trading_status?: string }) => p.trading_status === "operational"
  );
}
