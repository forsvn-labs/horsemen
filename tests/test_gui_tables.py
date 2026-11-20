"""CSV and TSV tables in the local workspace (canvas slice 2b). All files are fictional.

Failure modes covered: a link that no loaded record or canvas contains; a document, an
external link, an image, or an XLSX file read as a table; path traversal in the request;
a file larger than 1 MiB or without inline content; text that is not UTF-8, has NUL bytes,
or is a Git LFS pointer; a byte order mark kept in the text; a path that is a folder; a
file that is gone at the pinned revision; a stale discovery or another account; a
missing session; the table served as anything but JSON. Tables read the pinned revision only."""
import base64
import json
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from test_gui import Fake
from horsemen_core.gui import GitHubReader, ScanState, ProviderError, make_server, decode_table, table_type, MAX_TABLE
from horsemen_core.gui_links import canvas_links

CSV = b'week,guests\n1,12\n2,19\n'
TSV = b'stop\tminutes\nHarbour\t12\n'
LFS = b'version https://git-lfs.github.com/spec/v1\noid sha256:' + b'a' * 64 + b'\nsize 4000000\n'
RECORD = ('# Brain\n[Signups](data/signups.csv) [Stops](data/stops.TSV) [Budget](data/budget.xlsx) [Big](data/big.csv) '
          '[Huge](data/huge.csv) [Latin](data/latin.csv) [Nul](data/nul.csv) [Lfs](data/lfs.csv) [Bom](data/bom.csv) '
          '[Gone](data/gone.csv) [Folder](data/folder.csv) ![Flow](img/flow.png) [Doc](docs/a.md) [Remote](https://example.com/x.csv) [Up](../../outside.csv)')

def contents(data, **extra):
    return dict({'type':'file','sha':'e'*40,'size':len(data),'encoding':'base64','content':base64.b64encode(data).decode()}, **extra)

class TableFake(Fake):
    def __init__(self):
        super().__init__()
        self.files={'data/signups.csv':contents(CSV),'data/stops.TSV':contents(TSV),'data/budget.xlsx':contents(b'PK\x03\x04'),
                    'data/big.csv':contents(CSV,size=MAX_TABLE+1),'data/huge.csv':{'type':'file','sha':'f'*40,'size':MAX_TABLE,'encoding':'none','content':''},
                    'data/latin.csv':contents('caf\xe9,1\n'.encode('latin-1')),'data/nul.csv':contents(b'a,b\n\x00\x01,2\n'),'data/lfs.csv':contents(LFS),
                    'data/bom.csv':contents(b'\xef\xbb\xbfweek,guests\n1,12\n'),'data/folder.csv':[{'type':'file','name':'x.csv'}],'img/flow.png':contents(b'\x89PNG\r\n\x1a\n')}
    def __call__(self, path, paginate=False):
        if '/git/blobs/' in path:return {'encoding':'base64','content':base64.b64encode(RECORD.encode()).decode()}
        if '/contents/' in path:
            self.calls.append(path)
            name=path.split('/contents/',1)[1].split('?',1)[0]
            if name not in self.files:raise ProviderError('Repository or record is no longer accessible.',404)
            return self.files[name]
        return super().__call__(path,paginate)

def loaded():
    f=TableFake();s=ScanState(GitHubReader(f));s.scan_sync();pid=s.snapshot()['projects'][0]['id']
    links={l['title']:l for l in s.load_project(pid)['records']['brain']['connections']}
    return f,s,pid,links

class DecodeTests(unittest.TestCase):
    def test_types_by_extension(self):
        self.assertEqual([table_type(p) for p in ['a.csv','a.CSV','b/c.tsv','a.xlsx','a.csv.md','.csv','',None]],['csv','csv','tsv',None,None,None,None,None])
        self.assertEqual(MAX_TABLE,1024*1024)
    def test_text_of_a_table(self):
        self.assertEqual(decode_table(contents(CSV),'a.csv'),{'text':CSV.decode(),'format':'csv','size':len(CSV)})
        self.assertEqual(decode_table(contents(TSV),'a.tsv')['format'],'tsv')
        self.assertEqual(decode_table(contents(b'\xef\xbb\xbfa,b\n'),'a.csv')['text'],'a,b\n','a byte order mark is not text')
        self.assertEqual(decode_table(contents(b''),'a.csv')['text'],'','an empty file is an empty table')
    def test_rejections(self):
        for path,blob,status,words in [('a.xlsx',contents(b'PK'),415,'not a CSV or TSV table'),('a.png',contents(b'x'),415,'not a CSV or TSV table'),
                                       ('a.csv',contents(CSV,size=MAX_TABLE+1),413,'1 MiB'),('a.csv',{'type':'file','size':MAX_TABLE,'encoding':'none','content':''},413,'1 MiB'),
                                       ('a.csv',contents(CSV+b'x'*MAX_TABLE),413,'1 MiB'),('a.csv',contents('caf\xe9'.encode('latin-1')),415,'not UTF-8 text'),
                                       ('a.csv',contents(b'a\x00b'),415,'not UTF-8 text'),('a.csv',contents(LFS),415,'Git LFS'),
                                       ('a.csv',{'type':'file','size':10,'encoding':'base64','content':'!bad!'},502,'could not be decoded'),
                                       ('a.csv',{'type':'file','size':10,'encoding':'utf-8','content':'x'},502,'Unsupported table encoding'),
                                       ('a.csv',{'type':'dir'},422,'not a readable file'),('a.csv',[],422,'not a readable file'),('a.csv',contents(CSV,size=-1),422,'not a readable file')]:
            with self.assertRaises(ProviderError,msg=(path,words)) as error:decode_table(blob,path)
            self.assertEqual(error.exception.status,status,(path,str(error.exception)));self.assertIn(words,str(error.exception))

class StateTests(unittest.TestCase):
    def test_only_registered_tables_load_at_the_pinned_revision(self):
        f,s,pid,links=loaded()
        table=s.load_table(pid,links['Signups']['id'])
        self.assertEqual(table,{'text':CSV.decode(),'format':'csv','size':len(CSV)})
        self.assertIn('/contents/data/signups.csv?ref='+'a'*40,f.calls[-1])
        self.assertEqual(s.load_table(pid,links['Stops']['id'])['format'],'tsv')
        for name in ['Budget','Flow','Doc','Remote']:
            with self.assertRaises(ProviderError,msg=name) as error:s.load_table(pid,links[name]['id'])
            self.assertEqual(error.exception.status,404,name);self.assertIn('table linked from a loaded record or canvas',str(error.exception))
        for invented in ['f'*24,'../data/signups.csv','data/signups.csv','']:
            with self.assertRaises(ProviderError):s.load_table(pid,invented)
        self.assertNotIn('Up',links,'a path outside the repository is never a link')
    def test_a_table_that_a_canvas_names_is_registered(self):
        links=canvas_links('{"nodes":[{"id":"t","type":"file","x":0,"y":0,"width":400,"height":200,"file":".horsemen/media/signups.csv"}]}','.horsemen/canvas/board.canvas','','example/alpha','a'*40)
        self.assertEqual([(l['path'],l['kind']) for l in links],[('.horsemen/media/signups.csv','attachment')])
    def test_failures_are_explicit(self):
        f,s,pid,links=loaded()
        for name,status in [('Big',413),('Huge',413),('Latin',415),('Nul',415),('Lfs',415),('Gone',404),('Folder',422)]:
            with self.assertRaises(ProviderError,msg=name) as error:s.load_table(pid,links[name]['id'])
            self.assertEqual(error.exception.status,status,name)
        with self.assertRaises(ProviderError) as error:s.load_table(pid,links['Gone']['id'])
        self.assertEqual(str(error.exception),'The table is not in the repository at this commit.')
        self.assertEqual(s.load_table(pid,links['Bom']['id'])['text'],'week,guests\n1,12\n')
    def test_stale_discovery_and_account_change(self):
        f,s,pid,links=loaded();s.clear()
        with self.assertRaises(ProviderError):s.load_table(pid,links['Signups']['id'])
        f,s,pid,links=loaded();f.login='someone-else'
        with self.assertRaises(ProviderError):s.load_table(pid,links['Signups']['id'])

class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.fake,self.state,self.pid,self.links=loaded()
        self.server=make_server(0,self.state,Path(__file__).resolve().parents[1]/'web')
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.base='http://127.0.0.1:'+str(self.server.server_port)
    def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join()
    def get(self,path,session=True):
        return urlopen(Request(self.base+path,headers={'X-Horsemen-Session':self.server.session} if session else {}))
    def error(self,path,session=True):
        with self.assertRaises(HTTPError) as e:self.get(path,session)
        body=e.exception.read();e.exception.close();return e.exception.code,body
    def test_table_text_as_json(self):
        r=self.get(f'/api/table?id={self.pid}&link={self.links["Signups"]["id"]}')
        self.assertEqual(json.loads(r.read()),{'text':CSV.decode(),'format':'csv','size':len(CSV)})
        self.assertEqual(r.headers['Content-Type'],'application/json');self.assertEqual(r.headers['X-Content-Type-Options'],'nosniff')
        self.assertEqual(r.headers['Cache-Control'],'no-store')
    def test_table_authorization_type_size_and_traversal(self):
        signups=self.links['Signups']['id']
        self.assertEqual(self.error(f'/api/table?id={self.pid}&link={signups}',session=False)[0],403)
        for link in ['../../etc/passwd','data%2Fsignups.csv',self.links['Doc']['id'],self.links['Flow']['id'],self.links['Budget']['id'],self.links['Remote']['id'],'']:
            code,body=self.error(f'/api/table?id={self.pid}&link={link}')
            self.assertEqual(code,404,link);self.assertIn('error',json.loads(body))
        code,body=self.error(f'/api/table?id={self.pid}&link={self.links["Big"]["id"]}')
        self.assertEqual(code,413);self.assertIn('1 MiB',json.loads(body)['error'])
        self.assertEqual(self.error(f'/api/table?id={self.pid}&link={self.links["Lfs"]["id"]}')[0],415)
    def test_page_lists_the_canvas_media_scripts(self):
        r=urlopen(self.base+'/');html=r.read().decode()
        for name in ['/canvas-embeds.js','/canvas-table.js']:
            self.assertIn(f'<script src="{name}" defer></script>',html)
            r=urlopen(self.base+name);self.assertEqual(r.headers['Content-Type'],'text/javascript; charset=utf-8');r.read()
    def test_page_allows_frames_from_the_player_origins_only(self):
        r=urlopen(self.base+'/');csp=r.headers['Content-Security-Policy'];r.read()
        directive=lambda name:next((p.strip().split()[1:] for p in csp.split(';') if p.strip().startswith(name+' ')),None)
        self.assertEqual(directive('frame-src'),['https://www.youtube-nocookie.com','https://player.vimeo.com','https://www.loom.com','https://www.figma.com','https://docs.google.com'])
        self.assertEqual(directive('frame-ancestors'),["'none'"]);self.assertEqual(r.headers['Referrer-Policy'],'no-referrer')

if __name__=='__main__':unittest.main()
