```typescript
// Define a function to delegate a task to the Coder sub-agent
function delegateTask(task: string): string {
    // Define the Coder sub-agent
    class Coder {
        // Define a method to calculate factorial
        calculateFactorial(num: number): number {
            // Base case: factorial of 0 or 1 is 1
            if (num === 0 || num === 1) {
                return 1;
            }
            // Recursive case: num * (num-1)!
            else {
                return num * this.calculateFactorial(num - 1);
            }
        }
    }

    // Create an instance of the Coder sub-agent
    const coder = new Coder();

    // Delegate the task to the Coder sub-agent
    const result = `The factorial of ${task} is ${coder.calculateFactorial(parseInt(task))}`;
    return result;
}

// Delegate the task to calculate the factorial of 5
console.log(delegateTask('5'));
```

```typescript
// For a pure JavaScript/TypeScript solution without recursion
function factorial(n: number): number {
    let result = 1;
    for (let i = 2; i <= n; i++) {
        result *= i;
    }
    return result;
}

// Delegate the task to calculate the factorial of 5
console.log(`The factorial of 5 is ${factorial(5)}`);
```