import axios, { AxiosInstance } from "axios";
import { z } from "zod";
import { env } from "../config/env.js";
import { DeltaSigner } from "./signer.js";
import { DELTA_CONFIG } from "../config/delta.js";

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
    schema?: z.ZodSchema<T>
  ): Promise<T> {
    const timestamp = Date.now();
    const bodyString = body ? JSON.stringify(body) : "";

    const signature = DeltaSigner.sign(
      method,
      path,
      timestamp,
      bodyString
    );

    const res = await this.client.request({
      method,
      url: path,
      data: body,
      headers: {
        "api-key": env.DELTA_API_KEY,
        "timestamp": timestamp,
        "signature": signature,
        "Content-Type": "application/json",
      },
    });

    if (!schema) return res.data;

    return schema.parse(res.data);
  }

  // ---------- ENDPOINTS ----------

  getProducts() {
    return this.request(
      "GET",
      "/v2/products",
      undefined,
      z.object({ result: z.array(z.any()) })
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

  getCandles(symbol: string, resolution: string, limit = 200) {
    return this.request(
      "GET",
      `/v2/history/candles?symbol=${symbol}&resolution=${resolution}&limit=${limit}`,
      undefined,
      z.object({ result: z.array(z.any()) })
    );
  }
}
