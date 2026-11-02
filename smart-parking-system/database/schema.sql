-- SMART PARKING MANAGEMENT SYSTEM DATABASE SCHEMA
-- Target Engine: SQLite (better-sqlite3)

PRAGMA foreign_keys = ON;

-- 1. Parking Slots Table
CREATE TABLE IF NOT EXISTS parking_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OCCUPIED')),
    current_vehicle_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (current_vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
);

-- 2. Vehicles Table
CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_name TEXT NOT NULL,
    vehicle_number TEXT NOT NULL,
    vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('Car', 'Bike', 'Van')),
    entry_time DATETIME NOT NULL DEFAULT (datetime('now', 'localtime')),
    exit_time DATETIME DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('PARKED', 'WAITING', 'COMPLETED', 'CANCELLED')),
    slot_id INTEGER DEFAULT NULL,
    queue_order INTEGER DEFAULT NULL,
    FOREIGN KEY (slot_id) REFERENCES parking_slots(id) ON DELETE SET NULL
);

-- 3. Parking History Table
CREATE TABLE IF NOT EXISTS parking_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER,
    owner_name TEXT NOT NULL,
    vehicle_number TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    slot_number TEXT,
    entry_time DATETIME NOT NULL,
    exit_time DATETIME DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'PARKED' CHECK (status IN ('WAITING', 'PARKED', 'COMPLETED', 'CANCELLED'))
);

-- Indexes for high-performance searches and integrity
CREATE INDEX IF NOT EXISTS idx_slots_status ON parking_slots(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_queue ON vehicles(queue_order) WHERE status = 'WAITING';
CREATE INDEX IF NOT EXISTS idx_vehicles_vnum ON vehicles(vehicle_number);
CREATE INDEX IF NOT EXISTS idx_history_vnum ON parking_history(vehicle_number);
CREATE INDEX IF NOT EXISTS idx_history_entry ON parking_history(entry_time);

-- Unique constraint: A vehicle cannot be active (parked or waiting) twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_vehicle ON vehicles(vehicle_number) 
WHERE status IN ('PARKED', 'WAITING');
