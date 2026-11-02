const { supabase, isConfigured } = require('../config/supabase');

class ParkingService {
    /**
     * Check if database connection is available
     */
    checkConnection() {
        if (!isConfigured || !supabase) {
            throw new Error('Supabase is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
        }
    }

    /**
     * 1. GET DASHBOARD METRICS
     */
    async getDashboardMetrics() {
        this.checkConnection();

        // 1. Get Slots
        const { data: slots, error: slotsErr } = await supabase
            .from('parking_slots')
            .select(`
                id,
                slot_number,
                status,
                current_vehicle_id,
                vehicles (
                    owner_name,
                    vehicle_number,
                    vehicle_type,
                    entry_time
                )
            `)
            .order('id', { ascending: true });

        if (slotsErr) throw slotsErr;

        // 2. Count waiting vehicles
        const { count: waitingCount, error: waitErr } = await supabase
            .from('vehicles')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'WAITING');

        if (waitErr) throw waitErr;

        // 3. Count today's entries
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { count: todayCount, error: todayErr } = await supabase
            .from('parking_history')
            .select('*', { count: 'exact', head: true })
            .gte('entry_time', todayStart.toISOString());

        if (todayErr) throw todayErr;

        // 4. Recent activities (latest 8 from history)
        const { data: recentActivities, error: actErr } = await supabase
            .from('parking_history')
            .select('*')
            .order('id', { ascending: false })
            .limit(8);

        if (actErr) throw actErr;

        // 5. Queue preview (top 5 waiting)
        const queuePreview = await this.getWaitingQueue(5);

        // 6. Active vehicles type distribution
        const { data: activeVehicles, error: vehErr } = await supabase
            .from('vehicles')
            .select('vehicle_type')
            .in('status', ['PARKED', 'WAITING']);

        if (vehErr) throw vehErr;

        const typeMap = { Car: 0, Bike: 0, Van: 0 };
        (activeVehicles || []).forEach(v => {
            if (typeMap[v.vehicle_type] !== undefined) typeMap[v.vehicle_type]++;
        });

        const typeDistribution = Object.keys(typeMap).map(k => ({ vehicle_type: k, count: typeMap[k] }));

        const totalSlots = slots ? slots.length : 0;
        const occupiedSlots = slots ? slots.filter(s => s.status === 'OCCUPIED').length : 0;
        const availableSlots = Math.max(0, totalSlots - occupiedSlots);

        // Flatten slots data for frontend
        const formattedSlots = (slots || []).map(s => {
            const veh = s.vehicles;
            let parkedSeconds = 0;
            if (veh && veh.entry_time) {
                parkedSeconds = Math.max(0, Math.floor((new Date() - new Date(veh.entry_time)) / 1000));
            }
            return {
                id: s.id,
                slot_number: s.slot_number,
                status: s.status,
                current_vehicle_id: s.current_vehicle_id,
                owner_name: veh ? veh.owner_name : null,
                vehicle_number: veh ? veh.vehicle_number : null,
                vehicle_type: veh ? veh.vehicle_type : null,
                entry_time: veh ? veh.entry_time : null,
                parked_seconds: parkedSeconds
            };
        });

        return {
            total_slots: totalSlots,
            available_slots: availableSlots,
            occupied_slots: occupiedSlots,
            waiting_vehicles: waitingCount || 0,
            total_vehicles_today: todayCount || 0,
            total_currently_parked: occupiedSlots,
            occupancy_rate: totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 100) : 0,
            slots: formattedSlots,
            recent_activities: recentActivities || [],
            queue_preview: queuePreview,
            type_distribution: typeDistribution,
            server_time: new Date().toISOString()
        };
    }

    /**
     * 2. GET PARKING SLOTS
     */
    async getParkingSlots() {
        this.checkConnection();

        const { data: slots, error } = await supabase
            .from('parking_slots')
            .select(`
                id,
                slot_number,
                status,
                current_vehicle_id,
                vehicles (
                    owner_name,
                    vehicle_number,
                    vehicle_type,
                    entry_time
                )
            `)
            .order('id', { ascending: true });

        if (error) throw error;

        const formatted = (slots || []).map(s => {
            const veh = s.vehicles;
            let parkedSeconds = 0;
            if (veh && veh.entry_time) {
                parkedSeconds = Math.max(0, Math.floor((new Date() - new Date(veh.entry_time)) / 1000));
            }
            return {
                id: s.id,
                slot_number: s.slot_number,
                status: s.status,
                current_vehicle_id: s.current_vehicle_id,
                owner_name: veh ? veh.owner_name : null,
                vehicle_number: veh ? veh.vehicle_number : null,
                vehicle_type: veh ? veh.vehicle_type : null,
                entry_time: veh ? veh.entry_time : null,
                parked_seconds: parkedSeconds
            };
        });

        return {
            total_slots: formatted.length,
            available: formatted.filter(s => s.status === 'AVAILABLE').length,
            occupied: formatted.filter(s => s.status === 'OCCUPIED').length,
            data: formatted
        };
    }

    /**
     * 3. ADD PARKING SLOT
     */
    async addParkingSlot(slotNumber) {
        this.checkConnection();
        const cleanNumber = slotNumber.trim().toUpperCase();

        const { data: exists } = await supabase
            .from('parking_slots')
            .select('id')
            .eq('slot_number', cleanNumber)
            .maybeSingle();

        if (exists) {
            throw new Error(`Slot ${cleanNumber} already exists.`);
        }

        const { data, error } = await supabase
            .from('parking_slots')
            .insert([{ slot_number: cleanNumber, status: 'AVAILABLE' }])
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * 4. VEHICLE ENTRY (Smart Registration & Queue Enqueue)
     */
    async registerVehicleEntry(ownerName, vehicleNumber, vehicleType) {
        this.checkConnection();

        const cleanOwner = ownerName.trim();
        const cleanNumber = vehicleNumber.trim().toUpperCase();

        // 1. First, try atomic PostgreSQL RPC function if available
        try {
            const { data: rpcResult, error: rpcErr } = await supabase.rpc('register_vehicle', {
                p_owner_name: cleanOwner,
                p_vehicle_number: cleanNumber,
                p_vehicle_type: vehicleType
            });

            if (!rpcErr && rpcResult) {
                return rpcResult;
            }
        } catch (e) {
            // Fall through to JS-orchestrated table operations
        }

        // 2. Fallback Table-Level Transaction
        // Check duplicate active vehicle
        const { data: activeVeh } = await supabase
            .from('vehicles')
            .select('id, status, queue_order')
            .eq('vehicle_number', cleanNumber)
            .in('status', ['PARKED', 'WAITING'])
            .maybeSingle();

        if (activeVeh) {
            return {
                success: false,
                message: `Vehicle ${cleanNumber} is already ${activeVeh.status}. Duplicate registration rejected.`
            };
        }

        // Check first available slot
        const { data: availableSlot } = await supabase
            .from('parking_slots')
            .select('id, slot_number')
            .eq('status', 'AVAILABLE')
            .order('id', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (availableSlot) {
            // Allocate available slot
            const { data: newVeh, error: vehErr } = await supabase
                .from('vehicles')
                .insert([{
                    owner_name: cleanOwner,
                    vehicle_number: cleanNumber,
                    vehicle_type: vehicleType,
                    status: 'PARKED',
                    slot_id: availableSlot.id,
                    entry_time: new Date().toISOString()
                }])
                .select()
                .single();

            if (vehErr) throw vehErr;

            await supabase
                .from('parking_slots')
                .update({ status: 'OCCUPIED', current_vehicle_id: newVeh.id, updated_at: new Date().toISOString() })
                .eq('id', availableSlot.id);

            await supabase
                .from('parking_history')
                .insert([{
                    vehicle_id: newVeh.id,
                    owner_name: cleanOwner,
                    vehicle_number: cleanNumber,
                    vehicle_type: vehicleType,
                    slot_number: availableSlot.slot_number,
                    entry_time: new Date().toISOString(),
                    status: 'PARKED'
                }]);

            return {
                success: true,
                status: 'PARKED',
                allocated_slot: availableSlot.slot_number,
                vehicle: newVeh,
                message: `Success! Vehicle ${cleanNumber} has been allocated to ${availableSlot.slot_number}.`
            };
        } else {
            // Enqueue in Waiting Queue (FIFO)
            const { data: maxOrderRow } = await supabase
                .from('vehicles')
                .select('queue_order')
                .eq('status', 'WAITING')
                .order('queue_order', { ascending: false })
                .limit(1)
                .maybeSingle();

            const nextOrder = (maxOrderRow && maxOrderRow.queue_order ? Number(maxOrderRow.queue_order) : 0) + 1;

            const { data: queuedVeh, error: qErr } = await supabase
                .from('vehicles')
                .insert([{
                    owner_name: cleanOwner,
                    vehicle_number: cleanNumber,
                    vehicle_type: vehicleType,
                    status: 'WAITING',
                    queue_order: nextOrder,
                    entry_time: new Date().toISOString()
                }])
                .select()
                .single();

            if (qErr) throw qErr;

            const { count: currentPos } = await supabase
                .from('vehicles')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'WAITING');

            await supabase
                .from('parking_history')
                .insert([{
                    vehicle_id: queuedVeh.id,
                    owner_name: cleanOwner,
                    vehicle_number: cleanNumber,
                    vehicle_type: vehicleType,
                    slot_number: 'WAITING QUEUE',
                    entry_time: new Date().toISOString(),
                    status: 'WAITING'
                }]);

            return {
                success: true,
                status: 'WAITING',
                queue_position: currentPos || 1,
                queue_order: nextOrder,
                vehicle: queuedVeh,
                message: `Parking Full! Vehicle ${cleanNumber} added to Waiting Queue at position #${currentPos || 1}.`
            };
        }
    }

    /**
     * 5. VEHICLE EXIT & ATOMIC QUEUE DISPATCH
     */
    async processVehicleExit(vehicleNumber) {
        this.checkConnection();
        const cleanNumber = vehicleNumber.trim().toUpperCase();

        // 1. Try atomic PostgreSQL RPC function first
        try {
            const { data: rpcResult, error: rpcErr } = await supabase.rpc('exit_vehicle_and_allocate_queue', {
                p_vehicle_number: cleanNumber
            });

            if (!rpcErr && rpcResult) {
                return rpcResult;
            }
        } catch (e) {
            // Fall through to fallback
        }

        // 2. Fallback Table-Level Execution
        const { data: vehicle, error: vehErr } = await supabase
            .from('vehicles')
            .select('*, parking_slots (id, slot_number)')
            .eq('vehicle_number', cleanNumber)
            .eq('status', 'PARKED')
            .maybeSingle();

        if (vehErr || !vehicle) {
            return {
                success: false,
                message: `Vehicle ${cleanNumber} is not currently parked.`
            };
        }

        const slot = vehicle.parking_slots;
        const now = new Date().toISOString();

        // Mark exiting vehicle COMPLETED
        await supabase
            .from('vehicles')
            .update({ status: 'COMPLETED', exit_time: now, slot_id: null, updated_at: now })
            .eq('id', vehicle.id);

        await supabase
            .from('parking_history')
            .update({ exit_time: now, status: 'COMPLETED' })
            .eq('vehicle_id', vehicle.id)
            .eq('status', 'PARKED');

        // Check oldest waiting vehicle in FIFO queue
        const { data: waitingVehicle } = await supabase
            .from('vehicles')
            .select('*')
            .eq('status', 'WAITING')
            .order('queue_order', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (waitingVehicle) {
            // Allocate slot to waiting vehicle
            await supabase
                .from('vehicles')
                .update({ status: 'PARKED', slot_id: slot.id, queue_order: null, entry_time: now, updated_at: now })
                .eq('id', waitingVehicle.id);

            await supabase
                .from('parking_slots')
                .update({ status: 'OCCUPIED', current_vehicle_id: waitingVehicle.id, updated_at: now })
                .eq('id', slot.id);

            // Update or insert history record
            await supabase
                .from('parking_history')
                .insert([{
                    vehicle_id: waitingVehicle.id,
                    owner_name: waitingVehicle.owner_name,
                    vehicle_number: waitingVehicle.vehicle_number,
                    vehicle_type: waitingVehicle.vehicle_type,
                    slot_number: slot.slot_number,
                    entry_time: now,
                    status: 'PARKED'
                }]);

            await this.reindexQueue();

            return {
                success: true,
                message: `Vehicle ${cleanNumber} exited successfully. Next waiting vehicle ${waitingVehicle.vehicle_number} allocated to ${slot.slot_number}.`,
                exited_vehicle: {
                    vehicle_number: cleanNumber,
                    owner_name: vehicle.owner_name,
                    slot_number: slot.slot_number
                },
                next_allocated_vehicle: {
                    vehicle_number: waitingVehicle.vehicle_number,
                    owner_name: waitingVehicle.owner_name,
                    vehicle_type: waitingVehicle.vehicle_type,
                    slot_number: slot.slot_number
                }
            };
        } else {
            // Release slot to AVAILABLE
            await supabase
                .from('parking_slots')
                .update({ status: 'AVAILABLE', current_vehicle_id: null, updated_at: now })
                .eq('id', slot.id);

            return {
                success: true,
                message: `Vehicle ${cleanNumber} exited successfully. Slot ${slot.slot_number} is now available.`,
                exited_vehicle: {
                    vehicle_number: cleanNumber,
                    owner_name: vehicle.owner_name,
                    slot_number: slot.slot_number
                },
                next_allocated_vehicle: null
            };
        }
    }

    /**
     * 6. WAITING QUEUE (FIFO) OPERATIONS
     */
    async getWaitingQueue(limit = null) {
        this.checkConnection();

        let query = supabase
            .from('vehicles')
            .select('*')
            .eq('status', 'WAITING')
            .order('queue_order', { ascending: true });

        if (limit) query = query.limit(limit);

        const { data: rows, error } = await query;
        if (error) throw error;

        const count = rows ? rows.length : 0;
        const now = new Date();

        return (rows || []).map((row, index) => {
            const position = index + 1;
            const diffSeconds = Math.max(0, Math.floor((now - new Date(row.entry_time)) / 1000));
            return {
                id: row.id,
                position: position,
                owner_name: row.owner_name,
                vehicle_number: row.vehicle_number,
                vehicle_type: row.vehicle_type,
                entry_time: row.entry_time,
                queue_order: row.queue_order,
                waiting_seconds: diffSeconds,
                waiting_duration: this.formatDuration(diffSeconds),
                is_front: position === 1,
                is_rear: position === count
            };
        });
    }

    async getFrontVehicle() {
        const queue = await this.getWaitingQueue(1);
        return queue.length > 0 ? queue[0] : null;
    }

    async getRearVehicle() {
        this.checkConnection();
        const { data: row, error } = await supabase
            .from('vehicles')
            .select('*')
            .eq('status', 'WAITING')
            .order('queue_order', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        if (!row) return null;

        const diffSeconds = Math.max(0, Math.floor((new Date() - new Date(row.entry_time)) / 1000));
        const { count: total } = await supabase
            .from('vehicles')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'WAITING');

        return {
            id: row.id,
            position: total || 1,
            owner_name: row.owner_name,
            vehicle_number: row.vehicle_number,
            vehicle_type: row.vehicle_type,
            entry_time: row.entry_time,
            waiting_duration: this.formatDuration(diffSeconds),
            is_rear: true
        };
    }

    async cancelWaitingVehicle(vehicleNumber) {
        this.checkConnection();
        const cleanNumber = vehicleNumber.trim().toUpperCase();

        const { data: vehicle, error: fetchErr } = await supabase
            .from('vehicles')
            .select('*')
            .eq('vehicle_number', cleanNumber)
            .eq('status', 'WAITING')
            .maybeSingle();

        if (fetchErr || !vehicle) {
            throw new Error(`Vehicle ${cleanNumber} not found in waiting queue.`);
        }

        const now = new Date().toISOString();

        await supabase
            .from('vehicles')
            .update({ status: 'CANCELLED', exit_time: now, queue_order: null, updated_at: now })
            .eq('id', vehicle.id);

        await supabase
            .from('parking_history')
            .update({ status: 'CANCELLED', exit_time: now, slot_number: 'CANCELLED FROM QUEUE' })
            .eq('vehicle_id', vehicle.id)
            .eq('status', 'WAITING');

        await this.reindexQueue();

        return {
            success: true,
            message: `Vehicle ${cleanNumber} removed from waiting queue.`,
            cancelled_vehicle: vehicle
        };
    }

    async reindexQueue() {
        const { data: waiting } = await supabase
            .from('vehicles')
            .select('id')
            .eq('status', 'WAITING')
            .order('queue_order', { ascending: true });

        if (waiting && waiting.length > 0) {
            for (let i = 0; i < waiting.length; i++) {
                await supabase
                    .from('vehicles')
                    .update({ queue_order: i + 1 })
                    .eq('id', waiting[i].id);
            }
        }
    }

    /**
     * 7. PARKING HISTORY
     */
    async getParkingHistory(filters = {}) {
        this.checkConnection();
        const { search, vehicle_type, status, start_date, end_date, sort = 'id', order = 'desc' } = filters;

        let query = supabase.from('parking_history').select('*');

        if (search && search.trim()) {
            const term = `%${search.trim()}%`;
            query = query.or(`vehicle_number.ilike.${term},owner_name.ilike.${term},slot_number.ilike.${term}`);
        }

        if (vehicle_type && vehicle_type !== 'ALL') {
            query = query.eq('vehicle_type', vehicle_type);
        }

        if (status && status !== 'ALL') {
            query = query.eq('status', status);
        }

        if (start_date) {
            query = query.gte('entry_time', `${start_date}T00:00:00.000Z`);
        }

        if (end_date) {
            query = query.lte('entry_time', `${end_date}T23:59:59.999Z`);
        }

        const validSort = ['id', 'vehicle_number', 'owner_name', 'entry_time', 'exit_time', 'slot_number'];
        const sortCol = validSort.includes(sort) ? sort : 'id';
        const isAsc = order.toLowerCase() === 'asc';

        query = query.order(sortCol, { ascending: isAsc });

        const { data, error } = await query;
        if (error) throw error;

        return {
            total_records: data ? data.length : 0,
            data: data || []
        };
    }

    /**
     * 8. REPORTS
     */
    async getReports() {
        this.checkConnection();

        // All history for analytics
        const { data: history, error: histErr } = await supabase
            .from('parking_history')
            .select('*');

        if (histErr) throw histErr;

        const { data: slots } = await supabase.from('parking_slots').select('status');
        const { count: waitingCount } = await supabase.from('vehicles').select('*', { count: 'exact', head: true }).eq('status', 'WAITING');

        const totalSlots = slots ? slots.length : 0;
        const totalParked = slots ? slots.filter(s => s.status === 'OCCUPIED').length : 0;

        // Daily flow
        const dailyEntriesMap = {};
        const dailyExitsMap = {};
        const typeMap = {};
        const hourMap = {};

        (history || []).forEach(r => {
            const entryDay = r.entry_time.split('T')[0];
            dailyEntriesMap[entryDay] = (dailyEntriesMap[entryDay] || 0) + 1;

            if (r.exit_time) {
                const exitDay = r.exit_time.split('T')[0];
                dailyExitsMap[exitDay] = (dailyExitsMap[exitDay] || 0) + 1;
            }

            typeMap[r.vehicle_type] = (typeMap[r.vehicle_type] || 0) + 1;

            const hour = new Date(r.entry_time).getHours().toString().padStart(2, '0');
            hourMap[hour] = (hourMap[hour] || 0) + 1;
        });

        const dailyEntries = Object.keys(dailyEntriesMap).sort().map(d => ({ date: d, count: dailyEntriesMap[d] }));
        const dailyExits = Object.keys(dailyExitsMap).sort().map(d => ({ date: d, count: dailyExitsMap[d] }));
        const typeDistribution = Object.keys(typeMap).map(k => ({ vehicle_type: k, count: typeMap[k] }));
        const hourlyTraffic = Object.keys(hourMap).sort().map(h => ({ hour: h, count: hourMap[h] }));

        return {
            total_slots: totalSlots,
            currently_parked: totalParked,
            waiting_queue_count: waitingCount || 0,
            occupancy_percentage: totalSlots > 0 ? Math.round((totalParked / totalSlots) * 100) : 0,
            total_lifetime_records: history ? history.length : 0,
            daily_entries: dailyEntries,
            daily_exits: dailyExits,
            type_distribution: typeDistribution,
            hourly_traffic: hourlyTraffic
        };
    }

    /**
     * 9. SETTINGS & CAPACITY
     */
    async getSettings() {
        this.checkConnection();

        const { data: slots } = await supabase.from('parking_slots').select('*');
        const { count: waitingCount } = await supabase.from('vehicles').select('*', { count: 'exact', head: true }).eq('status', 'WAITING');
        const { count: historyCount } = await supabase.from('parking_history').select('*', { count: 'exact', head: true });

        const totalSlots = slots ? slots.length : 0;
        const occupied = slots ? slots.filter(s => s.status === 'OCCUPIED').length : 0;

        return {
            capacity: totalSlots,
            occupied_slots: occupied,
            available_slots: totalSlots - occupied,
            waiting_count: waitingCount || 0,
            history_count: historyCount || 0,
            database_engine: 'PostgreSQL (Supabase Cloud)',
            runtime: 'Vercel Serverless / Node.js',
            server_uptime_seconds: Math.floor(process.uptime())
        };
    }

    async updateCapacity(newCapacity) {
        this.checkConnection();
        const cap = parseInt(newCapacity, 10);
        if (isNaN(cap) || cap < 1 || cap > 100) {
            throw new Error('Capacity must be between 1 and 100.');
        }

        const { data: currentSlots } = await supabase
            .from('parking_slots')
            .select('*')
            .order('id', { ascending: true });

        const currentCount = currentSlots ? currentSlots.length : 0;
        const occupiedCount = currentSlots ? currentSlots.filter(s => s.status === 'OCCUPIED').length : 0;

        if (cap < occupiedCount) {
            throw new Error(`Cannot reduce capacity to ${cap} because ${occupiedCount} slots are currently occupied.`);
        }

        if (cap > currentCount) {
            const newSlots = [];
            for (let i = currentCount + 1; i <= cap; i++) {
                newSlots.push({
                    slot_number: `SLOT-${String(i).padStart(2, '0')}`,
                    status: 'AVAILABLE'
                });
            }
            await supabase.from('parking_slots').insert(newSlots);
        } else if (cap < currentCount) {
            const availableToRemove = (currentSlots || [])
                .filter(s => s.status === 'AVAILABLE')
                .reverse()
                .slice(0, currentCount - cap);

            const ids = availableToRemove.map(s => s.id);
            if (ids.length > 0) {
                await supabase.from('parking_slots').delete().in('id', ids);
            }
        }

        return {
            success: true,
            message: `Parking capacity successfully updated to ${cap} slots.`
        };
    }

    async seedDemoData() {
        this.checkConnection();
        try {
            await supabase.rpc('seed_demo_data');
            return { success: true, message: 'Demo data loaded successfully into Supabase!' };
        } catch (err) {
            throw new Error(`Failed to seed demo data: ${err.message}`);
        }
    }

    async resetSystem() {
        this.checkConnection();
        await supabase.from('parking_history').delete().neq('id', 0);
        await supabase.from('vehicles').delete().neq('id', 0);
        await supabase.from('parking_slots').delete().neq('id', 0);

        const defaultSlots = [];
        for (let i = 1; i <= 10; i++) {
            defaultSlots.push({
                slot_number: `SLOT-${String(i).padStart(2, '0')}`,
                status: 'AVAILABLE'
            });
        }
        await supabase.from('parking_slots').insert(defaultSlots);

        return { success: true, message: 'System reset to default 10 available parking slots.' };
    }

    formatDuration(seconds) {
        if (!seconds || seconds <= 0) return 'Just now';
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

module.exports = new ParkingService();
