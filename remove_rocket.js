const fs = require('fs');
let input = fs.readFileSync(0, 'utf-8');
input = input.replace(/^🚀\s*/, '');
process.stdout.write(input);
