#!/usr/bin/env node
/**
 * Test script to verify Open Graph meta tags for recipe pages.
 *
 * Fakes a facebookexternalhit crawler User-Agent so the server `handle` hook
 * (src/hooks.server.ts) renders real recipe OG tags instead of the client-side
 * placeholders. Exercises BOTH recipe route shapes: /recipe/<naddr> and
 * /r/<naddr>.
 *
 * Usage:
 *   1. Start local dev server: pnpm dev:cloudflare
 *   2. In another terminal: node test-og-tags.js <recipe-naddr>
 *
 * Example:
 *   node test-og-tags.js naddr1qvzqqqr4gupzq44he2prxpk7qcde4fu6nrw4ktn7aa5erpgya4vpcrpld7fajwquqqwhg6rfwvkkjuedvykhgetnwskz6mn0wskkzttjv43kjur995lx8uqx
 */

const recipeNaddr =
  process.argv[2] ||
  'naddr1qvzqqqr4gupzq44he2prxpk7qcde4fu6nrw4ktn7aa5erpgya4vpcrpld7fajwquqqwhg6rfwvkkjuedvykhgetnwskz6mn0wskkzttjv43kjur995lx8uqx';
const baseUrl = process.env.TEST_URL || 'http://localhost:8788';

// Placeholder values the client renders before its NDK fetch settles. If a
// crawler sees these, the server-side injection did NOT run.
const PLACEHOLDER_TITLE = 'Recipe';
const PLACEHOLDER_DESC = 'A recipe shared on zap.cooking - Food. Friends. Freedom.';

function extract(html) {
  return {
    ogTitle: html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i)?.[1],
    ogDescription: html.match(
      /<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i
    )?.[1],
    ogImage: html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']*)["']/i)?.[1],
    ogUrl: html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']*)["']/i)?.[1],
    twitterCard: html.match(/<meta\s+name=["']twitter:card["']\s+content=["']([^"']*)["']/i)?.[1]
  };
}

async function testPath(path) {
  const url = `${baseUrl}${path}`;
  console.log(`\n🧪 Testing OG tags for: ${url}\n`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
    }
  });

  if (!response.ok) {
    console.error(`❌ HTTP ${response.status}: ${response.statusText}`);
    return false;
  }

  const html = await response.text();
  const { ogTitle, ogDescription, ogImage, ogUrl, twitterCard } = extract(html);

  console.log('📋 Results:');
  console.log('─'.repeat(60));
  console.log(`   og:title:       ${ogTitle || '❌ MISSING'}`);
  console.log(
    `   og:description: ${ogDescription ? ogDescription.substring(0, 60) + '…' : '❌ MISSING'}`
  );
  console.log(`   og:image:       ${ogImage || '❌ MISSING'}`);
  console.log(`   og:url:         ${ogUrl || '❌ MISSING'}`);
  console.log(`   twitter:card:   ${twitterCard || '❌ MISSING'}`);
  console.log('─'.repeat(60));

  const allPresent = ogTitle && ogDescription && ogImage && ogUrl && twitterCard;
  if (!allPresent) {
    console.log('❌ Some OG tags are missing!');
    return false;
  }

  const isPlaceholder = ogTitle === PLACEHOLDER_TITLE && ogDescription === PLACEHOLDER_DESC;
  if (isPlaceholder) {
    console.log(
      '⚠️  OG tags are the generic PLACEHOLDERS — server-side injection did not resolve the recipe.'
    );
    console.log('   (This is acceptable as a timeout fallback, but not when the recipe exists.)');
    return false;
  }

  console.log('✅ Real recipe OG tags present.');
  return true;
}

async function main() {
  const paths = [`/recipe/${recipeNaddr}`, `/r/${recipeNaddr}`];
  const results = [];
  for (const path of paths) {
    try {
      results.push(await testPath(path));
    } catch (error) {
      console.error(`\n❌ Error testing ${path}: ${error.message}`);
      console.log('\n💡 Make sure the dev server is running:  pnpm dev:cloudflare');
      results.push(false);
    }
  }

  const allOk = results.every(Boolean);
  console.log('\n' + '═'.repeat(60));
  if (allOk) {
    console.log('✅ All recipe routes return real OG tags!');
    console.log('\n💡 Validate with social media debuggers:');
    console.log(`   - Facebook: https://developers.facebook.com/tools/debug/`);
    console.log(`   - LinkedIn: https://www.linkedin.com/post-inspector/`);
  } else {
    console.log('❌ One or more recipe routes failed.');
    process.exit(1);
  }
}

main();
