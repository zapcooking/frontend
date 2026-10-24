import { filterImageUrls, isImageUrl } from './imageUrls';

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

export type ZapCommentSegment =
  | { type: 'text'; value: string }
  | { type: 'url'; href: string; label: string };

export interface ParsedZapComment {
  segments: ZapCommentSegment[];
  imageUrls: string[];
}

export function shortenZapUrl(url: string, maxLength = 64): string {
  const label = url.replace(/^https?:\/\//i, '');
  if (label.length <= maxLength) return label;

  const safeLength = Math.max(16, maxLength);
  const tailLength = Math.min(14, Math.floor(safeLength / 3));
  const headLength = safeLength - tailLength - 3;
  return `${label.slice(0, headLength)}...${label.slice(-tailLength)}`;
}

export function parseZapComment(comment: string): ParsedZapComment {
  if (!comment) return { segments: [], imageUrls: [] };

  const segments: ZapCommentSegment[] = [];
  const imageCandidates: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(comment)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: comment.slice(lastIndex, match.index) });
    }

    const raw = match[0];
    const href = raw.replace(TRAILING_PUNCTUATION, '');
    const trailing = raw.slice(href.length);

    if (isImageUrl(href)) {
      imageCandidates.push(href);
    } else {
      segments.push({ type: 'url', href, label: shortenZapUrl(href) });
      if (trailing) segments.push({ type: 'text', value: trailing });
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < comment.length) {
    segments.push({ type: 'text', value: comment.slice(lastIndex) });
  }

  return { segments, imageUrls: filterImageUrls(imageCandidates) };
}
