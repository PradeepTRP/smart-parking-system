/**
 * APP.JS - Smart Parking Management System Frontend Controller
 * Handles REST API communications, UI state updates, FIFO Queue visualization, and events.
 */

// Global State
const State = {
    currentView: 'dashboard',
    dashboardData: null,
    slotsData: [],
    queueData: [],
    historyData: [],
    slotFilter: 'ALL',
    selectedExitVehicleNumber: null,
    vehicleToCancel: null,
    refreshTimer: null
};

// API Base URL
const API_BASE = '/api';

// Initialize Application on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    initClock();
    initNavigation();
    initEventListeners();
    handleRoute();

    // Periodic auto-refresh every 12 seconds
    State.refreshTimer = setInterval(() => {
        refreshCurrentView(false);
    }, 12000);
});

/**
 * -------------------------------------------------------------
 * 1. CLOCK & TICKER
 * -------------------------------------------------------------
 */
function initClock() {
    const clockEl = document.getElementById('live-clock');
    const update = () => {
        const now = new Date();
        if (clockEl) {
            clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' | ' + now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        }
        const entryTimeInput = document.getElementById('entry-time-display');
        if (entryTimeInput) {
            entryTimeInput.value = now.toLocaleString();
        }
    };
    update();
    setInterval(update, 1000);
}

/**
 * -------------------------------------------------------------
 * 2. NAVIGATION & ROUTING
 * -------------------------------------------------------------
 */
function initNavigation() {
    window.addEventListener('hashchange', handleRoute);

    // Sidebar navigation clicks
    document.querySelectorAll('.sidebar-menu .nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            const view = link.getAttribute('data-view');
            if (view) {
                navigateTo(view);
            }
        });
    });

    // Mobile sidebar toggle
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    if (toggleBtn && sidebar && overlay) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('show');
            overlay.classList.toggle('show');
        });

        overlay.addEventListener('click', () => {
            sidebar.classList.remove('show');
            overlay.classList.remove('show');
        });
    }

    // Manual refresh button
    const refreshBtn = document.getElementById('btn-manual-refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshCurrentView(true);
            showToast('Data refreshed successfully.', 'info');
        });
    }
}

function navigateTo(viewName) {
    window.location.hash = viewName;
}

function handleRoute() {
    const rawHash = window.location.hash.replace('#', '') || 'dashboard';
    const validViews = ['dashboard', 'slots', 'entry', 'exit', 'queue', 'history', 'reports', 'settings'];
    const view = validViews.includes(rawHash) ? rawHash : 'dashboard';

    State.currentView = view;

    // Update active menu link
    document.querySelectorAll('.sidebar-menu .nav-link').forEach(link => {
        link.classList.toggle('active', link.getAttribute('data-view') === view);
    });

    // Update active section
    document.querySelectorAll('.view-section').forEach(section => {
        section.classList.toggle('active', section.id === `view-${view}`);
    });

    // Update top header title
    updateHeaderTitle(view);

    // Close mobile sidebar if open
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('show');
    if (overlay) overlay.classList.remove('show');

    // Load data for the active view
    refreshCurrentView(true);
}

function updateHeaderTitle(view) {
    const titles = {
        dashboard: { title: 'Dashboard', sub: 'Real-time parking surveillance and queue metrics' },
        slots: { title: 'Parking Slots', sub: 'Interactive parking layout & capacity overview' },
        entry: { title: 'Vehicle Entry', sub: 'Smart check-in with automatic FIFO queue allocation' },
        exit: { title: 'Vehicle Exit', sub: 'Check-out & atomic FIFO queue slot assignment' },
        queue: { title: 'Waiting Queue (FIFO)', sub: 'First In, First Out queue structure visualization' },
        history: { title: 'Parking History', sub: 'Audit logs, search, and CSV export' },
        reports: { title: 'Analytical Reports', sub: 'Graphical occupancy trends and vehicle distribution' },
        settings: { title: 'System Settings', sub: 'Capacity reconfiguration and demo controls' }
    };

    const config = titles[view] || titles.dashboard;
    const titleEl = document.getElementById('page-title');
    const subEl = document.getElementById('page-subtitle');
    if (titleEl) titleEl.textContent = config.title;
    if (subEl) subEl.textContent = config.sub;
}

function refreshCurrentView(isUserTriggered = false) {
    switch (State.currentView) {
        case 'dashboard':
            loadDashboardView();
            break;
        case 'slots':
            loadSlotsView();
            break;
        case 'entry':
            // just keep entry time updated
            break;
        case 'exit':
            loadExitView();
            break;
        case 'queue':
            loadQueueView();
            break;
        case 'history':
            if (isUserTriggered) loadHistoryView();
            break;
        case 'reports':
            loadReportsView();
            break;
        case 'settings':
            loadSettingsView();
            break;
    }

    // Always keep sidebar badge updated
    updateSidebarQueueBadge();
}

/**
 * -------------------------------------------------------------
 * 3. DASHBOARD VIEW CONTROLLER
 * -------------------------------------------------------------
 */
async function loadDashboardView() {
    try {
        const res = await fetch(`${API_BASE}/dashboard`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        const data = json.data;
        State.dashboardData = data;

        // Metric Cards
        document.getElementById('dash-total-slots').textContent = data.total_slots;
        document.getElementById('dash-available-slots').textContent = data.available_slots;
        document.getElementById('dash-occupied-slots').textContent = data.occupied_slots;
        document.getElementById('dash-waiting-queue').textContent = data.waiting_vehicles;
        document.getElementById('dash-today-vehicles').textContent = data.total_vehicles_today;
        document.getElementById('dash-currently-parked').textContent = data.total_currently_parked;
        document.getElementById('dash-occupancy-percent').textContent = `${data.occupancy_rate}%`;

        // Update Charts
        if (window.AppCharts) {
            window.AppCharts.updateOccupancyChart(data.available_slots, data.occupied_slots);
            window.AppCharts.updateTypesChart(data.type_distribution);
        }

        // Live Queue Ribbon Preview
        renderDashboardQueuePreview(data.queue_preview);

        // Slots Map Overview
        renderSlotsGrid(data.slots, 'dash-slots-grid', 10);

        // Recent Activity Table
        renderRecentActivities(data.recent_activities);

        // Update badge
        const badge = document.getElementById('sidebar-queue-badge');
        if (badge) badge.textContent = data.waiting_vehicles;

    } catch (err) {
        console.error('Failed to load dashboard:', err);
    }
}

function renderDashboardQueuePreview(queueItems) {
    const container = document.getElementById('dash-queue-preview-container');
    if (!container) return;

    if (!queueItems || queueItems.length === 0) {
        container.innerHTML = `
            <div class="text-muted small py-3 px-2 d-flex align-items-center gap-2">
                <i class="fa-solid fa-circle-check text-success"></i>
                <span>Queue is currently empty. Arriving vehicles will be allocated parking slots immediately!</span>
            </div>
        `;
        return;
    }

    let html = '';
    queueItems.forEach((item, index) => {
        const isFront = item.is_front;
        const isRear = item.is_rear;
        const badgeClass = isFront ? 'node-badge bg-primary' : (isRear ? 'node-badge bg-warning' : 'node-badge bg-secondary');
        const roleLabel = isFront ? 'FRONT (NEXT)' : (isRear ? 'REAR (LAST)' : `WAITING #${item.position}`);

        html += `
            <div class="queue-node ${isFront ? 'node-front' : ''} ${isRear ? 'node-rear' : ''}">
                <span class="${badgeClass}">${roleLabel}</span>
                <div class="d-flex justify-content-between align-items-center mb-1 mt-2">
                    <span class="badge bg-light text-dark border">#${item.position}</span>
                    <span class="small text-muted"><i class="fa-solid ${getVehicleIcon(item.vehicle_type)}"></i> ${item.vehicle_type}</span>
                </div>
                <div class="fw-bold fs-6 text-primary" style="letter-spacing: 0.05em;">${escapeHtml(item.vehicle_number)}</div>
                <div class="small text-truncate text-muted">${escapeHtml(item.owner_name)}</div>
                <div class="small text-secondary mt-1"><i class="fa-regular fa-clock"></i> ${item.waiting_duration}</div>
            </div>
        `;

        if (index < queueItems.length - 1) {
            html += `<div class="queue-arrow"><i class="fa-solid fa-arrow-right"></i></div>`;
        }
    });

    container.innerHTML = html;
}

function renderRecentActivities(activities) {
    const tbody = document.getElementById('dash-recent-table-body');
    if (!tbody) return;

    if (!activities || activities.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No recent parking activity found.</td></tr>`;
        return;
    }

    tbody.innerHTML = activities.map(item => `
        <tr>
            <td><strong class="font-monospace text-primary">${escapeHtml(item.vehicle_number)}</strong></td>
            <td>${escapeHtml(item.owner_name)}</td>
            <td><i class="fa-solid ${getVehicleIcon(item.vehicle_type)} text-secondary me-1"></i> ${escapeHtml(item.vehicle_type)}</td>
            <td><span class="badge bg-light text-dark border">${escapeHtml(item.slot_number || 'Queue')}</span></td>
            <td><small class="text-muted">${formatTimestamp(item.entry_time)}</small></td>
            <td><small class="text-muted">${item.exit_time ? formatTimestamp(item.exit_time) : '<span class="text-success fw-bold">Active</span>'}</small></td>
            <td>${renderStatusBadge(item.status)}</td>
        </tr>
    `).join('');
}

/**
 * -------------------------------------------------------------
 * 4. PARKING SLOTS VIEW CONTROLLER
 * -------------------------------------------------------------
 */
async function loadSlotsView() {
    try {
        const res = await fetch(`${API_BASE}/parking/slots`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        State.slotsData = json.data;
        filterAndRenderSlots();
    } catch (err) {
        console.error('Failed to load slots:', err);
    }
}

function filterAndRenderSlots() {
    let filtered = State.slotsData;
    if (State.slotFilter === 'AVAILABLE') {
        filtered = State.slotsData.filter(s => s.status === 'AVAILABLE');
    } else if (State.slotFilter === 'OCCUPIED') {
        filtered = State.slotsData.filter(s => s.status === 'OCCUPIED');
    }

    renderSlotsGrid(filtered, 'full-slots-grid');
}

function renderSlotsGrid(slots, containerId, maxDisplay = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!slots || slots.length === 0) {
        container.innerHTML = `<div class="col-12 text-center text-muted py-5">No parking slots found.</div>`;
        return;
    }

    const list = maxDisplay ? slots.slice(0, maxDisplay) : slots;

    container.innerHTML = list.map(slot => {
        const isOccupied = slot.status === 'OCCUPIED';
        const cardClass = isOccupied ? 'slot-occupied' : 'slot-available';
        const badgeClass = isOccupied ? 'slot-badge' : 'slot-badge';
        const iconClass = isOccupied ? getVehicleIcon(slot.vehicle_type) : 'fa-square-parking';
        const durationFormatted = slot.parked_seconds ? formatSeconds(slot.parked_seconds) : 'Just parked';

        return `
            <div class="slot-card ${cardClass}">
                <div class="slot-header">
                    <span class="slot-title">${escapeHtml(slot.slot_number)}</span>
                    <span class="${badgeClass}">${escapeHtml(slot.status)}</span>
                </div>
                <div class="slot-body">
                    <div class="slot-icon-box">
                        <i class="fa-solid ${iconClass}"></i>
                    </div>
                    ${isOccupied ? `
                        <div class="slot-vehicle-info">
                            <div class="slot-vnum">${escapeHtml(slot.vehicle_number)}</div>
                            <div class="slot-owner"><i class="fa-solid fa-user small me-1"></i> ${escapeHtml(slot.owner_name)}</div>
                            <div class="small text-muted mt-1"><i class="fa-solid ${getVehicleIcon(slot.vehicle_type)}"></i> ${slot.vehicle_type}</div>
                        </div>
                    ` : `
                        <div class="text-muted small">Ready for allocation</div>
                    `}
                </div>
                <div class="slot-footer">
                    ${isOccupied ? `
                        <span class="text-muted"><i class="fa-regular fa-clock"></i> ${durationFormatted}</span>
                        <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="promptQuickExit('${escapeHtml(slot.vehicle_number)}', '${escapeHtml(slot.slot_number)}', '${escapeHtml(slot.owner_name)}')">
                            Exit <i class="fa-solid fa-arrow-right-from-bracket ms-1"></i>
                        </button>
                    ` : `
                        <span class="text-success"><i class="fa-solid fa-check"></i> Vacant</span>
                        <button class="btn btn-sm btn-outline-success py-0 px-2" onclick="navigateTo('entry')">
                            Park <i class="fa-solid fa-plus ms-1"></i>
                        </button>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * -------------------------------------------------------------
 * 5. VEHICLE ENTRY CONTROLLER
 * -------------------------------------------------------------
 */
function initEventListeners() {
    // Slot Filter Buttons
    document.querySelectorAll('[data-slot-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-slot-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            State.slotFilter = btn.getAttribute('data-slot-filter');
            filterAndRenderSlots();
        });
    });

    // Form: Vehicle Entry
    const formEntry = document.getElementById('form-vehicle-entry');
    if (formEntry) {
        formEntry.addEventListener('submit', async (e) => {
            e.preventDefault();
            const ownerName = document.getElementById('entry-owner-name').value.trim();
            const vehicleNumber = document.getElementById('entry-vehicle-number').value.trim().toUpperCase();
            const vehicleTypeRadio = document.querySelector('input[name="entry-vehicle-type"]:checked');
            const vehicleType = vehicleTypeRadio ? vehicleTypeRadio.value : 'Car';

            if (!ownerName || !vehicleNumber) {
                showToast('Please enter both owner name and vehicle registration number.', 'warning');
                return;
            }

            const submitBtn = document.getElementById('btn-submit-entry');
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span> Registering...`;

            try {
                const res = await fetch(`${API_BASE}/vehicles/entry`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        owner_name: ownerName,
                        vehicle_number: vehicleNumber,
                        vehicle_type: vehicleType
                    })
                });

                const data = await res.json();

                if (!res.ok || !data.success) {
                    showToast(data.message || 'Failed to register vehicle.', 'error');
                } else {
                    if (data.status === 'PARKED') {
                        showToast(`SUCCESS! Vehicle ${vehicleNumber} allocated to ${data.allocated_slot}.`, 'success');
                    } else if (data.status === 'WAITING') {
                        showToast(`PARKING FULL! Vehicle added to FIFO Waiting Queue at Position #${data.queue_position}.`, 'warning');
                    }

                    formEntry.reset();
                    // Reset radio to car
                    document.getElementById('type-car').checked = true;

                    // Navigate to Slots if parked, or Queue if waiting!
                    setTimeout(() => {
                        if (data.status === 'PARKED') navigateTo('slots');
                        else navigateTo('queue');
                    }, 1200);
                }
            } catch (err) {
                console.error('Entry error:', err);
                showToast('Network error while communicating with server.', 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `<i class="fa-solid fa-square-check me-2"></i> REGISTER VEHICLE`;
            }
        });
    }

    // Form: Vehicle Exit
    const formExit = document.getElementById('form-vehicle-exit');
    const exitSelect = document.getElementById('exit-vehicle-select');
    const exitInput = document.getElementById('exit-vehicle-input');

    if (exitSelect) {
        exitSelect.addEventListener('change', () => {
            const vnum = exitSelect.value;
            exitInput.value = vnum;
            updateExitPreview(vnum);
        });
    }

    if (exitInput) {
        exitInput.addEventListener('input', () => {
            const vnum = exitInput.value.trim().toUpperCase();
            if (exitSelect) exitSelect.value = vnum;
            updateExitPreview(vnum);
        });
    }

    if (formExit) {
        formExit.addEventListener('submit', async (e) => {
            e.preventDefault();
            const vehicleNumber = (exitInput.value || exitSelect.value || '').trim().toUpperCase();

            if (!vehicleNumber) {
                showToast('Please select or enter the vehicle registration number to exit.', 'warning');
                return;
            }

            processVehicleExit(vehicleNumber);
        });
    }

    // Modal Quick Exit Confirm Button
    const confirmExitBtn = document.getElementById('btn-confirm-quick-exit');
    if (confirmExitBtn) {
        confirmExitBtn.addEventListener('click', () => {
            const modalEl = document.getElementById('modal-quick-exit');
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();

            if (State.selectedExitVehicleNumber) {
                processVehicleExit(State.selectedExitVehicleNumber);
            }
        });
    }

    // Modal Cancel Queue Confirm Button
    const confirmCancelQueueBtn = document.getElementById('btn-confirm-cancel-queue');
    if (confirmCancelQueueBtn) {
        confirmCancelQueueBtn.addEventListener('click', async () => {
            const modalEl = document.getElementById('modal-cancel-queue');
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();

            if (State.vehicleToCancel) {
                try {
                    const res = await fetch(`${API_BASE}/queue/${encodeURIComponent(State.vehicleToCancel)}`, {
                        method: 'DELETE'
                    });
                    const data = await res.json();
                    if (data.success) {
                        showToast(`Vehicle ${State.vehicleToCancel} cancelled from waiting queue.`, 'info');
                        loadQueueView();
                    } else {
                        showToast(data.message || 'Failed to cancel waiting vehicle.', 'error');
                    }
                } catch (err) {
                    showToast('Failed to connect to server.', 'error');
                }
            }
        });
    }

    // History Filters & CSV Export
    const btnHistoryFilter = document.getElementById('btn-apply-history-filter');
    if (btnHistoryFilter) {
        btnHistoryFilter.addEventListener('click', loadHistoryView);
    }

    const searchInput = document.getElementById('history-search-input');
    if (searchInput) {
        searchInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') loadHistoryView();
        });
    }

    const btnExportCsv = document.getElementById('btn-export-csv');
    if (btnExportCsv) {
        btnExportCsv.addEventListener('click', exportHistoryToCsv);
    }

    // Settings Capacity Update
    const formCapacity = document.getElementById('form-update-capacity');
    if (formCapacity) {
        formCapacity.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newCap = parseInt(document.getElementById('settings-new-capacity').value, 10);
            if (isNaN(newCap) || newCap < 1) {
                showToast('Please enter a valid capacity.', 'warning');
                return;
            }

            try {
                const res = await fetch(`${API_BASE}/settings/capacity`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ capacity: newCap })
                });
                const data = await res.json();

                if (data.success) {
                    showToast(data.message, 'success');
                    loadSettingsView();
                } else {
                    showToast(data.message || 'Failed to update capacity.', 'error');
                }
            } catch (err) {
                showToast('Network error updating capacity.', 'error');
            }
        });
    }

    // Demo Data Seeder Button
    const btnSeed = document.getElementById('btn-seed-data');
    if (btnSeed) {
        btnSeed.addEventListener('click', async () => {
            if (!confirm('Load realistic demo data? (This will populate active slots, waiting vehicles, and past history)')) return;
            try {
                const res = await fetch(`${API_BASE}/settings/seed`, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    showToast(data.message, 'success');
                    loadSettingsView();
                    navigateTo('dashboard');
                } else {
                    showToast(data.message, 'error');
                }
            } catch (err) {
                showToast('Error seeding demo data.', 'error');
            }
        });
    }

    // System Reset Button
    const btnReset = document.getElementById('btn-reset-system');
    if (btnReset) {
        btnReset.addEventListener('click', async () => {
            if (!confirm('CAUTION: Reset system and erase all records? This restores default 10 empty slots.')) return;
            try {
                const res = await fetch(`${API_BASE}/settings/reset`, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    showToast(data.message, 'info');
                    loadSettingsView();
                    navigateTo('dashboard');
                } else {
                    showToast(data.message, 'error');
                }
            } catch (err) {
                showToast('Error resetting system.', 'error');
            }
        });
    }
}

/**
 * -------------------------------------------------------------
 * 6. VEHICLE EXIT PROCESSOR
 * -------------------------------------------------------------
 */
async function loadExitView() {
    try {
        const res = await fetch(`${API_BASE}/parking/slots`);
        const json = await res.json();
        if (!json.success) return;

        const occupied = json.data.filter(s => s.status === 'OCCUPIED');
        const select = document.getElementById('exit-vehicle-select');
        if (!select) return;

        select.innerHTML = '<option value="">-- Choose Parked Vehicle to Exit --</option>';
        occupied.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.vehicle_number;
            opt.textContent = `${s.slot_number} : ${s.vehicle_number} (${s.owner_name} - ${s.vehicle_type})`;
            select.appendChild(opt);
        });

        // Clear preview
        document.getElementById('exit-vehicle-preview').classList.add('d-none');
    } catch (err) {
        console.error('Failed to load exit options:', err);
    }
}

function updateExitPreview(vehicleNumber) {
    const previewBox = document.getElementById('exit-vehicle-preview');
    if (!previewBox) return;

    if (!vehicleNumber) {
        previewBox.classList.add('d-none');
        return;
    }

    const slot = State.slotsData.find(s => s.vehicle_number && s.vehicle_number.toUpperCase() === vehicleNumber.toUpperCase());
    if (slot) {
        previewBox.classList.remove('d-none');
        document.getElementById('prev-vnum').textContent = slot.vehicle_number;
        document.getElementById('prev-owner').textContent = slot.owner_name;
        document.getElementById('prev-slot').textContent = slot.slot_number;
        document.getElementById('prev-time').textContent = formatTimestamp(slot.entry_time);
    } else {
        previewBox.classList.add('d-none');
    }
}

function promptQuickExit(vehicleNumber, slotNumber, ownerName) {
    State.selectedExitVehicleNumber = vehicleNumber;
    document.getElementById('modal-exit-vnum').textContent = vehicleNumber;
    document.getElementById('modal-exit-details').textContent = `Slot: ${slotNumber} | Owner: ${ownerName}`;

    const modal = new bootstrap.Modal(document.getElementById('modal-quick-exit'));
    modal.show();
}

async function processVehicleExit(vehicleNumber) {
    const submitBtn = document.getElementById('btn-submit-exit');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span> Processing Exit...`;
    }

    try {
        const res = await fetch(`${API_BASE}/vehicles/exit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vehicle_number: vehicleNumber })
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            showToast(data.message || 'Exit failed.', 'error');
        } else {
            // Check if a waiting vehicle was allocated
            if (data.next_allocated_vehicle) {
                showToast(`Vehicle ${data.exited_vehicle.vehicle_number} exited. Next waiting vehicle ${data.next_allocated_vehicle.vehicle_number} allocated to ${data.next_allocated_vehicle.slot_number}!`, 'success');
            } else {
                showToast(`Vehicle ${data.exited_vehicle.vehicle_number} exited successfully. ${data.slot_number} is now available.`, 'info');
            }

            // Reset exit form
            const formExit = document.getElementById('form-vehicle-exit');
            if (formExit) formExit.reset();
            const previewBox = document.getElementById('exit-vehicle-preview');
            if (previewBox) previewBox.classList.add('d-none');

            // Refresh slots and queue
            loadExitView();
            setTimeout(() => navigateTo('slots'), 1200);
        }
    } catch (err) {
        console.error('Exit Error:', err);
        showToast('Network error while processing exit.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fa-solid fa-right-from-bracket me-2"></i> PROCESS VEHICLE EXIT`;
        }
    }
}

/**
 * -------------------------------------------------------------
 * 7. WAITING QUEUE VIEW CONTROLLER (FIFO)
 * -------------------------------------------------------------
 */
async function loadQueueView() {
    try {
        const res = await fetch(`${API_BASE}/queue`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        const queue = json.data;
        const status = json.status;
        State.queueData = queue;

        // Stat cards
        document.getElementById('q-total-count').textContent = queue.length;
        document.getElementById('q-front-vnum').textContent = status.front ? status.front.vehicle_number : 'Empty';
        document.getElementById('q-rear-vnum').textContent = status.rear ? status.rear.vehicle_number : 'Empty';

        // Render visual lane
        renderFullQueueVisual(queue);

        // Render queue table
        renderQueueTable(queue);

        // Update badge
        const badge = document.getElementById('sidebar-queue-badge');
        if (badge) badge.textContent = queue.length;

    } catch (err) {
        console.error('Failed to load queue:', err);
    }
}

function renderFullQueueVisual(queue) {
    const lane = document.getElementById('full-queue-visual-lane');
    if (!lane) return;

    if (!queue || queue.length === 0) {
        lane.innerHTML = `
            <div class="p-4 text-center text-muted w-100">
                <i class="fa-solid fa-circle-check text-success fa-2x mb-2"></i>
                <div class="fw-bold">Waiting Queue is Empty</div>
                <div class="small">All incoming vehicles can be parked without waiting.</div>
            </div>
        `;
        return;
    }

    let html = '';
    queue.forEach((item, index) => {
        const isFront = item.is_front;
        const isRear = item.is_rear;
        const roleLabel = isFront ? 'FRONT (NEXT IN LINE)' : (isRear ? 'REAR (LAST ARRIVED)' : `POSITION #${item.position}`);
        const cardClass = isFront ? 'node-front' : (isRear ? 'node-rear' : '');

        html += `
            <div class="queue-node ${cardClass}">
                <span class="node-badge">${roleLabel}</span>
                <div class="d-flex justify-content-between align-items-center mb-1 mt-2">
                    <span class="node-position">#${item.position}</span>
                    <span class="badge bg-light text-dark border"><i class="fa-solid ${getVehicleIcon(item.vehicle_type)}"></i> ${item.vehicle_type}</span>
                </div>
                <div class="fw-bold fs-6 text-primary" style="letter-spacing: 0.05em;">${escapeHtml(item.vehicle_number)}</div>
                <div class="small text-truncate text-muted">${escapeHtml(item.owner_name)}</div>
                <div class="small text-secondary mt-1"><i class="fa-regular fa-clock"></i> ${item.waiting_duration}</div>
                <button class="btn btn-sm btn-outline-danger w-100 mt-2 py-0" onclick="promptCancelQueue('${escapeHtml(item.vehicle_number)}')">
                    <i class="fa-solid fa-xmark me-1"></i> Cancel
                </button>
            </div>
        `;

        if (index < queue.length - 1) {
            html += `<div class="queue-arrow"><i class="fa-solid fa-arrow-right"></i></div>`;
        }
    });

    lane.innerHTML = html;
}

function renderQueueTable(queue) {
    const tbody = document.getElementById('queue-table-body');
    if (!tbody) return;

    if (!queue || queue.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No vehicles currently waiting in queue.</td></tr>`;
        return;
    }

    tbody.innerHTML = queue.map(item => {
        let roleBadge = '<span class="badge bg-light text-dark border">In Queue</span>';
        if (item.is_front) roleBadge = '<span class="badge bg-primary text-white"><i class="fa-solid fa-flag-checkered me-1"></i> FRONT</span>';
        else if (item.is_rear) roleBadge = '<span class="badge bg-warning text-dark"><i class="fa-solid fa-backward me-1"></i> REAR</span>';

        return `
            <tr>
                <td><strong class="fs-6 text-primary">#${item.position}</strong></td>
                <td>${roleBadge}</td>
                <td><strong class="font-monospace">${escapeHtml(item.vehicle_number)}</strong></td>
                <td>${escapeHtml(item.owner_name)}</td>
                <td><i class="fa-solid ${getVehicleIcon(item.vehicle_type)} text-secondary me-1"></i> ${escapeHtml(item.vehicle_type)}</td>
                <td><small class="text-muted">${formatTimestamp(item.entry_time)}</small></td>
                <td><span class="badge bg-light text-dark border"><i class="fa-regular fa-clock me-1"></i> ${item.waiting_duration}</span></td>
                <td>
                    <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="promptCancelQueue('${escapeHtml(item.vehicle_number)}')">
                        <i class="fa-solid fa-ban me-1"></i> Cancel
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function promptCancelQueue(vehicleNumber) {
    State.vehicleToCancel = vehicleNumber;
    document.getElementById('modal-cancel-vnum').textContent = vehicleNumber;

    const modal = new bootstrap.Modal(document.getElementById('modal-cancel-queue'));
    modal.show();
}

/**
 * -------------------------------------------------------------
 * 8. PARKING HISTORY VIEW CONTROLLER
 * -------------------------------------------------------------
 */
async function loadHistoryView() {
    try {
        const search = document.getElementById('history-search-input')?.value.trim() || '';
        const type = document.getElementById('history-filter-type')?.value || 'ALL';
        const status = document.getElementById('history-filter-status')?.value || 'ALL';
        const start = document.getElementById('history-filter-start')?.value || '';

        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (type !== 'ALL') params.append('vehicle_type', type);
        if (status !== 'ALL') params.append('status', status);
        if (start) params.append('start_date', start);

        const res = await fetch(`${API_BASE}/history?${params.toString()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        State.historyData = json.data;
        document.getElementById('history-total-records').textContent = `${json.total_records} Records`;

        renderHistoryTable(json.data);
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

function renderHistoryTable(records) {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    if (!records || records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No matching parking history records found.</td></tr>`;
        return;
    }

    tbody.innerHTML = records.map(r => `
        <tr>
            <td><span class="text-muted small">#${r.id}</span></td>
            <td><strong class="font-monospace text-primary">${escapeHtml(r.vehicle_number)}</strong></td>
            <td>${escapeHtml(r.owner_name)}</td>
            <td><i class="fa-solid ${getVehicleIcon(r.vehicle_type)} text-secondary me-1"></i> ${escapeHtml(r.vehicle_type)}</td>
            <td><span class="badge bg-light text-dark border">${escapeHtml(r.slot_number || 'Queue')}</span></td>
            <td><small class="text-muted">${formatTimestamp(r.entry_time)}</small></td>
            <td><small class="text-muted">${r.exit_time ? formatTimestamp(r.exit_time) : '<span class="text-success fw-bold">Active</span>'}</small></td>
            <td>${renderStatusBadge(r.status)}</td>
        </tr>
    `).join('');
}

function exportHistoryToCsv() {
    if (!State.historyData || State.historyData.length === 0) {
        showToast('No history records available to export.', 'warning');
        return;
    }

    const headers = ['Record ID', 'Vehicle Number', 'Owner Name', 'Vehicle Type', 'Slot Number', 'Entry Time', 'Exit Time', 'Status'];
    const rows = State.historyData.map(r => [
        r.id,
        `"${r.vehicle_number}"`,
        `"${r.owner_name}"`,
        r.vehicle_type,
        `"${r.slot_number || ''}"`,
        `"${r.entry_time}"`,
        `"${r.exit_time || ''}"`,
        r.status
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `smart_parking_history_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Parking history downloaded as CSV file.', 'success');
}

/**
 * -------------------------------------------------------------
 * 9. REPORTS VIEW CONTROLLER
 * -------------------------------------------------------------
 */
async function loadReportsView() {
    try {
        const res = await fetch(`${API_BASE}/reports`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        if (window.AppCharts) {
            window.AppCharts.renderReportCharts(json.data);
        }
    } catch (err) {
        console.error('Failed to load reports:', err);
    }
}

/**
 * -------------------------------------------------------------
 * 10. SETTINGS VIEW CONTROLLER
 * -------------------------------------------------------------
 */
async function loadSettingsView() {
    try {
        const res = await fetch(`${API_BASE}/settings`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        const data = json.data;
        document.getElementById('settings-current-capacity').value = `${data.capacity} Slots (${data.occupied_slots} Occupied, ${data.available_slots} Available)`;
        document.getElementById('settings-new-capacity').value = data.capacity;
        document.getElementById('settings-new-capacity').min = data.occupied_slots;

        document.getElementById('sys-db-engine').textContent = data.database_engine;
        document.getElementById('sys-node-version').textContent = data.node_version;
        document.getElementById('sys-uptime').textContent = formatSeconds(data.server_uptime_seconds);
        document.getElementById('sys-history-count').textContent = `${data.history_count} Records`;
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
}

async function updateSidebarQueueBadge() {
    try {
        const res = await fetch(`${API_BASE}/queue`);
        const json = await res.json();
        if (json.success) {
            const badge = document.getElementById('sidebar-queue-badge');
            if (badge) badge.textContent = json.total_waiting;
        }
    } catch (e) {
        // quiet ignore
    }
}

/**
 * -------------------------------------------------------------
 * 11. UTILITIES & TOASTS
 * -------------------------------------------------------------
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `custom-toast toast-${type}`;

    let icon = 'fa-circle-info text-primary';
    if (type === 'success') icon = 'fa-circle-check text-success';
    if (type === 'error') icon = 'fa-circle-xmark text-danger';
    if (type === 'warning') icon = 'fa-triangle-exclamation text-warning';

    toast.innerHTML = `
        <i class="fa-solid ${icon} fa-lg mt-1"></i>
        <div class="flex-grow-1">
            <div class="fw-bold small text-uppercase" style="letter-spacing: 0.05em;">${type}</div>
            <div class="small">${escapeHtml(message)}</div>
        </div>
        <button type="button" class="btn-close btn-sm ms-2" onclick="this.parentElement.remove()"></button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(50px)';
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

function getVehicleIcon(type) {
    switch (type) {
        case 'Bike': return 'fa-motorcycle';
        case 'Van': return 'fa-van-shuttle';
        case 'Car':
        default: return 'fa-car-side';
    }
}

function renderStatusBadge(status) {
    switch (status) {
        case 'PARKED':
            return '<span class="badge-status badge-parked"><i class="fa-solid fa-circle-check"></i> Parked</span>';
        case 'WAITING':
            return '<span class="badge-status badge-waiting"><i class="fa-solid fa-clock"></i> Waiting (FIFO)</span>';
        case 'COMPLETED':
            return '<span class="badge-status badge-completed"><i class="fa-solid fa-flag-checkered"></i> Completed</span>';
        case 'CANCELLED':
            return '<span class="badge-status badge-cancelled"><i class="fa-solid fa-ban"></i> Cancelled</span>';
        default:
            return `<span class="badge-status badge-completed">${escapeHtml(status)}</span>`;
    }
}

function formatTimestamp(isoStr) {
    if (!isoStr) return '--';
    try {
        const d = new Date(isoStr);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ')';
    } catch (e) {
        return isoStr;
    }
}

function formatSeconds(seconds) {
    if (!seconds || seconds <= 0) return 'Just now';
    const s = Math.floor(seconds);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    if (m < 60) return `${m}m ${rs}s`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
