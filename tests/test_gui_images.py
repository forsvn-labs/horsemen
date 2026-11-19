"""Repository images in the local workspace. All records and images are fictional.

Failure modes covered: a link that no loaded record contains; a document,
external, or non-image link used as an image; path traversal in the link or
the request; a file larger than the limit or without inline content; bytes
that do not match the image type; a path that is a folder; a stale discovery;
a missing session; wrong content type or sniffing; SVG served without a
sandbox. Images read the pinned revision only."""
import base64
import json
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from test_gui import Fake
from horsemen_core.gui import GitHubReader, ScanState, ProviderError, make_server, decode_image, MAX_IMAGE
from horsemen_core.gui_links import connections

PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 24
SVG = b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script>alert(1)</script><rect width="4" height="4"/></svg>'
JPG = b'\xff\xd8\xff\xe0' + b'\x00' * 16
GIF = b'GIF89a' + b'\x00' * 10
WEBP = b'RIFF\x10\x00\x00\x00WEBPVP8 ' + b'\x00' * 8
RECORD = ('# Brain\n![Flow](img/flow.png) ![Logo](img/logo.svg) ![Photo](img/photo.jpg) ![Big](img/big.png) '
          '![Huge](img/huge.png) ![Fake](img/fake.png) ![Gone](img/gone.png) ![Folder](img/folder.png) '
          '![Report](docs/report.pdf) [Doc](docs/a.md) ![Remote](https://example.com/x.png) ![Up](../../outside.png)')

def contents(data, **extra):
    return dict({'type':'file','sha':'e'*40,'size':len(data),'encoding':'base64','content':base64.b64encode(data).decode()}, **extra)

class ImageFake(Fake):
    def __init__(self):
        super().__init__()
        self.files={'img/flow.png':contents(PNG),'img/logo.svg':contents(SVG),'img/photo.jpg':contents(JPG),
                    'img/big.png':contents(PNG,size=MAX_IMAGE+1),
                    'img/huge.png':{'type':'file','sha':'f'*40,'size':MAX_IMAGE,'encoding':'none','content':''},
                    'img/fake.png':contents(b'<html>not an image</html>'),'img/folder.png':[{'type':'file','name':'x.png'}],
                    'docs/report.pdf':contents(b'%PDF-1.4')}
    def __call__(self, path, paginate=False):
        if '/git/blobs/' in path:return {'encoding':'base64','content':base64.b64encode(RECORD.encode()).decode()}
        if '/contents/' in path:
            self.calls.append(path)
            name=path.split('/contents/',1)[1].split('?',1)[0]
            if name not in self.files:raise ProviderError('Repository or record is no longer accessible.',404)
            return self.files[name]
        return super().__call__(path,paginate)

def loaded():
    f=ImageFake();s=ScanState(GitHubReader(f));s.scan_sync();pid=s.snapshot()['projects'][0]['id']
    links={l['title']:l for l in s.load_project(pid)['records']['brain']['connections']}
    return f,s,pid,links

class DecodeTests(unittest.TestCase):
    def test_types_by_extension_and_content(self):
        for path,data,kind in [('a.png',PNG,'image/png'),('a.PNG',PNG,'image/png'),('a.jpg',JPG,'image/jpeg'),('a.jpeg',JPG,'image/jpeg'),
                               ('a.gif',GIF,'image/gif'),('a.webp',WEBP,'image/webp'),('a.svg',SVG,'image/svg+xml'),('a.svg',b'\xef\xbb\xbf<!-- c -->\n<svg/>','image/svg+xml')]:
            self.assertEqual(decode_image(contents(data),path),(kind,data),path)
    def test_rejections(self):
        for path,blob,status in [('a.png',contents(b'GIF89a'),415),('a.gif',contents(PNG),415),('a.svg',contents(b'<html></html>'),415),('a.png',contents(b''),415),
                                 ('a.webp',contents(b'RIFF\x00\x00\x00\x00WAVE'),415),('a.pdf',contents(b'%PDF'),415),
                                 ('a.png',contents(PNG,size=MAX_IMAGE+1),413),('a.png',{'type':'file','size':MAX_IMAGE,'encoding':'none','content':''},413),
                                 ('a.png',{'type':'file','size':10,'encoding':'base64','content':'!bad!'},502),('a.png',{'type':'file','size':10,'encoding':'utf-8','content':'x'},502),
                                 ('a.png',{'type':'dir'},422),('a.png',[],422),('a.png',contents(PNG+b'\x00'*(MAX_IMAGE)),413)]:
            with self.assertRaises(ProviderError,msg=path) as error:decode_image(blob,path)
            self.assertEqual(error.exception.status,status,(path,str(error.exception)))
        with self.assertRaises(ProviderError) as error:decode_image(contents(PNG,size=MAX_IMAGE+1),'a.png')
        self.assertIn('1 MiB',str(error.exception))

class StateTests(unittest.TestCase):
    def test_links_classify_images_and_drop_traversal(self):
        links=connections(RECORD,'BRAIN.md','example/alpha','a'*40)
        kinds={l['title']:l['kind'] for l in links}
        self.assertEqual(kinds['Flow'],'attachment');self.assertEqual(kinds['Remote'],'external');self.assertNotIn('Up',kinds)
    def test_only_registered_repository_images_load_at_the_pinned_revision(self):
        f,s,pid,links=loaded()
        image=s.load_image(pid,links['Flow']['id'])
        self.assertEqual((image['type'],image['bytes']),('image/png',PNG))
        self.assertIn('/contents/img/flow.png?ref='+'a'*40,f.calls[-1])
        self.assertEqual(s.load_image(pid,links['Logo']['id'])['type'],'image/svg+xml')
        for name in ['Doc','Report','Remote']:
            with self.assertRaises(ProviderError,msg=name) as error:s.load_image(pid,links[name]['id'])
            self.assertEqual(error.exception.status,404)
        for invented in ['f'*24,'../img/flow.png','img/flow.png','']:
            with self.assertRaises(ProviderError):s.load_image(pid,invented)
    def test_failures_are_explicit(self):
        f,s,pid,links=loaded()
        for name,status in [('Big',413),('Huge',413),('Fake',415),('Gone',404),('Folder',422)]:
            with self.assertRaises(ProviderError,msg=name) as error:s.load_image(pid,links[name]['id'])
            self.assertEqual(error.exception.status,status,name)
            if name=='Gone':self.assertEqual(str(error.exception),'The image is not in the repository at this commit.')
    def test_stale_discovery_and_account_change(self):
        f,s,pid,links=loaded();s.clear()
        with self.assertRaises(ProviderError):s.load_image(pid,links['Flow']['id'])
        f,s,pid,links=loaded();f.login='someone-else'
        with self.assertRaises(ProviderError):s.load_image(pid,links['Flow']['id'])

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
    def test_image_bytes_types_and_headers(self):
        r=self.get(f'/api/image?id={self.pid}&link={self.links["Flow"]["id"]}')
        self.assertEqual(r.read(),PNG);self.assertEqual(r.headers['Content-Type'],'image/png')
        self.assertEqual(r.headers['X-Content-Type-Options'],'nosniff');self.assertEqual(r.headers['Cache-Control'],'no-store')
        r=self.get(f'/api/image?id={self.pid}&link={self.links["Logo"]["id"]}')
        self.assertEqual(r.headers['Content-Type'],'image/svg+xml');self.assertIn('sandbox',r.headers['Content-Security-Policy'])
        self.assertIn("default-src 'none'",r.headers['Content-Security-Policy']);r.read()
    def test_image_authorization_size_and_traversal(self):
        flow=self.links['Flow']['id']
        self.assertEqual(self.error(f'/api/image?id={self.pid}&link={flow}',session=False)[0],403)
        for link in ['../../etc/passwd','img%2Fflow.png','%2e%2e%2fBRAIN.md',self.links['Doc']['id'],self.links['Report']['id'],self.links['Remote']['id'],'']:
            code,body=self.error(f'/api/image?id={self.pid}&link={link}')
            self.assertEqual(code,404,link);self.assertIn('error',json.loads(body))
        self.assertEqual(self.error(f'/api/image?id=unknown&link={flow}')[0],404)
        code,body=self.error(f'/api/image?id={self.pid}&link={self.links["Big"]["id"]}')
        self.assertEqual(code,413);self.assertIn('1 MiB',json.loads(body)['error'])
        self.assertEqual(self.error(f'/api/image?id={self.pid}&link={self.links["Fake"]["id"]}')[0],415)
    def test_page_allows_blob_images_and_serves_diagram_files(self):
        r=urlopen(self.base+'/');csp=r.headers['Content-Security-Policy'];r.read()
        self.assertIn("img-src 'self' blob:",csp);self.assertIn("script-src 'self';",csp);self.assertNotIn('unsafe-eval',csp)
        r=urlopen(self.base+'/vendor/mermaid.min.js');self.assertEqual(r.headers['Content-Type'],'text/javascript; charset=utf-8')
        self.assertIn(b'globalThis["mermaid"]',r.read())
        r=urlopen(self.base+'/media.js');self.assertEqual(r.status,200);r.read()
        for path in ['/vendor/','/vendor/README.md','/vendor/../app.js','/vendor/mermaid.LICENSE.txt.js']:
            code,_=self.error(path,session=False);self.assertEqual(code,404,path)

if __name__=='__main__':unittest.main()
