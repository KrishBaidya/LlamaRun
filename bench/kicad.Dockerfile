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

# KiCad's first start asks where its settings live, whether to check for
# updates, and how to set up the symbol and footprint libraries: about six
# rounds per task that both harnesses would spend on dialogs, not the task.
# A settings folder with the default library tables, the update and data
# collection prompts answered, and update checks off skips them. (Key names
# from KiCad 9.0.9's libkicommon; check after a KiCad upgrade that no dialog
# reappears.)
RUN set -eux; \
    for home in /home/cua /root; do \
      dir="$home/.config/kicad/9.0"; mkdir -p "$dir"; \
      cp /usr/share/kicad/template/sym-lib-table /usr/share/kicad/template/fp-lib-table "$dir/"; \
      printf '{"meta":{"version":3},"do_not_show_again":{"update_check_prompt":true,"data_collection_prompt":true},"system":{"check_for_kicad_updates":false}}\n' > "$dir/kicad_common.json"; \
      printf '{"meta":{"version":0},"system":{"first_run_shown":true},"pcm":{"check_for_updates":false}}\n' > "$dir/kicad.json"; \
    done; \
    if id cua >/dev/null 2>&1; then chown -R cua:cua /home/cua/.config; fi
