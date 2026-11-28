#!/usr/bin/env bash
# `prepare.sh <version> [--no-push]`, the Release workflow's prepare step (docs/releasing.md):
# packs both tarballs, signs their .sha256 once a release key is pinned, stamps install.sh with the version and GITHUB_REPOSITORY, writes the Compose
# install's assets, checks the x64 tarball and the amd64 image against a throwaway Postgres and the
# Compose install with that image, then pushes the image for both platforms as $IMAGE:<version>.
# --no-push, for the Dry run, stops after the checks.
# Linux with Docker and buildx (QEMU for arm64), as on the Release runner.
set -euo pipefail

version=${1:?Give the version to release, such as 1.2.3.}
push=true
[[ ${2:-} == --no-push ]] && push=false
image=${IMAGE:?Set IMAGE to the image to push, such as ghcr.io/<owner>/the-office.}

cd "$(dirname "$0")/../.."
revision=$(git rev-parse HEAD)
# The repository's page, which GHCR links the image to.
source_url=$(git config --get remote.origin.url | sed -e 's#^git@github.com:#https://github.com/#' -e 's#\.git$##')
image_arguments=(
  --build-arg "VERSION=$version"
  --build-arg "REVISION=$revision"
  --build-arg "SOURCE=$source_url"
)

echo "::group::Build and pack $version"
npm ci
# The device helper reports the release's version (tools/device-helper/build.ts).
OFFICE_RELEASE_VERSION="$version" npm run build
for arch in x64 arm64; do
  npm run pack-release -- --version "$version" --arch "$arch"
done
(cd dist/release && sha256sum --check ./*.sha256)
echo "::endgroup::"

echo "::group::Sign each tarball's .sha256"
# The release key's public half, pinned in install.sh and the launcher (docs/releasing.md, "Signing
# a release"); its private half comes from the RELEASE_SIGNING_PRIVATE_KEY secret, as PEM, and is
# never written to disk.
release_key=$(sed -n "s/^readonly RELEASE_SIGNING_KEY='\(.*\)'\$/\1/p" tools/install/install.sh)
if [[ -z $release_key ]]; then
  echo "No release key is pinned in tools/install/install.sh, so signing is off: no .sig is made."
else
  : "${RELEASE_SIGNING_PRIVATE_KEY:?A release key is pinned: set RELEASE_SIGNING_PRIVATE_KEY to its private half.}"
  for checksum in dist/release/*.sha256; do
    openssl pkeyutl -sign -rawin -in "$checksum" -out "$checksum.sig" \
      -inkey <(printf '%s\n' "$RELEASE_SIGNING_PRIVATE_KEY")
    # A secret that isn't the pinned key's private half fails here, before anything is published.
    openssl pkeyutl -verify -pubin -rawin -in "$checksum" -sigfile "$checksum.sig" \
      -inkey <(printf -- '-----BEGIN PUBLIC KEY-----\n%s\n-----END PUBLIC KEY-----\n' "$release_key")
  done
fi
echo "::endgroup::"

echo "::group::Stamp install.sh with $version"
repository=${GITHUB_REPOSITORY:-przemczan/the-office}
sed -e "s|@OFFICE_VERSION@|$version|g" -e "s|@OFFICE_REPOSITORY@|$repository|g" \
  tools/install/install.sh >dist/release/install.sh
chmod 0755 dist/release/install.sh
if grep -n '@OFFICE_[A-Z]*@' dist/release/install.sh; then
  echo "dist/release/install.sh still holds a placeholder." >&2
  exit 1
fi
bash -n dist/release/install.sh
echo "::endgroup::"

echo "::group::Write the Compose install's docker-compose.yml and the-office.env for $version"
npm run compose-assets -- --version "$version"
echo "::endgroup::"

network=office-release-check
postgres=office-release-postgres
check_image_name=office-release-check
check_image=$check_image_name:$version
cleanup() {
  docker rm --force --volumes "$postgres" office-release-image-check >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "::group::Start a throwaway Postgres"
postgres_image=$(sed -n 's/^ *image: *\(postgres:.*\)$/\1/p' .devcontainer/compose.yaml)
docker network create "$network" >/dev/null
docker run --detach --name "$postgres" --network "$network" --publish 127.0.0.1:55432:5432 \
  --env POSTGRES_USER=office --env POSTGRES_PASSWORD=office --env POSTGRES_DB=the_office \
  "$postgres_image" >/dev/null
for _ in $(seq 60); do
  docker exec "$postgres" pg_isready --host 127.0.0.1 --username office --dbname the_office >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$postgres" pg_isready --host 127.0.0.1 --username office --dbname the_office
echo "::endgroup::"

echo "::group::Check the x64 tarball: it starts with no install or build"
rm -rf dist/release/check
mkdir -p dist/release/check
tar --extract --gzip --file "dist/release/the-office-$version-linux-x64.tar.gz" --directory dist/release/check
DATABASE_URL=postgres://office:office@127.0.0.1:55432/the_office OTEL_SDK_DISABLED=true \
  node tools/service-start-check/src/main.ts --root "dist/release/check/the-office-$version"
rm -rf dist/release/check
echo "::endgroup::"

echo "::group::Check the amd64 image"
docker buildx build --platform linux/amd64 --load --tag "$check_image" "${image_arguments[@]}" .
bash tools/release/image-check.sh "$check_image" "$network" \
  "postgres://office:office@$postgres:5432/the_office"
echo "::endgroup::"

echo "::group::Check the Compose install with the amd64 image"
bash tools/release/compose-check.sh "$check_image_name" "$version"
echo "::endgroup::"

if [[ $push == true ]]; then
  echo "::group::Push $image:$version for linux/amd64 and linux/arm64"
  docker buildx build --platform linux/amd64,linux/arm64 --push --tag "$image:$version" \
    "${image_arguments[@]}" .
  echo "::endgroup::"
fi
