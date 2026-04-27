const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log("Running part 1...");
require('./create_backend_part1.cjs');
console.log("Running part 2...");
require('./create_backend_part2.cjs');
console.log("Running part 3...");
require('./create_backend_part3.cjs');
console.log("Running part 4...");
require('./create_backend_part4.cjs');
console.log("Running part 5...");
require('./create_backend_part5.cjs');

console.log("All generation scripts completed.");
