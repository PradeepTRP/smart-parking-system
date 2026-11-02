const express = require('express');
const router = express.Router();
const parkingController = require('../controllers/parkingController');

// GET /api/parking/slots
router.get('/slots', parkingController.getSlots);

// POST /api/parking/slots
router.post('/slots', parkingController.addSlot);

module.exports = router;
