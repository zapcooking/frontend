interface PerformanceMetrics {
  profileCache: {
    hits: number;
    misses: number;
    fetches: number;
    avgFetchTime: number;
  };
  feedLoading: {
    initialLoadTime: number;
    cacheLoadTime: number;
    networkLoadTime: number;
  };
  subscriptions: {
    active: number;
    cleaned: number;
  };
}

class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: PerformanceMetrics = {
    profileCache: {
      hits: 0,
      misses: 0,
      fetches: 0,
      avgFetchTime: 0
    },
    feedLoading: {
      initialLoadTime: 0,
      cacheLoadTime: 0,
      networkLoadTime: 0
    },
    subscriptions: {
      active: 0,
      cleaned: 0
    }
  };

  private fetchTimes: number[] = [];

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  // Profile cache metrics
  recordProfileCacheHit(): void {
    this.metrics.profileCache.hits++;
    this.logMetrics();
  }

  recordProfileCacheMiss(): void {
    this.metrics.profileCache.misses++;
    this.logMetrics();
  }

  recordProfileFetch(startTime: number): void {
    const fetchTime = Date.now() - startTime;
    this.fetchTimes.push(fetchTime);
    this.metrics.profileCache.fetches++;
    
    // Calculate average fetch time
    const totalTime = this.fetchTimes.reduce((sum, time) => sum + time, 0);
    this.metrics.profileCache.avgFetchTime = totalTime / this.fetchTimes.length;
    
    this.logMetrics();
  }

  // Feed loading metrics
  recordFeedLoad(type: 'initial' | 'cache' | 'network', time: number): void {
    if (type === 'initial') {
      this.metrics.feedLoading.initialLoadTime = time;
    } else if (type === 'cache') {
      this.metrics.feedLoading.cacheLoadTime = time;
    } else if (type === 'network') {
      this.metrics.feedLoading.networkLoadTime = time;
    }
    this.logMetrics();
  }

  // Subscription metrics
  recordSubscriptionCreated(): void {
    this.metrics.subscriptions.active++;
    this.logMetrics();
  }

  recordSubscriptionCleaned(): void {
    this.metrics.subscriptions.active = Math.max(0, this.metrics.subscriptions.active - 1);
    this.metrics.subscriptions.cleaned++;
    this.logMetrics();
  }

  // Get current metrics
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  // Reset metrics
  resetMetrics(): void {
    this.metrics = {
      profileCache: {
        hits: 0,
        misses: 0,
        fetches: 0,
        avgFetchTime: 0
      },
      feedLoading: {
        initialLoadTime: 0,
        cacheLoadTime: 0,
        networkLoadTime: 0
      },
      subscriptions: {
        active: 0,
        cleaned: 0
      }
    };
    this.fetchTimes = [];
  }

  private lastLogTime = 0;
  private logThrottleMs = 5000; // Only log every 5 seconds

  private logMetrics(): void {
    // Only log in development and throttle the logging
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      const now = Date.now();
      if (now - this.lastLogTime > this.logThrottleMs) {
        console.log('📊 Performance Metrics:', this.metrics);
        this.lastLogTime = now;
      }
    }
  }

  // Get cache hit rate
  getCacheHitRate(): number {
    const total = this.metrics.profileCache.hits + this.metrics.profileCache.misses;
    return total > 0 ? (this.metrics.profileCache.hits / total) * 100 : 0;
  }

  // Get subscription leak status
  getSubscriptionLeakStatus(): { hasLeaks: boolean; active: number; cleaned: number } {
    return {
      hasLeaks: this.metrics.subscriptions.active > 0,
      active: this.metrics.subscriptions.active,
      cleaned: this.metrics.subscriptions.cleaned
    };
  }
}

export const performanceMonitor = PerformanceMonitor.getInstance();

// Performance timing utilities
export function startTiming(): number {
  return Date.now();
}

export function endTiming(startTime: number): number {
  return Date.now() - startTime;
}

// Debounce utility for performance optimization
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Throttle utility for performance optimization
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
