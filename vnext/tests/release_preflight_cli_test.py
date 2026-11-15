#!/usr/bin/env python3
"""Exercise the compiled preflight CLI using fake credentials only."""
import base64
import json
import os
import pathlib
import subprocess
import sys
import tempfile


def main():
    binary, staging = map(lambda s: str(pathlib.Path(s).resolve()), sys.argv[1:])
    with tempfile.TemporaryDirectory() as d:
        base = pathlib.Path(d)
        old, locks = base / 'old', base / 'locks'
        old.mkdir(mode=0o700)
        locks.mkdir(mode=0o700)
        (old / 'original').write_bytes(b'preserve')
        cred = base / 'fake.json'
        cred.write_text(json.dumps(dict(client_id='fake', client_secret='fake', refresh_token='fake', scope='https://www.googleapis.com/auth/drive.file')))
        cred.chmod(0o600)
        root = base / 'future'
        env = dict(os.environ, MD_SESSION_KEY_B64=base64.b64encode(b'test-only-not-a-production-secret!').decode(),
                   MD_PASSWORD_BCRYPT='$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy')
        args = ['--check-production', '--data-dir', str(root), '--protected-root', str(old), '--drive-lease-dir', str(locks), '--drive-credentials', str(cred), '--producer-commit', 'a'*40, '--listen', '127.0.0.1:18083', '--origin', 'https://example.invalid']
        def run(extra, good=False, exe=binary):
            p = subprocess.run([exe, *extra], env=env, capture_output=True, text=True, timeout=5)
            assert (p.returncode == 0) == good, (extra[0:1], p.returncode, p.stderr)
            return p.stdout
        p = json.loads(run(args, True))
        assert p['local_config_valid'] and p['namespace'] == 'MarketDepth-VNext'
        assert not p['activation_allowed'] and not p['production_ready'] and not p['network_checked']
        assert p['root_state'] == 'new_root_required'
        for a in ([], ['--run'], ['--mock', *args], ['--data-dir', str(root)], args+['--listen','0.0.0.0:80'], args+['--data-dir',str(old)], args+['--origin','http://example.invalid']):
            run(a)
        run(['--recover-catalog','--init-staging','--data-dir',str(root),'--drive-credentials',str(cred),'--producer-commit','a'*40], exe=staging)
        assert not root.exists() and list(locks.iterdir()) == [] and (old/'original').read_bytes() == b'preserve'
        print('PASS: compiled release CLI read-only preflight, activation refusal, staging lease requirement and old data preservation')
if __name__ == '__main__':
    main()
