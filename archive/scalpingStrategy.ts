import { logger } from '../utils/logger';
import { TechnicalIndicators } from '../utils/indicators';
import {
  SignalData,
  Ticker,
  L2Orderbook,
  Trade,
  OrderSide,
  StrategyConfig
} from '../types';

export class ScalpingStrategy {
  private config: StrategyConfig;
  private priceHistory: number[] = [];
  private volumeHistory: number[] = [];
  private tradeHistory: Trade[] = [];
  private maxHistorySize = 200;

  constructor(config: StrategyConfig) {
    this.config = config;
  }

  /**
   * Analyze market data and generate trading signal
   */
  analyze(
    ticker: Ticker,
    orderbook: L2Orderbook,
    recentTrades: Trade[]
  ): SignalData {
    // Update history
    this.updateHistory(ticker, recentTrades);

    if (this.priceHistory.length < this.config.rsiPeriod + 1) {
      return this.neutralSignal(ticker.close);
    }

    // Calculate technical indicators
    const rsi = TechnicalIndicators.calculateRSI(
      this.priceHistory,
      this.config.rsiPeriod
    );

    const trend = TechnicalIndicators.detectTrend(this.priceHistory);
    const momentum = TechnicalIndicators.calculateMomentum(this.priceHistory);

    // Analyze orderbook for liquidity and imbalance
    const orderbookAnalysis = this.analyzeOrderbook(orderbook);

    // Analyze recent trades for volume and aggression
    const tradeAnalysis = this.analyzeRecentTrades(recentTrades);

    // Generate signal
    const signal = this.generateSignal(
      rsi,
      trend,
      momentum,
      orderbookAnalysis,
      tradeAnalysis,
      ticker
    );

    logger.debug('Strategy analysis:', {
      price: ticker.close,
      rsi: rsi.toFixed(2),
      trend,
      momentum: momentum.toFixed(2),
      orderbookImbalance: orderbookAnalysis.imbalance.toFixed(2),
      signal: signal.signal,
      strength: signal.strength.toFixed(2)
    });

    return signal;
  }

  /**
   * Update price and volume history
   */
  private updateHistory(ticker: Ticker, recentTrades: Trade[]): void {
    this.priceHistory.push(ticker.close);
    this.volumeHistory.push(ticker.volume);
    this.tradeHistory = recentTrades;

    // Keep history size manageable
    if (this.priceHistory.length > this.maxHistorySize) {
      this.priceHistory.shift();
    }
    if (this.volumeHistory.length > this.maxHistorySize) {
      this.volumeHistory.shift();
    }
  }

  /**
   * Analyze orderbook for liquidity and imbalance
   */
  private analyzeOrderbook(orderbook: L2Orderbook): {
    bidLiquidity: number;
    askLiquidity: number;
    imbalance: number;
    spread: number;
  } {
    const bidLiquidity = orderbook.buy.reduce((sum, level) => sum + level.size, 0);
    const askLiquidity = orderbook.sell.reduce((sum, level) => sum + level.size, 0);
    
    const totalLiquidity = bidLiquidity + askLiquidity;
    const imbalance = totalLiquidity > 0
      ? (bidLiquidity - askLiquidity) / totalLiquidity
      : 0;

    const bestBid = parseFloat(orderbook.buy[0]?.price || '0');
    const bestAsk = parseFloat(orderbook.sell[0]?.price || '0');
    const spread = bestAsk - bestBid;
    const spreadPercent = bestBid > 0 ? (spread / bestBid) * 100 : 0;

    return {
      bidLiquidity,
      askLiquidity,
      imbalance,
      spread: spreadPercent
    };
  }

  /**
   * Analyze recent trades for volume and aggression
   */
  private analyzeRecentTrades(trades: Trade[]): {
    buyVolume: number;
    sellVolume: number;
    volumeImbalance: number;
    avgTradeSize: number;
  } {
    if (trades.length === 0) {
      return {
        buyVolume: 0,
        sellVolume: 0,
        volumeImbalance: 0,
        avgTradeSize: 0
      };
    }

    const buyVolume = trades
      .filter(t => t.side === 'buy')
      .reduce((sum, t) => sum + t.size, 0);

    const sellVolume = trades
      .filter(t => t.side === 'sell')
      .reduce((sum, t) => sum + t.size, 0);

    const totalVolume = buyVolume + sellVolume;
    const volumeImbalance = totalVolume > 0
      ? (buyVolume - sellVolume) / totalVolume
      : 0;

    const avgTradeSize = totalVolume / trades.length;

    return {
      buyVolume,
      sellVolume,
      volumeImbalance,
      avgTradeSize
    };
  }

  /**
   * Generate trading signal based on all indicators
   */
  private generateSignal(
    rsi: number,
    trend: 'up' | 'down' | 'sideways',
    momentum: number,
    orderbookAnalysis: any,
    tradeAnalysis: any,
    ticker: Ticker
  ): SignalData {
    let signal: 'buy' | 'sell' | 'neutral' = 'neutral';
    let strength = 0;

    // RSI-based signals
    const isOversold = rsi < this.config.rsiOversold;
    const isOverbought = rsi > this.config.rsiOverbought;

    // Orderbook imbalance threshold
    const strongImbalanceThreshold = 0.2;

    // Buy signal conditions
    const buyConditions = [
      isOversold,
      trend === 'up',
      momentum > 0,
      orderbookAnalysis.imbalance > strongImbalanceThreshold,
      tradeAnalysis.volumeImbalance > 0.2
    ];

    // Sell signal conditions
    const sellConditions = [
      isOverbought,
      trend === 'down',
      momentum < 0,
      orderbookAnalysis.imbalance < -strongImbalanceThreshold,
      tradeAnalysis.volumeImbalance < -0.2
    ];

    // Count met conditions
    const buyScore = buyConditions.filter(c => c).length;
    const sellScore = sellConditions.filter(c => c).length;

    // Determine signal and strength
    if (buyScore >= 3) {
      signal = 'buy';
      strength = buyScore / buyConditions.length;
    } else if (sellScore >= 3) {
      signal = 'sell';
      strength = sellScore / sellConditions.length;
    }

    // Additional confluence for scalping
    if (signal === 'buy') {
      // Check if price is near support
      if (orderbookAnalysis.spread < 0.05) { // Tight spread is good for scalping
        strength += 0.1;
      }
    } else if (signal === 'sell') {
      // Check if price is near resistance
      if (orderbookAnalysis.spread < 0.05) {
        strength += 0.1;
      }
    }

    strength = Math.min(strength, 1);

    return {
      timestamp: Date.now(),
      price: ticker.close,
      signal,
      strength,
      indicators: {
        rsi,
        trend,
        momentum,
        orderbookImbalance: orderbookAnalysis.imbalance,
        volumeImbalance: tradeAnalysis.volumeImbalance,
        spread: orderbookAnalysis.spread
      }
    };
  }

  /**
   * Create a neutral signal
   */
  private neutralSignal(price: number): SignalData {
    return {
      timestamp: Date.now(),
      price,
      signal: 'neutral',
      strength: 0,
      indicators: {}
    };
  }

  /**
   * Calculate optimal entry price for a signal
   */
  calculateEntryPrice(signal: SignalData, orderbook: L2Orderbook): string {
    if (signal.signal === 'buy') {
      // Try to buy at best bid or slightly above
      const bestBid = parseFloat(orderbook.buy[0]?.price || '0');
      const bestAsk = parseFloat(orderbook.sell[0]?.price || '0');
      const midPrice = (bestBid + bestAsk) / 2;
      
      // Place order at mid price for better fill probability
      return midPrice.toFixed(2);
    } else if (signal.signal === 'sell') {
      // Try to sell at best ask or slightly below
      const bestBid = parseFloat(orderbook.buy[0]?.price || '0');
      const bestAsk = parseFloat(orderbook.sell[0]?.price || '0');
      const midPrice = (bestBid + bestAsk) / 2;
      
      return midPrice.toFixed(2);
    }

    return signal.price.toFixed(2);
  }

  /**
   * Calculate stop loss price
   */
  calculateStopLoss(entryPrice: number, side: OrderSide, stopLossPercent: number): string {
    if (side === 'buy') {
      return (entryPrice * (1 - stopLossPercent / 100)).toFixed(2);
    } else {
      return (entryPrice * (1 + stopLossPercent / 100)).toFixed(2);
    }
  }

  /**
   * Calculate take profit price
   */
  calculateTakeProfit(entryPrice: number, side: OrderSide, profitTargetPercent: number): string {
    if (side === 'buy') {
      return (entryPrice * (1 + profitTargetPercent / 100)).toFixed(2);
    } else {
      return (entryPrice * (1 - profitTargetPercent / 100)).toFixed(2);
    }
  }

  /**
   * Reset strategy state
   */
  reset(): void {
    this.priceHistory = [];
    this.volumeHistory = [];
    this.tradeHistory = [];
    logger.info('Strategy state reset');
  }
}
