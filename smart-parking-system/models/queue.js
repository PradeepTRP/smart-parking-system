/**
 * QUEUE DATA STRUCTURE (FIFO - First In, First Out)
 * 
 * Implements a persistent, robust Queue data structure backed by SQLite.
 * Designed for the Smart Parking Management System.
 * 
 * Operations:
 *  - enqueue(vehicle): Add vehicle to the rear of the queue
 *  - dequeue(): Remove and return the vehicle from the front
 *  - front(): Inspect the front vehicle without removing
 *  - rear(): Inspect the rear vehicle without removing
 *  - display(): Return all waiting vehicles in arrival order with positions
 *  - size(): Return total waiting vehicles
 *  - getStatus(): Return queue status metadata
 *  - cancel(vehicleNumber): Cancel waiting registration and re-index
 */

class VehicleQueue {
    constructor(db) {
        this.db = db;
    }

    /**
     * ENQUEUE: Adds a vehicle to the rear of the queue.
     * @param {Object} vehicle - { owner_name, vehicle_number, vehicle_type }
     * @returns {Object} The enqueued vehicle details with its queue position.
     */
    enqueue(vehicle) {
        const stmtGetMax = this.db.prepare(`
            SELECT COALESCE(MAX(queue_order), 0) AS max_order 
            FROM vehicles 
            WHERE status = 'WAITING'
        `);
        
        const nextOrder = stmtGetMax.get().max_order + 1;

        const insertStmt = this.db.prepare(`
            INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id, queue_order)
            VALUES (?, ?, ?, datetime('now', 'localtime'), 'WAITING', NULL, ?)
        `);

        const result = insertStmt.run(
            vehicle.owner_name.trim(),
            vehicle.vehicle_number.trim().toUpperCase(),
            vehicle.vehicle_type,
            nextOrder
        );

        // Fetch inserted vehicle
        const newVehicle = this.db.prepare(`
            SELECT * FROM vehicles WHERE id = ?
        `).get(result.lastInsertRowid);

        const currentPosition = this.size();

        return {
            ...newVehicle,
            position: currentPosition
        };
    }

    /**
     * DEQUEUE: Removes and returns the vehicle at the front of the queue.
     * Note: When allocating a slot, caller marks it PARKED; this helper
     * safely retrieves the front vehicle and updates its queue state.
     * @returns {Object|null} The vehicle dequeued from the front, or null if empty.
     */
    dequeue() {
        const frontVehicle = this.front();
        if (!frontVehicle) {
            return null;
        }

        // Set status and clear queue_order
        this.db.prepare(`
            UPDATE vehicles 
            SET queue_order = NULL 
            WHERE id = ?
        `).run(frontVehicle.id);

        // Reindex remaining queue
        this.reindexQueue();

        return frontVehicle;
    }

    /**
     * FRONT: Retrieves the vehicle at the front of the queue without removing it.
     * @returns {Object|null}
     */
    front() {
        const row = this.db.prepare(`
            SELECT 
                id, 
                owner_name, 
                vehicle_number, 
                vehicle_type, 
                entry_time, 
                queue_order,
                ROUND((julianday('now', 'localtime') - julianday(entry_time)) * 86400) AS waiting_seconds
            FROM vehicles 
            WHERE status = 'WAITING' 
            ORDER BY queue_order ASC 
            LIMIT 1
        `).get();

        if (!row) return null;

        return {
            ...row,
            position: 1,
            waiting_duration: this.formatDuration(row.waiting_seconds)
        };
    }

    /**
     * REAR: Retrieves the vehicle at the rear (last in) of the queue.
     * @returns {Object|null}
     */
    rear() {
        const total = this.size();
        if (total === 0) return null;

        const row = this.db.prepare(`
            SELECT 
                id, 
                owner_name, 
                vehicle_number, 
                vehicle_type, 
                entry_time, 
                queue_order,
                ROUND((julianday('now', 'localtime') - julianday(entry_time)) * 86400) AS waiting_seconds
            FROM vehicles 
            WHERE status = 'WAITING' 
            ORDER BY queue_order DESC 
            LIMIT 1
        `).get();

        if (!row) return null;

        return {
            ...row,
            position: total,
            waiting_duration: this.formatDuration(row.waiting_seconds)
        };
    }

    /**
     * DISPLAY: Returns all waiting vehicles in arrival order with their positions.
     * @returns {Array<Object>}
     */
    display() {
        const rows = this.db.prepare(`
            SELECT 
                id, 
                owner_name, 
                vehicle_number, 
                vehicle_type, 
                entry_time, 
                queue_order,
                ROUND((julianday('now', 'localtime') - julianday(entry_time)) * 86400) AS waiting_seconds
            FROM vehicles 
            WHERE status = 'WAITING' 
            ORDER BY queue_order ASC
        `).all();

        const count = rows.length;

        return rows.map((row, index) => {
            const position = index + 1;
            return {
                id: row.id,
                position: position,
                owner_name: row.owner_name,
                vehicle_number: row.vehicle_number,
                vehicle_type: row.vehicle_type,
                entry_time: row.entry_time,
                queue_order: row.queue_order,
                waiting_seconds: row.waiting_seconds,
                waiting_duration: this.formatDuration(row.waiting_seconds),
                is_front: position === 1,
                is_rear: position === count
            };
        });
    }

    /**
     * SIZE: Returns the current number of vehicles in the waiting queue.
     * @returns {number}
     */
    size() {
        const res = this.db.prepare(`
            SELECT COUNT(*) AS count 
            FROM vehicles 
            WHERE status = 'WAITING'
        `).get();
        return res ? res.count : 0;
    }

    /**
     * QUEUE STATUS: Metadata regarding queue health, size, and endpoints.
     * @returns {Object}
     */
    getStatus() {
        const total = this.size();
        const frontItem = this.front();
        const rearItem = this.rear();

        return {
            queue_size: total,
            is_empty: total === 0,
            front: frontItem,
            rear: rearItem
        };
    }

    /**
     * CANCEL: Removes a waiting vehicle from the queue by registration number
     * and recalibrates remaining queue positions.
     * @param {string} vehicleNumber 
     * @returns {Object}
     */
    cancel(vehicleNumber) {
        const cleanNumber = vehicleNumber.trim().toUpperCase();

        const vehicle = this.db.prepare(`
            SELECT * FROM vehicles 
            WHERE vehicle_number = ? AND status = 'WAITING'
        `).get(cleanNumber);

        if (!vehicle) {
            throw new Error(`Vehicle ${cleanNumber} not found in waiting queue.`);
        }

        const transaction = this.db.transaction(() => {
            // Update vehicle status
            this.db.prepare(`
                UPDATE vehicles 
                SET status = 'CANCELLED', exit_time = datetime('now', 'localtime'), queue_order = NULL 
                WHERE id = ?
            `).run(vehicle.id);

            // Record / Update in parking history
            const histRow = this.db.prepare(`
                SELECT id FROM parking_history WHERE vehicle_id = ? AND status = 'WAITING'
            `).get(vehicle.id);

            if (histRow) {
                this.db.prepare(`
                    UPDATE parking_history 
                    SET status = 'CANCELLED', exit_time = datetime('now', 'localtime'), slot_number = 'CANCELLED FROM QUEUE' 
                    WHERE id = ?
                `).run(histRow.id);
            } else {
                this.db.prepare(`
                    INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, exit_time, status)
                    VALUES (?, ?, ?, ?, 'CANCELLED FROM QUEUE', ?, datetime('now', 'localtime'), 'CANCELLED')
                `).run(vehicle.id, vehicle.owner_name, vehicle.vehicle_number, vehicle.vehicle_type, vehicle.entry_time);
            }

            // Reindex the waiting queue to maintain consecutive order 1, 2, 3...
            this.reindexQueue();
        });

        transaction();

        return {
            success: true,
            message: `Vehicle ${cleanNumber} removed from waiting queue.`,
            cancelled_vehicle: vehicle
        };
    }

    /**
     * REINDEX QUEUE: Reassigns queue_order from 1..N based on entry_time and current queue_order.
     */
    reindexQueue() {
        const waitingVehicles = this.db.prepare(`
            SELECT id FROM vehicles 
            WHERE status = 'WAITING' 
            ORDER BY queue_order ASC, entry_time ASC
        `).all();

        const updateStmt = this.db.prepare(`
            UPDATE vehicles SET queue_order = ? WHERE id = ?
        `);

        const transaction = this.db.transaction((items) => {
            items.forEach((item, index) => {
                updateStmt.run(index + 1, item.id);
            });
        });

        transaction(waitingVehicles);
    }

    /**
     * Human readable duration helper
     */
    formatDuration(seconds) {
        if (!seconds || seconds < 0) return 'Just now';
        const sec = Math.floor(seconds);
        if (sec < 60) return `${sec}s ago`;
        const mins = Math.floor(sec / 60);
        const remSec = sec % 60;
        if (mins < 60) return `${mins}m ${remSec}s`;
        const hrs = Math.floor(mins / 60);
        const remMins = mins % 60;
        return `${hrs}h ${remMins}m`;
    }
}

module.exports = VehicleQueue;
