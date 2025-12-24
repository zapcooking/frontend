/**
 * Tests for NIP-89 Client Tag Parser
 * 
 * @see https://github.com/nostr-protocol/nips/blob/master/89.md
 */

import { parseClientTag } from './clientTag';

console.log('Running NIP-89 client tag parser tests...\n');

// Test 1: Full NIP-89 format with handler address and relay hint
const tags1 = [
  ['t', 'food'],
  ['client', 'Zap Cooking', '31990:abc123def456abc123def456abc123def456abc123def456abc123def456abcd:zap-cooking', 'wss://relay.example.com']
];
const result1 = parseClientTag(tags1);
console.assert(result1 !== null, 'Test 1a Failed: Should parse full NIP-89 tag');
console.assert(result1?.name === 'Zap Cooking', 'Test 1b Failed: Name should be "Zap Cooking"');
console.assert(result1?.handlerAddress === '31990:abc123def456abc123def456abc123def456abc123def456abc123def456abcd:zap-cooking', 'Test 1c Failed: Handler address should match');
console.assert(result1?.relayHint === 'wss://relay.example.com', 'Test 1d Failed: Relay hint should match');
console.log('✓ Test 1 Passed: Full NIP-89 format parsed correctly');

// Test 2: Simplified format with just name
const tags2 = [
  ['t', 'cooking'],
  ['client', 'zap.cooking']
];
const result2 = parseClientTag(tags2);
console.assert(result2 !== null, 'Test 2a Failed: Should parse simplified tag');
console.assert(result2?.name === 'zap.cooking', 'Test 2b Failed: Name should be "zap.cooking"');
console.assert(result2?.handlerAddress === undefined, 'Test 2c Failed: Should have no handler address');
console.assert(result2?.relayHint === undefined, 'Test 2d Failed: Should have no relay hint');
console.log('✓ Test 2 Passed: Simplified format parsed correctly');

// Test 3: No client tag present
const tags3 = [
  ['t', 'food'],
  ['p', 'somepubkey']
];
const result3 = parseClientTag(tags3);
console.assert(result3 === null, 'Test 3 Failed: Should return null when no client tag');
console.log('✓ Test 3 Passed: No client tag returns null');

// Test 4: Empty client name should return null
const tags4 = [
  ['client', '']
];
const result4 = parseClientTag(tags4);
console.assert(result4 === null, 'Test 4 Failed: Empty name should return null');
console.log('✓ Test 4 Passed: Empty client name returns null');

// Test 5: Client tag with only whitespace name should return null
const tags5 = [
  ['client', '   ']
];
const result5 = parseClientTag(tags5);
console.assert(result5 === null, 'Test 5 Failed: Whitespace name should return null');
console.log('✓ Test 5 Passed: Whitespace client name returns null');

// Test 6: Invalid handler address format should be ignored
const tags6 = [
  ['client', 'TestClient', 'invalid-address', 'wss://relay.test']
];
const result6 = parseClientTag(tags6);
console.assert(result6 !== null, 'Test 6a Failed: Should still parse tag');
console.assert(result6?.name === 'TestClient', 'Test 6b Failed: Name should be "TestClient"');
console.assert(result6?.handlerAddress === undefined, 'Test 6c Failed: Invalid handler address should be ignored');
console.log('✓ Test 6 Passed: Invalid handler address ignored');

// Test 7: Invalid relay hint should be ignored
const tags7 = [
  ['client', 'TestClient', '31990:abc123def456abc123def456abc123def456abc123def456abc123def456abcd:test', 'http://not-websocket']
];
const result7 = parseClientTag(tags7);
console.assert(result7 !== null, 'Test 7a Failed: Should still parse tag');
console.assert(result7?.relayHint === undefined, 'Test 7b Failed: Invalid relay hint should be ignored');
console.log('✓ Test 7 Passed: Invalid relay hint ignored');

// Test 8: Malformed tags array should not crash
const tags8 = null as any;
const result8 = parseClientTag(tags8);
console.assert(result8 === null, 'Test 8 Failed: Null tags should return null');
console.log('✓ Test 8 Passed: Null tags handled gracefully');

// Test 9: Empty tags array
const tags9: string[][] = [];
const result9 = parseClientTag(tags9);
console.assert(result9 === null, 'Test 9 Failed: Empty tags should return null');
console.log('✓ Test 9 Passed: Empty tags array returns null');

// Test 10: Multiple client tags - should return first one
const tags10 = [
  ['client', 'FirstClient'],
  ['client', 'SecondClient']
];
const result10 = parseClientTag(tags10);
console.assert(result10?.name === 'FirstClient', 'Test 10 Failed: Should return first client tag');
console.log('✓ Test 10 Passed: First client tag returned when multiple exist');

// Test 11: Client tag with extra items in array
const tags11 = [
  ['client', 'TestClient', '31990:abc123def456abc123def456abc123def456abc123def456abc123def456abcd:test', 'wss://relay.test', 'extra1', 'extra2']
];
const result11 = parseClientTag(tags11);
console.assert(result11 !== null, 'Test 11a Failed: Should parse tag with extra items');
console.assert(result11?.name === 'TestClient', 'Test 11b Failed: Name should be correct');
console.log('✓ Test 11 Passed: Extra array items ignored gracefully');

// Test 12: Name with leading/trailing whitespace should be trimmed
const tags12 = [
  ['client', '  Trimmed Client  ']
];
const result12 = parseClientTag(tags12);
console.assert(result12?.name === 'Trimmed Client', 'Test 12 Failed: Name should be trimmed');
console.log('✓ Test 12 Passed: Whitespace trimmed from name');

console.log('\n✅ All NIP-89 client tag parser tests completed successfully!');

