#!/usr/bin/env node
/**
 * Test script to verify Open Graph meta tags for recipe pages
 * 
 * Usage:
 *   1. Start local dev server: pnpm dev:cloudflare
 *   2. In another terminal: node test-og-tags.js <recipe-naddr>
 * 
 * Example:
 *   node test-og-tags.js naddr1qvzqqqr4gupzq44he2prxpk7qcde4fu6nrw4ktn7aa5erpgya4vpcrpld7fajwquqqwhg6rfwvkkjuedvykhgetnwskz6mn0wskkzttjv43kjur995lx8uqx
 */

const recipeNaddr = process.argv[2] || 'naddr1qvzqqqr4gupzq44he2prxpk7qcde4fu6nrw4ktn7aa5erpgya4vpcrpld7fajwquqqwhg6rfwvkkjuedvykhgetnwskz6mn0wskkzttjv43kjur995lx8uqx';
const baseUrl = process.env.TEST_URL || 'http://localhost:8788';

async function testOGTags() {
  const url = `${baseUrl}/recipe/${recipeNaddr}`;
  console.log(`\n🧪 Testing OG tags for: ${url}\n`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
      }
    });

    if (!response.ok) {
      console.error(`❌ HTTP ${response.status}: ${response.statusText}`);
      process.exit(1);
    }

    const html = await response.text();
    
    // Extract meta tags
    const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1];
    const ogDescription = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1];
    const ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1];
    const ogUrl = html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i)?.[1];
    const twitterCard = html.match(/<meta\s+name=["']twitter:card["']\s+content=["']([^"']+)["']/i)?.[1];

    console.log('📋 Results:');
    console.log('─'.repeat(60));
    console.log(`✅ og:title:      ${ogTitle || '❌ MISSING'}`);
    console.log(`✅ og:description: ${ogDescription ? ogDescription.substring(0, 60) + '...' : '❌ MISSING'}`);
    console.log(`✅ og:image:       ${ogImage || '❌ MISSING'}`);
    console.log(`✅ og:url:         ${ogUrl || '❌ MISSING'}`);
    console.log(`✅ twitter:card:   ${twitterCard || '❌ MISSING'}`);
    console.log('─'.repeat(60));

    const allPresent = ogTitle && ogDescription && ogImage && ogUrl && twitterCard;
    
    if (allPresent) {
      console.log('\n✅ All OG tags are present!');
      console.log('\n💡 Test with social media validators:');
      console.log(`   - Facebook: https://developers.facebook.com/tools/debug/?q=${encodeURIComponent(url)}`);
      console.log(`   - Twitter:  https://cards-dev.twitter.com/validator`);
      console.log(`   - LinkedIn: https://www.linkedin.com/post-inspector/inspect/${encodeURIComponent(url)}`);
    } else {
      console.log('\n❌ Some OG tags are missing!');
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.log('\n💡 Make sure the dev server is running:');
    console.log('   pnpm dev:cloudflare');
    process.exit(1);
  }
}

testOGTags();

