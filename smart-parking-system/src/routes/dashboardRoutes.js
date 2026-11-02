const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// GET /api/dashboard
router.get('/dashboard', dashboardController.getDashboard);

// GET /api/reports
router.get('/reports', dashboardController.getReports);

// GET /api/settings
router.get('/settings', dashboardController.getSettings);

// PUT /api/settings/capacity
router.put('/settings/capacity', dashboardController.updateCapacity);

// POST /api/settings/seed
router.post('/settings/seed', dashboardController.seedDemo);

// POST /api/settings/reset
router.post('/settings/reset', dashboardController.resetSystem);

module.exports = router;
