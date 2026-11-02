# Smart Parking Management System Using Queue Data Structure (FIFO)
### Full-Stack Cloud Architecture: GitHub + Vercel + Supabase (PostgreSQL)

An enterprise-grade, cloud-deployed Smart Parking Management System designed and built for an advanced **Computer Science Engineering Mini Project**. 

This system demonstrates the real-world application of the **Queue Data Structure (FIFO - First In, First Out)** to manage parking slot allocations, handle overflow with automated queuing, and atomically reallocate vacated slots to waiting drivers using **Supabase PostgreSQL** cloud persistence and **Vercel Serverless Functions**.

---

## 🌟 Key Highlights

* **True Cloud Architecture**: Deployed as an online, publicly accessible web application on **Vercel** with a managed **PostgreSQL** database on **Supabase**.
* **Strict FIFO Queue Data Structure**: Implements `ENQUEUE`, `DEQUEUE`, `FRONT`, `REAR`, `DISPLAY`, and `SIZE` with deterministic cloud PostgreSQL sequence tracking (`queue_order`).
* **Atomic Concurrency Protection**: High-concurrency slot exit and queue dispatching executed via PostgreSQL RPC functions with row-level locking (`FOR UPDATE SKIP LOCKED`) to eliminate double-allocations and race conditions.
* **Serverless Express.js Integration**: Express REST API optimized for Vercel Serverless Functions (`api/index.js`) while maintaining full local development capability.
* **Smart-City Admin Dashboard**: Built with vanilla JavaScript, modern Bootstrap 5, Font Awesome, and Chart.js featuring dynamic slot cards (Green = Available, Red = Occupied, Orange = Waiting) and real-time visual queue conveyor ribbon.

---

## 🏗️ System Architecture

```
               ┌────────────────────────────────────────────────────────┐
               │                     WEB BROWSER                        │
               │        (HTML5 / CSS3 / Vanilla JS / Bootstrap 5)       │
               └───────────────────────────┬────────────────────────────┘
                                           │ HTTPS REST API (/api/...)
                                           ▼
               ┌────────────────────────────────────────────────────────┐
               │                   VERCEL SERVERLESS                    │
               │                 Node.js + Express.js                   │
               │                   (`api/index.js`)                     │
               └───────────────────────────┬────────────────────────────┘
                                           │ Secure Service Role RPC / SSL
                                           ▼
               ┌────────────────────────────────────────────────────────┐
               │                    SUPABASE CLOUD                      │
               │              Managed PostgreSQL Database               │
               │  - `parking_slots` (Physical Slot Registry)            │
               │  - `vehicles` (Parked & FIFO Waiting Queue)            │
               │  - `parking_history` (Permanent Audit Trail)           │
               │  - Atomic Stored Procedures & Row Locking              │
               └────────────────────────────────────────────────────────┘
```

---

## 📁 Project Folder Structure

```
smart-parking-system/
│
├── api/
│   └── index.js                   # Vercel Serverless Express entry point
│
├── public/
│   ├── index.html                 # Single-page dashboard application
│   ├── style.css                  # Modern smart-city UI styling
│   ├── script.js                  # Frontend controller & Chart.js logic
│   └── assets/                    # Static assets & images
│
├── src/
│   ├── config/
│   │   └── supabase.js            # Secure Supabase client initialization
│   │
│   ├── controllers/
│   │   ├── dashboardController.js # Dashboard metrics, reports & settings
│   │   ├── vehicleController.js   # Vehicle entry, exit, & search
│   │   ├── parkingController.js   # Slot management & capacity
│   │   ├── queueController.js     # FIFO queue queries & cancellation
│   │   └── historyController.js   # Audit logs & filters
│   │
│   ├── routes/
│   │   ├── dashboardRoutes.js     # /api/dashboard, /api/reports, /api/settings
│   │   ├── vehicleRoutes.js       # /api/vehicles, /api/vehicles/entry, /api/vehicles/exit
│   │   ├── parkingRoutes.js       # /api/parking/slots
│   │   ├── queueRoutes.js         # /api/queue, /api/queue/front, /api/queue/rear
│   │   └── historyRoutes.js       # /api/history
│   │
│   ├── services/
│   │   └── parkingService.js      # Core business logic & database orchestration
│   │
│   └── middleware/
│       └── errorHandler.js        # Centralized HTTP error handling
│
├── supabase/
│   └── schema.sql                 # PostgreSQL DDL schema & atomic RPC functions
│
├── .gitignore                     # Git ignore rules (protects .env secrets)
├── .env.example                   # Environment variable template
├── package.json                   # Project manifest, dependencies, & scripts
├── vercel.json                    # Vercel deployment & routing configuration
└── README.md                      # Complete documentation & deployment guide
```

---

## 🗄️ Supabase PostgreSQL Database Schema

### Table 1: `parking_slots`
* Stores physical parking slots (`SLOT-01` to `SLOT-10` by default).
* Columns: `id` (PK), `slot_number` (UNIQUE), `status` (`AVAILABLE` or `OCCUPIED`), `current_vehicle_id` (FK to `vehicles.id`), `created_at`, `updated_at`.

### Table 2: `vehicles`
* Manages all currently active and waiting vehicles.
* Columns: `id` (PK), `owner_name`, `vehicle_number`, `vehicle_type` (`Car`, `Bike`, `Van`), `entry_time`, `exit_time`, `status` (`PARKED`, `WAITING`, `COMPLETED`, `CANCELLED`), `slot_id` (FK to `parking_slots.id`), `queue_order` (Monotonically increasing integer for FIFO queue ordering), `created_at`, `updated_at`.
* **Constraint**: `UNIQUE(vehicle_number) WHERE status IN ('PARKED', 'WAITING')` prevents duplicate check-ins.

### Table 3: `parking_history`
* Permanent audit trail of every check-in, slot assignment, queue duration, and check-out.
* Columns: `id` (PK), `vehicle_id`, `owner_name`, `vehicle_number`, `vehicle_type`, `slot_number`, `entry_time`, `exit_time`, `status`, `created_at`.

### Table 4: `system_settings`
* Stores facility configuration such as capacity.

---

## ⚙️ Queue Data Structure Implementation (FIFO)

The waiting line is managed in `src/services/parkingService.js` and `supabase/schema.sql`:

1. **ENQUEUE (Arrival when full)**:
   * When all parking slots are `OCCUPIED`, the incoming vehicle is assigned `status = 'WAITING'` and `queue_order = MAX(queue_order) + 1`.
   * Stored permanently in PostgreSQL, ensuring that serverless restarts or page reloads never lose queue ordering.
2. **DEQUEUE (Parked vehicle exits)**:
   * When an occupied slot is vacated, the database searches for the oldest waiting vehicle (`ORDER BY queue_order ASC, entry_time ASC LIMIT 1`).
   * The slot is released and atomically reassigned to this vehicle in a single database transaction.
   * Remaining waiting vehicles are contiguous reindexed (1, 2, 3...).
3. **FRONT & REAR**:
   * Inspects the next vehicle in line (lowest `queue_order`) and the most recently arrived waiting vehicle (highest `queue_order`).

---

## 🚀 Complete Deployment Guide: GitHub + Vercel + Supabase

Follow these 4 steps to deploy your project live on the internet:

### STEP 1: Set Up Supabase Cloud Database

1. Sign up / Log in to [Supabase](https://supabase.com/).
2. Click **New Project**, choose an organization, set a project name (e.g. `smart-parking-system`), and generate a strong database password.
3. Once your project is created, click on the **SQL Editor** tab (icon `>_` on the left sidebar).
4. Click **New Query**, open the file [`supabase/schema.sql`](file:///c:/Users/PRADEEP/OneDrive/Desktop/SMART%20PARKING%20MANAGEMENT%20SYSTEM%20USING%20QUEUE%20DATA%20STRUCTURE/supabase/schema.sql) from this repository, copy its entire contents, paste them into the SQL Editor, and click **Run**.
5. All 4 tables, indexes, constraints, and atomic stored procedures (`initialize_parking_slots`, `register_vehicle`, `exit_vehicle_and_allocate_queue`, `seed_demo_data`) will be created instantly.
6. Retrieve your credentials:
   * Go to **Project Settings** (gear icon) $\rightarrow$ **API**.
   * Copy the **Project URL** (e.g. `https://xyzcompany.supabase.co`).
   * Copy the **service_role secret key** (under *Project API keys*).

---

### STEP 2: Configure Local Environment (Optional)

1. In the project folder, create a `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and fill in your Supabase credentials:
   ```env
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
   PORT=3000
   NODE_ENV=development
   ```
3. Test locally:
   ```bash
   npm install
   npm start
   ```
   Open `http://localhost:3000` in your browser.

---

### STEP 3: Push Source Code to GitHub

1. Open your terminal in the project directory:
   ```bash
   git init
   git add .
   git commit -m "Initial Smart Parking System with Queue Data Structure"
   git branch -M main
   ```
2. Create a new repository on [GitHub](https://github.com/new) (e.g. `smart-parking-system`).
3. Link your local repo and push:
   ```bash
   git remote add origin https://github.com/YOUR_GITHUB_USERNAME/smart-parking-system.git
   git push -u origin main
   ```
*(Note: `.env` is automatically ignored by `.gitignore` so your secrets will never be exposed on GitHub).*

---

### STEP 4: Deploy to Vercel

1. Log in to [Vercel](https://vercel.com/).
2. Click **Add New... $\rightarrow$ Project**.
3. Import your GitHub repository (`smart-parking-system`).
4. In the **Configure Project** screen:
   * **Framework Preset**: Other (or Node.js)
   * **Root Directory**: `./` (leave default)
5. Expand the **Environment Variables** section and add:
   * `SUPABASE_URL`: Paste your Supabase project URL.
   * `SUPABASE_SERVICE_ROLE_KEY`: Paste your Supabase service_role secret key.
   * `NODE_ENV`: `production`
6. Click **Deploy**.
7. Vercel will build and deploy your application within 30 seconds, providing a live URL like `https://smart-parking-system.vercel.app`!

---

## 📡 REST API Reference

All frontend API calls use relative URLs (`/api/...`) so they work identically in both local development and Vercel cloud hosting:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check & Supabase connection status |
| `GET` | `/api/dashboard` | Aggregated parking stats, slot status, & queue preview |
| `GET` | `/api/parking/slots` | List all parking slots with occupant details |
| `POST` | `/api/parking/slots` | Add new parking slot to increase facility capacity |
| `GET` | `/api/vehicles` | List all active vehicles (Parked + Waiting) |
| `POST` | `/api/vehicles/entry` | Register vehicle (parks if slot available, enqueues if full) |
| `POST` | `/api/vehicles/exit` | Check out vehicle & atomically dispatch slot to FIFO queue |
| `GET` | `/api/vehicles/:vehicleNumber` | Search active vehicle record |
| `GET` | `/api/queue` | Complete list of waiting vehicles in FIFO order |
| `GET` | `/api/queue/front` | Inspect front vehicle in waiting queue |
| `GET` | `/api/queue/rear` | Inspect rear vehicle in waiting queue |
| `DELETE` | `/api/queue/:vehicleNumber` | Cancel waiting vehicle and reindex queue |
| `GET` | `/api/history` | Audit trail with search, filters, sorting, and CSV download |
| `GET` | `/api/reports` | Analytical reports (occupancy trend, daily flow, peak hours) |
| `GET` | `/api/settings` | System environment and capacity settings |
| `PUT` | `/api/settings/capacity` | Update total slot capacity safely |
| `POST` | `/api/settings/seed` | Seed realistic demo data into Supabase (1-click) |
| `POST` | `/api/settings/reset` | Restore factory defaults (10 empty slots) |

---

## 🧪 Verification & Demonstration Scenarios

Execute these 12 test cases during your college mini project evaluation:

| Test # | Test Scenario | Steps to Execute | Expected Result |
|---|---|---|---|
| **1** | Register vehicle with available slot | Go to **Vehicle Entry**, register `KA-01-AA-1111` (Car). | Allocated to `SLOT-01`. Card turns **RED** (Occupied). |
| **2** | Fill all 10 slots | Click **Settings $\rightarrow$ Load Realistic Demo Data** (or register 10 cars). | All 10 slots turn **RED**. Available slots shows `0`. |
| **3** | Register 11th vehicle when full | Go to **Vehicle Entry**, register `DL-01-ZZ-9999` (Car). | System detects full parking. Returns: *"Parking Full - Added to Waiting Queue (Position #1)"*. |
| **4** | Register multiple waiting vehicles | Register 2 more vehicles (`MH-12-QQ-8888`, `TN-07-WW-7777`). | Queue displays arrival order: `#1 (FRONT)`, `#2`, `#3 (REAR)`. |
| **5** | Exit parked vehicle & trigger FIFO dispatch | Go to **Vehicle Exit**, select `SLOT-01` (`KA-01-AA-1111`), click **Process Exit**. | `SLOT-01` is vacated and **automatically allocated to FRONT vehicle `#1`** from the queue. |
| **6** | Verify FIFO queue integrity | Check **Waiting Queue** page. | Previous vehicle `#2` has now moved up to position `#1 (FRONT)`. |
| **7** | Refresh the website | Press `F5` / reload the browser. | All slots, allocations, and queue positions remain saved in Supabase. |
| **8** | Serverless cold start / Redeployment | Trigger a redeploy in Vercel or restart local server. | Database records and queue state persist unchanged. |
| **9** | Prevent duplicate registration | Try registering an active vehicle already parked or in queue. | Backend rejects entry: *"Duplicate entry rejected"*. |
| **10** | Concurrent request protection | Test simultaneous entries. | Row-level locking ensures no slot is assigned twice. |
| **11** | Analytical reports & CSV download | Open **Reports** and **Parking History**, click **Export CSV**. | Live Chart.js graphs render and `.csv` audit file downloads. |
| **12** | Database audit in Supabase | Open the Supabase dashboard Table Editor. | All transactions and status transitions reflect in PostgreSQL. |

---

## 🔧 Troubleshooting Guide

* **Issue: "Database configuration missing" or 500 error**:
  * *Fix*: Verify that `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are entered under **Vercel Project Settings $\rightarrow$ Environment Variables**, and redeploy your project.
* **Issue: API returns 404 on Vercel**:
  * *Fix*: Ensure `vercel.json` exists in the repository root with the correct rewrite rule for `/api/(.*)`.
* **Issue: Supabase functions not working**:
  * *Fix*: Make sure you pasted and ran the entire [`supabase/schema.sql`](file:///c:/Users/PRADEEP/OneDrive/Desktop/SMART%20PARKING%20MANAGEMENT%20SYSTEM%20USING%20QUEUE%20DATA%20STRUCTURE/supabase/schema.sql) file in the Supabase SQL Editor.
* **Issue: CORS error in browser**:
  * *Fix*: The application uses relative URLs (`/api/...`), so all requests originate from the same host, inherently eliminating cross-origin issues.

---

## 🎓 College Viva / Project Q&A Preparation

### Q1: Why use a Queue Data Structure instead of a Priority Queue or Stack?
> **Answer**: Parking spaces are a shared, finite community resource. When arrival rates exceed capacity, fairness is paramount. A **FIFO (First In, First Out) Queue** guarantees fairness: the driver who arrived earliest receives the next available spot. Stacks (LIFO) would induce starvation for earlier arrivals, while random selection lacks systematic predictability.

### Q2: How does the system handle concurrent transactions when multiple vehicles exit or enter simultaneously?
> **Answer**: In `supabase/schema.sql`, critical parking operations are wrapped in PostgreSQL stored procedures that utilize `FOR UPDATE SKIP LOCKED`. When finding an available slot or dequeuing the oldest waiting vehicle, the matching database rows are locked at the engine level until the transaction commits, preventing race conditions and double-allocations.

### Q3: Why is Vercel + Supabase superior to a local-only database for this project?
> **Answer**: A local SQLite or JSON file cannot serve users online and loses state across distributed serverless environments. By coupling Vercel's serverless edge network with Supabase's managed cloud PostgreSQL instance, the application achieves high availability, real-time persistence, and global accessibility.

---

## 📄 License
This project is open-source and created for academic, college evaluation, and educational demonstration purposes.
