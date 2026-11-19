"""Only links actually present in a loaded source authorize document reads."""
import base64
import unittest
from test_gui import Fake
from horsemen_core.gui import GitHubReader, ScanState, ProviderError
from horsemen_core.gui_links import connections

class LinkTests(unittest.TestCase):
    def test_relative_links_deduplicate_and_exclude_code_and_unsafe_urls(self):
        links=connections('[Study](docs/study.md) [Again](docs/study.md)\n[x](javascript:alert(1))\n```md\n[Example](fake.md)\n```\n`[inline](fake2.md)`','BRAIN.md','example/alpha','a'*40)
        self.assertEqual(len(links),1);self.assertEqual(links[0]['path'],'docs/study.md')
        self.assertEqual(links[0]['kind'],'document')
    def test_parent_paths_external_links_attachments_and_anchors(self):
        links=connections('[Parent](../VISION.md) [Outside](../../outside.md) [Drive](https://docs.google.com/document/d/example) ![Shot](proof.png) [Self](#heading)','project/BRAIN.md','example/alpha','a'*40)
        self.assertEqual([l['kind'] for l in links],['document','external','attachment'])
        self.assertEqual(links[0]['path'],'VISION.md')
    def test_document_requires_known_link_and_supports_deeper_links(self):
        f=Fake();calls=[]
        def api(path,paginate=False):
            calls.append(path)
            if '/git/blobs/' in path:return {'encoding':'base64','content':base64.b64encode(b'# Brain\n[Study](docs/study.md)').decode()}
            if '/contents/docs/study.md?' in path:return {'type':'file','sha':'d'*40,'size':80,'encoding':'base64','content':base64.b64encode(b'# Study\nA real finding.\n[Decision](decision.md)').decode()}
            return f(path,paginate)
        s=ScanState(GitHubReader(api));s.scan_sync();pid=s.snapshot()['projects'][0]['id']
        with self.assertRaises(ProviderError):s.load_document(pid,'invented')
        data=s.load_project(pid);link=data['records']['brain']['connections'][0]
        doc=s.load_document(pid,link['id']);self.assertIn('A real finding.',doc['content'])
        self.assertEqual(doc['connections'][0]['path'],'docs/decision.md')
        self.assertIn('ref='+'a'*40,next(p for p in calls if '/contents/' in p))
        s.clear()
        with self.assertRaises(ProviderError):s.load_document(pid,link['id'])

if __name__=='__main__':unittest.main()
