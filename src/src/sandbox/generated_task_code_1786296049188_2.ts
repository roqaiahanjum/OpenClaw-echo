```typescript
/**
 * Checks if a given string is a palindrome.
 * A palindrome is a word, phrase, number, or other sequence of characters
 * which reads the same backward as forward, ignoring punctuation, case, and spacing.
 *
 * @param text The input string to check.
 * @returns True if the string is a palindrome, false otherwise.
 */
function isPalindrome(text: string): boolean {
  // Normalize the string: convert to lowercase and remove non-alphanumeric characters.
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Reverse the normalized string.
  const reversedText = normalizedText.split('').reverse().join('');

  // Compare the normalized string with its reversed version.
  return normalizedText === reversedText;
}

// --- Example Usage ---

console.log(`"madam" is a palindrome: ${isPalindrome("madam")}`); // Expected: true
console.log(`"Madam" is a palindrome: ${isPalindrome("Madam")}`); // Expected: true (case-insensitive)
console.log(`"A man, a plan, a canal: Panama" is a palindrome: ${isPalindrome("A man, a plan, a canal: Panama")}`); // Expected: true (ignores punctuation and spaces)
console.log(`"Racecar" is a palindrome: ${isPalindrome("Racecar")}`); // Expected: true
console.log(`"hello" is a palindrome: ${isPalindrome("hello")}`); // Expected: false
console.log(`"No 'x' in Nixon" is a palindrome: ${isPalindrome("No 'x' in Nixon")}`); // Expected: true
console.log(`"" (empty string) is a palindrome: ${isPalindrome("")}`); // Expected: true (conventionally)
console.log(`"a" is a palindrome: ${isPalindrome("a")}`); // Expected: true
```