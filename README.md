# Building a Smart Parking Management System with GridDB Native and Node.js

An independent application draft based on the existing GridDB energy-monitor example. It keeps the `apps/dashboard`, `apps/native-bridge`, `apps/scripts`, and `blogs/<topic>` structure, with parking-specific schemas and business logic.

The app manages 24 spaces in zones A, B, and C. You can register arrivals and departures, inspect active sessions, record fees, view recent activity, and run a parking-event simulator. The simulator is stopped by default.

## Project structure

```text
smart-parking-management/
├── README.md
├── apps/
│   ├── package.json
│   ├── scripts/
│   │   ├── run.mjs
│   │   ├── doctor.mjs
│   │   └── check.mjs
│   ├── dashboard/
│   │   ├── package.json
│   │   ├── index.html
│   │   ├── app.js
│   │   └── styles.css
│   └── native-bridge/
│       ├── package.json
│       ├── .env.example
│       ├── lib/README.md
│       ├── scripts/setup-macos.sh
│       ├── src/
│       │   ├── griddb-client.js
│       │   ├── parking-service.js
│       │   ├── demo-store.js
│       │   ├── server.js
│       │   └── index.js
│       ├── python/
│       │   ├── griddb_worker.py
│       │   ├── parking.py
│       │   ├── init_schema.py
│       │   └── test_parking.py
│       └── test/parking.test.js
└── blogs/smart-parking-management/
    ├── blog.md
    └── assets/README.md
```

The browser dashboard uses plain JavaScript and CSS and is served by the Node API. It needs no frontend build or third-party JavaScript dependencies. The original example’s dashboard framework is intentionally simplified for a beginner tutorial; the workspace and native bridge layout are retained.

## Quick preview without GridDB

Use Node.js 22 or newer and Python 3.12 for the syntax checks. From this folder:

```bash
cd apps
npm install
npm run dev:demo
```

Open **http://127.0.0.1:3002**. The header explicitly says `DEMO · memory only`. Demo mode starts with eight occupied spaces, supports the same dashboard operations, and resets when the server stops. It does not connect to or validate GridDB. No real credentials, licensed libraries, or virtual environments are copied from the original project.

## Native GridDB Cloud setup on macOS

Requirements: Node.js 22+, Python 3.12, Homebrew, Java 21, Maven, and access to GridDB Cloud with a supported public native route. The setup script installs the public libraries and pins the Python client source to the commit reviewed in the original example, with GridDB Java/Arrow adapter 5.9.0 and Arrow memory Netty 17.0.0.

```bash
cd apps
npm install
npm run setup:mac
cp native-bridge/.env.example native-bridge/.env
```

In your Cloud portal, generate the Notification Provider URL, configure the app’s public outbound IP in the access list, and download the compatible Cloud Java library. Install the JAR from the downloaded RPM or an extracted JAR (quote paths containing spaces):

```bash
npm run install:cloud-jar -- /path/to/griddb-ee-java-lib-5.9.0-linux.x86_64.rpm
# Or: npm run install:cloud-jar -- /path/to/gridstore-advanced.jar
```

The installer requires Bash and, for RPMs, `bsdtar` or both `rpm2cpio` and `cpio`. It copies the library to `apps/native-bridge/lib/gridstore-advanced.jar`; the setup script supplies the other three JARs. Use the library versions supported by your Cloud service; do not publish the licensed JAR in a public repository.

Edit `native-bridge/.env` using real values:

```dotenv
GRIDDB_NOTIFICATION_PROVIDER='https://your-provider-url'
GRIDDB_CLUSTER_NAME='your-cluster'
GRIDDB_DATABASE='your-database'
GRIDDB_USERNAME='your-user'
GRIDDB_PASSWORD='your-password'
GRIDDB_CONNECTION_ROUTE='PUBLIC'
GRIDDB_SSL_MODE='PREFERRED'
PARKING_CONTAINER_PREFIX='parking_demo'
PARKING_MODE='native'
PARKING_API_HOST='127.0.0.1'
PARKING_API_PORT='3002'
PARKING_HOURLY_RATE='2.50'
GRIDDB_REQUEST_TIMEOUT_MS='30000'
```

Use a dedicated database or prefix. The prefix must start with a letter and contain at most 41 letters, digits, or underscores. The project loads `.env` without executing it; shell environment variables take precedence. Do not put JavaScript template syntax, shell commands, or inline comments into values.

```bash
npm run doctor
npm run init
npm run seed
npm run dev:griddb
npm run dev:live
```

`doctor` checks local prerequisites. `init` creates 28 containers and refuses incompatible existing schemas. `seed` adds missing space metadata without clearing sessions or replacing existing rates. `dev:griddb` forces a real database request. `dev:live` starts the API and dashboard in native mode and refuses to start if the database cannot be reached or no spaces exist.

Linux/Windows: install the compatible Python client, JPype, PyArrow, Java and Maven using their official instructions, supply the same four JARs, and set `JAVA_HOME` and optionally `PYTHON_BIN`. The Node bridge recognizes Windows virtual-environment paths, but the included automated setup script is for macOS only; Linux and Windows installation have not been verified for this draft.

## How the native bridge works

```text
Browser dashboard
  → local Node.js HTTP API
  → persistent Python worker over NDJSON stdin/stdout
  → JPype / JVM / GridDB Java client
  → GridDB native connection to GridDB Cloud
```

The browser uses HTTP to communicate with the application. GridDB operations use the native client through Python, not the GridDB Cloud Web API. The HTTPS Notification Provider URL still participates in discovery. One persistent worker owns the store and serializes all parking operations. Java’s Arrow memory access option is supplied by the bridge.

## Schema and data ownership

All names start with `PARKING_CONTAINER_PREFIX`:

| Suffix | Container | Key | Purpose |
| --- | --- | --- | --- |
| `spaces` | Collection | `space_id` | Zone, space type, hourly rate in cents, enabled state |
| `sessions` | Collection | UUID `session_id` | Vehicle, entry/exit timestamps, active state, final fee, simulation flag |
| `events` | Collection | `session_id` + event type | Timestamped arrival/departure audit projection |
| `occupancy` | TimeSeries | Timestamp | Lot occupied count and capacity |
| `sensor_A01` … `sensor_C08` | TimeSeries | Timestamp | Per-space occupied state, session ID, data source |

Active sessions determine live availability. Sensor rows are **simulated projections of session state**, not readings from physical detectors. A real detector integration needs its own ingestion, timestamp conversion, duplicate handling, and disagreement reconciliation.

Session rows are authoritative. A session write and its event/telemetry projections span separate containers and are not atomic. If a projection fails, the API returns the saved session plus a warning; availability and fees still come from sessions. A production version should reconcile missing projections from sessions.

For an active session, `exited_at` initially equals `entered_at`; the `active` flag distinguishes an unfinished session. Timestamps are generated in Python as UTC datetimes rather than sending ISO strings into generic native writes. Native timestamps returned as naive UTC are explicitly normalized before rewriting them.

## API reference

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Real native database check; demo explicitly reports no database |
| GET | `/api/parking` | Spaces, active sessions, summary, simulator state |
| GET | `/api/events` | Newest 100 events |
| GET | `/api/history?hours=24` | Newest 1,000 occupancy samples, 1–168 hour window |
| POST | `/api/arrivals` | Register a vehicle using `{sessionId, spaceId, vehicleTag}` |
| POST | `/api/departures` | Close a session using `{sessionId}` |
| POST | `/api/simulator/start` | Start simulation; send `{}` |
| POST | `/api/simulator/stop` | Stop simulation; send `{}` |

Arrival example, with a new UUID for each logical arrival:

```bash
curl -X POST http://127.0.0.1:3002/api/arrivals \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"5b5207cb-92ab-491e-b410-132535258ba1","spaceId":"A01","vehicleTag":"B 2048 PK"}'
```

Departure example:

```bash
curl -X POST http://127.0.0.1:3002/api/departures \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"5b5207cb-92ab-491e-b410-132535258ba1"}'
```

Matching retries return the same session rather than creating or billing another one. A conflicting space or vehicle returns 409; malformed input returns 400; a missing session returns 404. Native failures return 503.

## Fees and simulator behavior

Fees are calculated as `ceil(elapsed_seconds / 3600) × hourly_rate_cents`. A session lasting one hour and one second costs two hours; exactly zero elapsed time is free. The app records a calculated fee, not payment collection. Revenue means fees from sessions completed since midnight UTC. It does not prorate an active session, include payment settlement, or implement taxes, discounts, reservations, subscriptions, or enforcement.

The simulator generates one random arrival/departure every five seconds. It departs only sessions marked simulated, leaving manually registered vehicles in place. Starting the simulator in native mode writes real sample data into the configured prefix. It stops after an error. History is recorded from actual app activity; seed does not fabricate a 24-hour history.

## Verification

```bash
cd apps
npm run check
npm test
cd native-bridge/python
python3 -m unittest -v test_parking.py
```

The tests cover fee boundaries, idempotency, occupied-space conflicts, duplicate active vehicles, validation, API endpoints, simulator control, UTC timestamp rewriting, projection failures and non-destructive seeding. These offline tests do not prove a live GridDB Cloud connection.

## Draft limitations and next steps

Run one API process/worker for this prototype. The check-before-write logic does not prevent conflicts between multiple independent API processes; production needs a database-supported coordination or locking design. The dashboard polls every five seconds, and all worker requests execute serially. Data queries are bounded: at most 64 spaces, 1,000 active sessions, 100 events and 1,000 history samples. Daily fee totals cover up to 5,000 completed sessions and expose truncation when that limit is exceeded.

A native timeout terminates the worker and rejects pending operations. Restart the API, inspect sessions, then retry with the same UUID if the previous write outcome is uncertain. The app does not silently switch to demo mode.

The server binds to loopback by default. Before public deployment, add operator authentication, authorization, HTTPS, rate limits, audit/reconciliation jobs, retention rules, and backup policies. Do not put credentials, raw TQL, or container selection in the browser. Accessible spaces are labeled, but eligibility rules are outside this draft.

The independent article draft is in [`blogs/smart-parking-management/blog.md`](blogs/smart-parking-management/blog.md).
