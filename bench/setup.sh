#!/usr/bin/env bash
# Prepares this machine to run the Cua Bench comparison (Linux, root, Docker installed).
# Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"
REGISTRY=localhost:5000

# 1. Docker (Cua Bench's local sandboxes).
if ! docker info >/dev/null 2>&1; then
  (nohup dockerd >/tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi

# 2. Cua Bench. cua-sandbox 0.9.x passes `fleet_from_env` to cua.embedded(), which the
#    published cua 0.9.0 doesn't accept; local runs don't need it, so drop it.
command -v cb >/dev/null || uv tool install cua-bench
SDK=$(ls "$HOME"/.local/share/uv/tools/cua-bench/lib/python3*/site-packages/cua_sandbox/_sdk.py)
sed -i 's/^\(\s*\)fleet_from_env=False,$/\1# fleet_from_env=False,  (bench\/setup.sh: unsupported by cua 0.9.0)/' "$SDK"

# 3. The desktop images, served from a local registry: Cua's runtime can't pull
#    ghcr.io anonymously, Docker can.
if ! curl -sf "http://$REGISTRY/v2/" >/dev/null; then
  docker rm -f cua-bench-registry >/dev/null 2>&1 || true
  docker run -d --name cua-bench-registry -p 5000:5000 ghcr.io/project-zot/zot-linux-amd64:latest >/dev/null
  sleep 3
fi
for image in bench-web:1.0 linux:24.04; do
  docker pull -q "ghcr.io/trycua/$image" >/dev/null
  docker tag "ghcr.io/trycua/$image" "$REGISTRY/trycua/$image"
  docker push -q "$REGISTRY/trycua/$image" >/dev/null
done

# 4. The Linux cua-driver binary (from the cua-driver wheel), copied into each sandbox.
mkdir -p .cache
if [ ! -x .cache/cua-driver ]; then
  url=$(curl -s https://pypi.org/pypi/cua-driver/json | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['info']['version']; print([f['url'] for f in d['releases'][v] if 'manylinux_2_31_x86_64' in f['filename']][0])")
  curl -sSL -o .cache/cua-driver.whl "$url"
  python3 -c "import zipfile; z=zipfile.ZipFile('.cache/cua-driver.whl'); open('.cache/cua-driver','wb').write(z.read('cua_driver/bin/cua-driver'))"
  chmod +x .cache/cua-driver
fi

# 5. Llama Run's harness, bundled for plain Node.
(cd .. && node bench/build.mjs)
echo "Ready. Run: bench/run.sh"
