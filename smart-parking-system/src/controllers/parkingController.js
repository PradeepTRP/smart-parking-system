const parkingService = require('../services/parkingService');

exports.getSlots = async (req, res, next) => {
    try {
        const result = await parkingService.getParkingSlots();
        res.json({
            success: true,
            ...result
        });
    } catch (err) {
        next(err);
    }
};

exports.addSlot = async (req, res, next) => {
    try {
        const { slot_number } = req.body;
        if (!slot_number) {
            return res.status(400).json({ success: false, message: 'Slot number is required (e.g. SLOT-11).' });
        }

        const slot = await parkingService.addParkingSlot(slot_number);
        res.status(201).json({
            success: true,
            message: `Parking slot ${slot.slot_number} created successfully.`,
            data: slot
        });
    } catch (err) {
        next(err);
    }
};
