"""Verify the offline design with an isolated agent-browser session."""
import json
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
        result = browser('eval', '--stdin', script=(root / 'test-canvas.js').read_text())
        assert 'PASS:' in result, result
        result = browser('eval', '--stdin', script=(root / 'test-ui.js').read_text())
        assert 'PASS:' in result, result
        browser('screenshot', '--full', str(output / f'canvas-{width}.png'))
    browser('set', 'viewport', '1440', '1100')
    browser('click', '#reset-layout')
    def card_rect():
        return json.loads(browser('eval', 'document.querySelector("[data-artifact=vision]").getBoundingClientRect().toJSON()'))
    before = card_rect()
    x, y = round(before['x'] + 60), round(before['y'] + 45)
    browser('mouse', 'move', str(x), str(y))
    browser('mouse', 'down')
    browser('mouse', 'move', str(x - 120), str(y + 30))
    browser('mouse', 'up')
    assert abs(card_rect()['x'] - before['x'] + 120) < 2
    assert browser('eval', 'document.querySelector("#peek").open').strip() == 'false'
    saved = browser('eval', 'document.querySelector("[data-artifact=vision]").style.left')
    browser('reload')
    assert browser('eval', 'document.querySelector("[data-artifact=vision]").style.left') == saved
    browser('mouse', 'move', '800', '550')
    old_zoom = browser('eval', 'document.querySelector("#zoom-label").textContent')
    browser('mouse', 'wheel', '-180')
    assert browser('eval', 'document.querySelector("#zoom-label").textContent') != old_zoom
    browser('screenshot', str(output / 'drag-and-zoom.png'))
    browser('click', '#reset-layout')
    browser('click', '[data-artifact="progress"]')
    browser('wait', '#peek[open]')
    browser('press', 'Escape')
    browser('eval', 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert 'progress' in browser('eval', 'document.activeElement.dataset.artifact')
    browser('set', 'media', 'light', 'reduced-motion')
    browser('click', '[data-artifact="vision"]')
    assert 'none' in browser('eval', 'getComputedStyle(document.querySelector("#peek")).animationName')
    browser('press', 'Escape')
    errors = browser('errors')
    assert not errors.strip(), errors
    (output / 'a11y.json').write_text(browser('a11y', '--json'))
    print('PASS: infinite canvas and evidence checks; interaction checks at 1440, 728, and 390 px; focus return; reduced motion; no browser errors.')
finally:
    browser('close')
    (output / 'output.txt').write_text('\n'.join(log))
