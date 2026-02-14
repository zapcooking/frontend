/**
 * Image optimization utilities for better performance
 */

export interface ImageOptimizationOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png' | 'auto';
  blur?: boolean;
}

/**
 * Optimize image URL with parameters for better loading
 */
export function optimizeImageUrl(
  url: string, 
  options: ImageOptimizationOptions = {}
): string {
  if (!url || url.startsWith('data:') || url.startsWith('/')) {
    return url; // Skip optimization for data URLs and local assets
  }

  try {
    const urlObj = new URL(url);
    const params = new URLSearchParams();
    
    // Add optimization parameters
    if (options.width) params.set('w', options.width.toString());
    if (options.height) params.set('h', options.height.toString());
    if (options.quality) params.set('q', options.quality.toString());
    
    // Prefer WebP format for better compression
    if (options.format === 'webp' || options.format === 'auto') {
      params.set('f', 'webp');
    }
    
    // Add blur for placeholder effect
    if (options.blur) {
      params.set('blur', '5');
    }
    
    // Add existing query parameters
    const existingParams = urlObj.searchParams;
    existingParams.forEach((value, key) => {
      if (!params.has(key)) {
        params.set(key, value);
      }
    });
    
    urlObj.search = params.toString();
    return urlObj.toString();
  } catch (error) {
    console.warn('Failed to optimize image URL:', url, error);
    return url;
  }
}

/**
 * Create a progressive image loader
 */
export function createProgressiveImage(
  src: string, 
  options: ImageOptimizationOptions = {}
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      resolve(img);
    };
    
    img.onerror = () => {
      reject(new Error(`Failed to load image: ${src}`));
    };
    
    // Use optimized URL
    img.src = optimizeImageUrl(src, options);
  });
}

/**
 * Check if browser supports WebP (cached after first call)
 */
let webPSupported: boolean | null = null;
export function supportsWebP(): boolean {
  if (webPSupported !== null) return webPSupported;
  if (typeof window === 'undefined') return false;

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;

  webPSupported = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  return webPSupported;
}

/**
 * Get optimal image format based on browser support
 */
export function getOptimalFormat(): 'webp' | 'jpeg' {
  return supportsWebP() ? 'webp' : 'jpeg';
}

/**
 * Generate responsive image URLs for different screen sizes
 */
export function generateResponsiveImageUrls(
  baseUrl: string, 
  sizes: number[] = [160, 320, 640, 1280]
): string[] {
  return sizes.map(size => 
    optimizeImageUrl(baseUrl, {
      width: size,
      quality: size <= 320 ? 80 : 90,
      format: 'auto'
    })
  );
}

/**
 * Preload critical images
 */
export function preloadImage(src: string, options: ImageOptimizationOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = optimizeImageUrl(src, options);
    
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to preload image: ${src}`));
    
    document.head.appendChild(link);
  });
}
