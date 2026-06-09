const http = require('http');
const fs = require('fs');
const path = require('path');

let PORT = parseInt(process.env.PORT) || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  // Normalize and resolve file path
  let filePath = req.url === '/' ? '/index.html' : req.url;
  // Remove query string or hash if present
  filePath = filePath.split('?')[0].split('#')[0];
  
  const absolutePath = path.join(__dirname, filePath);

  // Security check: ensure path is within the project directory
  if (!absolutePath.startsWith(__dirname)) {
    res.statusCode = 403;
    res.end('Access Denied');
    return;
  }

  fs.stat(absolutePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // If path is a route that might be handled by frontend routing (SPA), serve index.html
      // Otherwise return 404. Since this is a simple SPA, we'll fallback to index.html
      // if it does not look like a file request (no extension).
      const ext = path.extname(absolutePath);
      if (!ext) {
        fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
          if (err) {
            res.statusCode = 500;
            res.end('Error loading index.html');
          } else {
            res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
            res.end(content);
          }
        });
      } else {
        res.statusCode = 404;
        res.end('File Not Found');
      }
      return;
    }

    fs.readFile(absolutePath, (err, content) => {
      if (err) {
        res.statusCode = 500;
        res.end('Server Error');
        return;
      }

      const ext = path.extname(absolutePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(content);
    });
  });
});

function startServer(port) {
  server.listen(port);
}

server.on('listening', () => {
  const address = server.address();
  console.log(`LiteTube Server is running at http://localhost:${address.port}`);
  console.log('Press Ctrl+C to stop.');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is in use, trying port ${PORT + 1}...`);
    PORT++;
    startServer(PORT);
  } else {
    console.error('Server error:', err);
  }
});

startServer(PORT);
