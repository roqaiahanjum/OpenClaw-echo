import { isSimpleConversation } from './src/core/conversationGuard';

const cases: [string, boolean][] = [
  ['Run this JavaScript: console.log(2+2)', false],
  ['What are my goals?', false],
  ['Add a goal: finish testing', false],
  ['hi', true],
  ['Hello there!', true],
  ['How are you?', true],
  ['2+2', true],
  ['what is 15 * 4?', true],
  ['calculate 100 / 5', true],
  ['Check git status', false],
  ['Send email to boss', false],
  ['Search latest news', false],
  ['Read file notes.txt', false]
];

let allPassed = true;
for (const [prompt, expected] of cases) {
  const actual = isSimpleConversation(prompt);
  const pass = actual === expected;
  if (!pass) allPassed = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} => "${prompt}" (expected ${expected}, got ${actual})`);
}

if (!allPassed) {
  process.exit(1);
} else {
  console.log('All conversationGuard tests PASSED!');
  process.exit(0);
}
