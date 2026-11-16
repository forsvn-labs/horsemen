"""Scheduling contracts for the verification driver."""
from pathlib import Path
import sys
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from verify import run_phases


class VerifyPhases(unittest.TestCase):
    def test_serial_does_not_start_later_phase_after_failure(self):
        events = []

        def fail():
            events.append("first")
            raise RuntimeError("first failed")

        with self.assertRaisesRegex(RuntimeError, "first failed"):
            run_phases((fail, lambda: events.append("second")), jobs=1)
        self.assertEqual(events, ["first"])

    def test_parallel_runs_together_and_reports_both_failures(self):
        together = threading.Barrier(2)

        def fail(label):
            together.wait(timeout=10)
            raise RuntimeError(f"{label} failed")

        with self.assertRaisesRegex(RuntimeError, "source failed.*package failed"):
            run_phases((lambda: fail("source"), lambda: fail("package")), jobs=2)


if __name__ == "__main__":
    unittest.main()
