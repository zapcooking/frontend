/**
 * Share Note as Image
 * 
 * Generates shareable PNG images from Nostr notes using html2canvas
 */

import html2canvas from 'html2canvas';
import { browser } from '$app/environment';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';

// URL and image detection patterns
const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'];

/**
 * Check if a URL is an image
 */
function isImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.includes(ext));
}

/**
 * Extract image URLs from content
 */
function extractImageUrls(content: string): string[] {
  const urls = content.match(URL_REGEX) || [];
  return urls.filter((url) => isImageUrl(url));
}

/**
 * Remove image URLs from content
 */
function stripImageUrls(content: string): string {
  return content
    .replace(URL_REGEX, (url) => isImageUrl(url) ? '' : url)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove nostr: references from content (nevent, note, npub, nprofile, etc.)
 */
function stripNostrReferences(content: string): string {
  // Match nostr:nevent1..., nostr:note1..., nostr:npub1..., nostr:nprofile1..., etc.
  return content
    .replace(/nostr:(nevent|note|npub|nprofile|naddr)[a-z0-9]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract nostr event references from content
 */
export function extractNostrReferences(content: string): string[] {
  const regex = /nostr:(nevent|note)1[a-z0-9]+/gi;
  const matches = content.match(regex) || [];
  return matches;
}

/**
 * Decode a nostr reference to get the event ID
 */
export function decodeNostrReference(ref: string): string | null {
  try {
    // Remove the "nostr:" prefix
    const bech32 = ref.replace(/^nostr:/i, '');
    const decoded = nip19.decode(bech32);
    
    if (decoded.type === 'note') {
      return decoded.data as string;
    } else if (decoded.type === 'nevent') {
      return (decoded.data as { id: string }).id;
    }
    return null;
  } catch (e) {
    console.warn('[ShareImage] Failed to decode nostr reference:', ref, e);
    return null;
  }
}

/**
 * Referenced note data for embedding
 */
export interface ReferencedNote {
  id: string;
  content: string;
  authorName?: string;
  authorPicture?: string;
  authorPubkey: string;
  timestamp?: number;
}

/**
 * Generate avatar color from pubkey
 */
function generateAvatarColor(pubkey: string): string {
  const hash = pubkey.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Get initials from name
 */
function getInitials(name: string): string {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

export interface EngagementData {
  zaps: { totalAmount: number; count: number };
  reactions: { count: number };
  comments: { count: number };
}

export type ImageFormat = 'square' | 'landscape';

/**
 * Generate a filename for the shared image
 */
export function generateImageFilename(event: NDKEvent): string {
  const content = event.content || '';
  const words = content
    .split(/\s+/)
    .slice(0, 5)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((word) => word.length > 0)
    .join('-')
    .toLowerCase();
  
  const prefix = words || 'note';
  return `zap-cooking-${prefix}-${event.id.substring(0, 8)}.png`;
}

/**
 * Generate QR code data URL (simple implementation using a QR code library)
 * For now, we'll use a simple approach or skip QR if library not available
 */
async function generateQRCode(url: string, size: number = 200): Promise<string | null> {
  if (!browser) return null;
  
  try {
    // Try to use a QR code library if available, otherwise return null
    // For now, we'll skip QR code generation and add it later if needed
    // You can install qrcode library: npm install qrcode
    return null;
  } catch (error) {
    console.warn('QR code generation failed:', error);
    return null;
  }
}

/**
 * Generate image using Canvas API directly (Safari fallback)
 * This avoids html2canvas issues with Safari's content blockers
 */
async function generateSafariImage(
  event: NDKEvent,
  engagementData: EngagementData,
  authorName?: string,
  authorPicture?: string,
  referencedNoteContent?: string,
  referencedNoteAuthor?: string
): Promise<Blob | null> {
  const width = 540;
  const height = 540;
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    console.error('[ShareImage] Failed to get canvas context');
    return null;
  }

  // Polyfill for roundRect if not available (for older browsers)
  if (!ctx.roundRect) {
    (ctx as any).roundRect = function(x: number, y: number, w: number, h: number, r: number) {
      if (w < 2 * r) r = w / 2;
      if (h < 2 * r) r = h / 2;
      this.beginPath();
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
    };
  }

  // Helper to load an image with timeout
  const loadImage = (src: string, timeout = 3000): Promise<HTMLImageElement | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => {
        resolve(null);
      }, timeout);
      img.onload = () => {
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = src;
    });
  };

  // Background
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1a1a1a');
  gradient.addColorStop(1, '#2d2d2d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Add subtle glow effect
  const radialGradient = ctx.createRadialGradient(width * 0.8, height * 0.2, 0, width * 0.8, height * 0.2, width);
  radialGradient.addColorStop(0, 'rgba(251, 191, 36, 0.1)');
  radialGradient.addColorStop(1, 'transparent');
  ctx.fillStyle = radialGradient;
  ctx.fillRect(0, 0, width, height);

  // Settings
  const padding = 30;
  let y = padding;

  // Author section
  const authorPubkey = event.author?.hexpubkey || event.pubkey;
  const displayName = authorName || authorPubkey.substring(0, 12) + '...';
  
  // Avatar
  const avatarSize = 36;
  const avatarX = padding;
  const avatarY = y;
  const avatarCenterX = avatarX + avatarSize / 2;
  const avatarCenterY = avatarY + avatarSize / 2;
  
  // Try to load profile picture
  let pfpLoaded = false;
  if (authorPicture) {
    const pfpImg = await loadImage(authorPicture);
    if (pfpImg) {
      // Clip to circle and draw
      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(pfpImg, avatarX, avatarY, avatarSize, avatarSize);
      ctx.restore();
      pfpLoaded = true;
    }
  }
  
  // Fallback to colored circle with initials
  if (!pfpLoaded) {
    const avatarColor = `hsl(${Math.abs(authorPubkey.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)) % 360}, 70%, 50%)`;
    ctx.fillStyle = avatarColor;
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
    ctx.fill();

    // Initials
    const initials = displayName.substring(0, 2).toUpperCase();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, avatarCenterX, avatarCenterY);
  }

  // Author name
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(displayName, padding + avatarSize + 10, y + 4);

  // Timestamp
  let timestamp = 'Just now';
  if (event.created_at) {
    const diffMs = Date.now() - event.created_at * 1000;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      timestamp = diffMins < 1 ? 'Just now' : `${diffMins}m ago`;
    } else if (diffHours < 24) {
      timestamp = `${diffHours}h ago`;
    } else {
      timestamp = `${Math.floor(diffHours / 24)}d ago`;
    }
  }
  ctx.fillStyle = '#9ca3af';
  ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(timestamp, padding + avatarSize + 10, y + 22);

  y += avatarSize + 20;

  // Extract image URLs from content BEFORE cleaning
  const rawContent = event.content || '';
  const imageUrlRegex = /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|avif)(\?[^\s]*)?/gi;
  const imageUrls = rawContent.match(imageUrlRegex) || [];
  const firstImageUrl = imageUrls.length > 0 ? imageUrls[0] : null;
  
  // Load the first image if available
  let noteImage: HTMLImageElement | null = null;
  if (firstImageUrl) {
    noteImage = await loadImage(firstImageUrl, 5000);
  }

  // Content - clean up links and nostr references
  let content = rawContent
    .replace(/nostr:(nevent|note|npub|nprofile|naddr)[a-z0-9]+/gi, '') // Remove nostr refs
    .replace(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|avif)(\?[^\s]*)?/gi, '') // Remove image URLs (we'll show the image)
    .replace(/https?:\/\/[^\s]+/gi, '🔗') // Replace other URLs with link emoji
    .replace(/\n\s*\n/g, '\n') // Collapse multiple newlines
    .trim();
  
  const hasReferencedNote = referencedNoteContent && referencedNoteAuthor;
  const hasNoteImage = noteImage !== null;
  
  // Adjust content length based on what we're showing
  let maxContentLength = 300;
  if (hasNoteImage && hasReferencedNote) maxContentLength = 100;
  else if (hasNoteImage) maxContentLength = 150;
  else if (hasReferencedNote) maxContentLength = 200;
  
  const displayContent = content.length > maxContentLength 
    ? content.substring(0, maxContentLength) + '...' 
    : content;

  ctx.fillStyle = '#f3f4f6';
  ctx.font = '16px -apple-system, BlinkMacSystemFont, sans-serif';
  
  // Define maxWidth for word wrapping
  const maxWidth = width - padding * 2;
  
  // Word wrap helper
  const wrapText = (text: string, maxY: number, fontSize: number = 16, color: string = '#f3f4f6') => {
    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = color;
    const lineHeight = fontSize * 1.5;
    const words = text.split(' ');
    let line = '';
    
    for (const word of words) {
      const testLine = line + word + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && line !== '') {
        ctx.fillText(line.trim(), padding, y);
        line = word + ' ';
        y += lineHeight;
        if (y > maxY) return;
      } else {
        line = testLine;
      }
    }
    if (line && y <= maxY) {
      ctx.fillText(line.trim(), padding, y);
      y += lineHeight;
    }
  };
  
  // Calculate available space for content vs image
  const footerHeight = 100; // engagement + branding
  const refNoteHeight = hasReferencedNote ? 90 : 0;
  const availableHeight = height - y - footerHeight - refNoteHeight - padding;
  
  // Draw main content (limit height if we have an image)
  const textMaxY = hasNoteImage ? y + Math.min(availableHeight * 0.3, 80) : height - footerHeight - refNoteHeight - 10;
  wrapText(displayContent, textMaxY);
  
  // Draw note image if available
  if (noteImage) {
    y += 10;
    
    // Calculate image dimensions to fit
    const imgMaxWidth = width - padding * 2;
    const imgMaxHeight = Math.min(availableHeight * 0.6, 180);
    
    let imgWidth = noteImage.width;
    let imgHeight = noteImage.height;
    const imgAspect = imgWidth / imgHeight;
    
    // Scale to fit
    if (imgWidth > imgMaxWidth) {
      imgWidth = imgMaxWidth;
      imgHeight = imgWidth / imgAspect;
    }
    if (imgHeight > imgMaxHeight) {
      imgHeight = imgMaxHeight;
      imgWidth = imgHeight * imgAspect;
    }
    
    // Center horizontally
    const imgX = padding + (imgMaxWidth - imgWidth) / 2;
    
    // Draw with rounded corners
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(imgX, y, imgWidth, imgHeight, 8);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(noteImage, imgX, y, imgWidth, imgHeight);
    ctx.restore();
    
    // Add subtle border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(imgX, y, imgWidth, imgHeight, 8);
    ctx.stroke();
    
    y += imgHeight + 10;
  }
  
  // Draw referenced note if present
  if (hasReferencedNote && y < height - footerHeight - 10) {
    y += 5;
    
    // Quote box background
    const quoteBoxY = y;
    const quoteBoxHeight = Math.min(80, height - y - footerHeight - 5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(padding, quoteBoxY, width - padding * 2, quoteBoxHeight, 8);
    ctx.fill();
    ctx.stroke();
    
    y = quoteBoxY + 12;
    
    // Referenced note author
    ctx.fillStyle = '#9ca3af';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`↩ ${referencedNoteAuthor}`, padding + 10, y);
    y += 18;
    
    // Referenced note content (truncated)
    const refContent = referencedNoteContent.length > 80 
      ? referencedNoteContent.substring(0, 80) + '...'
      : referencedNoteContent;
    ctx.fillStyle = '#d1d5db';
    ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
    
    // Simple single-line truncation for quote
    const refMetrics = ctx.measureText(refContent);
    if (refMetrics.width > width - padding * 2 - 20) {
      let truncated = refContent;
      while (ctx.measureText(truncated + '...').width > width - padding * 2 - 20 && truncated.length > 0) {
        truncated = truncated.slice(0, -1);
      }
      ctx.fillText(truncated + '...', padding + 10, y);
    } else {
      ctx.fillText(refContent, padding + 10, y);
    }
    
    y = quoteBoxY + quoteBoxHeight + 5;
  }

  // Engagement metrics at bottom
  y = height - 100;
  
  // Divider line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, y);
  ctx.lineTo(width - padding, y);
  ctx.stroke();
  
  y += 20;

  // Zaps
  const zapAmount = Math.floor(engagementData.zaps.totalAmount / 1000);
  ctx.fillStyle = zapAmount > 0 ? '#fbbf24' : '#6b7280';
  ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`⚡ ${zapAmount} sats`, padding, y);

  // Reactions
  ctx.fillStyle = engagementData.reactions.count > 0 ? '#a855f7' : '#6b7280';
  ctx.fillText(`💜 ${engagementData.reactions.count}`, padding + 120, y);

  // Comments
  ctx.fillStyle = engagementData.comments.count > 0 ? '#60a5fa' : '#6b7280';
  ctx.fillText(`💬 ${engagementData.comments.count}`, padding + 200, y);

  // Footer
  y = height - 45;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.beginPath();
  ctx.moveTo(padding, y);
  ctx.lineTo(width - padding, y);
  ctx.stroke();

  y += 15;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('zap.cooking', padding, y);

  ctx.fillStyle = '#9ca3af';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Found on zap.cooking ⚡', padding, y + 16);

  // Logo icon in bottom right
  const iconSize = 36;
  const iconX = width - padding - iconSize;
  const iconY = height - padding - iconSize;
  
  // Try to load the icon
  const iconImg = await loadImage('/icon.png', 2000);
  if (iconImg) {
    // Draw icon with rounded corners
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(iconX, iconY, iconSize, iconSize, 6);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(iconImg, iconX, iconY, iconSize, iconSize);
    ctx.restore();
  } else {
    // Fallback: draw a simple pan icon box
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.roundRect(iconX, iconY, iconSize, iconSize, 6);
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '22px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🍳', iconX + iconSize / 2, iconY + iconSize / 2);
  }

  // Convert to blob
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        // Fallback to toDataURL
        const dataUrl = canvas.toDataURL('image/png');
        fetch(dataUrl)
          .then(res => res.blob())
          .then(b => resolve(b))
          .catch(() => resolve(null));
      }
    }, 'image/png');
  });
}

/**
 * Promise with timeout wrapper
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
    
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Generate shareable image from note
 */
export async function generateNoteImage(
  event: NDKEvent,
  engagementData: EngagementData,
  format: ImageFormat = 'square',
  showQR: boolean = true,
  authorName?: string,
  authorPicture?: string,
  referencedNote?: ReferencedNote
): Promise<Blob | null> {
  if (!browser) {
    console.error('[ShareImage] Not in browser environment');
    return null;
  }

  // Wrap entire generation with a 15-second timeout
  try {
    return await withTimeout(
      generateNoteImageInternal(event, engagementData, format, showQR, authorName, authorPicture, referencedNote),
      15000,
      'Image generation timed out. Please try again.'
    );
  } catch (error) {
    console.error('[ShareImage] Generation failed or timed out:', error);
    return null;
  }
}

async function generateNoteImageInternal(
  event: NDKEvent,
  engagementData: EngagementData,
  format: ImageFormat,
  showQR: boolean,
  authorName?: string,
  authorPicture?: string,
  referencedNote?: ReferencedNote
): Promise<Blob | null> {
  // Detect Safari
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  // For Safari, use simple canvas drawing instead of html2canvas
  if (isSafari) {
    return generateSafariImage(
      event, 
      engagementData, 
      authorName,
      authorPicture,
      referencedNote?.content,
      referencedNote?.authorName || referencedNote?.authorPubkey?.substring(0, 12)
    );
  }

  let container: HTMLDivElement | null = null;

  try {
    // Extract images from content - skip on Safari due to CORS issues
    const imageUrls = isSafari ? [] : extractImageUrls(event.content || '');

    // Use smaller dimensions for Safari
    const width = isSafari ? 540 : (format === 'square' ? 1080 : 1200);
    const height = isSafari ? 540 : (format === 'square' ? 1080 : 675);

    // Create a temporary container for the card
    container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    document.body.appendChild(container);

    // Create the HTML structure manually - skip all images on Safari
    const cardHTML = createNoteCardHTML(
      event, 
      engagementData, 
      format, 
      showQR, 
      authorName, 
      isSafari ? undefined : authorPicture,
      imageUrls, 
      isSafari ? undefined : referencedNote,
      isSafari // skipAllImages flag for Safari
    );
    container.innerHTML = cardHTML;

    // Wait for images to load (shorter timeout for Safari)
    await waitForImages(container, isSafari ? 2000 : 5000);

    // Generate QR code if needed
    if (showQR) {
      const qrContainer = container.querySelector('#qr-code-container');
      if (qrContainer) {
        const qrDataUrl = await generateQRCode(`https://zap.cooking/${nip19.noteEncode(event.id)}`, 120);
        if (qrDataUrl) {
          qrContainer.innerHTML = `<img src="${qrDataUrl}" style="width: 100%; height: 100%;" />`;
        }
      }
    }

    // Generate canvas with Safari-specific options
    console.log('[ShareImage] Generating canvas with html2canvas...');
    
    const canvas = await html2canvas(container, {
      width,
      height,
      scale: isSafari ? 1 : 2,
      useCORS: !isSafari,
      allowTaint: true,
      backgroundColor: '#1a1a1a',
      logging: false,
      foreignObjectRendering: false,
      removeContainer: false,
      imageTimeout: isSafari ? 0 : 15000,
    });

    // Convert to blob - use toDataURL as fallback for Safari
    let blob: Blob | null = null;
    
    // Try toBlob first (faster when it works)
    try {
      blob = await new Promise<Blob | null>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('toBlob timeout'));
        }, 3000);
        
        canvas.toBlob((b) => {
          clearTimeout(timeout);
          if (b) {
            resolve(b);
          } else {
            reject(new Error('toBlob returned null'));
          }
        }, 'image/png', 1.0);
      });
    } catch (e) {
      // Fallback to toDataURL (works better on Safari)
      const dataUrl = canvas.toDataURL('image/png');
      const response = await fetch(dataUrl);
      blob = await response.blob();
    }

    // Clean up the container after blob is created
    if (container && container.parentNode) {
      document.body.removeChild(container);
      console.log('[ShareImage] Container cleaned up');
    }

    return blob;
  } catch (error) {
    console.error('[ShareImage] Failed to generate note image:', error);
    // Clean up the container on error
    if (container && container.parentNode) {
      document.body.removeChild(container);
      console.log('[ShareImage] Container cleaned up after error');
    }
    return null;
  }
}

/**
 * Create HTML structure for note card (temporary solution until we can properly render Svelte component)
 */
function createNoteCardHTML(
  event: NDKEvent,
  engagementData: EngagementData,
  format: ImageFormat,
  showQR: boolean,
  authorName?: string,
  authorPicture?: string,
  imageUrls: string[] = [],
  referencedNote?: ReferencedNote,
  skipAllImages: boolean = false
): string {
  const noteId = nip19.noteEncode(event.id);
  // Format timestamp nicely
  let timestamp = 'Unknown time';
  if (event.created_at) {
    const date = new Date(event.created_at * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      timestamp = diffMins < 1 ? 'Just now' : `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
    } else if (diffHours < 24) {
      timestamp = `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    } else if (diffDays < 7) {
      timestamp = `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
    } else {
      timestamp = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      });
    }
  }
  
  const zapAmount = Math.floor(engagementData.zaps.totalAmount / 1000);
  const hasZaps = zapAmount > 0;
  const hasReactions = engagementData.reactions.count > 0;
  const hasComments = engagementData.comments.count > 0;
  const hasImages = !skipAllImages && imageUrls.length > 0;
  const hasProfilePicture = !skipAllImages && !!authorPicture;
  const hasReferencedNote = !skipAllImages && !!referencedNote;
  const showLogo = !skipAllImages;

  // Get author pubkey for avatar fallback
  const authorPubkey = event.author?.hexpubkey || event.pubkey;
  
  // Get display name - don't truncate, show full name
  const displayName = authorName || (() => {
    try {
      const npub = nip19.npubEncode(authorPubkey);
      return npub.substring(0, 16) + '...';
    } catch {
      return authorPubkey.substring(0, 16) + '...';
    }
  })();
  
  // Strip image URLs and nostr references from content
  let cleanContent = stripImageUrls(event.content || '');
  cleanContent = stripNostrReferences(cleanContent);
  
  // Truncate content - shorter if we have images or referenced note to display
  const hasMedia = hasImages || hasReferencedNote;
  const maxLength = hasMedia 
    ? (format === 'square' ? 250 : 350)
    : (format === 'square' ? 500 : 800);
  const displayContent = cleanContent.length > maxLength
    ? cleanContent.substring(0, maxLength) + '...'
    : cleanContent;

  // Format content - escape HTML, keep newlines as actual line breaks (using pre-wrap)
  const formattedContent = displayContent
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Note: newlines are preserved by white-space: pre-wrap in CSS
  
  // Format referenced note content if present
  let refNoteContent = '';
  let refNoteAuthor = '';
  if (referencedNote) {
    const refContent = referencedNote.content.length > 200 
      ? referencedNote.content.substring(0, 200) + '...'
      : referencedNote.content;
    refNoteContent = refContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    refNoteAuthor = referencedNote.authorName || referencedNote.authorPubkey.substring(0, 12) + '...';
  }
  
  // Get the origin for absolute URLs (needed for html2canvas to load images)
  const origin = browser ? window.location.origin : '';

  return `
    <div style="
      width: ${format === 'square' ? '1080px' : '1200px'};
      height: ${format === 'square' ? '1080px' : '675px'};
      background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      padding: 60px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
    ">
      <!-- Background decoration -->
      <div style="
        position: absolute;
        top: -50%;
        right: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(circle, rgba(251, 191, 36, 0.1) 0%, transparent 70%);
        pointer-events: none;
      "></div>

      <!-- Header -->
      <div style="
        display: flex;
        align-items: center;
        gap: 20px;
        margin-bottom: 30px;
        z-index: 1;
      ">
        <!-- Profile Picture -->
        ${hasProfilePicture ? `
          <img 
            src="${authorPicture}" 
            crossorigin="anonymous"
            style="
              width: 72px;
              height: 72px;
              border-radius: 50%;
              flex-shrink: 0;
              object-fit: cover;
              border: 3px solid rgba(255, 255, 255, 0.2);
            "
            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
          />
          <div style="
            width: 72px;
            height: 72px;
            border-radius: 50%;
            background: ${generateAvatarColor(authorPubkey)};
            flex-shrink: 0;
            display: none;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            font-weight: bold;
            color: white;
          ">${getInitials(displayName)}</div>
        ` : `
          <div style="
            width: 72px;
            height: 72px;
            border-radius: 50%;
            background: ${generateAvatarColor(authorPubkey)};
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            font-weight: bold;
            color: white;
          ">${getInitials(displayName)}</div>
        `}
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 28px; font-weight: 600; margin-bottom: 4px; line-height: 1.3;">
            ${displayName}
          </div>
          <div style="font-size: 18px; color: #9ca3af; font-weight: 400;">
            ${timestamp}
          </div>
        </div>
      </div>

      <!-- Content -->
      ${formattedContent ? `
        <div style="
          font-size: ${hasImages ? '26px' : '32px'};
          line-height: 1.7;
          color: #f3f4f6;
          margin-bottom: ${hasImages ? '20px' : '30px'};
          overflow: hidden;
          z-index: 1;
          word-wrap: break-word;
          word-break: break-word;
          white-space: pre-wrap;
          letter-spacing: 0.01em;
          ${hasImages ? 'max-height: 200px;' : 'flex: 1;'}
        ">${formattedContent}</div>
      ` : ''}

      <!-- Image (first one only for now) -->
      ${hasImages ? `
        <div style="
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
          overflow: hidden;
          border-radius: 12px;
          background: #111;
          z-index: 1;
        ">
          <img 
            src="${imageUrls[0]}" 
            crossorigin="anonymous"
            style="
              max-width: 100%;
              max-height: 100%;
              object-fit: contain;
              border-radius: 12px;
            "
            onerror="this.style.display='none'"
          />
        </div>
      ` : ''}

      <!-- Referenced/Quoted Note -->
      ${hasReferencedNote && referencedNote ? `
        <div style="
          ${!hasImages ? 'flex: 1;' : ''}
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 20px;
          z-index: 1;
          overflow: hidden;
        ">
          <!-- Referenced note header -->
          <div style="
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
          ">
            ${referencedNote.authorPicture ? `
              <img 
                src="${referencedNote.authorPicture}" 
                crossorigin="anonymous"
                style="
                  width: 36px;
                  height: 36px;
                  border-radius: 50%;
                  object-fit: cover;
                "
                onerror="this.style.display='none'"
              />
            ` : `
              <div style="
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: ${generateAvatarColor(referencedNote.authorPubkey)};
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
                font-weight: bold;
                color: white;
              ">${getInitials(refNoteAuthor)}</div>
            `}
            <div style="font-size: 18px; font-weight: 600; color: #e5e7eb;">
              ${refNoteAuthor}
            </div>
          </div>
          <!-- Referenced note content -->
          <div style="
            font-size: 20px;
            line-height: 1.5;
            color: #d1d5db;
            white-space: pre-wrap;
            word-wrap: break-word;
          ">${refNoteContent}</div>
        </div>
      ` : ''}

      <!-- Engagement metrics - always show all three -->
      <div style="
        display: flex;
        align-items: center;
        gap: 48px;
        padding: 24px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.15);
        z-index: 1;
      ">
        <!-- Zaps -->
        <div style="display: flex; align-items: center; gap: 12px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="${hasZaps ? '#fbbf24' : '#6b7280'}" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          <div style="font-size: 22px; font-weight: 600; color: ${hasZaps ? '#fbbf24' : '#9ca3af'};">
            ${hasZaps ? zapAmount.toLocaleString() : '0'} sats
          </div>
        </div>

        <!-- Reactions -->
        <div style="display: flex; align-items: center; gap: 12px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="${hasReactions ? '#a855f7' : '#6b7280'}" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
          <div style="font-size: 22px; font-weight: 600; color: ${hasReactions ? '#ffffff' : '#9ca3af'};">
            ${engagementData.reactions.count}
          </div>
        </div>

        <!-- Comments -->
        <div style="display: flex; align-items: center; gap: 12px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="${hasComments ? '#60a5fa' : '#6b7280'}" xmlns="http://www.w3.org/2000/svg">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"/>
          </svg>
          <div style="font-size: 22px; font-weight: 600; color: ${hasComments ? '#ffffff' : '#9ca3af'};">
            ${engagementData.comments.count}
          </div>
        </div>
      </div>

      <!-- Footer with logo -->
      <div style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: 24px;
        border-top: 1px solid rgba(255, 255, 255, 0.15);
        z-index: 1;
      ">
        <div>
          <div style="font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">
            zap.cooking
          </div>
          <div style="font-size: 16px; color: #9ca3af; margin-top: 4px;">
            Found on zap.cooking ⚡
          </div>
        </div>
        ${showLogo ? `
          <!-- Pan logo in bottom right -->
          <img 
            src="${origin}/icon.png" 
            crossorigin="anonymous"
            style="
              width: 80px;
              height: 80px;
              object-fit: contain;
            "
            onerror="this.style.display='none'"
          />
        ` : `
          <!-- Text logo fallback for Safari -->
          <div style="
            font-size: 48px;
            font-weight: bold;
            color: #fbbf24;
          ">🍳</div>
        `}
      </div>
    </div>
  `;
}

/**
 * Wait for all images in container to load (with timeout)
 */
function waitForImages(container: HTMLElement, timeoutMs: number = 5000): Promise<void> {
  return new Promise((resolve) => {
    const images = container.querySelectorAll('img');
    if (images.length === 0) {
      resolve();
      return;
    }

    let loaded = 0;
    const total = images.length;
    let resolved = false;

    // Timeout to prevent hanging
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, timeoutMs);

    const checkComplete = () => {
      loaded++;
      if (loaded === total && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        // Give a small delay for rendering
        setTimeout(resolve, 100);
      }
    };

    images.forEach((img) => {
      if (img.complete) {
        checkComplete();
      } else {
        img.onload = checkComplete;
        img.onerror = () => {
          checkComplete();
        };
      }
    });
  });
}

/**
 * Share or download the image
 */
export async function shareNoteImage(
  blob: Blob,
  filename: string
): Promise<boolean> {
  if (!browser) return false;

  try {
    // Try native share API first (mobile)
    if (navigator.share && navigator.canShare) {
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Found on zap.cooking ⚡',
        });
        return true;
      }
    }

    // Fall back to download (desktop)
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error('Failed to share/download image:', error);
    return false;
  }
}
