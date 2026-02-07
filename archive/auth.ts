import crypto from 'crypto';

/**
 * Generate signature for Delta Exchange API authentication
 * Signature = HMAC-SHA256(secret, method + timestamp + path + query_string + body)
 */
export function generateSignature(
  secret: string,
  method: string,
  timestamp: string,
  path: string,
  queryString: string = '',
  body: string = ''
): string {
  const message = method + timestamp + path + queryString + body;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(message);
  return hmac.digest('hex');
}

/**
 * Generate timestamp in seconds
 */
export function getTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

/**
 * Create authentication headers for Delta Exchange API
 */
export function createAuthHeaders(
  apiKey: string,
  apiSecret: string,
  method: string,
  path: string,
  queryString: string = '',
  body: string = ''
): Record<string, string> {
  const timestamp = getTimestamp();
  const signature = generateSignature(apiSecret, method, timestamp, path, queryString, body);

  return {
    'api-key': apiKey,
    'signature': signature,
    'timestamp': timestamp,
    'User-Agent': 'delta-scalper-nodejs',
    'Content-Type': 'application/json'
  };
}
