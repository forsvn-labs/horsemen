"""Verify the offline design with an isolated agent-browser session."""
import argparse
import pathlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
output = pathlib.Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=True)
root = pathlib.Path(__file__).resolve().parent
session = 'horsemen-design-verification'
log = []

def browser(*args, script=None):
    result = subprocess.run(['agent-browser', '--session', session, '--allow-file-access', *args],
                            input=script, text=True, capture_output=True, timeout=60)
    log.append(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout

try:
    browser('open', (root / 'prototype.html').as_uri())
    for width, height in [(1440, 1100), (728, 1100), (390, 844)]:
        browser('set', 'viewport', str(width), str(height))
        result = browser('eval', '--stdin', script=(root / 'test-ui.js').read_text())
        assert 'PASS:' in result, result
        browser('screenshot', '--full', str(output / f'canvas-{width}.png'))
    browser('click', '[data-artifact="progress"]')
    browser('press', 'Escape')
    assert 'progress' in browser('eval', 'document.activeElement.dataset.artifact')
    browser('set', 'media', 'light', 'reduced-motion')
    browser('click', '[data-artifact="vision"]')
    assert 'none' in browser('eval', 'getComputedStyle(document.querySelector("#peek")).animationName')
    browser('press', 'Escape')
    errors = browser('errors')
    assert not errors.strip(), errors
    (output / 'a11y.json').write_text(browser('a11y', '--json'))
    print('PASS: interaction checks at 1440, 728, and 390 px; focus return; reduced motion; no browser errors.')
finally:
    browser('close')
    (output / 'output.txt').write_text('\n'.join(log))
