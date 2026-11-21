"""Preview the working files in one GitHub project during a coding session."""
import base64
import hashlib
from pathlib import Path
import re
import subprocess
from urllib.parse import quote

from . import gui
from .canvas import inside


class SessionReader(gui.GitHubReader):
    def __init__(self, root, repo=None):
        self.root = Path(root).resolve(strict=True)
        if repo is None:
            remote = subprocess.run(['git', '-C', str(self.root), 'remote', 'get-url', 'origin'],
                                    capture_output=True, text=True).stdout.strip()
            match = re.fullmatch(r'(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([\w.-]+/[\w.-]+)', remote)
            if not match:
                raise ValueError('The project needs a github.com origin for source links.')
            repo = match[1].removesuffix('.git')
        self.repo = repo
        self.key = hashlib.sha256(str(self.root).encode()).hexdigest()[:24]

    def profile(self):
        return 'Working copy'

    def repositories(self):
        return [{'full_name': self.repo}]

    def scan_repo(self, repo):
        candidates = [self.root / n for n in [*gui.FILES.values(), 'STATUS.md']]
        folder = inside(self.root, self.root / gui.CANVAS_DIR)
        if folder and folder.is_dir():
            candidates.extend(folder.glob('*.canvas'))
        entries = []
        for path in candidates:
            real = inside(self.root, path)
            if real and real.is_file():
                entries.append(dict(path=path.relative_to(self.root).as_posix(), type='blob', mode='100644'))
        roots = gui.discover_roots(entries)
        if '' not in roots:
            raise gui.ProviderError('Open the folder that contains the Horsemen records.', 422)
        return [dict(id=self.key, repo=self.repo, root='', name=self.root.name, branch='HEAD',
                     revision='HEAD', working_copy=True, files=roots[''], canvases=gui.discover_canvases(entries, roots)[''],
                     private=True, archived=False, missing=[k for k in ('vision','progress','brain','structure') if k not in roots['']], scanned_at=gui.now())]

    def _bytes(self, path, limit):
        real = inside(self.root, self.root / path)
        if not real or '.git' in real.relative_to(self.root).parts or not real.is_file():
            raise gui.ProviderError('The file is unavailable in this working copy.', 404)
        try:
            with real.open('rb') as source:
                data = source.read(limit + 1)
        except OSError as error:
            raise gui.ProviderError('Cannot read this file.', 404) from error
        if len(data) > limit:
            raise gui.ProviderError('The file exceeds the preview size limit.', 413)
        return data

    def _text(self, path, name, drawing=False):
        rec = dict(name=name, path=path, url=f'https://github.com/{self.repo}/blob/HEAD/{quote(path)}')
        try:
            data = self._bytes(path, gui.MAX_FILE)
            text = data.decode('utf-8-sig')
            links = gui.canvas_links(text, path, '', self.repo, 'HEAD') if drawing else gui.connections(text, path, self.repo, 'HEAD')
            rec.update(content=text, connections=links, blob=hashlib.sha256(data).hexdigest())
            if not drawing:
                rec['sections'] = dict(gui.sections(text))
        except (gui.ProviderError, UnicodeError) as error:
            rec['error'] = str(error)
        return rec

    def load_canvas(self, project, name):
        return self._text(project['canvases'][name]['path'], name, True)

    def load_record(self, project, key, default):
        file = project['files'].get(key)
        return self._text(file['path'], default) if file else dict(name=default, error='Record is missing from this project root.')

    def load_document(self, project, link):
        return self._text(link['path'], Path(link['path']).name)

    def _blob(self, path):
        data = self._bytes(path, gui.MAX_IMAGE)
        return dict(type='file', encoding='base64', size=len(data), content=base64.b64encode(data).decode())

    def load_image(self, project, link):
        kind, data = gui.decode_image(self._blob(link['path']), link['path'])
        return dict(type=kind, bytes=data, size=len(data))

    def load_table(self, project, link):
        return gui.decode_table(self._blob(link['path']), link['path'])

    def pull_request(self, project, number):
        raise gui.ProviderError('Open this pull request on GitHub to see its details.', 422)
