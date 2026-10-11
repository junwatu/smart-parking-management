"""Parking domain operations. All mutations are serialized by one worker.

Sessions are authoritative. Event/telemetry projections are best effort because
the native API does not make these separate container writes one transaction.
"""
import datetime as dt
import math
import os
import random
import re
import uuid

UTC = dt.timezone.utc


class ConflictError(Exception):
    pass


def utc_now():
    return dt.datetime.now(UTC)


def fee_cents(entered, exited, rate):
    seconds = max(0, (exited - entered).total_seconds())
    return math.ceil(seconds / 3600) * rate


def identifier(value, pattern, label):
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError(f"Invalid {label}")
    return value


def session_json(row):
    return dict(zip(("id", "spaceId", "vehicleTag", "enteredAt", "exitedAt", "active", "hourlyRateCents", "feeCents", "simulated"), row))


class Parking:
    def __init__(self, store):
        self.store = store
        self.prefix = identifier(os.environ.get("PARKING_CONTAINER_PREFIX", "parking_demo"), r"[A-Za-z][A-Za-z0-9_]{0,40}", "container prefix")
        from decimal import Decimal
        rate = Decimal(os.environ.get("PARKING_HOURLY_RATE", "2.50")) * 100
        if not rate.is_finite() or rate < 0 or rate > 100000 or rate != rate.to_integral_value():
            raise ValueError("PARKING_HOURLY_RATE must be 0–1000 with at most two decimal places")
        self.rate = int(rate)
        self.last_timestamp = dt.datetime.min.replace(tzinfo=UTC)

    def name(self, suffix):
        return f"{self.prefix}_{suffix}"

    def container(self, suffix):
        con = self.store.get_container(self.name(suffix))
        if con is None:
            raise LookupError(f"Missing {self.name(suffix)}; run npm run init and npm run seed")
        return con

    def read(self, suffix, tql):
        con = self.container(suffix)
        try:
            rs = con.query(tql).fetch()
            try:
                rows = []
                while rs.has_next():
                    rows.append(rs.next())
                return rows
            finally:
                rs.close()
        finally:
            con.close()

    def get(self, suffix, key):
        con = self.container(suffix)
        try:
            return con.get(key)
        finally:
            con.close()

    def put(self, suffix, row):
        con = self.container(suffix)
        try:
            con.put(row)
        finally:
            con.close()

    def active(self):
        rows = self.read("sessions", "SELECT * WHERE active LIMIT 1001")
        if len(rows) > 1000:
            raise RuntimeError("Active-session limit exceeded; investigate data before accepting arrivals")
        return rows

    def health(self):
        con = self.container("spaces")  # This forces a real native database request.
        con.close()
        return {"status": "ok", "mode": "native", "database": "reachable"}

    def seed(self):
        created = 0
        for zone in "ABC":
            for number in range(1, 9):
                space_id = f"{zone}{number:02d}"
                if self.get("spaces", space_id) is None:
                    self.put("spaces", [space_id, zone, "accessible" if number == 1 else "standard", self.rate, True])
                    created += 1
        warnings = self.record_telemetry(utc_now())
        return {"created": created, "warnings": warnings}

    def snapshot(self):
        metadata = self.read("spaces", "SELECT * ORDER BY space_id ASC LIMIT 65")
        if len(metadata) > 64:
            raise RuntimeError("This draft supports at most 64 spaces")
        active = self.active()
        by_space = {row[1]: session_json(row) for row in active}
        if len(by_space) != len(active):
            raise RuntimeError("Conflicting active sessions detected; reconcile before continuing")
        spaces = [{"id": r[0], "zone": r[1], "type": r[2], "hourlyRateCents": r[3], "enabled": r[4], "session": by_space.get(r[0])} for r in metadata]
        if any(row[1] not in {space['id'] for space in spaces} for row in active):
            raise RuntimeError("Active session refers to an unknown space")
        now = utc_now()
        day = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z")
        completed = self.read("sessions", f"SELECT * WHERE NOT active AND exited_at >= TIMESTAMP('{day}') LIMIT 5001")
        revenue = sum(row[7] for row in completed[:5000])
        capacity = sum(1 for space in spaces if space['enabled'])
        return {"mode": "native", "generatedAt": now, "spaces": spaces, "stats": {"capacity": capacity, "occupied": len(active), "available": capacity - len(active), "occupancyPercent": round(len(active) / capacity * 100, 1) if capacity else 0, "revenueTodayCents": revenue, "completedToday": min(len(completed), 5000), "revenueTruncated": len(completed) > 5000}, "sessions": [session_json(row) for row in active]}

    def park(self, req):
        sid = identifier(req.get("sessionId"), r"[0-9a-fA-F-]{36}", "session ID")
        uuid.UUID(sid)
        space_id = identifier(req.get("spaceId"), r"[ABC]0[1-8]", "space ID")
        tag = identifier(req.get("vehicleTag"), r"[A-Z0-9 -]{1,16}", "vehicle tag")
        existing = self.get("sessions", sid)
        if existing is not None:
            if existing[1:3] != [space_id, tag]:
                raise ConflictError("Session ID was already used for a different arrival")
            return {"session": session_json(existing), "replayed": True, "warnings": []}
        metadata = self.get("spaces", space_id)
        if metadata is None or not metadata[4]:
            raise LookupError("Space is missing or disabled")
        active = self.active()
        if any(row[1] == space_id for row in active):
            raise ConflictError("Space is already occupied")
        if any(row[2] == tag for row in active):
            raise ConflictError("Vehicle already has an active parking session")
        now = utc_now()
        row = [sid, space_id, tag, now, now, True, metadata[3], 0, bool(req.get("simulated", False))]
        self.put("sessions", row)
        warnings = self.project_event(row, "arrival", now) + self.record_telemetry(now)
        return {"session": session_json(row), "replayed": False, "warnings": warnings}

    def depart(self, req):
        sid = identifier(req.get("sessionId"), r"[0-9a-fA-F-]{36}", "session ID")
        row = self.get("sessions", sid)
        if row is None:
            raise LookupError("Session not found")
        if not row[5]:
            return {"session": session_json(row), "replayed": True, "warnings": []}
        now = utc_now()
        # Java/Python may return a naive UTC datetime. Normalize before arithmetic.
        entered = row[3] if row[3].tzinfo else row[3].replace(tzinfo=UTC)
        row[3] = entered  # Preserve the original instant when writing a naive UTC value back.
        row[4], row[5], row[7] = now, False, fee_cents(entered, now, row[6])
        self.put("sessions", row)
        warnings = self.project_event(row, "departure", now) + self.record_telemetry(now)
        return {"session": session_json(row), "replayed": False, "warnings": warnings}

    def project_event(self, row, kind, now):
        try:
            self.put("events", [f"{row[0]}_{kind}", now, kind, row[1], row[0], row[2], row[7]])
            return []
        except Exception:
            return ["Session saved, but event projection failed. Reconcile from sessions."]

    def record_telemetry(self, now):
        try:
            active = self.active()
            metadata = self.read("spaces", "SELECT * LIMIT 65")
            if len(metadata) > 64:
                raise RuntimeError("Space limit exceeded")
            # Millisecond precision; avoid overwriting two transitions in one millisecond.
            timestamp = now.replace(microsecond=(now.microsecond // 1000) * 1000)
            timestamp = max(timestamp, self.last_timestamp + dt.timedelta(milliseconds=1))
            self.last_timestamp = timestamp
            by_space = {row[1]: row[0] for row in active}
            capacity = sum(1 for row in metadata if row[4])
            self.put("occupancy", [timestamp, len(active), capacity])
            for row in metadata:
                self.put(f"sensor_{row[0]}", [timestamp, row[0] in by_space, by_space.get(row[0], ""), "session_projection"])
            return []
        except Exception:
            return ["Session state is available, but occupancy telemetry is incomplete."]

    def events(self):
        rows = self.read("events", "SELECT * ORDER BY timestamp DESC LIMIT 100")
        return [dict(zip(("id", "timestamp", "type", "spaceId", "sessionId", "vehicleTag", "feeCents"), row)) for row in rows]

    def history(self, req):
        hours = req.get("hours", 24)
        if not isinstance(hours, int) or not 1 <= hours <= 168:
            raise ValueError("hours must be an integer from 1 to 168")
        # Descending query keeps the newest points if the bounded result fills.
        rows = self.read("occupancy", f"SELECT * WHERE timestamp > TIMESTAMPADD(HOUR, NOW(), -{hours}) ORDER BY timestamp DESC LIMIT 1000")
        rows.reverse()
        return {"points": [dict(zip(("timestamp", "occupied", "capacity"), row)) for row in rows], "limit": 1000, "possiblyTruncated": len(rows) == 1000}

    def simulate(self):
        snapshot = self.snapshot()
        available = [s for s in snapshot['spaces'] if s['enabled'] and not s['session']]
        simulated = [s for s in snapshot['sessions'] if s['simulated']]
        if simulated and (not available or random.random() < 0.45):
            return self.depart({"sessionId": random.choice(simulated)['id']})
        if available:
            return self.park({"sessionId": str(uuid.uuid4()), "spaceId": random.choice(available)['id'], "vehicleTag": f"SIM-{uuid.uuid4().hex[:6].upper()}", "simulated": True})
        return {"warnings": self.record_telemetry(utc_now())}
