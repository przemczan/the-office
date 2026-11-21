# The image the checks run in: Linux with Node at .nvmrc's major (the full image brings git, bash and
# the ssh client the tests run) and the Chromium Playwright's end-to-end tests drive. The Project's
# install command runs over it, so node_modules is not built here.
FROM node:22.23.4-trixie@sha256:c46850e69b4fab3c4f225aa36b777c8cc001d1cd5b2136e1ea024796f6d3bbbb

# shellcheck, for tools/install's test of install.sh.
RUN apt-get update \
    && apt-get install -y --no-install-recommends shellcheck \
    && rm -rf /var/lib/apt/lists/*

# Keep in step with @playwright/test in apps/web/package.json: each release wants its own Chromium build.
ARG PLAYWRIGHT_VERSION=1.64.1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx --yes playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm

# Go, for tools/device-helper (the Connected devices' helper). Keep in step with the `toolchain` line
# of its go.mod and the release workflow's setup-go; the official tarball for the container's CPU,
# checked against the sha256 go.dev/dl lists.
ARG GO_VERSION=1.27.4
ARG GO_SHA256_AMD64=7226736c2339719cda28fbf3a54d71aa63bcefe376e98cef00034268dab24840
ARG GO_SHA256_ARM64=3392582988a273a87ab5043ee1b2c9c17a2c3c00580bf9326c47a2e0aaaeac92
RUN arch="$(dpkg --print-architecture)" \
    && case "$arch" in \
        amd64) sha256="$GO_SHA256_AMD64" ;; \
        arm64) sha256="$GO_SHA256_ARM64" ;; \
        *) echo "No Go is pinned for $arch." >&2; exit 1 ;; \
    esac \
    && curl --fail --silent --show-error --location --output /tmp/go.tar.gz \
        "https://go.dev/dl/go${GO_VERSION}.linux-${arch}.tar.gz" \
    && echo "${sha256}  /tmp/go.tar.gz" | sha256sum --check - \
    && tar --extract --gzip --file /tmp/go.tar.gz --directory /usr/local \
    && rm /tmp/go.tar.gz
ENV PATH=/usr/local/go/bin:$PATH \
    GOTOOLCHAIN=local
