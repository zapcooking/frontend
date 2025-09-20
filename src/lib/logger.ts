/**
 * Production-ready logging utility
 * Automatically adjusts log levels based on environment
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: string;
  data?: any;
  timestamp: number;
  userAgent?: string;
  url?: string;
}

class Logger {
  private static instance: Logger;
  private logLevel: LogLevel;
  private isDevelopment: boolean;
  private isProduction: boolean;
  private logBuffer: LogEntry[] = [];
  private maxBufferSize = 100;

  private constructor() {
    this.isDevelopment = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || 
       window.location.hostname === '127.0.0.1' ||
       window.location.hostname.includes('dev'));
    
    this.isProduction = typeof window !== 'undefined' && 
      !this.isDevelopment && 
      window.location.protocol === 'https:';

    // Set log level based on environment
    if (this.isDevelopment) {
      this.logLevel = LogLevel.DEBUG;
    } else if (this.isProduction) {
      this.logLevel = LogLevel.WARN; // Only show warnings and errors in production
    } else {
      this.logLevel = LogLevel.INFO;
    }

    // Initialize error tracking in production
    if (this.isProduction) {
      this.initializeProductionLogging();
    }
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private initializeProductionLogging(): void {
    // Set up global error handlers for production
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        this.error('Global error', 'window', {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: event.error
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        this.error('Unhandled promise rejection', 'window', {
          reason: event.reason,
          promise: event.promise
        });
      });
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  private createLogEntry(level: LogLevel, message: string, context?: string, data?: any): LogEntry {
    return {
      level,
      message,
      context,
      data,
      timestamp: Date.now(),
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
      url: typeof window !== 'undefined' ? window.location.href : undefined
    };
  }

  private log(level: LogLevel, message: string, context?: string, data?: any): void {
    if (!this.shouldLog(level)) return;

    const entry = this.createLogEntry(level, message, context, data);
    
    // Add to buffer
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer = this.logBuffer.slice(-this.maxBufferSize);
    }

    // Console logging
    if (this.isDevelopment) {
      const emoji = this.getLevelEmoji(level);
      const levelName = LogLevel[level];
      
      if (context) {
        console.log(`${emoji} [${levelName}] ${context}: ${message}`, data || '');
      } else {
        console.log(`${emoji} [${levelName}] ${message}`, data || '');
      }
    }

    // Production logging (send to external service)
    if (this.isProduction && level >= LogLevel.WARN) {
      this.sendToProductionService(entry);
    }
  }

  private getLevelEmoji(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG: return '🐛';
      case LogLevel.INFO: return 'ℹ️';
      case LogLevel.WARN: return '⚠️';
      case LogLevel.ERROR: return '❌';
      default: return '📝';
    }
  }

  private sendToProductionService(entry: LogEntry): void {
    // In production, you would send logs to your logging service
    // Examples: Sentry, LogRocket, DataDog, or your own service
    
    // For now, we'll just store in localStorage for debugging
    if (typeof window !== 'undefined') {
      try {
        const logs = JSON.parse(localStorage.getItem('production_logs') || '[]');
        logs.push(entry);
        
        // Keep only last 50 entries
        if (logs.length > 50) {
          logs.splice(0, logs.length - 50);
        }
        
        localStorage.setItem('production_logs', JSON.stringify(logs));
      } catch (error) {
        // Silently fail if localStorage is not available
      }
    }
  }

  debug(message: string, context?: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, context, data);
  }

  info(message: string, context?: string, data?: any): void {
    this.log(LogLevel.INFO, message, context, data);
  }

  warn(message: string, context?: string, data?: any): void {
    this.log(LogLevel.WARN, message, context, data);
  }

  error(message: string, context?: string, data?: any): void {
    this.log(LogLevel.ERROR, message, context, data);
  }

  // Performance logging
  performance(action: string, duration: number, context?: string): void {
    this.info(`Performance: ${action} took ${duration}ms`, context);
  }

  // User action logging
  userAction(action: string, data?: any): void {
    this.info(`User action: ${action}`, 'user', data);
  }

  // Get recent logs for debugging
  getRecentLogs(count: number = 20): LogEntry[] {
    return this.logBuffer.slice(-count);
  }

  // Clear logs
  clearLogs(): void {
    this.logBuffer = [];
    if (typeof window !== 'undefined') {
      localStorage.removeItem('production_logs');
    }
  }

  // Get current log level
  getLogLevel(): LogLevel {
    return this.logLevel;
  }

  // Set log level (useful for debugging)
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Convenience functions
export const debug = (message: string, context?: string, data?: any) => 
  logger.debug(message, context, data);

export const info = (message: string, context?: string, data?: any) => 
  logger.info(message, context, data);

export const warn = (message: string, context?: string, data?: any) => 
  logger.warn(message, context, data);

export const error = (message: string, context?: string, data?: any) => 
  logger.error(message, context, data);

export const performance = (action: string, duration: number, context?: string) => 
  logger.performance(action, context, duration);

export const userAction = (action: string, data?: any) => 
  logger.userAction(action, data);
