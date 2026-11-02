const parkingService = require('../services/parkingService');
const { supabase } = require('../config/supabase');

exports.registerVehicle = async (req, res, next) => {
    try {
        const { owner_name, vehicle_number, vehicle_type } = req.body;

        if (!owner_name || !owner_name.trim()) {
            return res.status(400).json({ success: false, message: 'Owner name is required.' });
        }
        if (!vehicle_number || !vehicle_number.trim()) {
            return res.status(400).json({ success: false, message: 'Vehicle registration number is required.' });
        }
        if (!vehicle_type || !['Car', 'Bike', 'Van'].includes(vehicle_type)) {
            return res.status(400).json({ success: false, message: 'Vehicle type must be Car, Bike, or Van.' });
        }

        const result = await parkingService.registerVehicleEntry(owner_name, vehicle_number, vehicle_type);

        if (!result.success) {
            return res.status(409).json(result);
        }

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

exports.exitVehicle = async (req, res, next) => {
    try {
        const { vehicle_number } = req.body;

        if (!vehicle_number || !vehicle_number.trim()) {
            return res.status(400).json({ success: false, message: 'Vehicle registration number is required.' });
        }

        const result = await parkingService.processVehicleExit(vehicle_number);

        if (!result.success) {
            return res.status(404).json(result);
        }

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

exports.getVehicleByNumber = async (req, res, next) => {
    try {
        const cleanNumber = (req.params.vehicleNumber || '').trim().toUpperCase();

        const { data: vehicle, error } = await supabase
            .from('vehicles')
            .select('*, parking_slots(slot_number)')
            .eq('vehicle_number', cleanNumber)
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        if (!vehicle) {
            return res.status(404).json({ success: false, message: `No active records found for vehicle ${cleanNumber}.` });
        }

        res.json({ success: true, data: vehicle });
    } catch (err) {
        next(err);
    }
};

exports.getAllVehicles = async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from('vehicles')
            .select('*, parking_slots(slot_number)')
            .in('status', ['PARKED', 'WAITING'])
            .order('id', { ascending: true });

        if (error) throw error;

        res.json({ success: true, count: data ? data.length : 0, data: data || [] });
    } catch (err) {
        next(err);
    }
};
