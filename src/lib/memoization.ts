/**
 * Memoization utilities for Svelte components
 */

interface MemoizedFunction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): ReturnType<T>;
  clear(): void;
  has(args: Parameters<T>): boolean;
}

/**
 * Create a memoized function that caches results based on arguments
 */
export function memoize<T extends (...args: any[]) => any>(
  fn: T,
  maxCacheSize: number = 100
): MemoizedFunction<T> {
  const cache = new Map<string, ReturnType<T>>();
  const argKeys: string[] = [];

  const memoized = (...args: Parameters<T>): ReturnType<T> => {
    // Create a simple key that avoids circular references
    const key = args.map((arg, index) => {
      if (arg && typeof arg === 'object') {
        // For NDKEvent objects, use id if available
        if ('id' in arg && typeof arg.id === 'string') {
          return `event:${arg.id}`;
        }
        // For other objects, use a simple hash
        return `obj:${index}:${Object.keys(arg).length}`;
      }
      return `${typeof arg}:${String(arg)}`;
    }).join('|');
    
    if (cache.has(key)) {
      return cache.get(key)!;
    }

    const result = fn(...args);
    
    // Implement LRU eviction if cache is full
    if (cache.size >= maxCacheSize) {
      const oldestKey = argKeys.shift()!;
      cache.delete(oldestKey);
    }
    
    cache.set(key, result);
    argKeys.push(key);
    
    return result;
  };

  memoized.clear = () => {
    cache.clear();
    argKeys.length = 0;
  };

  memoized.has = (args: Parameters<T>) => {
    const key = JSON.stringify(args);
    return cache.has(key);
  };

  return memoized;
}

/**
 * Create a memoized reactive statement for Svelte
 */
export function createMemoizedReactive<T>(
  computeFn: () => T,
  dependencies: any[],
  maxCacheSize: number = 50
): () => T {
  const memoized = memoize(computeFn, maxCacheSize);
  
  return () => {
    // Use dependencies as cache key
    return memoized(...dependencies);
  };
}

/**
 * Memoize expensive DOM operations
 */
export function memoizeDOMOperation<T extends (...args: any[]) => any>(
  operation: T,
  keyGenerator?: (...args: Parameters<T>) => string
): MemoizedFunction<T> {
  const cache = new Map<string, ReturnType<T>>();
  
  return ((...args: Parameters<T>) => {
    const key = keyGenerator ? keyGenerator(...args) : args.map((arg, index) => {
      if (arg && typeof arg === 'object') {
        if ('id' in arg && typeof arg.id === 'string') {
          return `event:${arg.id}`;
        }
        return `obj:${index}:${Object.keys(arg).length}`;
      }
      return `${typeof arg}:${String(arg)}`;
    }).join('|');
    
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    
    const result = operation(...args);
    cache.set(key, result);
    
    return result;
  }) as MemoizedFunction<T>;
}

/**
 * Debounced memoization for expensive operations
 */
export function debouncedMemoize<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 300,
  maxCacheSize: number = 100
): MemoizedFunction<T> {
  const cache = new Map<string, ReturnType<T>>();
  const timeouts = new Map<string, NodeJS.Timeout>();
  
  const memoized = (...args: Parameters<T>): ReturnType<T> => {
    const key = args.map(arg => {
      if (arg && typeof arg === 'object') {
        if ('id' in arg) return `id:${arg.id}`;
        if ('pubkey' in arg) return `pubkey:${arg.pubkey}`;
        if ('content' in arg) return `content:${arg.content}`;
        return `obj:${String(arg).substring(0, 100)}`;
      }
      return String(arg);
    }).join('|');
    
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    
    // Clear existing timeout for this key
    if (timeouts.has(key)) {
      clearTimeout(timeouts.get(key)!);
    }
    
    // Set up debounced execution
    const timeout = setTimeout(() => {
      const result = fn(...args);
      cache.set(key, result);
      
      // Implement LRU eviction
      if (cache.size > maxCacheSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      
      timeouts.delete(key);
    }, delay);
    
    timeouts.set(key, timeout);
    
    // Return undefined for debounced calls
    return undefined as ReturnType<T>;
  };
  
  memoized.clear = () => {
    cache.clear();
    timeouts.forEach(timeout => clearTimeout(timeout));
    timeouts.clear();
  };
  
  memoized.has = (args: Parameters<T>) => {
    const key = JSON.stringify(args);
    return cache.has(key);
  };
  
  return memoized;
}

/**
 * Memoize async operations with promise caching
 */
export function memoizeAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  maxCacheSize: number = 50
): MemoizedFunction<T> {
  const cache = new Map<string, Promise<ReturnType<T>>>();
  const resolvedCache = new Map<string, ReturnType<T>>();
  
  const memoized = (...args: Parameters<T>): ReturnType<T> => {
    const key = args.map(arg => {
      if (arg && typeof arg === 'object') {
        if ('id' in arg) return `id:${arg.id}`;
        if ('pubkey' in arg) return `pubkey:${arg.pubkey}`;
        if ('content' in arg) return `content:${arg.content}`;
        return `obj:${String(arg).substring(0, 100)}`;
      }
      return String(arg);
    }).join('|');
    
    // Return resolved value if available
    if (resolvedCache.has(key)) {
      return Promise.resolve(resolvedCache.get(key)!) as ReturnType<T>;
    }
    
    // Return existing promise if in progress
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    
    // Create new promise
    const promise = fn(...args).then(result => {
      resolvedCache.set(key, result);
      
      // Implement LRU eviction
      if (resolvedCache.size > maxCacheSize) {
        const firstKey = resolvedCache.keys().next().value;
        resolvedCache.delete(firstKey);
        cache.delete(firstKey);
      }
      
      return result;
    });
    
    cache.set(key, promise);
    return promise;
  };
  
  memoized.clear = () => {
    cache.clear();
    resolvedCache.clear();
  };
  
  memoized.has = (args: Parameters<T>) => {
    const key = JSON.stringify(args);
    return cache.has(key) || resolvedCache.has(key);
  };
  
  return memoized;
}
