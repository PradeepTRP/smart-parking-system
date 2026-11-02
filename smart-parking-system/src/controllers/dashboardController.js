const parkingService = require('../services/parkingService');

exports.getDashboard = async (req, res, next) => {
    try {
        const data = await parkingService.getDashboardMetrics();
        res.json({
            success: true,
            data
        });
    } catch (err) {
        next(err);
    }
};

exports.getReports = async (req, res, next) => {
    try {
        const data = await parkingService.getReports();
        res.json({
            success: true,
            data
        });
    } catch (err) {
        next(err);
    }
};

exports.getSettings = async (req, res, next) => {
    try {
        const data = await parkingService.getSettings();
        res.json({
            success: true,
            data
        });
    } catch (err) {
        next(err);
    }
};

exports.updateCapacity = async (req, res, next) => {
    try {
        const { capacity } = req.body;
        const result = await parkingService.updateCapacity(capacity);
        res.json(result);
    } catch (err) {
        next(err);
    }
};

exports.seedDemo = async (req, res, next) => {
    try {
        const result = await parkingService.seedDemoData();
        res.json(result);
    } catch (err) {
        next(err);
    }
};

exports.resetSystem = async (req, res, next) => {
    try {
        const result = await parkingService.resetSystem();
        res.json(result);
    } catch (err) {
        next(err);
    }
};
