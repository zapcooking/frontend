/**
 * Centralized error handling utilities
 */

export interface ErrorInfo {
  error: Error;
  errorInfo?: any;
  context?: string;
  userId?: string;
  timestamp?: number;
}

export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorLog: ErrorInfo[] = [];
  private maxLogSize = 100;

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * Log an error with context
   */
  logError(error: Error, context?: string, errorInfo?: any): void {
    const errorEntry: ErrorInfo = {
      error,
      errorInfo,
      context,
      timestamp: Date.now()
    };

    this.errorLog.push(errorEntry);

    // Keep only the most recent errors
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }

    // Log to console in development
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      console.error(`🚨 Error in ${context || 'unknown context'}:`, error);
      if (errorInfo) {
        console.error('Error info:', errorInfo);
      }
    }

    // In production, you might want to send to an error tracking service
    this.sendToErrorService(errorEntry);
  }

  /**
   * Send error to external service (implement based on your needs)
   */
  private sendToErrorService(errorEntry: ErrorInfo): void {
    // Example: Send to Sentry, LogRocket, or your own error tracking service
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
      // Only send in production
      try {
        // Example implementation:
        // Sentry.captureException(errorEntry.error, {
        //   tags: { context: errorEntry.context },
        //   extra: errorEntry.errorInfo
        // });
        
        // Or send to your own API:
        // fetch('/api/errors', {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify(errorEntry)
        // }).catch(() => {}); // Silent fail
      } catch (e) {
        // Silent fail - don't let error reporting break the app
      }
    }
  }

  /**
   * Get recent errors for debugging
   */
  getRecentErrors(limit = 10): ErrorInfo[] {
    return this.errorLog.slice(-limit);
  }

  /**
   * Clear error log
   */
  clearErrors(): void {
    this.errorLog = [];
  }

  /**
   * Check if an error is recoverable
   */
  isRecoverableError(error: Error): boolean {
    const recoverablePatterns = [
      'network',
      'timeout',
      'connection',
      'fetch',
      'websocket'
    ];

    const errorMessage = error.message.toLowerCase();
    return recoverablePatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Get user-friendly error message
   */
  getUserFriendlyMessage(error: Error): string {
    const errorMessage = error.message.toLowerCase();

    if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
      return 'Network connection issue. Please check your internet connection and try again.';
    }

    if (errorMessage.includes('timeout')) {
      return 'Request timed out. The servers might be busy. Please try again.';
    }

    if (errorMessage.includes('websocket')) {
      return 'Connection lost. Please refresh the page to reconnect.';
    }

    if (errorMessage.includes('unauthorized') || errorMessage.includes('401')) {
      return 'Authentication required. Please log in and try again.';
    }

    if (errorMessage.includes('forbidden') || errorMessage.includes('403')) {
      return 'Access denied. You may not have permission to perform this action.';
    }

    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      return 'The requested content was not found.';
    }

    if (errorMessage.includes('server') || errorMessage.includes('500')) {
      return 'Server error. Please try again later.';
    }

    // Default message
    return 'Something went wrong. Please try again or refresh the page.';
  }

  /**
   * Get suggested actions based on error type
   */
  getSuggestedActions(error: Error): string[] {
    const errorMessage = error.message.toLowerCase();
    const actions: string[] = [];

    if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
      actions.push('Check your internet connection');
      actions.push('Try refreshing the page');
      actions.push('Try again in a few moments');
    } else if (errorMessage.includes('timeout')) {
      actions.push('Wait a moment and try again');
      actions.push('Check if the service is available');
    } else if (errorMessage.includes('websocket')) {
      actions.push('Refresh the page to reconnect');
      actions.push('Check your internet connection');
    } else {
      actions.push('Try refreshing the page');
      actions.push('Contact support if the problem persists');
    }

    return actions;
  }
}

// Export singleton instance
export const errorHandler = ErrorHandler.getInstance();

// Utility functions
export function logError(error: Error, context?: string, errorInfo?: any): void {
  errorHandler.logError(error, context, errorInfo);
}

export function getUserFriendlyMessage(error: Error): string {
  return errorHandler.getUserFriendlyMessage(error);
}

export function getSuggestedActions(error: Error): string[] {
  return errorHandler.getSuggestedActions(error);
}

export function isRecoverableError(error: Error): boolean {
  return errorHandler.isRecoverableError(error);
}
