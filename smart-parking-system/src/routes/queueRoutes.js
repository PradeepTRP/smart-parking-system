const express = require('express');
const router = express.Router();
const queueController = require('../controllers/queueController');

// GET /api/queue
router.get('/', queueController.getQueue);

// GET /api/queue/front
router.get('/front', queueController.getFront);

// GET /api/queue/rear
router.get('/rear', queueController.getRear);

// DELETE /api/queue/:vehicleNumber
router.delete('/:vehicleNumber', queueController.cancelWaiting);

module.exports = router;
