const express = require('express');
const router = express.Router();
const historyController = require('../controllers/historyController');

// GET /api/history
router.get('/', historyController.getHistory);

// GET /api/history/:vehicleNumber
router.get('/:vehicleNumber', historyController.getHistoryByVehicle);

module.exports = router;
