import axios, { AxiosInstance } from "axios";
import { z } from "zod";
import { env } from "../config/env.js";
import { DeltaSigner } from "./signer.js";
import { DELTA_CONFIG } from "../config/delta.js";

type RequestOptions = {
  timeoutMs?: number;
};

type CandleRequestOptions = {
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
};

export class DeltaRestClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: env.DELTA_BASE_URL,
      timeout: DELTA_CONFIG.restTimeoutMs,
    });
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: object,
    schema?: z.ZodSchema<T>,
    authRequired = true,
    options?: RequestOptions
  ): Promise<T> {
    const [pathOnly = path, queryString = ""] = path.split("?");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (authRequired) {
      const timestamp = Math.floor(Date.now() / 1000);
      const bodyString = body ? JSON.stringify(body) : "";
      const signature = DeltaSigner.sign(
        method,
        pathOnly,
        timestamp,
        bodyString,
        queryString ? `?${queryString}` : ""
      );
      headers["api-key"] = env.DELTA_API_KEY;
      headers["timestamp"] = String(timestamp);
      headers["signature"] = signature;
    }

    let res;
    try {
      res = await this.client.request({
        method,
        url: path,
        data: body,
        headers,
        ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        const code = error.code ? ` ${error.code}` : "";
        const timeout = error.config?.timeout ? ` timeout=${error.config.timeout}` : "";
        const details = data ? JSON.stringify(data) : error.message;
        throw new Error(`Delta API ${status ?? "error"}${code}${timeout}: ${details}`);
      }
      throw error;
    }

    if (!schema) return res.data;

    return schema.parse(res.data);
  }

  // ---------- ENDPOINTS ----------

  getProducts(params?: {
    contract_types?: string;
    states?: string;
    after?: string;
    before?: string;
    page_size?: number;
    expiry?: string;
  }) {
    const search = new URLSearchParams();
    if (params?.contract_types) search.set("contract_types", params.contract_types);
    if (params?.states) search.set("states", params.states);
    if (params?.after) search.set("after", params.after);
    if (params?.before) search.set("before", params.before);
    if (params?.page_size !== undefined) search.set("page_size", String(params.page_size));
    if (params?.expiry) search.set("expiry", params.expiry);
    const qs = search.toString();

    return this.request(
      "GET",
      qs ? `/v2/products?${qs}` : "/v2/products",
      undefined,
      z.object({ result: z.array(z.any()) }),
      false
    );
  }

  getProductBySymbol(symbol: string) {
    return this.request(
      "GET",
      `/v2/products/${symbol}`,
      undefined,
      z.object({ result: z.any() }),
      false
    );
  }

  getTickers(params?: {
    contract_types?: string;
    underlying_asset_symbols?: string;
    expiry_date?: string;
  }) {
    const search = new URLSearchParams();
    if (params?.contract_types) search.set("contract_types", params.contract_types);
    if (params?.underlying_asset_symbols) {
      search.set("underlying_asset_symbols", params.underlying_asset_symbols);
    }
    if (params?.expiry_date) search.set("expiry_date", params.expiry_date);
    const qs = search.toString();

    return this.request(
      "GET",
      qs ? `/v2/tickers?${qs}` : "/v2/tickers",
      undefined,
      z.object({ result: z.array(z.any()) }),
      false
    );
  }

  getBalances() {
    return this.request(
      "GET",
      "/v2/wallet/balances",
      undefined,
      z.object({ result: z.array(z.any()) })
    );
  }

  getPositions() {
    return this.request(
      "GET",
      "/v2/positions",
      undefined,
      z.object({ result: z.array(z.any()) })
    );
  }

  placeOrder(payload: object) {
    return this.request(
      "POST",
      "/v2/orders",
      payload,
      z.object({ result: z.any() })
    );
  }

  cancelOrder(orderId: string) {
    return this.request(
      "DELETE",
      `/v2/orders/${orderId}`,
      undefined,
      z.object({ success: z.boolean() })
    );
  }

  getCandles(
    symbol: string,
    resolution: string,
    start: number,
    end: number,
    limit = 200,
    options?: CandleRequestOptions
  ) {
    const normalizedResolution = resolution;
    const retries = options?.retries ?? 3;
    const baseDelay = options?.retryBaseDelayMs ?? 1000;
    const maxDelay = options?.retryMaxDelayMs ?? 8000;

    const attemptRequest = async () =>
      this.request(
        "GET",
        `/v2/history/candles?symbol=${symbol}&resolution=${normalizedResolution}&start=${start}&end=${end}&limit=${limit}`,
        undefined,
        z.object({ result: z.array(z.any()) }),
        false,
        options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : undefined
      );

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    return (async () => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
          return await attemptRequest();
        } catch (error) {
          lastError = error;
          if (attempt >= retries) break;
          const backoff = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
          const jitter = Math.floor(Math.random() * 250);
          await sleep(backoff + jitter);
        }
      }
      throw lastError;
    })();
  }
}
