### Python Code
```typescript
// Import the required module
import { execSync } from 'child_process';

// Function to calculate factorial
function calculateFactorial(n: number): number {
    // Use the Python script to calculate the factorial
    const pythonProcess = execSync(`python -c "import math; print(math.factorial(${n}))"`, { encoding: 'utf8' });
    // Return the result
    return parseInt(pythonProcess);
}

// Test the function
console.log(calculateFactorial(5));  // Output: 120
```

### Alternative Python Code using a separate Python script
```typescript
// Create a new Python script (factorial.py)
console.log(`// Create a new file named factorial.py`);
console.log(`import math`);
console.log(`def calculate_factorial(n):`);
console.log(`    return math.factorial(n)`);
console.log(`# Test the function`);
console.log(`print(calculate_factorial(5))`);

// Run the Python script
console.log('// Run the Python script');
console.log(`import subprocess`);
console.log(`subprocess.run(['python', 'factorial.py'])`);
```

### Alternative TypeScript Code using a custom function
```typescript
// Function to calculate factorial
function calculateFactorial(n: number): number {
    let result = 1;
    for (let i = 1; i <= n; i++) {
        result *= i;
    }
    return result;
}

// Test the function
console.log(calculateFactorial(5));  // Output: 120
```