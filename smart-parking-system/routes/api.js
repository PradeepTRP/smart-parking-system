const { db, seedDemoData, initializeDefaultSlots } = require('../database/db');
const VehicleQueue = require('../models/queue');

const vehicleQueue = new VehicleQueue(db);

/**
 * -------------------------------------------------------------
 * ROUTE HANDLERS
 * -------------------------------------------------------------
 */

// 1. DASHBOARD
function handleDashboard(req, res) {
    try {
        const totalSlotsRow = db.prepare('SELECT COUNT(*) as count FROM parking_slots').get();
        const occupiedSlotsRow = db.prepare("SELECT COUNT(*) as count FROM parking_slots WHERE status = 'OCCUPIED'").get();
        const waitingRow = db.prepare("SELECT COUNT(*) as count FROM vehicles WHERE status = 'WAITING'").get();
        
        const totalTodayRow = db.prepare(`
            SELECT COUNT(*) as count FROM parking_history 
            WHERE date(entry_time) = date('now', 'localtime')
        `).get();

        const totalSlots = totalSlotsRow.count;
        const occupiedSlots = occupiedSlotsRow.count;
        const availableSlots = Math.max(0, totalSlots - occupiedSlots);
        const waitingVehicles = waitingRow.count;
        const totalVehiclesToday = totalTodayRow.count;
        const totalCurrentlyParked = occupiedSlots;

        const slots = db.prepare(`
            SELECT 
                ps.id,
                ps.slot_number,
                ps.status,
                ps.current_vehicle_id,
                v.owner_name,
                v.vehicle_number,
                v.vehicle_type,
                v.entry_time,
                ROUND((julianday('now', 'localtime') - julianday(v.entry_time)) * 86400) AS parked_seconds
            FROM parking_slots ps
            LEFT JOIN vehicles v ON ps.current_vehicle_id = v.id
            ORDER BY ps.id ASC
        `).all();

        const recentActivities = db.prepare(`
            SELECT 
                id,
                vehicle_number,
                owner_name,
                vehicle_type,
                slot_number,
                entry_time,
                exit_time,
                status
            FROM parking_history
            ORDER BY id DESC
            LIMIT 8
        `).all();

        const queuePreview = vehicleQueue.display().slice(0, 5);

        const typeDistribution = db.prepare(`
            SELECT vehicle_type, COUNT(*) as count 
            FROM vehicles 
            WHERE status IN ('PARKED', 'WAITING')
            GROUP BY vehicle_type
        `).all();

        res.json({
            success: true,
            data: {
                total_slots: totalSlots,
                available_slots: availableSlots,
                occupied_slots: occupiedSlots,
                waiting_vehicles: waitingVehicles,
                total_vehicles_today: totalVehiclesToday,
                total_currently_parked: totalCurrentlyParked,
                occupancy_rate: totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 100) : 0,
                slots,
                recent_activities: recentActivities,
                queue_preview: queuePreview,
                type_distribution: typeDistribution,
                server_time: new Date().toISOString()
            }
        });
    } catch (err) {
        console.error('Error fetching dashboard data:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard data.' });
    }
}

// 2. PARKING SLOTS
function handleGetSlots(req, res) {
    try {
        const slots = db.prepare(`
            SELECT 
                ps.id,
                ps.slot_number,
                ps.status,
                ps.current_vehicle_id,
                v.owner_name,
                v.vehicle_number,
                v.vehicle_type,
                v.entry_time,
                ROUND((julianday('now', 'localtime') - julianday(v.entry_time)) * 86400) AS parked_seconds
            FROM parking_slots ps
            LEFT JOIN vehicles v ON ps.current_vehicle_id = v.id
            ORDER BY ps.id ASC
        `).all();

        res.json({
            success: true,
            total_slots: slots.length,
            available: slots.filter(s => s.status === 'AVAILABLE').length,
            occupied: slots.filter(s => s.status === 'OCCUPIED').length,
            data: slots
        });
    } catch (err) {
        console.error('Error fetching slots:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch parking slots.' });
    }
}

function handleAddSlot(req, res) {
    try {
        const { slot_number } = req.body || {};
        if (!slot_number || !slot_number.trim()) {
            return res.status(400).json({ success: false, message: 'Slot number is required (e.g. SLOT-11).' });
        }

        const cleanSlotNumber = slot_number.trim().toUpperCase();
        const exists = db.prepare('SELECT id FROM parking_slots WHERE slot_number = ?').get(cleanSlotNumber);
        if (exists) {
            return res.status(400).json({ success: false, message: `Slot ${cleanSlotNumber} already exists.` });
        }

        const insert = db.prepare('INSERT INTO parking_slots (slot_number, status) VALUES (?, "AVAILABLE")');
        const info = insert.run(cleanSlotNumber);

        res.status(201).json({
            success: true,
            message: `Parking slot ${cleanSlotNumber} created successfully.`,
            slot_id: info.lastInsertRowid
        });
    } catch (err) {
        console.error('Error adding slot:', err);
        res.status(500).json({ success: false, message: 'Failed to add parking slot.' });
    }
}

// 3. VEHICLE ENTRY
function handleVehicleEntry(req, res) {
    try {
        const { owner_name, vehicle_number, vehicle_type } = req.body || {};

        if (!owner_name || !owner_name.trim()) {
            return res.status(400).json({ success: false, message: 'Owner name is required.' });
        }
        if (!vehicle_number || !vehicle_number.trim()) {
            return res.status(400).json({ success: false, message: 'Vehicle registration number is required.' });
        }
        if (!vehicle_type || !['Car', 'Bike', 'Van'].includes(vehicle_type)) {
            return res.status(400).json({ success: false, message: 'Valid vehicle type (Car, Bike, Van) is required.' });
        }

        const cleanVehicleNumber = vehicle_number.trim().toUpperCase();
        const cleanOwnerName = owner_name.trim();

        // Prevent duplicate active registrations
        const activeVehicle = db.prepare(`
            SELECT v.*, ps.slot_number 
            FROM vehicles v
            LEFT JOIN parking_slots ps ON v.slot_id = ps.id
            WHERE v.vehicle_number = ? AND v.status IN ('PARKED', 'WAITING')
        `).get(cleanVehicleNumber);

        if (activeVehicle) {
            if (activeVehicle.status === 'PARKED') {
                return res.status(409).json({
                    success: false,
                    message: `Vehicle ${cleanVehicleNumber} is already parked at ${activeVehicle.slot_number || 'a slot'}. Duplicate entry rejected.`
                });
            } else if (activeVehicle.status === 'WAITING') {
                return res.status(409).json({
                    success: false,
                    message: `Vehicle ${cleanVehicleNumber} is already in the waiting queue (Position #${activeVehicle.queue_order}). Duplicate entry rejected.`
                });
            }
        }

        // Check available slot
        const availableSlot = db.prepare(`
            SELECT id, slot_number 
            FROM parking_slots 
            WHERE status = 'AVAILABLE' 
            ORDER BY id ASC 
            LIMIT 1
        `).get();

        if (availableSlot) {
            const allocateTransaction = db.transaction(() => {
                const insertVeh = db.prepare(`
                    INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id, queue_order)
                    VALUES (?, ?, ?, datetime('now', 'localtime'), 'PARKED', ?, NULL)
                `);
                const vehResult = insertVeh.run(cleanOwnerName, cleanVehicleNumber, vehicle_type, availableSlot.id);
                const vehicleId = vehResult.lastInsertRowid;

                db.prepare(`
                    UPDATE parking_slots 
                    SET status = 'OCCUPIED', current_vehicle_id = ? 
                    WHERE id = ?
                `).run(vehicleId, availableSlot.id);

                db.prepare(`
                    INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, exit_time, status)
                    VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'), NULL, 'PARKED')
                `).run(vehicleId, cleanOwnerName, cleanVehicleNumber, vehicle_type, availableSlot.slot_number);

                return vehicleId;
            });

            const vehicleId = allocateTransaction();

            return res.status(200).json({
                success: true,
                status: 'PARKED',
                allocated_slot: availableSlot.slot_number,
                vehicle: {
                    id: vehicleId,
                    owner_name: cleanOwnerName,
                    vehicle_number: cleanVehicleNumber,
                    vehicle_type: vehicle_type
                },
                message: `Success! Vehicle ${cleanVehicleNumber} has been allocated to ${availableSlot.slot_number}.`
            });
        } else {
            // Parking full -> FIFO Queue
            const enqueuedVehicle = vehicleQueue.enqueue({
                owner_name: cleanOwnerName,
                vehicle_number: cleanVehicleNumber,
                vehicle_type: vehicle_type
            });

            db.prepare(`
                INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, exit_time, status)
                VALUES (?, ?, ?, ?, 'WAITING QUEUE', datetime('now', 'localtime'), NULL, 'WAITING')
            `).run(enqueuedVehicle.id, cleanOwnerName, cleanVehicleNumber, vehicle_type);

            return res.status(200).json({
                success: true,
                status: 'WAITING',
                queue_position: enqueuedVehicle.position,
                vehicle: enqueuedVehicle,
                message: `Parking Full! Vehicle ${cleanVehicleNumber} added to Waiting Queue at position #${enqueuedVehicle.position}.`
            });
        }
    } catch (err) {
        console.error('Vehicle Entry Error:', err);
        res.status(500).json({ success: false, message: 'Internal server error while processing vehicle entry.' });
    }
}

// 4. VEHICLE EXIT
function handleVehicleExit(req, res) {
    try {
        const { vehicle_number } = req.body || {};
        if (!vehicle_number || !vehicle_number.trim()) {
            return res.status(400).json({ success: false, message: 'Vehicle registration number is required for exit.' });
        }

        const cleanVehicleNumber = vehicle_number.trim().toUpperCase();

        const vehicle = db.prepare(`
            SELECT v.*, ps.slot_number, ps.id AS slot_pk
            FROM vehicles v
            JOIN parking_slots ps ON v.slot_id = ps.id
            WHERE v.vehicle_number = ? AND v.status = 'PARKED'
        `).get(cleanVehicleNumber);

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: `Vehicle ${cleanVehicleNumber} is not currently parked in any slot.`
            });
        }

        const slotId = vehicle.slot_pk;
        const slotNumber = vehicle.slot_number;
        let nextAllocatedVehicle = null;

        const exitTransaction = db.transaction(() => {
            db.prepare(`
                UPDATE vehicles 
                SET status = 'COMPLETED', exit_time = datetime('now', 'localtime'), slot_id = NULL 
                WHERE id = ?
            `).run(vehicle.id);

            db.prepare(`
                UPDATE parking_history 
                SET exit_time = datetime('now', 'localtime'), status = 'COMPLETED' 
                WHERE vehicle_id = ? AND status = 'PARKED'
            `).run(vehicle.id);

            db.prepare(`
                UPDATE parking_slots 
                SET status = 'AVAILABLE', current_vehicle_id = NULL 
                WHERE id = ?
            `).run(slotId);

            // FIFO Check: First waiting vehicle gets the newly freed slot
            const waitingVehicle = db.prepare(`
                SELECT * FROM vehicles 
                WHERE status = 'WAITING' 
                ORDER BY queue_order ASC, entry_time ASC 
                LIMIT 1
            `).get();

            if (waitingVehicle) {
                db.prepare(`
                    UPDATE vehicles 
                    SET status = 'PARKED', slot_id = ?, queue_order = NULL, entry_time = datetime('now', 'localtime')
                    WHERE id = ?
                `).run(slotId, waitingVehicle.id);

                db.prepare(`
                    UPDATE parking_slots 
                    SET status = 'OCCUPIED', current_vehicle_id = ? 
                    WHERE id = ?
                `).run(waitingVehicle.id, slotId);

                const existingWaitingHistory = db.prepare(`
                    SELECT id FROM parking_history WHERE vehicle_id = ? AND status = 'WAITING'
                `).get(waitingVehicle.id);

                if (existingWaitingHistory) {
                    db.prepare(`
                        UPDATE parking_history 
                        SET status = 'PARKED', slot_number = ?
                        WHERE id = ?
                    `).run(slotNumber, existingWaitingHistory.id);
                } else {
                    db.prepare(`
                        INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, exit_time, status)
                        VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'), NULL, 'PARKED')
                    `).run(waitingVehicle.id, waitingVehicle.owner_name, waitingVehicle.vehicle_number, waitingVehicle.vehicle_type, slotNumber);
                }

                vehicleQueue.reindexQueue();
                nextAllocatedVehicle = waitingVehicle;
            }
        });

        exitTransaction();

        if (nextAllocatedVehicle) {
            return res.json({
                success: true,
                message: `Vehicle ${cleanVehicleNumber} exited successfully. Next waiting vehicle ${nextAllocatedVehicle.vehicle_number} allocated to ${slotNumber}.`,
                exited_vehicle: { vehicle_number: cleanVehicleNumber, owner_name: vehicle.owner_name, slot_number: slotNumber },
                next_allocated_vehicle: {
                    vehicle_number: nextAllocatedVehicle.vehicle_number,
                    owner_name: nextAllocatedVehicle.owner_name,
                    vehicle_type: nextAllocatedVehicle.vehicle_type,
                    slot_number: slotNumber
                }
            });
        } else {
            return res.json({
                success: true,
                message: `Vehicle ${cleanVehicleNumber} exited successfully. Slot ${slotNumber} is now available.`,
                exited_vehicle: { vehicle_number: cleanVehicleNumber, owner_name: vehicle.owner_name, slot_number: slotNumber },
                next_allocated_vehicle: null
            });
        }
    } catch (err) {
        console.error('Vehicle Exit Error:', err);
        res.status(500).json({ success: false, message: 'Internal server error while processing vehicle exit.' });
    }
}

// 5. VEHICLE SEARCH
function handleSearchVehicle(req, res, vehicleNumber) {
    try {
        const cleanNumber = (vehicleNumber || '').trim().toUpperCase();
        const vehicle = db.prepare(`
            SELECT 
                v.*, 
                ps.slot_number,
                ROUND((julianday('now', 'localtime') - julianday(v.entry_time)) * 86400) AS duration_seconds
            FROM vehicles v
            LEFT JOIN parking_slots ps ON v.slot_id = ps.id
            WHERE v.vehicle_number = ?
            ORDER BY v.id DESC
            LIMIT 1
        `).get(cleanNumber);

        if (!vehicle) {
            return res.status(404).json({ success: false, message: `No active records found for vehicle ${cleanNumber}.` });
        }

        res.json({ success: true, data: vehicle });
    } catch (err) {
        console.error('Search Vehicle Error:', err);
        res.status(500).json({ success: false, message: 'Failed to search vehicle.' });
    }
}

// 6. WAITING QUEUE
function handleGetQueue(req, res) {
    try {
        const queueList = vehicleQueue.display();
        const status = vehicleQueue.getStatus();
        res.json({ success: true, total_waiting: queueList.length, status, data: queueList });
    } catch (err) {
        console.error('Error fetching queue:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch waiting queue.' });
    }
}

function handleGetQueueFront(req, res) {
    try {
        const frontVehicle = vehicleQueue.front();
        res.json({ success: true, data: frontVehicle });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch front vehicle.' });
    }
}

function handleGetQueueRear(req, res) {
    try {
        const rearVehicle = vehicleQueue.rear();
        res.json({ success: true, data: rearVehicle });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch rear vehicle.' });
    }
}

function handleCancelQueue(req, res, vehicleNumber) {
    try {
        const result = vehicleQueue.cancel(vehicleNumber);
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
}

// 7. PARKING HISTORY
function handleGetHistory(req, res) {
    try {
        const queryParams = req.query || {};
        const { search, vehicle_type, status, start_date, end_date, sort = 'id', order = 'DESC' } = queryParams;

        let query = 'SELECT * FROM parking_history WHERE 1=1';
        const params = [];

        if (search && search.trim()) {
            query += ' AND (vehicle_number LIKE ? OR owner_name LIKE ? OR slot_number LIKE ?)';
            const term = `%${search.trim()}%`;
            params.push(term, term, term);
        }

        if (vehicle_type && vehicle_type !== 'ALL') {
            query += ' AND vehicle_type = ?';
            params.push(vehicle_type);
        }

        if (status && status !== 'ALL') {
            query += ' AND status = ?';
            params.push(status);
        }

        if (start_date) {
            query += ' AND date(entry_time) >= date(?)';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND date(entry_time) <= date(?)';
            params.push(end_date);
        }

        const validSortCols = ['id', 'vehicle_number', 'owner_name', 'entry_time', 'exit_time', 'slot_number'];
        const sortCol = validSortCols.includes(sort) ? sort : 'id';
        const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        query += ` ORDER BY ${sortCol} ${sortOrder}`;

        const records = db.prepare(query).all(...params);

        res.json({ success: true, total_records: records.length, data: records });
    } catch (err) {
        console.error('Error fetching parking history:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch parking history.' });
    }
}

function handleGetHistoryByVehicle(req, res, vehicleNumber) {
    try {
        const cleanNumber = (vehicleNumber || '').trim().toUpperCase();
        const records = db.prepare(`SELECT * FROM parking_history WHERE vehicle_number = ? ORDER BY id DESC`).all(cleanNumber);
        res.json({ success: true, total_records: records.length, data: records });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch vehicle history.' });
    }
}

// 8. REPORTS
function handleReports(req, res) {
    try {
        const dailyEntries = db.prepare(`
            SELECT date(entry_time) as date, COUNT(*) as count 
            FROM parking_history 
            WHERE entry_time >= date('now', '-7 days')
            GROUP BY date(entry_time)
            ORDER BY date(entry_time) ASC
        `).all();

        const dailyExits = db.prepare(`
            SELECT date(exit_time) as date, COUNT(*) as count 
            FROM parking_history 
            WHERE exit_time IS NOT NULL AND exit_time >= date('now', '-7 days')
            GROUP BY date(exit_time)
            ORDER BY date(exit_time) ASC
        `).all();

        const typeDistribution = db.prepare(`
            SELECT vehicle_type, COUNT(*) as count 
            FROM parking_history 
            GROUP BY vehicle_type
        `).all();

        const hourlyTraffic = db.prepare(`
            SELECT strftime('%H', entry_time) as hour, COUNT(*) as count 
            FROM parking_history 
            GROUP BY hour
            ORDER BY hour ASC
        `).all();

        const totalParked = db.prepare("SELECT COUNT(*) as count FROM parking_slots WHERE status = 'OCCUPIED'").get().count;
        const totalSlots = db.prepare('SELECT COUNT(*) as count FROM parking_slots').get().count;
        const totalWaiting = vehicleQueue.size();
        const totalLifetime = db.prepare('SELECT COUNT(*) as count FROM parking_history').get().count;

        res.json({
            success: true,
            data: {
                total_slots: totalSlots,
                currently_parked: totalParked,
                waiting_queue_count: totalWaiting,
                occupancy_percentage: totalSlots > 0 ? Math.round((totalParked / totalSlots) * 100) : 0,
                total_lifetime_records: totalLifetime,
                daily_entries: dailyEntries,
                daily_exits: dailyExits,
                type_distribution: typeDistribution,
                hourly_traffic: hourlyTraffic
            }
        });
    } catch (err) {
        console.error('Error generating reports:', err);
        res.status(500).json({ success: false, message: 'Failed to generate reports.' });
    }
}

// 9. SETTINGS
function handleGetSettings(req, res) {
    try {
        const totalSlots = db.prepare('SELECT COUNT(*) as count FROM parking_slots').get().count;
        const occupiedSlots = db.prepare("SELECT COUNT(*) as count FROM parking_slots WHERE status = 'OCCUPIED'").get().count;
        const waitingCount = vehicleQueue.size();
        const historyCount = db.prepare('SELECT COUNT(*) as count FROM parking_history').get().count;

        res.json({
            success: true,
            data: {
                capacity: totalSlots,
                occupied_slots: occupiedSlots,
                available_slots: totalSlots - occupiedSlots,
                waiting_count: waitingCount,
                history_count: historyCount,
                node_version: process.version,
                database_engine: 'SQLite 3 (better-sqlite3 / node:sqlite)',
                server_uptime_seconds: Math.floor(process.uptime())
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to load settings.' });
    }
}

function handleUpdateCapacity(req, res) {
    try {
        const { capacity } = req.body || {};
        const newCapacity = parseInt(capacity, 10);

        if (isNaN(newCapacity) || newCapacity < 1 || newCapacity > 100) {
            return res.status(400).json({ success: false, message: 'Capacity must be a number between 1 and 100.' });
        }

        const currentSlots = db.prepare('SELECT * FROM parking_slots ORDER BY id ASC').all();
        const currentCount = currentSlots.length;
        const occupiedCount = currentSlots.filter(s => s.status === 'OCCUPIED').length;

        if (newCapacity < occupiedCount) {
            return res.status(400).json({
                success: false,
                message: `Cannot reduce capacity to ${newCapacity} because ${occupiedCount} slots are currently occupied.`
            });
        }

        const updateTransaction = db.transaction(() => {
            if (newCapacity > currentCount) {
                const insertSlot = db.prepare(`
                    INSERT INTO parking_slots (slot_number, status, current_vehicle_id)
                    VALUES (?, 'AVAILABLE', NULL)
                `);

                for (let i = currentCount + 1; i <= newCapacity; i++) {
                    const slotNum = `SLOT-${String(i).padStart(2, '0')}`;
                    insertSlot.run(slotNum);
                }
            } else if (newCapacity < currentCount) {
                const availableSlotsToRemove = db.prepare(`
                    SELECT id FROM parking_slots 
                    WHERE status = 'AVAILABLE' 
                    ORDER BY id DESC 
                    LIMIT ?
                `).all(currentCount - newCapacity);

                const deleteStmt = db.prepare('DELETE FROM parking_slots WHERE id = ?');
                availableSlotsToRemove.forEach(s => deleteStmt.run(s.id));
            }
        });

        updateTransaction();

        // Check if queue had waiting vehicles that can now be parked
        let allocatedFromQueue = 0;
        const autoAllocateTransaction = db.transaction(() => {
            const emptySlots = db.prepare("SELECT * FROM parking_slots WHERE status = 'AVAILABLE' ORDER BY id ASC").all();
            
            for (const slot of emptySlots) {
                const waitingVehicle = db.prepare("SELECT * FROM vehicles WHERE status = 'WAITING' ORDER BY queue_order ASC LIMIT 1").get();
                if (!waitingVehicle) break;

                db.prepare(`
                    UPDATE vehicles 
                    SET status = 'PARKED', slot_id = ?, queue_order = NULL, entry_time = datetime('now', 'localtime')
                    WHERE id = ?
                `).run(slot.id, waitingVehicle.id);

                db.prepare(`
                    UPDATE parking_slots 
                    SET status = 'OCCUPIED', current_vehicle_id = ? 
                    WHERE id = ?
                `).run(waitingVehicle.id, slot.id);

                db.prepare(`
                    INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, exit_time, status)
                    VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'), NULL, 'PARKED')
                `).run(waitingVehicle.id, waitingVehicle.owner_name, waitingVehicle.vehicle_number, waitingVehicle.vehicle_type, slot.slot_number);

                allocatedFromQueue++;
            }

            if (allocatedFromQueue > 0) {
                vehicleQueue.reindexQueue();
            }
        });

        autoAllocateTransaction();

        res.json({
            success: true,
            message: `Parking capacity successfully updated to ${newCapacity} slots.${allocatedFromQueue > 0 ? ` Allocated ${allocatedFromQueue} waiting vehicles from FIFO queue.` : ''}`
        });

    } catch (err) {
        console.error('Error updating capacity:', err);
        res.status(500).json({ success: false, message: 'Failed to update capacity.' });
    }
}

function handleSeedDemo(req, res) {
    try {
        seedDemoData();
        res.json({ success: true, message: 'Demo data loaded successfully! All tables and FIFO queue populated.' });
    } catch (err) {
        console.error('Error seeding data:', err);
        res.status(500).json({ success: false, message: 'Failed to seed demo data.' });
    }
}

function handleResetSystem(req, res) {
    try {
        const resetTransaction = db.transaction(() => {
            db.prepare('DELETE FROM parking_history').run();
            db.prepare('DELETE FROM vehicles').run();
            db.prepare('DELETE FROM parking_slots').run();
            initializeDefaultSlots(10);
        });

        resetTransaction();
        res.json({ success: true, message: 'System reset complete. Restored to default 10 available parking slots.' });
    } catch (err) {
        console.error('Error resetting system:', err);
        res.status(500).json({ success: false, message: 'Failed to reset system.' });
    }
}

/**
 * -------------------------------------------------------------
 * NATIVE HTTP DISPATCHER
 * -------------------------------------------------------------
 */
function dispatch(req, res, pathname) {
    const method = req.method.toUpperCase();

    // 1. Dashboard
    if (method === 'GET' && pathname === '/api/dashboard') {
        handleDashboard(req, res);
        return true;
    }

    // 2. Parking Slots
    if (method === 'GET' && pathname === '/api/parking/slots') {
        handleGetSlots(req, res);
        return true;
    }
    if (method === 'POST' && pathname === '/api/parking/slots') {
        handleAddSlot(req, res);
        return true;
    }

    // 3. Vehicle Entry
    if (method === 'POST' && pathname === '/api/vehicles/entry') {
        handleVehicleEntry(req, res);
        return true;
    }

    // 4. Vehicle Exit
    if (method === 'POST' && pathname === '/api/vehicles/exit') {
        handleVehicleExit(req, res);
        return true;
    }

    // 5. Vehicle Search: /api/vehicles/:vehicleNumber
    if (method === 'GET' && pathname.startsWith('/api/vehicles/')) {
        const vnum = decodeURIComponent(pathname.replace('/api/vehicles/', ''));
        handleSearchVehicle(req, res, vnum);
        return true;
    }

    // 6. Waiting Queue
    if (method === 'GET' && pathname === '/api/queue') {
        handleGetQueue(req, res);
        return true;
    }
    if (method === 'GET' && pathname === '/api/queue/front') {
        handleGetQueueFront(req, res);
        return true;
    }
    if (method === 'GET' && pathname === '/api/queue/rear') {
        handleGetQueueRear(req, res);
        return true;
    }
    if (method === 'DELETE' && pathname.startsWith('/api/queue/')) {
        const vnum = decodeURIComponent(pathname.replace('/api/queue/', ''));
        handleCancelQueue(req, res, vnum);
        return true;
    }

    // 7. Parking History
    if (method === 'GET' && pathname === '/api/history') {
        handleGetHistory(req, res);
        return true;
    }
    if (method === 'GET' && pathname.startsWith('/api/history/')) {
        const vnum = decodeURIComponent(pathname.replace('/api/history/', ''));
        handleGetHistoryByVehicle(req, res, vnum);
        return true;
    }

    // 8. Reports
    if (method === 'GET' && pathname === '/api/reports') {
        handleReports(req, res);
        return true;
    }

    // 9. Settings
    if (method === 'GET' && pathname === '/api/settings') {
        handleGetSettings(req, res);
        return true;
    }
    if (method === 'PUT' && pathname === '/api/settings/capacity') {
        handleUpdateCapacity(req, res);
        return true;
    }
    if (method === 'POST' && pathname === '/api/settings/seed') {
        handleSeedDemo(req, res);
        return true;
    }
    if (method === 'POST' && pathname === '/api/settings/reset') {
        handleResetSystem(req, res);
        return true;
    }

    return false;
}

// Check if Express router can be created
let exportTarget;
try {
    const express = require('express');
    const router = express.Router();

    router.get('/dashboard', handleDashboard);
    router.get('/parking/slots', handleGetSlots);
    router.post('/parking/slots', handleAddSlot);
    router.post('/vehicles/entry', handleVehicleEntry);
    router.post('/vehicles/exit', handleVehicleExit);
    router.get('/vehicles/:vehicleNumber', (req, res) => handleSearchVehicle(req, res, req.params.vehicleNumber));
    router.get('/queue', handleGetQueue);
    router.get('/queue/front', handleGetQueueFront);
    router.get('/queue/rear', handleGetQueueRear);
    router.delete('/queue/:vehicleNumber', (req, res) => handleCancelQueue(req, res, req.params.vehicleNumber));
    router.get('/history', handleGetHistory);
    router.get('/history/:vehicleNumber', (req, res) => handleGetHistoryByVehicle(req, res, req.params.vehicleNumber));
    router.get('/reports', handleReports);
    router.get('/settings', handleGetSettings);
    router.put('/settings/capacity', handleUpdateCapacity);
    router.post('/settings/seed', handleSeedDemo);
    router.post('/settings/reset', handleResetSystem);

    router.dispatch = dispatch;
    exportTarget = router;
} catch (e) {
    exportTarget = { dispatch };
}

module.exports = exportTarget;
