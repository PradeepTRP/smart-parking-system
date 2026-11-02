const parkingService = require('../services/parkingService');

exports.getQueue = async (req, res, next) => {
    try {
        const queue = await parkingService.getWaitingQueue();
        const front = await parkingService.getFrontVehicle();
        const rear = await parkingService.getRearVehicle();

        res.json({
            success: true,
            total_waiting: queue.length,
            status: {
                queue_size: queue.length,
                is_empty: queue.length === 0,
                front,
                rear
            },
            data: queue
        });
    } catch (err) {
        next(err);
    }
};

exports.getFront = async (req, res, next) => {
    try {
        const front = await parkingService.getFrontVehicle();
        res.json({
            success: true,
            data: front
        });
    } catch (err) {
        next(err);
    }
};

exports.getRear = async (req, res, next) => {
    try {
        const rear = await parkingService.getRearVehicle();
        res.json({
            success: true,
            data: rear
        });
    } catch (err) {
        next(err);
    }
};

exports.cancelWaiting = async (req, res, next) => {
    try {
        const { vehicleNumber } = req.params;
        const result = await parkingService.cancelWaitingVehicle(vehicleNumber);
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
