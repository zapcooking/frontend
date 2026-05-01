import DOMPurify from 'dompurify';

const SANITIZE_CONFIG = {
  ADD_ATTR: ['target']
};

type DOMPurifyLike = {
  sanitize: (html: string, config?: typeof SANITIZE_CONFIG) => string;
  addHook?: (hook: 'afterSanitizeAttributes', callback: (node: Element) => void) => void;
};

let purifier: DOMPurifyLike | null = null;

function getPurifier(): DOMPurifyLike {
  if (purifier) return purifier;

  const domPurify = DOMPurify as unknown as DOMPurifyLike & ((window: Window) => DOMPurifyLike);
  purifier = typeof window !== 'undefined' ? domPurify(window) : domPurify;

  purifier.addHook?.('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer nofollow ugc');
    }
  });

  return purifier;
}

export function sanitizeHTML(html: string): string {
  return getPurifier().sanitize(html, SANITIZE_CONFIG);
}
