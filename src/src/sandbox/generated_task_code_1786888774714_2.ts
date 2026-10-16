```typescript
// Import the required libraries
import { PythonShell } from 'python-shell';

// Delegate the task to the Coder sub-agent
async function calculateFactorial() {
    // Define the task
    const task = {
        language: 'python',
        script: 'factorial.py', // Python script to calculate factorial
        args: ['5'] // Input number to calculate factorial
    };

    // Create a new PythonShell instance
    const pythonShell = new PythonShell('factorial.py', {
        mode: 'json'
    });

    // Capture the output
    let output = '';
    pythonShell.on('data', (data) => {
        output += data.toString();
    });

    // Handle the end of the script
    pythonShell.on('end', () => {
        console.log(`Factorial of 5: ${output}`);
    });

    // Handle the error
    pythonShell.on('error', (err) => {
        console.log(`Error: ${err}`);
    });
}

// Run the task
calculateFactorial();
```

```python
# factorial.py
import sys

# Get the input number
num = int(sys.argv[1])

# Calculate the factorial
factorial = 1
for i in range(1, num + 1):
    factorial *= i

# Print the result
print(factorial)
```

To run this code, you'll need to have Node.js and the `python-shell` library installed. You can install the `python-shell` library using npm:

```bash
npm install python-shell
```

You'll also need to have Python installed on your system. The `factorial.py` script should be in the same directory as the TypeScript code. When you run the `calculateFactorial` function, it will execute the `factorial.py` script with the input `5` and print the result.