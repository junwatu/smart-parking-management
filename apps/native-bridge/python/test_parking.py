"""Exercise native parking operations without credentials or a live database."""
import copy
import datetime as dt
import os
import unittest
import uuid
from unittest.mock import patch

from parking import Parking, ConflictError, fee_cents, UTC


class MemoryParking(Parking):
    def __init__(self):
        super().__init__(None)
        self.data = {}
        self.fail_projections = False

    def get(self, suffix, key):
        return copy.deepcopy(self.data.get(suffix, {}).get(key))

    def put(self, suffix, row):
        if self.fail_projections and suffix != 'sessions':
            raise RuntimeError('projection failure')
        self.data.setdefault(suffix, {})[row[0]] = copy.deepcopy(row)

    def active(self):
        return [copy.deepcopy(r) for r in self.data.get('sessions', {}).values() if r[5]]

    def read(self, suffix, tql):
        rows = list(self.data.get(suffix, {}).values())
        if suffix == 'sessions':
            rows = [r for r in rows if not r[5]]
        return copy.deepcopy(rows)


class NativeDomainTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'PARKING_CONTAINER_PREFIX': 'parking_test', 'PARKING_HOURLY_RATE': '2.50'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.parking = MemoryParking()
        self.parking.seed()

    def test_idempotency_and_conflicts(self):
        req = {'sessionId': str(uuid.uuid4()), 'spaceId': 'A01', 'vehicleTag': 'PY-01'}
        self.assertFalse(self.parking.park(req)['replayed'])
        self.assertTrue(self.parking.park(req)['replayed'])
        with self.assertRaises(ConflictError):
            self.parking.park({**req, 'sessionId': str(uuid.uuid4())})
        with self.assertRaises(ConflictError):
            self.parking.park({**req, 'sessionId': str(uuid.uuid4()), 'spaceId': 'B01'})
        with self.assertRaises(ConflictError):
            self.parking.park({**req, 'vehicleTag': 'OTHER'})

    def test_timestamp_conversion_and_fees(self):
        req = {'sessionId': str(uuid.uuid4()), 'spaceId': 'A01', 'vehicleTag': 'PY-02'}
        self.parking.park(req)
        # Native GridDB returns timestamps as naive UTC datetimes.
        entered = dt.datetime(2026, 10, 11, 10, 0)
        self.parking.data['sessions'][req['sessionId']][3] = entered
        with patch('parking.utc_now', return_value=dt.datetime(2026, 10, 11, 11, 0, 1, tzinfo=UTC)):
            result = self.parking.depart(req)
        self.assertEqual(result['session']['feeCents'], 500)
        self.assertEqual(result['session']['enteredAt'].tzinfo, UTC)
        self.assertFalse(result['session']['active'])
        self.assertTrue(self.parking.depart(req)['replayed'])
        self.assertEqual(len(self.parking.data['events']), 2)

    def test_projection_failure_preserves_authority(self):
        self.parking.fail_projections = True
        req = {'sessionId': str(uuid.uuid4()), 'spaceId': 'A01', 'vehicleTag': 'PY-03'}
        result = self.parking.park(req)
        self.assertTrue(result['warnings'])
        self.assertEqual(self.parking.snapshot()['stats']['occupied'], 1)

    def test_seed_preserves_existing_metadata_and_sessions(self):
        self.parking.data['spaces']['A01'][3] = 999
        self.parking.park({'sessionId': str(uuid.uuid4()), 'spaceId': 'A01', 'vehicleTag': 'PY-04'})
        self.assertEqual(self.parking.seed()['created'], 0)
        self.assertEqual(self.parking.data['spaces']['A01'][3], 999)
        self.assertEqual(self.parking.snapshot()['stats']['occupied'], 1)

    def test_fee_boundary(self):
        start = dt.datetime(2026, 1, 1, tzinfo=UTC)
        self.assertEqual(fee_cents(start, start, 250), 0)
        self.assertEqual(fee_cents(start, start + dt.timedelta(hours=1), 250), 250)
        self.assertEqual(fee_cents(start, start + dt.timedelta(hours=1, seconds=1), 250), 500)


if __name__ == '__main__':
    unittest.main()
