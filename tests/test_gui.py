"""Local GitHub reader tests. All providers and records are fictional."""
import base64
import json
import sys
import threading
import unittest
from unittest.mock import patch
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'horsemen/scripts'))
from horsemen_core.gui import discover_roots, GitHubReader, ScanState, make_server, ProviderError

class Fake:
    def __init__(self): self.calls=[]; self.login='operator'; self.fail=False
    def __call__(self, path, paginate=False):
        self.calls.append(path)
        if self.fail: raise ProviderError('GitHub access failed', 403)
        if path=='/user': return {'login':self.login}
        if path.startswith('/user/repos'): return [{'id':1,'full_name':'example/alpha','default_branch':'main','private':True,'archived':False}]
        if '/commits/' in path: return {'sha':'a'*40,'commit':{'tree':{'sha':'b'*40}}}
        if '/git/trees/' in path: return {'truncated':False,'tree':[{'path':n,'type':'blob','mode':'100644','sha':'c'*40,'size':40} for n in ['VISION.md','BRAIN.md','PROGRESS.md','STRUCTURE.md']]}
        if '/git/blobs/' in path: return {'encoding':'base64','content':base64.b64encode(b'# Record\n\nActual source.').decode()}
        raise AssertionError(path)

class ReaderTests(unittest.TestCase):
    def test_discovery_nested_legacy_and_non_records(self):
        paths=['one/VISION.md','one/STATUS.md','one/BRAIN.md','one/STRUCTURE.md','two/VISION.md','two/PROGRESS.md','node_modules/pkg/VISION.md','node_modules/pkg/PROGRESS.md','README.md']
        roots=discover_roots([{'path':p,'type':'blob','mode':'100644','sha':'x','size':1} for p in paths])
        self.assertEqual(set(roots), {'one','two'})
        self.assertEqual(roots['one']['progress']['path'],'one/STATUS.md')
        self.assertNotIn('structure',roots['two'])
    def test_symlinks_ignored_and_progress_preferred(self):
        entries=[{'path':n,'type':'blob','mode':'100644','sha':'x','size':1} for n in ['VISION.md','PROGRESS.md','STATUS.md']]
        entries.append({'path':'BRAIN.md','type':'blob','mode':'120000','sha':'x','size':1})
        root=discover_roots(entries)['']
        self.assertEqual(root['progress']['path'],'PROGRESS.md');self.assertNotIn('brain',root)
    def test_pinned_records_and_no_disk_cache(self):
        f=Fake();reader=GitHubReader(f);projects=reader.scan_repo(f('/user/repos')[0])
        p=projects[0];self.assertEqual(p['revision'],'a'*40)
        data=reader.load(p);self.assertEqual(data['records']['vision']['content'],'# Record\n\nActual source.')
        self.assertIn('/git/blobs/'+'c'*40,f.calls[-1])
        self.assertNotIn('content',p['files']['vision'])
    def test_oversized_and_missing_are_explicit(self):
        f=Fake();r=GitHubReader(f);p=r.scan_repo(f('/user/repos')[0])[0];p['files']['vision']['size']=9999999
        result=r.load(p);self.assertIn('size limit',result['records']['vision']['error']);self.assertIn('missing',result['records']['readme']['error'])
    def test_truncated_tree_is_not_complete(self):
        f=Fake()
        def truncated(path,paginate=False):
            data=f(path,paginate)
            if '/git/trees/' in path: data['truncated']=True
            return data
        with self.assertRaises(ProviderError): GitHubReader(truncated).scan_repo(f('/user/repos')[0])
    def test_invalid_base64_fails_record_not_entire_project(self):
        f=Fake()
        def bad(path,paginate=False):
            if '/git/blobs/' in path:return {'encoding':'base64','content':'!invalid!'}
            return f(path,paginate)
        r=GitHubReader(bad);p=r.scan_repo(f('/user/repos')[0])[0];self.assertIn('error',r.load(p)['records']['vision'])

class PerformanceTests(unittest.TestCase):
    def test_profile_cache_checks_credential_changes_and_expiry(self):
        f=Fake();identity=['one'];r=GitHubReader(f,credential_identity=lambda:identity[0])
        with patch('horsemen_core.gui.time.monotonic',return_value=100):
            self.assertEqual(r.profile(),'operator');r.profile()
        self.assertEqual(f.calls.count('/user'),1)
        identity[0]='two';f.login='changed'
        with patch('horsemen_core.gui.time.monotonic',return_value=101):self.assertEqual(r.profile(),'changed')
        self.assertEqual(f.calls.count('/user'),2)
        with patch('horsemen_core.gui.time.monotonic',return_value=200):r.profile()
        self.assertEqual(f.calls.count('/user'),3)
    def test_records_load_concurrently(self):
        f=Fake();barrier=threading.Barrier(4)
        def parallel(path,paginate=False):
            if '/git/blobs/' in path:barrier.wait(timeout=2)
            return f(path,paginate)
        r=GitHubReader(parallel);p=r.scan_repo(f('/user/repos')[0])[0]
        self.assertTrue(all('content' in v for k,v in r.load(p)['records'].items() if k in p['files']))
    def test_memory_cache_reuses_blobs_but_checks_account(self):
        f=Fake();s=ScanState(GitHubReader(f));s.scan_sync();pid=s.snapshot()['projects'][0]['id']
        s.load_project(pid);count=sum('/git/blobs/' in p for p in f.calls)
        s.load_project(pid);self.assertEqual(sum('/git/blobs/' in p for p in f.calls),count)
        f.login='changed'
        with self.assertRaises(ProviderError):s.load_project(pid)
        self.assertEqual(s.cache,{})
    def test_refresh_invalidates_cache_and_stale_load(self):
        f=Fake();s=ScanState(GitHubReader(f));s.scan_sync();pid=s.snapshot()['projects'][0]['id'];s.load_project(pid)
        s.scan_sync();self.assertEqual(s.cache,{})
        load=s.reader.load
        def stale(project):
            data=load(project);s.clear();return data
        s.reader.load=stale
        with self.assertRaises(ProviderError):s.load_project(pid)
        self.assertEqual(s.cache,{})

class StateTests(unittest.TestCase):
    def test_scan_retry_and_membership(self):
        f=Fake();s=ScanState(GitHubReader(f));s.scan_sync();self.assertEqual(s.snapshot()['phase'],'ready');self.assertEqual(len(s.snapshot()['projects']),1)
        with self.assertRaises(ProviderError):s.project('unknown')
        f.fail=True;s.scan_sync();self.assertEqual(s.snapshot()['phase'],'error');self.assertEqual(s.snapshot()['projects'],[])
        f.fail=False;s.scan_sync();self.assertEqual(s.snapshot()['phase'],'ready')
    def test_account_change_invalidates_projects(self):
        f=Fake();s=ScanState(GitHubReader(f));s.scan_sync();pid=s.snapshot()['projects'][0]['id'];f.login='different'
        with self.assertRaises(ProviderError):s.project(pid)
        self.assertEqual(s.snapshot()['projects'],[])
    def test_stale_project_check_does_not_clear_new_scan(self):
        f=Fake();s=ScanState(GitHubReader(f));s.scan_sync();pid=s.snapshot()['projects'][0]['id']
        original=s.reader.profile
        def changed():
            s.reader.profile=original;s.scan_sync();return f.login
        s.reader.profile=changed
        with self.assertRaises(ProviderError):s.project(pid)
        self.assertEqual(s.snapshot()['phase'],'ready')
        self.assertEqual(len(s.snapshot()['projects']),1)
    def test_duplicate_scan_and_cancel_generation(self):
        f=Fake();started=threading.Event();release=threading.Event()
        def block(path,paginate=False):
            if path=='/user':started.set();release.wait(2)
            return f(path,paginate)
        s=ScanState(GitHubReader(block));self.assertTrue(s.start());self.assertTrue(started.wait(1));self.assertFalse(s.start());s.clear();release.set();s.worker.join(3)
        self.assertEqual(s.snapshot()['phase'],'idle');self.assertEqual(s.snapshot()['projects'],[])

class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.server=make_server(0,ScanState(GitHubReader(Fake())),Path(__file__).resolve().parents[1]/'web')
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.base='http://127.0.0.1:'+str(self.server.server_port)
    def tearDown(self): self.server.shutdown();self.server.server_close();self.thread.join()
    def test_host_origin_and_session_boundaries(self):
        for headers in [{},{'X-Horsemen-Session':'bad'},{'X-Horsemen-Session':self.server.session,'Origin':'https://evil.example'},{'X-Horsemen-Session':self.server.session,'Host':'evil.example'}]:
            with self.assertRaises(HTTPError) as err:urlopen(Request(self.base+'/api/status',headers=headers))
            self.assertEqual(err.exception.code,403);err.exception.close()
        r=urlopen(Request(self.base+'/api/status',headers={'X-Horsemen-Session':self.server.session}));self.assertEqual(json.load(r)['phase'],'idle');self.assertEqual(r.headers['Cache-Control'],'no-store')
    def test_no_arbitrary_files(self):
        with self.assertRaises(HTTPError) as e:urlopen(self.base+'/../BRAIN.md')
        self.assertEqual(e.exception.code,404);e.exception.close()

if __name__=='__main__':unittest.main()
