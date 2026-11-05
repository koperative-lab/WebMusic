import subprocess
import sys
import time
import os
import json

child = subprocess.Popen([sys.executable, '-c', 'pass'], start_new_session=True)
time.sleep(0.15)

def probe():
    try:
        os.killpg(child.pid, 0)
        return {'status': 'exists'}
    except OSError as error:
        return {'status': 'error', 'errno': error.errno, 'error': str(error)}

try:
    before = probe()
finally:
    child.wait()
print(json.dumps({'before_reap': before, 'after_reap': probe()}))
