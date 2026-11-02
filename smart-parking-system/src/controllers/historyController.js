const parkingService = require('../services/parkingService');

exports.getHistory = async (req, res, next) => {
    try {
        const result = await parkingService.getParkingHistory(req.query);
        res.json({
            success: true,
            ...result
        });
    } catch (err) {
        next(err);
    }
};

exports.getHistoryByVehicle = async (req, res, next) => {
    try {
        const { vehicleNumber } = req.params;
        const result = await parkingService.getParkingHistory({ search: vehicleNumber });
        res.json({
            success: true,
            ...result
        });
    } catch (err) {
        next(err);
    }
};
