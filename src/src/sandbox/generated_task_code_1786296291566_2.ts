```typescript
/**
 * Checks if a given string is a palindrome.
 * A palindrome is a word, phrase, number, or other sequence of characters
 * which reads the same backward as forward, ignoring punctuation, case, and spacing.
 *
 * @param str The input string to check.
 * @returns True if the string is a palindrome, false otherwise.
 */
function isPalindrome(str: string): boolean {
  // Normalize the string: convert to lowercase and remove non-alphanumeric characters.
  const normalizedStr = str.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Reverse the normalized string.
  const reversedStr = normalizedStr.split('').reverse().join('');

  // Compare the normalized string with its reversed version.
  return normalizedStr === reversedStr;
}

// --- Example Usage ---

console.log(`"madam" is a palindrome: ${isPalindrome("madam")}`); // true
console.log(`"A man, a plan, a canal: Panama" is a palindrome: ${isPalindrome("A man, a plan, a canal: Panama")}`); // true
console.log(`"hello" is a palindrome: ${isPalindrome("hello")}`); // false
console.log(`"Racecar" is a palindrome: ${isPalindrome("Racecar")}`); // true
console.log(`"No lemon, no melon" is a palindrome: ${isPalindrome("No lemon, no melon")}`); // true
console.log(`"12321" is a palindrome: ${isPalindrome("12321")}`); // true
console.log(`"Was it a car or a cat I saw?" is a palindrome: ${isPalindrome("Was it a car or a cat I saw?")}`); // true
console.log(`"TypeScript" is a palindrome: ${isPalindrome("TypeScript")}`); // false
```