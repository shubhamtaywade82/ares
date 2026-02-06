import crypto from "crypto";
import { env } from "../config/env.js";

export class DeltaSigner {
  static sign(
    method: string,
    path: string,
    timestamp: number,
    body: string = ""
  ): string {
    const payload = `${method}${timestamp}${path}${body}`;
    return crypto
      .createHmac("sha256", env.DELTA_API_SECRET)
      .update(payload)
      .digest("hex");
  }
}
