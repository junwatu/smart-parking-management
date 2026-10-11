"""Create parking containers; refuse incompatible schemas without changing data."""
import os
import re

SPACES = (("space_id", "STRING"), ("zone", "STRING"), ("space_type", "STRING"), ("hourly_rate_cents", "INTEGER"), ("enabled", "BOOL"))
SESSIONS = (("session_id", "STRING"), ("space_id", "STRING"), ("vehicle_tag", "STRING"), ("entered_at", "TIMESTAMP"), ("exited_at", "TIMESTAMP"), ("active", "BOOL"), ("hourly_rate_cents", "INTEGER"), ("fee_cents", "INTEGER"), ("simulated", "BOOL"))
EVENTS = (("event_id", "STRING"), ("timestamp", "TIMESTAMP"), ("event_type", "STRING"), ("space_id", "STRING"), ("session_id", "STRING"), ("vehicle_tag", "STRING"), ("fee_cents", "INTEGER"))
OCCUPANCY = (("timestamp", "TIMESTAMP"), ("occupied", "INTEGER"), ("capacity", "INTEGER"))
SENSOR = (("timestamp", "TIMESTAMP"), ("occupied", "BOOL"), ("session_id", "STRING"), ("source", "STRING"))


def initialize(store):
    import griddb_python as griddb
    prefix = os.environ.get("PARKING_CONTAINER_PREFIX", "parking_demo")
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,40}", prefix):
        raise ValueError("Invalid PARKING_CONTAINER_PREFIX")
    schemas = [("spaces", "COLLECTION", SPACES), ("sessions", "COLLECTION", SESSIONS), ("events", "COLLECTION", EVENTS), ("occupancy", "TIME_SERIES", OCCUPANCY)]
    schemas += [(f"sensor_{zone}{number:02d}", "TIME_SERIES", SENSOR) for zone in "ABC" for number in range(1, 9)]
    results = []
    for suffix, kind, columns in schemas:
        name = f"{prefix}_{suffix}"
        info = griddb.ContainerInfo(name, [[c, getattr(griddb.Type, t)] for c, t in columns], type=getattr(griddb.ContainerType, kind), row_key=True)
        container = store.get_container(name)
        if container is not None:
            container.close()
            existing = store.get_container_info(name)
            actual = (existing.type.name, bool(existing.row_key), tuple((c[0], c[1].name) for c in existing.column_info_list))
            if actual != (kind, True, columns):
                raise RuntimeError(f"Incompatible schema: {name}; no existing data was deleted")
            results.append({"name": name, "status": "unchanged"})
        else:
            container = store.put_container(info, modifiable=False)
            container.close()
            results.append({"name": name, "status": "created"})
    return results
