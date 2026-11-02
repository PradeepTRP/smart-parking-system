try { require('dotenv').config(); } catch (_) {}
const express = require('express');
const cors = require('cors');
const path = require('path');

const { isConfigured } = require('../src/config/supabase');
const errorHandler = require('../src/middleware/errorHandler');

// Route modules
const dashboardRoutes = require('../src/routes/dashboardRoutes');
const vehicleRoutes = require('../src/routes/vehicleRoutes');
const parkingRoutes = require('../src/routes/parkingRoutes');
const queueRoutes = require('../src/routes/queueRoutes');
const historyRoutes = require('../src/routes/historyRoutes');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files when running locally
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// -------------------------------------------------------------
// 1. HEALTH CHECK ENDPOINT
// -------------------------------------------------------------
app.get('/api/health', (req, res) => {
    res.json({
        status: 'UP',
        service: 'Smart Parking Management System (FIFO Queue)',
        database: isConfigured ? 'CONNECTED (Supabase Cloud)' : 'UNCONFIGURED',
        environment: process.env.NODE_ENV || 'production',
        timestamp: new Date().toISOString()
    });
});

// -------------------------------------------------------------
// 2. MOUNT API ROUTES
// -------------------------------------------------------------
// Dashboard, reports & settings (/api/dashboard, /api/reports, /api/settings)
app.use('/api', dashboardRoutes);

// Vehicles (/api/vehicles, /api/vehicles/entry, /api/vehicles/exit)
app.use('/api', vehicleRoutes);

// Parking Slots (/api/parking/slots)
app.use('/api/parking', parkingRoutes);

// Waiting Queue (/api/queue)
app.use('/api/queue', queueRoutes);

// Parking History (/api/history)
app.use('/api/history', historyRoutes);

// -------------------------------------------------------------
// 3. FRONTEND FALLBACK (SPA Support)
// -------------------------------------------------------------
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found.` });
    }
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// -------------------------------------------------------------
// 4. CENTRALIZED ERROR HANDLING
// -------------------------------------------------------------
app.use(errorHandler);

// Export Express app for Vercel Serverless Function
module.exports = app;

// Local Development Server
if (require.main === module || !process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`
========================================================================
   🚗 SMART PARKING MANAGEMENT SYSTEM - FULL-STACK DEPLOYMENT 🚗
========================================================================
   [✓] Local Server:            http://localhost:${PORT}
   [✓] Database Engine:         Supabase PostgreSQL (${isConfigured ? 'Configured' : 'Missing credentials in .env'})
   [✓] Deployment Platform:     GitHub + Vercel Serverless
========================================================================
`);
    });
}
