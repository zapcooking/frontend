import MarkdownIt from 'markdown-it';
import { sanitizeHTML } from '$lib/sanitize';

const md = new MarkdownIt({ linkify: true });

// Override link renderer to open links in new tab
const defaultRender = md.renderer.rules.link_open || function(tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.link_open = function(tokens, idx, options, env, self) {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return defaultRender(tokens, idx, options, env, self);
};

const YOUTUBE_PATTERNS = [
  /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([a-zA-Z0-9_-]{11})(?:[&#].*)?$/,
  /^(?:https?:\/\/)?(?:www\.|m\.)?youtu\.be\/([a-zA-Z0-9_-]{11})(?:[?#].*)?$/,
  /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})(?:[?#].*)?$/,
  /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})(?:[?#].*)?$/
];

function extractYoutubeId(url: string): string | null {
  const trimmed = url.trim();
  for (const re of YOUTUBE_PATTERNS) {
    const m = trimmed.match(re);
    if (m) return m[1];
  }
  return null;
}

const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;
const HASHTAG_SKIP_TAGS = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

function collectTextNodes(el: Element, out: Text[]): void {
  if (HASHTAG_SKIP_TAGS.has(el.nodeName)) return;
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      out.push(child as Text);
    } else if (child.nodeType === 1) {
      collectTextNodes(child as Element, out);
    }
  }
}

function linkHashtagsInElement(root: Element, doc: Document): void {
  const textNodes: Text[] = [];
  collectTextNodes(root, textNodes);
  for (const node of textNodes) {
    const text = node.textContent || '';
    HASHTAG_RE.lastIndex = 0;
    if (!HASHTAG_RE.test(text)) continue;
    HASHTAG_RE.lastIndex = 0;

    const fragment = doc.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HASHTAG_RE.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(doc.createTextNode(text.slice(lastIndex, match.index)));
      }
      const a = doc.createElement('a');
      a.setAttribute('href', `/tag/${match[1].toLowerCase()}`);
      a.className = 'hashtag-link';
      a.textContent = match[0];
      fragment.appendChild(a);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      fragment.appendChild(doc.createTextNode(text.slice(lastIndex)));
    }
    node.parentNode?.replaceChild(fragment, node);
  }
}

function buildYoutubeEmbed(id: string, doc: Document): HTMLElement {
  const wrapper = doc.createElement('div');
  wrapper.className = 'youtube-embed';
  const iframe = doc.createElement('iframe');
  iframe.setAttribute('src', `https://www.youtube-nocookie.com/embed/${id}`);
  iframe.setAttribute('title', 'YouTube video player');
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute(
    'allow',
    'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
  );
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('loading', 'lazy');
  wrapper.appendChild(iframe);
  return wrapper;
}

function embedYoutubeInElement(root: Element, doc: Document): void {
  const paragraphs = Array.from(root.querySelectorAll('p'));
  for (const p of paragraphs) {
    const links = p.querySelectorAll('a');
    if (links.length !== 1) continue;
    const link = links[0];
    const href = link.getAttribute('href') || '';
    const id = extractYoutubeId(href);
    if (!id) continue;

    const wrapper = buildYoutubeEmbed(id, doc);

    // Strip any leading decorative chars (emoji, whitespace, punctuation) before the link
    // and check whether the link is effectively the entire paragraph.
    const paraText = (p.textContent || '').trim();
    const linkText = (link.textContent || '').trim();
    const decorationStripped = paraText
      .replace(/^[\s\p{P}\p{S}]+/u, '')
      .replace(/[\s\p{P}\p{S}]+$/u, '');

    if (decorationStripped === linkText) {
      p.replaceWith(wrapper);
    } else {
      p.parentNode?.insertBefore(wrapper, p.nextSibling);
    }
  }
}

function enhanceContent(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return html;
  embedYoutubeInElement(root, doc);
  linkHashtagsInElement(root, doc);
  return root.innerHTML;
}

export function parseMarkdown(markdown: string) {
  const parsedMarkdown = md.render(markdown);
  const sanitized = sanitizeHTML(parsedMarkdown);
  return enhanceContent(sanitized);
}

interface MarkdownInformation {

  prepTime: string;
  cookTime: string;
  servings: string;
}

interface MarkdownTemplate {
  chefNotes?: string;
  information?: MarkdownInformation;
  ingredients: string[];
  directions: string[];
  additionalMarkdown?: string;
}

/**
 * Lenient parser for editing - extracts content without strict validation
 * Used when loading recipes for editing to avoid losing data due to format issues
 */
export function parseMarkdownForEditing(markdown: string): MarkdownTemplate {
  const template: MarkdownTemplate = {
    ingredients: [],
    directions: []
  };

  template.information = {
    prepTime: '',
    cookTime: '',
    servings: ''
  };

  // Extract Chef's notes
  const chefNotesMatch = markdown.match(/## Chef's notes\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (chefNotesMatch) {
    template.chefNotes = chefNotesMatch[1].trim();
  }

  // Extract Details
  const detailsMatch = markdown.match(/## Details\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (detailsMatch) {
    const detailsContent = detailsMatch[1];
    const prepMatch = detailsContent.match(/⏲️ Prep time[:\s]+([^\n]+)/i);
    const cookMatch = detailsContent.match(/🍳 Cook time[:\s]+([^\n]+)/i);
    const servingsMatch = detailsContent.match(/🍽️ Servings[:\s]+([^\n]+)/i);
    if (prepMatch) template.information.prepTime = prepMatch[1].trim();
    if (cookMatch) template.information.cookTime = cookMatch[1].trim();
    if (servingsMatch) template.information.servings = servingsMatch[1].trim();
  }

  // Extract Ingredients - be lenient with format
  const ingredientsMatch = markdown.match(/## Ingredients\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (ingredientsMatch) {
    const lines = ingredientsMatch[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        template.ingredients.push(trimmed.substring(2).trim());
      } else if (trimmed.startsWith('* ')) {
        template.ingredients.push(trimmed.substring(2).trim());
      } else if (trimmed && !trimmed.startsWith('#')) {
        // Include non-empty lines that aren't headers
        template.ingredients.push(trimmed);
      }
    }
  }

  // Extract Directions - be lenient with format
  const directionsMatch = markdown.match(/## Directions\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (directionsMatch) {
    const lines = directionsMatch[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Match numbered steps (1. 2. etc)
      const numberedMatch = trimmed.match(/^(\d+)\.\s*(.+)$/);
      if (numberedMatch) {
        template.directions.push(numberedMatch[2].trim());
      } else if (trimmed.startsWith('- ')) {
        template.directions.push(trimmed.substring(2).trim());
      } else if (trimmed && !trimmed.startsWith('#') && trimmed.length > 10) {
        // Include substantial non-empty lines
        template.directions.push(trimmed);
      }
    }
  }

  // Extract Additional Resources
  const additionalMatch = markdown.match(/## Additional Resources\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (additionalMatch) {
    template.additionalMarkdown = additionalMatch[1].trim();
  }

  return template;
}

export function validateMarkdownTemplate(markdown: string): MarkdownTemplate | string {
  const template: MarkdownTemplate = {
    ingredients: [],
    directions: []
  };

  template.information = {
    prepTime: '',
    cookTime: '',
    servings: ''
  };

  const sections = markdown.match(/## [A-Za-z\s']+\n[^#]+/g);

  if (!sections) {
    return 'Sections are missing.';
  }

  for (const section of sections) {
    if (section.startsWith("## Chef's notes")) {
      const chefNotes = section.split("## Chef's notes")[1].trim();
      if (chefNotes.length > 99999) {
        return "Chef's notes exceed character limit.";
      }
      template.chefNotes = chefNotes;
    } else if (section.startsWith('## Details')) {
      const detailsLines = section.split('\n').slice(1, -1);
      for (const line of detailsLines) {
        const [key, value] = line.split(': ');
        if (key === '- ⏲️ Prep time') {
          if (value.length > 999) {
            return 'Prep time exceeds character limit.';
          }
          template.information.prepTime = value;
        } else if (key === '- 🍳 Cook time') {
          if (value.length > 999) {
            return 'Cook time exceeds character limit.';
          }
          template.information.cookTime = value;
        } else if (key === '- 🍽️ Servings') {
          if (value.length > 999) {
            return 'Servings exceed character limit.';
          }
          template.information.servings = value;
        }
      }
    } else if (section.startsWith('## Ingredients')) {
      const ingredientsLines = section.split('\n').slice(1, -1);
      for (const line of ingredientsLines) {
        if (line.startsWith('- ')) {
          const ingredient = line.substring(2).trim();
          if (ingredient.length > 9999) {
            return 'An ingredient exceeds the character limit.';
          }
          template.ingredients.push(ingredient);
        }
      }
    } else if (section.startsWith('## Directions')) {
      const directionsLines = section.split('\n').slice(1);
      let prevStepNumber = 0;
      for (const line of directionsLines) {
        if (line.match(/^\d+\./)) {
          // @ts-expect-error i'm not going to mess with this, it's probably fine though.
          const stepNumber = parseInt(line.match(/^\d+/)[0], 10);
          if (stepNumber !== prevStepNumber + 1) {
            return 'Directions are not in the correct ordered list format.';
          }
          const stepDescription = line.split(/^\d+\./)[1].trim();
          if (stepDescription.length > 9999) {
            return 'A step in the directions exceeds the character limit.';
          }
          template.directions.push(stepDescription);
          prevStepNumber = stepNumber;
        } else if (line.trim() !== '') {
          return 'Directions are not in the correct ordered list format.';
        }
      }
    } else if (section.startsWith('## Additional Resources')) {
      const additionalMarkdown = section.split('## Additional Resources')[1].trim();
      template.additionalMarkdown = additionalMarkdown;
    }
  }

  if (template.directions.length < 1 || template.ingredients.length < 1) {
    return 'Directions and/or ingredients list too short.';
  }

  return template;
}

export function createMarkdown(
  chefsnotes: string,
  preptime: string,
  cooktime: string,
  servings: string,
  ingredients: string,
  directions: string,
  additionalMarkdown: string
) {
  let template: string = ``;

  if (chefsnotes !== '') {
    template += `
## Chef's notes

${chefsnotes}
`;
  }

  if (preptime !== '' || cooktime !== '' || servings !== '') {
    template += `
## Details

`;
    if (preptime !== '') {
      template += `- ⏲️ Prep time: ${preptime}
`;
    }

    if (cooktime !== '') {
      template += `- 🍳 Cook time: ${cooktime}
`;
    }

    if (servings !== '') {
      template += `- 🍽️ Servings: ${servings}
`;
    }
  }

  if (ingredients.length > 1) {
    template += `
## Ingredients

`;
    template += ingredients;
  }

  if (directions.length > 1) {
    template += `

## Directions

`;
    template += directions;
  }

  if (additionalMarkdown !== '') {
    template += `

## Additional Resources

${additionalMarkdown}

`;
  }

  return template;
}

// Phase shape preserved for component/print-modal compatibility. We no longer
// auto-group directions into phases — the keyword heuristic frequently
// mis-classified steps (e.g. assigning "Bake for 65 minutes" to Finishing),
// which confused readers more than it helped. `extractAndGroupDirections` now
// always returns a single "Directions" phase containing every step.
export interface DirectionPhase {
  id: string;
  title: string;
  steps: Array<{ number: number; text: string }>;
}

/**
 * Flexible parser for directions that handles various formats
 */
function extractDirectionsFlexible(markdown: string): Array<{ number: number; text: string }> {
  // Try strict validation first (numbered format)
  const validated = validateMarkdownTemplate(markdown);
  if (typeof validated !== 'string' && validated.directions && validated.directions.length > 0) {
    return validated.directions.map((text, index) => ({
      number: index + 1,
      text
    }));
  }

  // Fallback: Try to extract from ## Directions section with flexible parsing
  const directionsMatch = markdown.match(/## Directions\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (directionsMatch) {
    const directionsContent = directionsMatch[1].trim();
    const steps: Array<{ number: number; text: string }> = [];
    
    // Split by lines and process each
    const lines = directionsContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let stepNumber = 1;
    for (const line of lines) {
      // Check if line starts with a number (numbered format)
      const numberedMatch = line.match(/^(\d+)\.\s*(.+)$/);
      if (numberedMatch) {
        steps.push({
          number: parseInt(numberedMatch[1], 10),
          text: numberedMatch[2].trim()
        });
        stepNumber = parseInt(numberedMatch[1], 10) + 1;
      } else if (line.match(/^[-*•]\s+/)) {
        // Bullet point format - treat as step
        steps.push({
          number: stepNumber++,
          text: line.replace(/^[-*•]\s+/, '').trim()
        });
      } else if (line.length > 10) {
        // Plain text line (not a header or empty) - treat as step
        // Skip very short lines that might be formatting
        steps.push({
          number: stepNumber++,
          text: line
        });
      }
    }
    
    if (steps.length > 0) {
      return steps;
    }
  }

  // Last resort: Look for "Directions" heading (case-insensitive, without ##)
  const altDirectionsMatch = markdown.match(/(?:^|\n)Directions\s*\n([\s\S]*?)(?=\n(?:## |[A-Z][a-z]+:)|$)/i);
  if (altDirectionsMatch) {
    const directionsContent = altDirectionsMatch[1].trim();
    const steps: Array<{ number: number; text: string }> = [];
    
    // Split by periods followed by space or newline, or by newlines
    const sentences = directionsContent
      .split(/(?<=[.!?])\s+(?=[A-Z])|(?<=\n)/)
      .map(s => s.trim())
      .filter(s => s.length > 10); // Filter out very short fragments
    
    sentences.forEach((sentence, index) => {
      steps.push({
        number: index + 1,
        text: sentence.replace(/^[-*•\d+\.]\s*/, '').trim() // Remove any leading bullets or numbers
      });
    });
    
    if (steps.length > 0) {
      return steps;
    }
  }

  return [];
}

/**
 * Extracts directions from markdown. Returns a single "Directions" phase so
 * downstream renderers/print code don't have to change shape.
 */
export function extractAndGroupDirections(markdown: string): {
  directions: DirectionPhase[];
  markdownWithoutDirections: string;
} {
  const steps = extractDirectionsFlexible(markdown);

  // Remove Directions section from markdown (case-insensitive, handles various formats)
  let markdownWithoutDirections = markdown;
  const directionsSectionRegex = /## Directions\s*\n[\s\S]*?(?=\n## |$)/i;
  if (directionsSectionRegex.test(markdownWithoutDirections)) {
    markdownWithoutDirections = markdownWithoutDirections.replace(directionsSectionRegex, '').trim();
  } else {
    const altDirectionsRegex = /(?:^|\n)Directions\s*\n[\s\S]*?(?=\n(?:## |[A-Z][a-z]+:)|$)/i;
    if (altDirectionsRegex.test(markdownWithoutDirections)) {
      markdownWithoutDirections = markdownWithoutDirections.replace(altDirectionsRegex, '').trim();
    }
  }

  if (steps.length === 0) {
    return { directions: [], markdownWithoutDirections };
  }

  return {
    directions: [{ id: 'directions', title: 'Directions', steps }],
    markdownWithoutDirections
  };
}

/**
 * Extracts recipe details (prep time, cook time, servings) from markdown
 * Returns null values if not found
 */
export interface RecipeDetails {
  prepTime: string | null;
  cookTime: string | null;
  servings: string | null;
}

export function extractRecipeDetails(markdown: string): RecipeDetails {
  const details: RecipeDetails = {
    prepTime: null,
    cookTime: null,
    servings: null
  };

  // Try using validateMarkdownTemplate first (handles strict format)
  const validated = validateMarkdownTemplate(markdown);
  if (typeof validated !== 'string' && validated.information) {
    details.prepTime = validated.information.prepTime || null;
    details.cookTime = validated.information.cookTime || null;
    details.servings = validated.information.servings || null;
    
    // If we got any details, return early
    if (details.prepTime || details.cookTime || details.servings) {
      return details;
    }
  }

  // Fallback: Try flexible extraction from Details section
  const detailsMatch = markdown.match(/## Details\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (detailsMatch) {
    const detailsContent = detailsMatch[1].trim();
    const lines = detailsContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    for (const line of lines) {
      // Match patterns like "- ⏲️ Prep time: ..." or "- Prep time: ..."
      const prepMatch = line.match(/[-•]\s*(?:⏲️|⏱️)?\s*Prep\s+time:?\s*(.+)/i);
      if (prepMatch) {
        details.prepTime = prepMatch[1].trim();
        continue;
      }
      
      // Match patterns like "- 🍳 Cook time: ..." or "- Cook time: ..."
      const cookMatch = line.match(/[-•]\s*(?:🍳|🔥|⏰)?\s*Cook\s+time:?\s*(.+)/i);
      if (cookMatch) {
        details.cookTime = cookMatch[1].trim();
        continue;
      }
      
      // Match patterns like "- 🍽️ Servings: ..." or "- Servings: ..."
      const servingsMatch = line.match(/[-•]\s*(?:🍽️|👥|🥘)?\s*Servings:?\s*(.+)/i);
      if (servingsMatch) {
        details.servings = servingsMatch[1].trim();
        continue;
      }
    }
  }

  return details;
}
