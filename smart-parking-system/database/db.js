const path = require('path');
const fs = require('fs');

let Database;
let isNodeSqlite = false;

try {
    Database = require('better-sqlite3');
} catch (e) {
    try {
        const { DatabaseSync } = require('node:sqlite');
        Database = DatabaseSync;
        isNodeSqlite = true;
    } catch (e2) {
        throw new Error('Neither better-sqlite3 nor node:sqlite is available in this Node runtime.');
    }
}

const DB_PATH = path.join(__dirname, 'parking_system.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Initialize database instance
const db = new Database(DB_PATH);

if (isNodeSqlite) {
    // Provide better-sqlite3 compatibility layer for native node:sqlite
    db.pragma = (statement) => {
        try {
            return db.exec(`PRAGMA ${statement}`);
        } catch (e) {
            console.warn(`Pragma ${statement} notice:`, e.message);
        }
    };

    db.transaction = (fn) => {
        return (...args) => {
            db.exec('BEGIN TRANSACTION');
            try {
                const result = fn(...args);
                db.exec('COMMIT');
                return result;
            } catch (err) {
                try { db.exec('ROLLBACK'); } catch (_) {}
                throw err;
            }
        };
    };
}

// Enable performance and integrity pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initialize Database Schema and Default Parking Slots
 */
function initializeDatabase() {
    try {
        const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
        db.exec(schema);

        // Check if slots already exist; if not, initialize default 10 slots
        const count = db.prepare('SELECT COUNT(*) as count FROM parking_slots').get().count;
        if (count === 0) {
            initializeDefaultSlots(10);
            console.log('✓ Initialized default 10 parking slots (SLOT-01 to SLOT-10).');
        }

        console.log(`✓ SQLite Database initialized successfully (${isNodeSqlite ? 'native node:sqlite' : 'better-sqlite3'}) at: ${DB_PATH}`);
    } catch (err) {
        console.error('✗ Failed to initialize database:', err.message);
        throw err;
    }
}

/**
 * Initialize N default slots
 */
function initializeDefaultSlots(totalSlots = 10) {
    const insertSlot = db.prepare(`
        INSERT OR IGNORE INTO parking_slots (slot_number, status, current_vehicle_id)
        VALUES (?, 'AVAILABLE', NULL)
    `);

    const transaction = db.transaction((count) => {
        for (let i = 1; i <= count; i++) {
            const slotNumber = `SLOT-${String(i).padStart(2, '0')}`;
            insertSlot.run(slotNumber);
        }
    });

    transaction(totalSlots);
}

/**
 * Seed realistic demo data for presentation/examination testing
 */
function seedDemoData() {
    const clearTransaction = db.transaction(() => {
        db.prepare('DELETE FROM parking_history').run();
        db.prepare('DELETE FROM vehicles').run();
        db.prepare('UPDATE parking_slots SET status = "AVAILABLE", current_vehicle_id = NULL').run();
    });
    clearTransaction();

    const insertVehicle = db.prepare(`
        INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, exit_time, status, slot_id, queue_order)
        VALUES (?, ?, ?, datetime('now', ?), ?, ?, ?, ?)
    `);

    const updateSlot = db.prepare(`
        UPDATE parking_slots SET status = 'OCCUPIED', current_vehicle_id = ? WHERE id = ?
    `);

    const insertHistory = db.prepare(`
        INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, exit_time, status)
        VALUES (?, ?, ?, ?, ?, datetime('now', ?), ?, ?)
    `);

    const seedTransaction = db.transaction(() => {
        // 1. Completed historical vehicles (past entries and exits)
        const historyData = [
            { owner: 'Rajesh Sharma', num: 'MH-12-AB-1234', type: 'Car', slot: 'SLOT-01', entryDelta: '-4 hours', exitDelta: '-2 hours' },
            { owner: 'Priya Patel', num: 'KA-01-MJ-5678', type: 'Bike', slot: 'SLOT-03', entryDelta: '-3 hours', exitDelta: '-1 hours' },
            { owner: 'Vikram Singh', num: 'DL-04-CA-9012', type: 'Van', slot: 'SLOT-05', entryDelta: '-5 hours', exitDelta: '-3 hours' },
            { owner: 'Ananya Roy', num: 'WB-02-XY-4321', type: 'Car', slot: 'SLOT-02', entryDelta: '-2 hours', exitDelta: '-30 minutes' }
        ];

        historyData.forEach((h) => {
            const vRes = insertVehicle.run(h.owner, h.num, h.type, h.entryDelta, new Date().toISOString(), 'COMPLETED', null, null);
            insertHistory.run(vRes.lastInsertRowid, h.owner, h.num, h.type, h.slot, h.entryDelta, new Date().toISOString(), 'COMPLETED');
        });

        // 2. Currently parked vehicles (fill slots 1 to 8)
        const parkedData = [
            { owner: 'Amit Verma', num: 'DL-01-AA-1111', type: 'Car', slotIndex: 1, entryDelta: '-120 minutes' },
            { owner: 'Sunita Rao', num: 'KA-05-BB-2222', type: 'Bike', slotIndex: 2, entryDelta: '-90 minutes' },
            { owner: 'Rohan Mehta', num: 'MH-02-CC-3333', type: 'Car', slotIndex: 3, entryDelta: '-75 minutes' },
            { owner: 'Deepak Joshi', num: 'HR-26-DD-4444', type: 'Van', slotIndex: 4, entryDelta: '-60 minutes' },
            { owner: 'Sneha Kulkarni', num: 'TN-09-EE-5555', type: 'Car', slotIndex: 5, entryDelta: '-45 minutes' },
            { owner: 'Arun Kumar', num: 'UP-16-FF-6666', type: 'Bike', slotIndex: 6, entryDelta: '-30 minutes' },
            { owner: 'Meera Nair', num: 'KL-07-GG-7777', type: 'Car', slotIndex: 7, entryDelta: '-20 minutes' },
            { owner: 'Karan Malhotra', num: 'TS-08-HH-8888', type: 'Van', slotIndex: 8, entryDelta: '-10 minutes' }
        ];

        const slots = db.prepare('SELECT id, slot_number FROM parking_slots ORDER BY id ASC').all();

        parkedData.forEach((p, idx) => {
            if (slots[idx]) {
                const slot = slots[idx];
                const vRes = insertVehicle.run(p.owner, p.num, p.type, p.entryDelta, null, 'PARKED', slot.id, null);
                updateSlot.run(vRes.lastInsertRowid, slot.id);
                insertHistory.run(vRes.lastInsertRowid, p.owner, p.num, p.type, slot.slot_number, p.entryDelta, null, 'PARKED');
            }
        });

        // 3. Vehicles in FIFO Waiting Queue (order 1, 2, 3)
        const waitingData = [
            { owner: 'Pooja Hegde', num: 'KA-04-QQ-9999', type: 'Car', entryDelta: '-8 minutes', order: 1 },
            { owner: 'Aditya Sen', num: 'MH-14-RR-8888', type: 'Bike', entryDelta: '-5 minutes', order: 2 },
            { owner: 'Divya Iyer', num: 'TN-07-SS-7777', type: 'Car', entryDelta: '-2 minutes', order: 3 }
        ];

        waitingData.forEach((w) => {
            insertVehicle.run(w.owner, w.num, w.type, w.entryDelta, null, 'WAITING', null, w.order);
        });
    });

    seedTransaction();
    console.log('✓ Demo data seeded successfully.');
}

// Auto-run schema initialization
initializeDatabase();

module.exports = {
    db,
    initializeDatabase,
    initializeDefaultSlots,
    seedDemoData,
    DB_PATH,
    isNodeSqlite
};
