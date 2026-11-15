# syntax=docker/dockerfile:1
# The Office's container image (docs/releasing.md): an Office release's tarball for the image's
# CPU, unpacked as it is, so the image and the tarball are the same bits. tools/release/prepare.sh
# builds it after `npm run pack-release`; it never builds from the sources.
#
# Mounting the Docker socket and its group, and the Office data folder at the same path on the
# host and in the container (so the run environments' bind mounts resolve on the host), is the
# Docker Compose install's part, not the image's.
FROM node:22.23.4-trixie-slim@sha256:be1e2a3dc2c4fd68cdfadad2a696a280e0d2749098bee509230174d72fb768c6

# Docker's CLI with Compose and buildx, never its daemon, at the versions docs/container-runtime.md
# holds, from Docker's repository for Debian trixie.
ARG DOCKER_VERSION=29.9.3
ARG BUILDX_VERSION=0.38.1
ARG COMPOSE_VERSION=5.7.0
ARG DOCKER_KEY_FINGERPRINT=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl gnupg git openssh-client tini \
    && install --mode 0755 --directory /etc/apt/keyrings \
    && curl --fail --silent --show-error --location https://download.docker.com/linux/debian/gpg \
        --output /etc/apt/keyrings/docker.asc \
    && gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc \
        | grep --quiet "^fpr:::::::::${DOCKER_KEY_FINGERPRINT}:" \
    && printf '%s\n' 'Types: deb' 'URIs: https://download.docker.com/linux/debian' 'Suites: trixie' \
        'Components: stable' 'Signed-By: /etc/apt/keyrings/docker.asc' \
        > /etc/apt/sources.list.d/docker.sources \
    && apt-get update \
    && apt-get install --yes --no-install-recommends \
        "docker-ce-cli=5:${DOCKER_VERSION}-1~debian.13~trixie" \
        "docker-buildx-plugin=${BUILDX_VERSION}-1~debian.13~trixie" \
        "docker-compose-plugin=${COMPOSE_VERSION}-1~debian.13~trixie" \
    && apt-get purge --yes --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*

# The service's user, which owns the Office data folder and nothing of The Office's own files.
RUN groupadd --system --gid 10001 office \
    && useradd --system --uid 10001 --gid office --home-dir /var/lib/the-office --create-home \
        --shell /usr/sbin/nologin office

ARG VERSION
ARG TARGETARCH
RUN --mount=type=bind,source=dist/release,target=/release \
    case "$TARGETARCH" in \
        amd64) arch=x64 ;; \
        arm64) arch=arm64 ;; \
        *) echo "No Office release is packed for $TARGETARCH." >&2; exit 1 ;; \
    esac \
    && mkdir /opt/the-office \
    && tar --extract --gzip --file "/release/the-office-${VERSION}-linux-${arch}.tar.gz" \
        --directory /opt/the-office --strip-components=1 --no-same-owner

ARG REVISION
ARG SOURCE
LABEL org.opencontainers.image.title="The Office" \
    org.opencontainers.image.version="${VERSION}" \
    org.opencontainers.image.revision="${REVISION}" \
    org.opencontainers.image.source="${SOURCE}" \
    org.opencontainers.image.licenses="GPL-3.0-only"

# OFFICE_INSTALL tells the service it runs in a container, which the Office updater updates
# through Docker Compose (docs/running-the-office.md).
ENV OFFICE_HOST=0.0.0.0 \
    OFFICE_PORT=4310 \
    OFFICE_DATA_DIR=/var/lib/the-office \
    OFFICE_INSTALL=container
WORKDIR /opt/the-office
USER office
EXPOSE 4310
# At the address the service listens on, which on the host's network (the Compose install) can be a
# LAN IP alone; every address (0.0.0.0 or ::) is asked at 127.0.0.1.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "-e", "const host = process.env.OFFICE_HOST || '127.0.0.1'; const address = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host; fetch(`http://${address}:${process.env.OFFICE_PORT || 4310}/api/health`).then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]
# tini passes SIGTERM on to the service, which re-raises it, so `docker stop` ends it with 143.
# No launcher: the Office updater, a short-lived container of this image, replaces this one.
ENTRYPOINT ["tini", "--", "node", "--enable-source-maps", "apps/service/dist/main.js"]
