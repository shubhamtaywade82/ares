import axios, { AxiosInstance } from 'axios';
import { createAuthHeaders } from '../utils/auth';
import { logger } from '../utils/logger';
import {
  ApiResponse,
  Order,
  Position,
  Ticker,
  L2Orderbook,
  Trade,
  DeltaConfig
} from '../types';

export class DeltaRestClient {
  private client: AxiosInstance;
  private config: DeltaConfig;

  constructor(config: DeltaConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('API Error:', {
          url: error.config?.url,
          status: error.response?.status,
          data: error.response?.data
        });
        throw error;
      }
    );
  }

  /**
   * Get ticker for a specific product
   */
  async getTicker(symbol: string): Promise<Ticker> {
    const path = `/v2/tickers/${symbol}`;
    const response = await this.client.get<ApiResponse<Ticker>>(path);
    
    if (!response.data.success) {
      throw new Error(`Failed to get ticker: ${response.data.error?.code}`);
    }
    
    return response.data.result!;
  }

  /**
   * Get L2 orderbook
   */
  async getOrderbook(productId: number, depth: number = 20): Promise<L2Orderbook> {
    const path = `/v2/l2orderbook/${productId}`;
    const queryString = `?depth=${depth}`;
    const response = await this.client.get<ApiResponse<L2Orderbook>>(
      `${path}${queryString}`
    );
    
    if (!response.data.success) {
      throw new Error(`Failed to get orderbook: ${response.data.error?.code}`);
    }
    
    return response.data.result!;
  }

  /**
   * Get recent trades
   */
  async getTrades(productId: number, limit: number = 50): Promise<Trade[]> {
    const path = `/v2/products/${productId}/trades`;
    const queryString = `?limit=${limit}`;
    const response = await this.client.get<ApiResponse<Trade[]>>(
      `${path}${queryString}`
    );
    
    if (!response.data.success) {
      throw new Error(`Failed to get trades: ${response.data.error?.code}`);
    }
    
    return response.data.result!;
  }

  /**
   * Place a new order
   */
  async placeOrder(order: Order): Promise<Order> {
    const path = '/v2/orders';
    const method = 'POST';
    const body = JSON.stringify(order);
    
    const headers = createAuthHeaders(
      this.config.apiKey,
      this.config.apiSecret,
      method,
      path,
      '',
      body
    );

    logger.info('Placing order:', order);

    const response = await this.client.post<ApiResponse<Order>>(
      path,
      order,
      { headers }
    );

    if (!response.data.success) {
      throw new Error(
        `Failed to place order: ${response.data.error?.code} - ${JSON.stringify(response.data.error?.context)}`
      );
    }

    logger.info('Order placed successfully:', response.data.result);
    return response.data.result!;
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: number, productId: number): Promise<Order> {
    const path = '/v2/orders';
    const method = 'DELETE';
    const body = JSON.stringify({ id: orderId, product_id: productId });
    
    const headers = createAuthHeaders(
      this.config.apiKey,
      this.config.apiSecret,
      method,
      path,
      '',
      body
    );

    logger.info('Cancelling order:', { orderId, productId });

    const response = await this.client.delete<ApiResponse<Order>>(
      path,
      { 
        headers,
        data: { id: orderId, product_id: productId }
      }
    );

    if (!response.data.success) {
      throw new Error(`Failed to cancel order: ${response.data.error?.code}`);
    }

    logger.info('Order cancelled successfully');
    return response.data.result!;
  }

  /**
   * Get all open orders
   */
  async getOpenOrders(productId?: number): Promise<Order[]> {
    const path = '/v2/orders';
    const method = 'GET';
    const queryString = productId ? `?product_id=${productId}&state=open` : '?state=open';
    
    const headers = createAuthHeaders(
      this.config.apiKey,
      this.config.apiSecret,
      method,
      path,
      queryString
    );

    const response = await this.client.get<ApiResponse<Order[]>>(
      `${path}${queryString}`,
      { headers }
    );

    if (!response.data.success) {
      throw new Error(`Failed to get open orders: ${response.data.error?.code}`);
    }

    return response.data.result || [];
  }

  /**
   * Get open positions
   */
  async getPositions(productId?: number): Promise<Position[]> {
    const path = '/v2/positions/margined';
    const method = 'GET';
    const queryString = productId ? `?product_ids=${productId}` : '';
    
    const headers = createAuthHeaders(
      this.config.apiKey,
      this.config.apiSecret,
      method,
      path,
      queryString
    );

    const response = await this.client.get<ApiResponse<Position[]>>(
      `${path}${queryString}`,
      { headers }
    );

    if (!response.data.success) {
      throw new Error(`Failed to get positions: ${response.data.error?.code}`);
    }

    return response.data.result || [];
  }

  /**
   * Get real-time position for a specific product
   */
  async getPosition(productId: number): Promise<Position | null> {
    const path = '/v2/positions';
    const method = 'GET';
    const queryString = `?product_id=${productId}`;
    
    const headers = createAuthHeaders(
      this.config.apiKey,
      this.config.apiSecret,
      method,
      path,
      queryString
    );

    const response = await this.client.get<ApiResponse<Position>>(
      `${path}${queryString}`,
      { headers }
    );

    if (!response.data.success) {
      throw new Error(`Failed to get position: ${response.data.error?.code}`);
    }

    return response.data.result || null;
  }

  /**
   * Set leverage for orders
   */
  async setLeverage(productId: number, leverage: number): Promise<void> {
    const path = `/v2/products/${productId}/orders/leverage`;
    const method = 'POST';
    const body = JSON.stringify({ leverage: leverage.toString() });
    
    const headers = createAuthHeaders(
      this.config.apiKey,
      this.config.apiSecret,
      method,
      path,
      '',
      body
    );

    logger.info('Setting leverage:', { productId, leverage });

    const response = await this.client.post(
      path,
      { leverage: leverage.toString() },
      { headers }
    );

    if (!response.data.success) {
      throw new Error(`Failed to set leverage: ${response.data.error?.code}`);
    }

    logger.info('Leverage set successfully');
  }

  /**
   * Place batch orders
   */
  async placeBatchOrders(productId: number, orders: Omit<Order, 'product_id'>[]): Promise<Order[]> {
    const path = '/v2/orders/batch';
    const method = 'POST';
    const body = JSON.stringify({ product_id: productId, orders });
    
    const headers = createAuthHeaders(
      this.config.apiKey,
      this.config.apiSecret,
      method,
      path,
      '',
      body
    );

    logger.info('Placing batch orders:', { productId, count: orders.length });

    const response = await this.client.post<ApiResponse<Order[]>>(
      path,
      { product_id: productId, orders },
      { headers }
    );

    if (!response.data.success) {
      throw new Error(`Failed to place batch orders: ${response.data.error?.code}`);
    }

    logger.info('Batch orders placed successfully');
    return response.data.result!;
  }

  /**
   * Cancel all open orders
   */
  async cancelAllOrders(productId?: number): Promise<void> {
    const path = '/v2/orders/all';
    const method = 'DELETE';
    const body = productId ? JSON.stringify({ product_id: productId }) : '{}';
    
    const headers = createAuthHeaders(
      this.config.apiKey,
      this.config.apiSecret,
      method,
      path,
      '',
      body
    );

    logger.info('Cancelling all orders', productId ? { productId } : {});

    const response = await this.client.delete(
      path,
      { 
        headers,
        data: productId ? { product_id: productId } : {}
      }
    );

    if (!response.data.success) {
      throw new Error(`Failed to cancel all orders: ${response.data.error?.code}`);
    }

    logger.info('All orders cancelled successfully');
  }
}
