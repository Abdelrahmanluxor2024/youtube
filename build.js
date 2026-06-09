const fs = require('fs');
const path = require('path');

const filesToCopy = ['index.html', 'styles.css', 'app.js', 'icons.js'];
const distDir = path.join(__dirname, 'dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir);
}

// Copy each file
filesToCopy.forEach(file => {
  const src = path.join(__dirname, file);
  const dest = path.join(distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Successfully copied ${file} to dist/`);
  } else {
    console.error(`Error: File ${file} not found!`);
    process.exit(1); // Fail build if a required file is missing
  }
});

console.log('Build completed successfully.');
