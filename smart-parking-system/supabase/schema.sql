-- =========================================================================
-- SMART PARKING MANAGEMENT SYSTEM USING QUEUE DATA STRUCTURE
-- Target Database: Supabase PostgreSQL
-- =========================================================================

-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -------------------------------------------------------------------------
-- 1. TABLE: parking_slots
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parking_slots (
    id SERIAL PRIMARY KEY,
    slot_number VARCHAR(20) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OCCUPIED')),
    current_vehicle_id INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------------------
-- 2. TABLE: vehicles
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
    id SERIAL PRIMARY KEY,
    owner_name VARCHAR(100) NOT NULL,
    vehicle_number VARCHAR(50) NOT NULL,
    vehicle_type VARCHAR(20) NOT NULL CHECK (vehicle_type IN ('Car', 'Bike', 'Van')),
    entry_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    exit_time TIMESTAMPTZ DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('PARKED', 'WAITING', 'COMPLETED', 'CANCELLED')),
    slot_id INTEGER REFERENCES parking_slots(id) ON DELETE SET NULL,
    queue_order BIGINT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Foreign key linking parking_slots to vehicles
ALTER TABLE parking_slots 
    DROP CONSTRAINT IF EXISTS fk_slot_vehicle;

ALTER TABLE parking_slots 
    ADD CONSTRAINT fk_slot_vehicle 
    FOREIGN KEY (current_vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;

-- -------------------------------------------------------------------------
-- 3. TABLE: parking_history
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parking_history (
    id SERIAL PRIMARY KEY,
    vehicle_id INTEGER,
    owner_name VARCHAR(100) NOT NULL,
    vehicle_number VARCHAR(50) NOT NULL,
    vehicle_type VARCHAR(20) NOT NULL,
    slot_number VARCHAR(50) NOT NULL,
    entry_time TIMESTAMPTZ NOT NULL,
    exit_time TIMESTAMPTZ DEFAULT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('WAITING', 'PARKED', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------------------
-- 4. TABLE: system_settings
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(50) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default settings seed
INSERT INTO system_settings (key, value)
VALUES ('default_capacity', '10')
ON CONFLICT (key) DO NOTHING;

-- -------------------------------------------------------------------------
-- INDEXES FOR HIGH-CONCURRENCY PERFORMANCE
-- -------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_slots_status ON parking_slots(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_queue ON vehicles(queue_order) WHERE status = 'WAITING';
CREATE INDEX IF NOT EXISTS idx_vehicles_vnum ON vehicles(vehicle_number);
CREATE INDEX IF NOT EXISTS idx_history_vnum ON parking_history(vehicle_number);
CREATE INDEX IF NOT EXISTS idx_history_entry ON parking_history(entry_time);

-- Prevent duplicate active registrations (A vehicle cannot be parked or waiting twice)
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_vehicles ON vehicles(vehicle_number) 
WHERE status IN ('PARKED', 'WAITING');

-- =========================================================================
-- ATOMIC POSTGRESQL FUNCTIONS (RPC)
-- =========================================================================

-- -------------------------------------------------------------------------
-- FUNCTION 1: initialize_parking_slots
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION initialize_parking_slots(p_total_slots INT DEFAULT 10)
RETURNS VOID AS $$
DECLARE
    i INT;
    v_slot_num TEXT;
BEGIN
    FOR i IN 1..p_total_slots LOOP
        v_slot_num := 'SLOT-' || LPAD(i::TEXT, 2, '0');
        INSERT INTO parking_slots (slot_number, status, current_vehicle_id)
        VALUES (v_slot_num, 'AVAILABLE', NULL)
        ON CONFLICT (slot_number) DO NOTHING;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------------
-- FUNCTION 2: register_vehicle
-- Atomically allocates a slot with row locking OR adds to FIFO queue
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_vehicle(
    p_owner_name TEXT,
    p_vehicle_number TEXT,
    p_vehicle_type TEXT
)
RETURNS JSON AS $$
DECLARE
    v_clean_vnum TEXT;
    v_clean_owner TEXT;
    v_active_record RECORD;
    v_slot RECORD;
    v_new_veh_id INT;
    v_next_order BIGINT;
    v_queue_pos INT;
BEGIN
    v_clean_vnum := UPPER(TRIM(p_vehicle_number));
    v_clean_owner := TRIM(p_owner_name);

    -- 1. Check for duplicate active entry
    SELECT * INTO v_active_record 
    FROM vehicles 
    WHERE vehicle_number = v_clean_vnum AND status IN ('PARKED', 'WAITING')
    LIMIT 1;

    IF FOUND THEN
        RETURN json_build_object(
            'success', false,
            'message', 'Vehicle ' || v_clean_vnum || ' is already ' || v_active_record.status || '. Duplicate entry rejected.'
        );
    END IF;

    -- 2. Try to lock the first available slot (Row-level lock to prevent double allocation)
    SELECT id, slot_number INTO v_slot
    FROM parking_slots
    WHERE status = 'AVAILABLE'
    ORDER BY id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF FOUND THEN
        -- Slot is available -> Park vehicle
        INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id, queue_order)
        VALUES (v_clean_owner, v_clean_vnum, p_vehicle_type, NOW(), 'PARKED', v_slot.id, NULL)
        RETURNING id INTO v_new_veh_id;

        UPDATE parking_slots 
        SET status = 'OCCUPIED', current_vehicle_id = v_new_veh_id, updated_at = NOW()
        WHERE id = v_slot.id;

        INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, exit_time, status)
        VALUES (v_new_veh_id, v_clean_owner, v_clean_vnum, p_vehicle_type, v_slot.slot_number, NOW(), NULL, 'PARKED');

        RETURN json_build_object(
            'success', true,
            'status', 'PARKED',
            'allocated_slot', v_slot.slot_number,
            'vehicle_id', v_new_veh_id,
            'message', 'Success! Vehicle ' || v_clean_vnum || ' has been allocated to ' || v_slot.slot_number || '.'
        );
    ELSE
        -- Parking full -> Enqueue into FIFO Waiting Queue
        SELECT COALESCE(MAX(queue_order), 0) + 1 INTO v_next_order 
        FROM vehicles 
        WHERE status = 'WAITING';

        INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id, queue_order)
        VALUES (v_clean_owner, v_clean_vnum, p_vehicle_type, NOW(), 'WAITING', NULL, v_next_order)
        RETURNING id INTO v_new_veh_id;

        SELECT COUNT(*) INTO v_queue_pos FROM vehicles WHERE status = 'WAITING';

        INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, exit_time, status)
        VALUES (v_new_veh_id, v_clean_owner, v_clean_vnum, p_vehicle_type, 'WAITING QUEUE', NOW(), NULL, 'WAITING');

        RETURN json_build_object(
            'success', true,
            'status', 'WAITING',
            'queue_position', v_queue_pos,
            'queue_order', v_next_order,
            'vehicle_id', v_new_veh_id,
            'message', 'Parking Full! Vehicle ' || v_clean_vnum || ' added to Waiting Queue at position #' || v_queue_pos || '.'
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------------
-- FUNCTION 3: exit_vehicle_and_allocate_queue
-- Atomically releases parked slot and assigns it to FRONT of FIFO queue
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION exit_vehicle_and_allocate_queue(p_vehicle_number TEXT)
RETURNS JSON AS $$
DECLARE
    v_clean_vnum TEXT;
    v_parked_vehicle RECORD;
    v_slot RECORD;
    v_next_waiting RECORD;
    v_hist_id INT;
BEGIN
    v_clean_vnum := UPPER(TRIM(p_vehicle_number));

    -- 1. Find and lock active parked vehicle
    SELECT v.*, ps.slot_number, ps.id AS slot_pk INTO v_parked_vehicle
    FROM vehicles v
    JOIN parking_slots ps ON v.slot_id = ps.id
    WHERE v.vehicle_number = v_clean_vnum AND v.status = 'PARKED'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'message', 'Vehicle ' || v_clean_vnum || ' is not currently parked.'
        );
    END IF;

    -- 2. Mark exiting vehicle as COMPLETED
    UPDATE vehicles 
    SET status = 'COMPLETED', exit_time = NOW(), slot_id = NULL, updated_at = NOW()
    WHERE id = v_parked_vehicle.id;

    UPDATE parking_history 
    SET exit_time = NOW(), status = 'COMPLETED' 
    WHERE vehicle_id = v_parked_vehicle.id AND status = 'PARKED';

    -- 3. Release slot temporarily
    UPDATE parking_slots 
    SET status = 'AVAILABLE', current_vehicle_id = NULL, updated_at = NOW()
    WHERE id = v_parked_vehicle.slot_pk;

    -- 4. Check FIFO queue for the FIRST waiting vehicle (Row-level lock)
    SELECT * INTO v_next_waiting
    FROM vehicles
    WHERE status = 'WAITING'
    ORDER BY queue_order ASC, entry_time ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF FOUND THEN
        -- Assign slot to next waiting vehicle
        UPDATE vehicles 
        SET status = 'PARKED', slot_id = v_parked_vehicle.slot_pk, queue_order = NULL, entry_time = NOW(), updated_at = NOW()
        WHERE id = v_next_waiting.id;

        UPDATE parking_slots 
        SET status = 'OCCUPIED', current_vehicle_id = v_next_waiting.id, updated_at = NOW()
        WHERE id = v_parked_vehicle.slot_pk;

        -- Update or insert history record
        SELECT id INTO v_hist_id 
        FROM parking_history 
        WHERE vehicle_id = v_next_waiting.id AND status = 'WAITING' 
        LIMIT 1;

        IF FOUND THEN
            UPDATE parking_history 
            SET status = 'PARKED', slot_number = v_parked_vehicle.slot_number 
            WHERE id = v_hist_id;
        ELSE
            INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, exit_time, status)
            VALUES (v_next_waiting.id, v_next_waiting.owner_name, v_next_waiting.vehicle_number, v_next_waiting.vehicle_type, v_parked_vehicle.slot_number, NOW(), NULL, 'PARKED');
        END IF;

        -- Reindex remaining waiting queue (1..N)
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY queue_order ASC, entry_time ASC) AS new_order
            FROM vehicles
            WHERE status = 'WAITING'
        )
        UPDATE vehicles v
        SET queue_order = r.new_order
        FROM ranked r
        WHERE v.id = r.id;

        RETURN json_build_object(
            'success', true,
            'message', 'Vehicle ' || v_clean_vnum || ' exited. Next waiting vehicle ' || v_next_waiting.vehicle_number || ' allocated to ' || v_parked_vehicle.slot_number || '.',
            'exited_vehicle', json_build_object(
                'vehicle_number', v_clean_vnum,
                'owner_name', v_parked_vehicle.owner_name,
                'slot_number', v_parked_vehicle.slot_number
            ),
            'next_allocated_vehicle', json_build_object(
                'vehicle_number', v_next_waiting.vehicle_number,
                'owner_name', v_next_waiting.owner_name,
                'vehicle_type', v_next_waiting.vehicle_type,
                'slot_number', v_parked_vehicle.slot_number
            )
        );
    ELSE
        RETURN json_build_object(
            'success', true,
            'message', 'Vehicle ' || v_clean_vnum || ' exited successfully. ' || v_parked_vehicle.slot_number || ' is now available.',
            'exited_vehicle', json_build_object(
                'vehicle_number', v_clean_vnum,
                'owner_name', v_parked_vehicle.owner_name,
                'slot_number', v_parked_vehicle.slot_number
            ),
            'next_allocated_vehicle', NULL
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------------
-- FUNCTION 4: seed_demo_data
-- Populates active slots, waiting vehicles, and past history in 1 click
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_demo_data()
RETURNS VOID AS $$
DECLARE
    s RECORD;
    v_id INT;
BEGIN
    -- Clear current data
    DELETE FROM parking_history;
    DELETE FROM vehicles;
    UPDATE parking_slots SET status = 'AVAILABLE', current_vehicle_id = NULL;

    -- Ensure 10 slots
    PERFORM initialize_parking_slots(10);

    -- 1. Insert Completed Historical Records
    INSERT INTO parking_history (owner_name, vehicle_number, vehicle_type, slot_number, entry_time, exit_time, status)
    VALUES 
        ('Rajesh Sharma', 'MH-12-AB-1234', 'Car', 'SLOT-01', NOW() - INTERVAL '4 hours', NOW() - INTERVAL '2 hours', 'COMPLETED'),
        ('Priya Patel', 'KA-01-MJ-5678', 'Bike', 'SLOT-03', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hours', 'COMPLETED'),
        ('Vikram Singh', 'DL-04-CA-9012', 'Van', 'SLOT-05', NOW() - INTERVAL '5 hours', NOW() - INTERVAL '3 hours', 'COMPLETED'),
        ('Ananya Roy', 'WB-02-XY-4321', 'Car', 'SLOT-02', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '30 minutes', 'COMPLETED');

    -- 2. Park Vehicles in Slots 1 to 8
    INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id)
    SELECT 'Amit Verma', 'DL-01-AA-1111', 'Car', NOW() - INTERVAL '120 minutes', 'PARKED', id FROM parking_slots WHERE slot_number = 'SLOT-01' RETURNING id INTO v_id;
    UPDATE parking_slots SET status = 'OCCUPIED', current_vehicle_id = v_id WHERE slot_number = 'SLOT-01';
    INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, status) VALUES (v_id, 'Amit Verma', 'DL-01-AA-1111', 'Car', 'SLOT-01', NOW() - INTERVAL '120 minutes', 'PARKED');

    INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id)
    SELECT 'Sunita Rao', 'KA-05-BB-2222', 'Bike', NOW() - INTERVAL '90 minutes', 'PARKED', id FROM parking_slots WHERE slot_number = 'SLOT-02' RETURNING id INTO v_id;
    UPDATE parking_slots SET status = 'OCCUPIED', current_vehicle_id = v_id WHERE slot_number = 'SLOT-02';
    INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, status) VALUES (v_id, 'Sunita Rao', 'KA-05-BB-2222', 'Bike', 'SLOT-02', NOW() - INTERVAL '90 minutes', 'PARKED');

    INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id)
    SELECT 'Rohan Mehta', 'MH-02-CC-3333', 'Car', NOW() - INTERVAL '75 minutes', 'PARKED', id FROM parking_slots WHERE slot_number = 'SLOT-03' RETURNING id INTO v_id;
    UPDATE parking_slots SET status = 'OCCUPIED', current_vehicle_id = v_id WHERE slot_number = 'SLOT-03';
    INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, status) VALUES (v_id, 'Rohan Mehta', 'MH-02-CC-3333', 'Car', 'SLOT-03', NOW() - INTERVAL '75 minutes', 'PARKED');

    INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id)
    SELECT 'Deepak Joshi', 'HR-26-DD-4444', 'Van', NOW() - INTERVAL '60 minutes', 'PARKED', id FROM parking_slots WHERE slot_number = 'SLOT-04' RETURNING id INTO v_id;
    UPDATE parking_slots SET status = 'OCCUPIED', current_vehicle_id = v_id WHERE slot_number = 'SLOT-04';
    INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, status) VALUES (v_id, 'Deepak Joshi', 'HR-26-DD-4444', 'Van', 'SLOT-04', NOW() - INTERVAL '60 minutes', 'PARKED');

    INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id)
    SELECT 'Sneha Kulkarni', 'TN-09-EE-5555', 'Car', NOW() - INTERVAL '45 minutes', 'PARKED', id FROM parking_slots WHERE slot_number = 'SLOT-05' RETURNING id INTO v_id;
    UPDATE parking_slots SET status = 'OCCUPIED', current_vehicle_id = v_id WHERE slot_number = 'SLOT-05';
    INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, status) VALUES (v_id, 'Sneha Kulkarni', 'TN-09-EE-5555', 'Car', 'SLOT-05', NOW() - INTERVAL '45 minutes', 'PARKED');

    INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id)
    SELECT 'Arun Kumar', 'UP-16-FF-6666', 'Bike', NOW() - INTERVAL '30 minutes', 'PARKED', id FROM parking_slots WHERE slot_number = 'SLOT-06' RETURNING id INTO v_id;
    UPDATE parking_slots SET status = 'OCCUPIED', current_vehicle_id = v_id WHERE slot_number = 'SLOT-06';
    INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, status) VALUES (v_id, 'Arun Kumar', 'UP-16-FF-6666', 'Bike', 'SLOT-06', NOW() - INTERVAL '30 minutes', 'PARKED');

    INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id)
    SELECT 'Meera Nair', 'KL-07-GG-7777', 'Car', NOW() - INTERVAL '20 minutes', 'PARKED', id FROM parking_slots WHERE slot_number = 'SLOT-07' RETURNING id INTO v_id;
    UPDATE parking_slots SET status = 'OCCUPIED', current_vehicle_id = v_id WHERE slot_number = 'SLOT-07';
    INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, status) VALUES (v_id, 'Meera Nair', 'KL-07-GG-7777', 'Car', 'SLOT-07', NOW() - INTERVAL '20 minutes', 'PARKED');

    INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id)
    SELECT 'Karan Malhotra', 'TS-08-HH-8888', 'Van', NOW() - INTERVAL '10 minutes', 'PARKED', id FROM parking_slots WHERE slot_number = 'SLOT-08' RETURNING id INTO v_id;
    UPDATE parking_slots SET status = 'OCCUPIED', current_vehicle_id = v_id WHERE slot_number = 'SLOT-08';
    INSERT INTO parking_history (vehicle_id, owner_name, vehicle_number, vehicle_type, slot_number, entry_time, status) VALUES (v_id, 'Karan Malhotra', 'TS-08-HH-8888', 'Van', 'SLOT-08', NOW() - INTERVAL '10 minutes', 'PARKED');

    -- 3. Insert Waiting Vehicles in FIFO Order (1, 2, 3)
    INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id, queue_order)
    VALUES ('Pooja Hegde', 'KA-04-QQ-9999', 'Car', NOW() - INTERVAL '8 minutes', 'WAITING', NULL, 1);

    INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id, queue_order)
    VALUES ('Aditya Sen', 'MH-14-RR-8888', 'Bike', NOW() - INTERVAL '5 minutes', 'WAITING', NULL, 2);

    INSERT INTO vehicles (owner_name, vehicle_number, vehicle_type, entry_time, status, slot_id, queue_order)
    VALUES ('Divya Iyer', 'TN-07-SS-7777', 'Car', NOW() - INTERVAL '2 minutes', 'WAITING', NULL, 3);
END;
$$ LANGUAGE plpgsql;

-- Initial execution of slot initialization
SELECT initialize_parking_slots(10);
