import { DeltaRestClient } from './services/deltaClient';
import { DeltaWebSocketClient } from './services/deltaWebSocket';
import { ScalpingStrategy } from './strategies/scalpingStrategy';
import { RiskManager } from './utils/riskManager';
import { logger } from './utils/logger';
import {
  DeltaConfig,
  TradingConfig,
  StrategyConfig,
  Order,
  Position,
  SignalData,
  OrderSide,
  Ticker,
  L2Orderbook,
  Trade
} from './types';

export class ScalpingBot {
  private restClient: DeltaRestClient;
  private wsClient: DeltaWebSocketClient;
  private strategy: ScalpingStrategy;
  private riskManager: RiskManager;
  private tradingConfig: TradingConfig;
  private isRunning: boolean = false;
  private currentPosition: Position | null = null;
  private openOrders: Order[] = [];
  private lastTicker: Ticker | null = null;
  private lastOrderbook: L2Orderbook | null = null;
  private recentTrades: Trade[] = [];
  private analysisInterval: NodeJS.Timeout | null = null;

  constructor(
    deltaConfig: DeltaConfig,
    tradingConfig: TradingConfig,
    strategyConfig: StrategyConfig
  ) {
    this.restClient = new DeltaRestClient(deltaConfig);
    this.wsClient = new DeltaWebSocketClient(deltaConfig);
    this.strategy = new ScalpingStrategy(strategyConfig);
    this.riskManager = new RiskManager(tradingConfig);
    this.tradingConfig = tradingConfig;
  }

  /**
   * Start the scalping bot
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting Delta Exchange Scalping Bot...');

      // Set leverage
      await this.restClient.setLeverage(
        this.tradingConfig.productId,
        this.tradingConfig.leverage
      );

      // Connect WebSocket
      await this.wsClient.connect();

      // Subscribe to market data channels
      this.subscribeToMarketData();

      // Subscribe to private channels
      this.subscribeToPrivateChannels();

      // Start periodic analysis
      this.startPeriodicAnalysis();

      this.isRunning = true;
      logger.info('Scalping bot started successfully');

    } catch (error) {
      logger.error('Failed to start bot:', error);
      throw error;
    }
  }

  /**
   * Stop the scalping bot
   */
  async stop(): Promise<void> {
    logger.info('Stopping scalping bot...');
    this.isRunning = false;

    // Stop periodic analysis
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }

    // Cancel all open orders
    try {
      await this.restClient.cancelAllOrders(this.tradingConfig.productId);
      logger.info('All orders cancelled');
    } catch (error) {
      logger.error('Error cancelling orders:', error);
    }

    // Disconnect WebSocket
    this.wsClient.disconnect();

    logger.info('Scalping bot stopped');
  }

  /**
   * Subscribe to market data channels
   */
  private subscribeToMarketData(): void {
    const symbol = this.tradingConfig.productSymbol;

    // Subscribe to ticker
    this.wsClient.subscribe('v2_ticker', [symbol]);
    this.wsClient.onMessage('v2_ticker', (data) => {
      if (data.symbol === symbol && data.ticker) {
        this.lastTicker = data.ticker;
      }
    });

    // Subscribe to L2 orderbook
    this.wsClient.subscribe('l2_orderbook', [symbol]);
    this.wsClient.onMessage('l2_orderbook', (data) => {
      if (data.symbol === symbol && data.orderbook) {
        this.lastOrderbook = data.orderbook;
      }
    });

    // Subscribe to trades
    this.wsClient.subscribe('all_trades', [symbol]);
    this.wsClient.onMessage('all_trades', (data) => {
      if (data.symbol === symbol && data.trades) {
        this.recentTrades = data.trades.slice(-50);
      }
    });

    logger.info('Subscribed to market data channels');
  }

  /**
   * Subscribe to private channels
   */
  private subscribeToPrivateChannels(): void {
    // Subscribe to position updates
    this.wsClient.subscribe('positions');
    this.wsClient.onMessage('positions', (data) => {
      this.handlePositionUpdate(data);
    });

    // Subscribe to order updates
    this.wsClient.subscribe('orders');
    this.wsClient.onMessage('orders', (data) => {
      this.handleOrderUpdate(data);
    });

    logger.info('Subscribed to private channels');
  }

  /**
   * Start periodic market analysis
   */
  private startPeriodicAnalysis(): void {
    // Analyze market every 5 seconds
    this.analysisInterval = setInterval(async () => {
      await this.analyzeAndTrade();
    }, 5000);

    logger.info('Started periodic analysis (5s interval)');
  }

  /**
   * Main trading logic - analyze market and execute trades
   */
  private async analyzeAndTrade(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Check if we have enough data
      if (!this.lastTicker || !this.lastOrderbook || this.recentTrades.length === 0) {
        // Fetch data via REST API if WebSocket data not available
        await this.fetchMarketData();
        return;
      }

      // Update current position
      await this.updatePosition();

      // Update open orders
      await this.updateOpenOrders();

      // Check risk limits
      if (this.riskManager.isEmergencyStop()) {
        logger.error('Emergency stop triggered - daily loss limit reached');
        await this.emergencyCloseAll();
        return;
      }

      // If we have a position, manage it
      if (this.currentPosition && Math.abs(this.currentPosition.size) > 0) {
        await this.managePosition();
        return;
      }

      // No position - look for entry signal
      const signal = this.strategy.analyze(
        this.lastTicker,
        this.lastOrderbook,
        this.recentTrades
      );

      // Execute trade if signal is strong enough
      if (signal.signal !== 'neutral') {
        await this.executeSignal(signal);
      }

    } catch (error) {
      logger.error('Error in analyze and trade:', error);
    }
  }

  /**
   * Fetch market data via REST API
   */
  private async fetchMarketData(): Promise<void> {
    try {
      const [ticker, orderbook, trades] = await Promise.all([
        this.restClient.getTicker(this.tradingConfig.productSymbol),
        this.restClient.getOrderbook(this.tradingConfig.productId),
        this.restClient.getTrades(this.tradingConfig.productId)
      ]);

      this.lastTicker = ticker;
      this.lastOrderbook = orderbook;
      this.recentTrades = trades;

    } catch (error) {
      logger.error('Error fetching market data:', error);
    }
  }

  /**
   * Update current position from API
   */
  private async updatePosition(): Promise<void> {
    try {
      const position = await this.restClient.getPosition(this.tradingConfig.productId);
      this.currentPosition = position;

      // Update risk manager
      const positions = position ? [position] : [];
      this.riskManager.updatePositionsCount(positions);

    } catch (error) {
      logger.error('Error updating position:', error);
    }
  }

  /**
   * Update open orders from API
   */
  private async updateOpenOrders(): Promise<void> {
    try {
      this.openOrders = await this.restClient.getOpenOrders(this.tradingConfig.productId);
    } catch (error) {
      logger.error('Error updating open orders:', error);
    }
  }

  /**
   * Execute trading signal
   */
  private async executeSignal(signal: SignalData): Promise<void> {
    if (!this.lastOrderbook) return;

    // Check if we should take this trade
    if (!this.riskManager.shouldTakeTrade(signal.strength, 0.7)) {
      logger.debug('Trade rejected by risk manager');
      return;
    }

    try {
      const side: OrderSide = signal.signal === 'buy' ? 'buy' : 'sell';
      const entryPrice = parseFloat(
        this.strategy.calculateEntryPrice(signal, this.lastOrderbook)
      );

      // Calculate stop loss and take profit
      const stopLossPrice = parseFloat(
        this.strategy.calculateStopLoss(
          entryPrice,
          side,
          this.tradingConfig.stopLossPercent
        )
      );

      const takeProfitPrice = parseFloat(
        this.strategy.calculateTakeProfit(
          entryPrice,
          side,
          this.tradingConfig.profitTargetPercent
        )
      );

      // Validate risk-reward
      if (!this.riskManager.validateRiskReward(entryPrice, stopLossPrice, takeProfitPrice)) {
        logger.warn('Trade rejected - poor risk-reward ratio');
        return;
      }

      // Place entry order
      const order: Order = {
        product_id: this.tradingConfig.productId,
        product_symbol: this.tradingConfig.productSymbol,
        size: this.tradingConfig.positionSize,
        side,
        order_type: 'limit_order',
        limit_price: entryPrice.toFixed(2),
        time_in_force: 'gtc',
        post_only: true,
        client_order_id: `scalp_${Date.now()}`
      };

      logger.info('Placing entry order:', {
        side,
        price: entryPrice,
        size: order.size,
        stopLoss: stopLossPrice,
        takeProfit: takeProfitPrice
      });

      const placedOrder = await this.restClient.placeOrder(order);

      // Increment trade counter
      this.riskManager.incrementTradeCount();

      // Log trade
      logger.info('Entry order placed successfully', {
        orderId: placedOrder.id,
        signal: signal.signal,
        strength: signal.strength
      });

    } catch (error) {
      logger.error('Error executing signal:', error);
    }
  }

  /**
   * Manage existing position
   */
  private async managePosition(): Promise<void> {
    if (!this.currentPosition || !this.lastTicker) return;

    const currentPrice = this.lastTicker.close;
    const entryPrice = parseFloat(this.currentPosition.entry_price);
    const positionSize = this.currentPosition.size;
    const side: OrderSide = positionSize > 0 ? 'buy' : 'sell';

    // Calculate unrealized P&L percentage
    const pnlPercent = positionSize > 0
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;

    logger.debug('Managing position:', {
      side,
      size: positionSize,
      entryPrice,
      currentPrice,
      pnlPercent: pnlPercent.toFixed(2)
    });

    // Check if stop loss or take profit should be triggered
    if (positionSize > 0) {
      // Long position
      if (pnlPercent <= -this.tradingConfig.stopLossPercent) {
        logger.warn('Stop loss triggered for long position');
        await this.closePosition('stop_loss');
      } else if (pnlPercent >= this.tradingConfig.profitTargetPercent) {
        logger.info('Take profit triggered for long position');
        await this.closePosition('take_profit');
      }
    } else {
      // Short position
      if (pnlPercent <= -this.tradingConfig.stopLossPercent) {
        logger.warn('Stop loss triggered for short position');
        await this.closePosition('stop_loss');
      } else if (pnlPercent >= this.tradingConfig.profitTargetPercent) {
        logger.info('Take profit triggered for short position');
        await this.closePosition('take_profit');
      }
    }
  }

  /**
   * Close current position
   */
  private async closePosition(reason: string): Promise<void> {
    if (!this.currentPosition) return;

    try {
      const positionSize = Math.abs(this.currentPosition.size);
      const side: OrderSide = this.currentPosition.size > 0 ? 'sell' : 'buy';

      const order: Order = {
        product_id: this.tradingConfig.productId,
        size: positionSize,
        side,
        order_type: 'market_order',
        reduce_only: true
      };

      logger.info('Closing position:', { reason, side, size: positionSize });

      await this.restClient.placeOrder(order);

      // Update P&L
      if (this.currentPosition.realized_pnl) {
        this.riskManager.updateDailyPnL(parseFloat(this.currentPosition.realized_pnl));
      }

      logger.info('Position closed successfully');

    } catch (error) {
      logger.error('Error closing position:', error);
    }
  }

  /**
   * Emergency close all positions and orders
   */
  private async emergencyCloseAll(): Promise<void> {
    logger.warn('EMERGENCY: Closing all positions and cancelling all orders');

    try {
      // Cancel all orders
      await this.restClient.cancelAllOrders(this.tradingConfig.productId);

      // Close position if exists
      if (this.currentPosition && Math.abs(this.currentPosition.size) > 0) {
        await this.closePosition('emergency_stop');
      }

      // Stop the bot
      await this.stop();

    } catch (error) {
      logger.error('Error in emergency close:', error);
    }
  }

  /**
   * Handle position updates from WebSocket
   */
  private handlePositionUpdate(data: any): void {
    if (data.product_id === this.tradingConfig.productId) {
      this.currentPosition = data.position;
      logger.debug('Position updated via WebSocket');
    }
  }

  /**
   * Handle order updates from WebSocket
   */
  private handleOrderUpdate(data: any): void {
    if (data.product_id === this.tradingConfig.productId) {
      logger.info('Order update received:', {
        orderId: data.id,
        state: data.state,
        side: data.side
      });
    }
  }

  /**
   * Get bot status
   */
  getStatus(): {
    isRunning: boolean;
    position: Position | null;
    openOrders: number;
    riskStats: any;
  } {
    return {
      isRunning: this.isRunning,
      position: this.currentPosition,
      openOrders: this.openOrders.length,
      riskStats: this.riskManager.getRiskStats()
    };
  }
}
