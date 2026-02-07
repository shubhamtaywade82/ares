import { logger } from '../utils/logger';
import { Position, Order, TradingConfig } from '../types';

export class RiskManager {
  private config: TradingConfig;
  private dailyPnL: number = 0;
  private dailyTrades: number = 0;
  private lastResetDate: string;
  private openPositionsCount: number = 0;

  constructor(config: TradingConfig) {
    this.config = config;
    this.lastResetDate = new Date().toISOString().split('T')[0];
  }

  /**
   * Check if daily loss limit has been reached
   */
  checkDailyLossLimit(): boolean {
    this.resetIfNewDay();

    if (this.dailyPnL <= -this.config.maxDailyLoss) {
      logger.warn('Daily loss limit reached', {
        dailyPnL: this.dailyPnL,
        limit: -this.config.maxDailyLoss
      });
      return false;
    }

    return true;
  }

  /**
   * Check if maximum open positions limit has been reached
   */
  checkMaxPositions(): boolean {
    if (this.openPositionsCount >= this.config.maxOpenPositions) {
      logger.warn('Maximum open positions reached', {
        current: this.openPositionsCount,
        max: this.config.maxOpenPositions
      });
      return false;
    }

    return true;
  }

  /**
   * Validate position size
   */
  validatePositionSize(size: number): boolean {
    if (size > this.config.maxPositionSize) {
      logger.warn('Position size exceeds maximum', {
        requested: size,
        max: this.config.maxPositionSize
      });
      return false;
    }

    if (size <= 0) {
      logger.warn('Invalid position size', { size });
      return false;
    }

    return true;
  }

  /**
   * Calculate position size based on risk parameters
   */
  calculatePositionSize(
    accountBalance: number,
    entryPrice: number,
    stopLossPrice: number,
    riskPercent: number = 1
  ): number {
    const riskAmount = accountBalance * (riskPercent / 100);
    const priceRisk = Math.abs(entryPrice - stopLossPrice);
    
    if (priceRisk === 0) {
      return this.config.positionSize;
    }

    const calculatedSize = Math.floor(riskAmount / priceRisk);
    
    // Cap at configured maximum
    const size = Math.min(calculatedSize, this.config.maxPositionSize);
    
    // Use minimum of calculated size or default size
    return Math.max(1, Math.min(size, this.config.positionSize));
  }

  /**
   * Update daily P&L
   */
  updateDailyPnL(pnl: number): void {
    this.resetIfNewDay();
    this.dailyPnL += pnl;
    logger.debug('Daily P&L updated', { dailyPnL: this.dailyPnL });
  }

  /**
   * Update positions count
   */
  updatePositionsCount(positions: Position[]): void {
    this.openPositionsCount = positions.filter(p => Math.abs(p.size) > 0).length;
  }

  /**
   * Increment daily trades counter
   */
  incrementTradeCount(): void {
    this.resetIfNewDay();
    this.dailyTrades++;
  }

  /**
   * Check if we should take a trade based on win rate and streak
   */
  shouldTakeTrade(signalStrength: number, minStrength: number = 0.6): boolean {
    // Don't trade if daily loss limit is hit
    if (!this.checkDailyLossLimit()) {
      return false;
    }

    // Don't trade if max positions reached
    if (!this.checkMaxPositions()) {
      return false;
    }

    // Check signal strength
    if (signalStrength < minStrength) {
      logger.debug('Signal strength too low', {
        strength: signalStrength,
        minRequired: minStrength
      });
      return false;
    }

    return true;
  }

  /**
   * Calculate risk-reward ratio
   */
  calculateRiskReward(
    entryPrice: number,
    stopLoss: number,
    takeProfit: number
  ): number {
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);

    if (risk === 0) return 0;
    return reward / risk;
  }

  /**
   * Validate risk-reward ratio
   */
  validateRiskReward(
    entryPrice: number,
    stopLoss: number,
    takeProfit: number,
    minRatio: number = 1.5
  ): boolean {
    const ratio = this.calculateRiskReward(entryPrice, stopLoss, takeProfit);

    if (ratio < minRatio) {
      logger.warn('Risk-reward ratio too low', {
        ratio: ratio.toFixed(2),
        minRequired: minRatio
      });
      return false;
    }

    return true;
  }

  /**
   * Reset daily statistics if new day
   */
  private resetIfNewDay(): void {
    const today = new Date().toISOString().split('T')[0];
    
    if (today !== this.lastResetDate) {
      logger.info('New trading day - resetting daily statistics', {
        previousDate: this.lastResetDate,
        dailyPnL: this.dailyPnL,
        dailyTrades: this.dailyTrades
      });

      this.dailyPnL = 0;
      this.dailyTrades = 0;
      this.lastResetDate = today;
    }
  }

  /**
   * Get current risk statistics
   */
  getRiskStats(): {
    dailyPnL: number;
    dailyTrades: number;
    openPositionsCount: number;
    dailyLossLimitReached: boolean;
    maxPositionsReached: boolean;
  } {
    this.resetIfNewDay();

    return {
      dailyPnL: this.dailyPnL,
      dailyTrades: this.dailyTrades,
      openPositionsCount: this.openPositionsCount,
      dailyLossLimitReached: this.dailyPnL <= -this.config.maxDailyLoss,
      maxPositionsReached: this.openPositionsCount >= this.config.maxOpenPositions
    };
  }

  /**
   * Emergency stop - close all positions
   */
  isEmergencyStop(): boolean {
    return this.dailyPnL <= -this.config.maxDailyLoss;
  }
}
