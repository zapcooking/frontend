import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt();

// Override link renderer to open links in new tab
const defaultRender = md.renderer.rules.link_open || function(tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.link_open = function(tokens, idx, options, env, self) {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return defaultRender(tokens, idx, options, env, self);
};

export function parseMarkdown(markdown: string) {
  const parsedMarkdown = md.render(markdown);
  return DOMPurify.sanitize(parsedMarkdown);
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

// Phase definitions for grouping directions
export interface DirectionPhase {
  id: string;
  title: string;
  steps: Array<{ number: number; text: string }>;
}

const PHASE_KEYWORDS: Record<string, string[]> = {
  preparation: ['crust', 'dough', 'pastry', 'base', 'bottom', 'prepare', 'ready', 'separate bowl'],
  mixing: ['mix', 'combine', 'blend', 'beat', 'whisk', 'fold', 'stir', 'cream', 'batter', 'mixture', 'filling', 'cheesecake', 'cream cheese', 'layer', 'add', 'ingredients'],
  baking: ['preheat', 'bake', 'oven', 'temperature', 'degrees', 'minutes', 'scoop', 'cookie sheet', 'baking sheet', 'cook', 'roast', 'grill'],
  finishing: ['cool', 'chill', 'refrigerate', 'set', 'rest', 'garnish', 'serve', 'raspberr', 'mint', 'sprinkle', 'decorate', 'top', 'walnuts', 'nuts', 'ganache', 'chocolate', 'melt', 'chocolate chips']
};

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
 * Extracts directions from markdown and groups them into phases
 */
export function extractAndGroupDirections(markdown: string): {
  directions: DirectionPhase[];
  markdownWithoutDirections: string;
} {
  const steps = extractDirectionsFlexible(markdown);
  
  if (steps.length === 0) {
    // Return empty phases and original markdown if directions can't be parsed
    return { directions: [], markdownWithoutDirections: markdown };
  }

  // Group steps into phases
  // Note: Phases are generic enough to work for various recipe types
  // Steps are automatically grouped based on keyword matching
  const phases: DirectionPhase[] = [
    { id: 'preparation', title: 'Preparation', steps: [] },
    { id: 'mixing', title: 'Mixing & Combining', steps: [] },
    { id: 'baking', title: 'Baking & Cooking', steps: [] },
    { id: 'finishing', title: 'Finishing & Serving', steps: [] }
  ];

  let currentPhaseIndex = 0;

  for (const step of steps) {
    const stepLower = step.text.toLowerCase();
    
    // Use keyword matching to assign steps to phases (only move forward)
    let phaseFound = false;
    for (let i = currentPhaseIndex; i < phases.length; i++) {
      const keywords = PHASE_KEYWORDS[phases[i].id];
      if (keywords && keywords.some(keyword => stepLower.includes(keyword))) {
        currentPhaseIndex = i;
        phaseFound = true;
        break;
      }
    }

    // Assign step to current phase (or keep in current phase if no keywords matched)
    phases[currentPhaseIndex].steps.push(step);
  }

  // Filter out empty phases
  const nonEmptyPhases = phases.filter(phase => phase.steps.length > 0);

  // Remove Directions section from markdown (case-insensitive, handles various formats)
  let markdownWithoutDirections = markdown;
  
  // Try to remove ## Directions section
  const directionsSectionRegex = /## Directions\s*\n[\s\S]*?(?=\n## |$)/i;
  if (directionsSectionRegex.test(markdownWithoutDirections)) {
    markdownWithoutDirections = markdownWithoutDirections.replace(directionsSectionRegex, '').trim();
  } else {
    // Try without ##
    const altDirectionsRegex = /(?:^|\n)Directions\s*\n[\s\S]*?(?=\n(?:## |[A-Z][a-z]+:)|$)/i;
    if (altDirectionsRegex.test(markdownWithoutDirections)) {
      markdownWithoutDirections = markdownWithoutDirections.replace(altDirectionsRegex, '').trim();
    }
  }

  return {
    directions: nonEmptyPhases,
    markdownWithoutDirections
  };
}
