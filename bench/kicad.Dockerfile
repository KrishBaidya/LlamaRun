# The Linux desktop image with KiCad 9 installed (bench/setup.sh builds it as
# localhost:5000/trycua/linux-kicad:24.04). Each KiCad task otherwise installs
# KiCad from its PPA inside the sandbox: a large download per task, and one that
# fails behind a TLS-intercepting proxy the sandbox doesn't trust. The task's
# installer skips an installed KiCad. The base image pins every Launchpad PPA
# to -1 (it takes only Chromium from one), which would quietly install Ubuntu's
# KiCad 7 instead, so the KiCad PPA gets a pin of its own.
#
# Behind such a proxy, pass its CA as the `proxyca` build secret (it is trusted
# for the build only) and https_proxy as a build arg.
FROM localhost:5000/trycua/linux:24.04
ARG https_proxy
RUN --mount=type=secret,id=proxyca set -eux; \
    if [ -s /run/secrets/proxyca ]; then cp /run/secrets/proxyca /usr/local/share/ca-certificates/build-proxy-ca.crt; update-ca-certificates; fi; \
    sed -i 's|http://|https://|g' /etc/apt/sources.list.d/* /etc/apt/sources.list 2>/dev/null || true; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update; apt-get install -y software-properties-common; \
    add-apt-repository --yes --no-update ppa:kicad/kicad-9.0-releases; \
    printf 'Package: *\nPin: release o=LP-PPA-kicad-kicad-9.0-releases\nPin-Priority: 600\n' > /etc/apt/preferences.d/00-kicad; \
    sed -i 's|http://|https://|g' /etc/apt/sources.list.d/*; \
    apt-get update; apt-get install -y --install-recommends kicad; \
    rm -rf /var/lib/apt/lists/* /usr/local/share/ca-certificates/build-proxy-ca.crt; update-ca-certificates --fresh >/dev/null; \
    command -v kicad
