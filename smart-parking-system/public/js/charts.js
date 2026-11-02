/**
 * CHARTS.JS - Chart.js Visualizations for Smart Parking Management System
 */

const AppCharts = {
    occupancyChart: null,
    typesChart: null,
    dailyFlowChart: null,
    reportTypesChart: null,
    hourlyTrafficChart: null,

    /**
     * Initialize or update the Dashboard Occupancy Donut Chart
     */
    updateOccupancyChart(available, occupied) {
        const ctx = document.getElementById('chart-occupancy');
        if (!ctx) return;

        const data = {
            labels: ['Available Slots', 'Occupied Slots'],
            datasets: [{
                data: [available, occupied],
                backgroundColor: ['#10b981', '#ef4444'],
                hoverBackgroundColor: ['#059669', '#dc2626'],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        };

        if (this.occupancyChart) {
            this.occupancyChart.data = data;
            this.occupancyChart.update();
            return;
        }

        this.occupancyChart = new Chart(ctx, {
            type: 'doughnut',
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            boxWidth: 12,
                            font: { family: 'Inter', size: 12, weight: 600 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return ` ${context.label}: ${context.raw} slots`;
                            }
                        }
                    }
                }
            }
        });
    },

    /**
     * Initialize or update Dashboard Vehicle Type Bar Chart
     */
    updateTypesChart(typeDistribution) {
        const ctx = document.getElementById('chart-types');
        if (!ctx) return;

        const typeMap = { 'Car': 0, 'Bike': 0, 'Van': 0 };
        if (Array.isArray(typeDistribution)) {
            typeDistribution.forEach(item => {
                if (typeMap[item.vehicle_type] !== undefined) {
                    typeMap[item.vehicle_type] = item.count;
                }
            });
        }

        const data = {
            labels: ['Cars', 'Bikes', 'Vans'],
            datasets: [{
                label: 'Active Vehicles',
                data: [typeMap.Car, typeMap.Bike, typeMap.Van],
                backgroundColor: ['#2563eb', '#10b981', '#06b6d4'],
                borderRadius: 8,
                barThickness: 36
            }]
        };

        if (this.typesChart) {
            this.typesChart.data = data;
            this.typesChart.update();
            return;
        }

        this.typesChart = new Chart(ctx, {
            type: 'bar',
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, font: { family: 'Inter' } },
                        grid: { color: '#f1f5f9' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { font: { family: 'Inter', weight: 600 } }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    },

    /**
     * Render Reports View Charts
     */
    renderReportCharts(reportsData) {
        if (!reportsData) return;

        // 1. Daily Entries vs Exits
        const flowCtx = document.getElementById('chart-daily-flow');
        if (flowCtx) {
            const entryMap = {};
            const exitMap = {};
            const allDatesSet = new Set();

            (reportsData.daily_entries || []).forEach(d => {
                entryMap[d.date] = d.count;
                allDatesSet.add(d.date);
            });
            (reportsData.daily_exits || []).forEach(d => {
                exitMap[d.date] = d.count;
                allDatesSet.add(d.date);
            });

            // If empty, supply last 3 days
            if (allDatesSet.size === 0) {
                const today = new Date().toISOString().split('T')[0];
                allDatesSet.add(today);
            }

            const sortedDates = Array.from(allDatesSet).sort();
            const entriesData = sortedDates.map(d => entryMap[d] || 0);
            const exitsData = sortedDates.map(d => exitMap[d] || 0);

            if (this.dailyFlowChart) {
                this.dailyFlowChart.destroy();
            }

            this.dailyFlowChart = new Chart(flowCtx, {
                type: 'bar',
                data: {
                    labels: sortedDates,
                    datasets: [
                        {
                            label: 'Entries',
                            data: entriesData,
                            backgroundColor: '#2563eb',
                            borderRadius: 6
                        },
                        {
                            label: 'Exits',
                            data: exitsData,
                            backgroundColor: '#ef4444',
                            borderRadius: 6
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, ticks: { stepSize: 1 } },
                        x: { grid: { display: false } }
                    },
                    plugins: {
                        legend: { position: 'top' }
                    }
                }
            });
        }

        // 2. Lifetime Type Distribution
        const typeCtx = document.getElementById('chart-report-types');
        if (typeCtx) {
            const labels = [];
            const counts = [];
            const colors = ['#2563eb', '#10b981', '#06b6d4', '#f59e0b', '#8b5cf6'];

            (reportsData.type_distribution || []).forEach(item => {
                labels.push(item.vehicle_type);
                counts.push(item.count);
            });

            if (labels.length === 0) {
                labels.push('No Records');
                counts.push(1);
            }

            if (this.reportTypesChart) {
                this.reportTypesChart.destroy();
            }

            this.reportTypesChart = new Chart(typeCtx, {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        data: counts,
                        backgroundColor: colors.slice(0, labels.length)
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });
        }

        // 3. Hourly Traffic
        const hourCtx = document.getElementById('chart-hourly-traffic');
        if (hourCtx) {
            const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
            const hourMap = {};

            (reportsData.hourly_traffic || []).forEach(item => {
                const h = String(parseInt(item.hour, 10)).padStart(2, '0') + ':00';
                hourMap[h] = item.count;
            });

            const trafficData = hours.map(h => hourMap[h] || 0);

            if (this.hourlyTrafficChart) {
                this.hourlyTrafficChart.destroy();
            }

            this.hourlyTrafficChart = new Chart(hourCtx, {
                type: 'line',
                data: {
                    labels: hours,
                    datasets: [{
                        label: 'Vehicle Entries by Hour',
                        data: trafficData,
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.1)',
                        fill: true,
                        tension: 0.35,
                        pointRadius: 4,
                        pointBackgroundColor: '#2563eb'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, ticks: { stepSize: 1 } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }
    }
};

window.AppCharts = AppCharts;
