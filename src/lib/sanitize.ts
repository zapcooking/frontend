import DOMPurify from 'isomorphic-dompurify';

const SANITIZE_CONFIG = {
  ADD_ATTR: ['target']
};

type DOMPurifyLike = {
  sanitize: (html: string, config?: typeof SANITIZE_CONFIG) => string;
  addHook?: (hook: 'afterSanitizeAttributes', callback: (node: Element) => void) => void;
};

const purifier = DOMPurify as unknown as DOMPurifyLike;

purifier.addHook?.('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer nofollow ugc');
  }
});

export function sanitizeHTML(html: string): string {
  return purifier.sanitize(html, SANITIZE_CONFIG);
}
