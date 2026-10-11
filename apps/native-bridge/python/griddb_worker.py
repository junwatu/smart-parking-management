"""Persistent native GridDB worker, controlled over NDJSON stdin/stdout."""
import datetime as dt
import json
import os
from pathlib import Path
import sys

from parking import Parking


def start_gridstore():
    required = ("GRIDDB_NOTIFICATION_PROVIDER", "GRIDDB_CLUSTER_NAME", "GRIDDB_DATABASE", "GRIDDB_USERNAME", "GRIDDB_PASSWORD")
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        raise RuntimeError("Missing environment variables: " + ", ".join(missing))
    import jpype
    lib = Path(__file__).resolve().parents[1] / "lib"
    jars = ("gridstore.jar", "gridstore-arrow.jar", "gridstore-advanced.jar", "arrow-memory-netty.jar")
    missing_jars = [name for name in jars if not (lib / name).is_file()]
    if missing_jars:
        raise RuntimeError("Missing runtime JARs: " + ", ".join(missing_jars))
    if not jpype.isJVMStarted():
        jpype.startJVM(classpath=[str(path) for path in sorted(lib.glob("*.jar"))])
    import griddb_python as griddb
    options = {"notification_provider": os.environ["GRIDDB_NOTIFICATION_PROVIDER"], "cluster_name": os.environ["GRIDDB_CLUSTER_NAME"], "database": os.environ["GRIDDB_DATABASE"], "username": os.environ["GRIDDB_USERNAME"], "password": os.environ["GRIDDB_PASSWORD"], "ssl_mode": os.environ.get("GRIDDB_SSL_MODE", "PREFERRED")}
    route = os.environ.get("GRIDDB_CONNECTION_ROUTE", "PUBLIC").strip()
    if route:
        options["connection_route"] = route
    return griddb.StoreFactory.get_instance().get_store(**options)


def json_value(value):
    if isinstance(value, dt.datetime):
        return (value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)).isoformat().replace("+00:00", "Z")
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if hasattr(value, "tolist"):
        return json_value(value.tolist())
    return value


def main():
    try:
        store = start_gridstore()
        parking = Parking(store)
    except Exception as error:
        # Do not expose provider URLs or credentials from library exception strings.
        print(f"GridDB startup failed ({type(error).__name__}); check .env and runtime JARs.", file=sys.stderr)
        return 1
    try:
        for line in sys.stdin:
            rid = None
            try:
                req = json.loads(line)
                rid = req.get("id")
                operation = req.get("operation")
                if operation == "close":
                    result = {"status": "closed"}
                elif operation == "ready":
                    result = {"status": "ready", "connection": "lazy"}
                elif operation == "init":
                    from init_schema import initialize
                    result = initialize(store)
                elif operation in ("health", "seed", "snapshot", "events", "simulate"):
                    result = getattr(parking, operation)()
                elif operation in ("park", "depart", "history"):
                    result = getattr(parking, operation)(req)
                else:
                    raise ValueError("Unsupported parking operation")
                message = {"id": rid, "ok": True, "result": json_value(result)}
            except Exception as error:
                safe_types = {"ValueError", "ConflictError", "LookupError", "RuntimeError"}
                kind = type(error).__name__
                text = str(error) if kind in safe_types else "Native GridDB operation failed; inspect connectivity and schema configuration."
                message = {"id": rid, "ok": False, "error": {"type": kind, "message": text}}
            print(json.dumps(message, separators=(",", ":")), flush=True)
            if message['ok'] and req.get('operation') == 'close':
                break
    finally:
        store.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
