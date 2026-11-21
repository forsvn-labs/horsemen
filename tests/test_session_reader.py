"""Unpublished artifacts, missing files, stale snapshots, and paths outside the project."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'horsemen/scripts'))

from horsemen_core.session_reader import SessionReader
from horsemen_core.gui import ScanState


class SessionTest(unittest.TestCase):
    def test_working_copy(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'VISION.md').write_text('# Vision\n[Draft](draft.md)')
            (root / 'PROGRESS.md').write_text('# Progress')
            (root / 'draft.md').write_text('First draft')
            state = ScanState(SessionReader(root, 'example/alpha'))
            state.scan_sync()
            key = state.snapshot()['projects'][0]['id']
            record = state.load_project(key)['records']['vision']
            link = record['connections'][0]
            self.assertEqual(state.load_document(key, link['id'])['content'], 'First draft')
            (root / 'draft.md').unlink()
            (root / 'draft.md').symlink_to(Path(__file__))
            self.assertIn('error', state.load_document(key, link['id']))
            (root / 'VISION.md').write_text('# Revised')
            state.scan_sync()
            self.assertEqual(state.load_project(key)['records']['vision']['content'], '# Revised')
