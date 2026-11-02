const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { db, DB_PATH } = require('./database/db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types for static asset serving
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// Check if express is installed
let useExpress = false;
try {
    require.resolve('express');
    require.resolve('cors');
    useExpress = true;
} catch (e) {
    useExpress = false;
}

if (useExpress) {
    // -------------------------------------------------------------
    // OPTION A: EXPRESS.JS (When npm dependencies are installed)
    // -------------------------------------------------------------
    const express = require('express');
    const cors = require('cors');
    const apiRoutes = require('./routes/api');

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(PUBLIC_DIR));
    app.use('/api', apiRoutes);

    app.get('*', (req, res) => {
        res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    });

    startServer(app);
} else {
    // -------------------------------------------------------------
    // OPTION B: ZERO-DEPENDENCY NATIVE HTTP SERVER (Runs instantly!)
    // -------------------------------------------------------------
    const apiRoutes = require('./routes/api');

    const server = http.createServer((req, res) => {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            return res.end();
        }

        // Helper response methods matching Express
        res.status = function(code) {
            this.statusCode = code;
            return this;
        };

        res.json = function(data) {
            this.setHeader('Content-Type', 'application/json');
            this.end(JSON.stringify(data));
        };

        // Parse URL and query
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;
        req.query = parsedUrl.query;

        // Collect body data for POST / PUT / DELETE
        let bodyBuffer = '';
        req.on('data', chunk => { bodyBuffer += chunk; });
        req.on('end', () => {
            req.body = {};
            if (bodyBuffer) {
                try {
                    req.body = JSON.parse(bodyBuffer);
                } catch (e) {
                    // Try URL-encoded parsing
                    const params = new URLSearchParams(bodyBuffer);
                    for (const [key, val] of params) {
                        req.body[key] = val;
                    }
                }
            }

            // Route API calls
            if (pathname.startsWith('/api')) {
                const handled = apiRoutes.dispatch(req, res, pathname);
                if (handled) return;

                res.status(404).json({ success: false, message: `Route ${pathname} not found.` });
                return;
            }

            // Serve Static Files from public/
            let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

            // Security check: prevent directory traversal
            if (!filePath.startsWith(PUBLIC_DIR)) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }

            fs.stat(filePath, (err, stats) => {
                if (err || !stats.isFile()) {
                    // Fallback to index.html for SPA client-side routing
                    filePath = path.join(PUBLIC_DIR, 'index.html');
                }

                const ext = path.extname(filePath).toLowerCase();
                const contentType = MIME_TYPES[ext] || 'application/octet-stream';

                fs.readFile(filePath, (readErr, content) => {
                    if (readErr) {
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        return res.end('Server file read error.');
                    }
                    res.writeHead(200, { 'Content-Type': contentType });
                    res.end(content);
                });
            });
        });
    });

    startServer(server);
}

function startServer(appOrServer) {
    const srv = typeof appOrServer.listen === 'function' ? appOrServer.listen(PORT, onListening) : appOrServer.listen(PORT, onListening);

    function onListening() {
        console.log(`
========================================================================
   🚗 SMART PARKING MANAGEMENT SYSTEM USING QUEUE DATA STRUCTURE 🚗
========================================================================
   [✓] Server running on:       http://localhost:${PORT}
   [✓] SQLite Database Path:    ${DB_PATH}
   [✓] Queue Data Structure:    FIFO (First In First Out) Persistent Queue
   [✓] Execution Mode:          ${useExpress ? 'Express.js Framework' : 'Native High-Speed Node Server'}
========================================================================
   Server is live and listening on port ${PORT}!
========================================================================
`);
    }

    process.on('SIGINT', () => {
        console.log('\nGracefully shutting down Smart Parking System...');
        try { db.close(); } catch (_) {}
        process.exit(0);
    });
}
