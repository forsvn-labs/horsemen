import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'horsemen/scripts'))
from unittest.mock import patch
from horsemen_core.issue_preview import issue_preview
from horsemen_core.gui import ProviderError


class LinearPreviewTest(unittest.TestCase):
    def test_only_linear_issues_from_the_same_workspace(self):
        url = 'https://linear.app/demo/issue/OPS-42/review'
        result = {'identifier':'OPS-42', 'url':url, 'title':'Review', 'state':{'name':'Done'}}
        with patch.dict('os.environ', {'LINEAR_API_KEY':'fictional'}), patch('horsemen_core.issue_preview.fetch_issue', return_value=result) as fetch:
            self.assertEqual(issue_preview(url)['state'], 'Done')
            fetch.assert_called_once_with('OPS-42', 'fictional')
            for bad in [url.replace('demo','other'), url.replace('linear.app','example.com'), url.replace('OPS-42','invalid')]:
                with self.assertRaises(ProviderError):
                    issue_preview(bad)
