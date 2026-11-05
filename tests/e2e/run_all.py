"""Run every browser test in this folder, each in its own process, and summarise.

    python3 tests/e2e/run_all.py              # all
    python3 tests/e2e/run_all.py palette      # only tests whose file name contains "palette"

Needs Playwright + Chromium:  pip install -r tests/e2e/requirements.txt && playwright install chromium
"""
import glob, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
SKIP = {'browser_stub.py', 'run_all.py'}
TIMEOUT = 300

def main(filters):
    files = [f for f in sorted(glob.glob(os.path.join(HERE, '*.py'))) if os.path.basename(f) not in SKIP]
    if filters:
        files = [f for f in files if any(x in os.path.basename(f) for x in filters)]
    if not files:
        print('no matching e2e tests'); return 2
    failed = []
    for f in files:
        name = os.path.basename(f)
        t0 = time.time()
        try:
            r = subprocess.run([sys.executable, f], capture_output=True, text=True, timeout=TIMEOUT)
            ok, out = r.returncode == 0, (r.stdout + r.stderr).strip()
        except subprocess.TimeoutExpired:
            ok, out = False, f'timed out after {TIMEOUT}s'
        print(f"{'PASS' if ok else 'FAIL'}  {name}  ({time.time() - t0:.1f}s)")
        if not ok:
            failed.append(name)
            print('\n'.join('      ' + line for line in out.splitlines()[-25:]))
    print(f"\n{len(files) - len(failed)}/{len(files)} passed")
    return 1 if failed else 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
