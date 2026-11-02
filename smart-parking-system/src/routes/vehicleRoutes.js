const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');

// GET /api/vehicles
router.get('/vehicles', vehicleController.getAllVehicles);

// POST /api/vehicles/entry
router.post('/vehicles/entry', vehicleController.registerVehicle);

// POST /api/vehicles/exit
router.post('/vehicles/exit', vehicleController.exitVehicle);

// GET /api/vehicles/:vehicleNumber
router.get('/vehicles/:vehicleNumber', vehicleController.getVehicleByNumber);

module.exports = router;
