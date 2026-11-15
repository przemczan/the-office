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
