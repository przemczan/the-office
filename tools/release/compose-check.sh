#!/usr/bin/env bash
# `compose-check.sh <image> <version>`: brings the Compose install up from the release's assets in
# dist/release (docker-compose.yml and the-office.env, stamped with `version`) with the local image
# `<image>:<version>`, checks it as a user would use it, moves it to another tag as the Office
# updater does, and takes it down (docs/releasing.md). prepare.sh runs it after image-check.sh, on
# the Release runner; it needs ports 4393 and 55433 free and the runner's Docker socket.
set -euo pipefail

image=${1:?Give the image to check, without its tag.}
version=${2:?Give the version its tag and the assets were stamped with.}
update_version=$version-compose-update
port=4393

cd "$(dirname "$0")/../.."
work=$(mktemp -d)
folder=$work/compose
# A path that doesn't exist yet: the data folder step creates it.
data=$work/data

compose() {
  docker compose --project-directory "$folder" --file "$folder/docker-compose.yml" "$@"
}
# Sets the .env line of `name` to `value`, as a user editing the stamped file would.
set_env() {
  grep --quiet "^$1=" "$folder/.env" || fail "the-office.env has no $1= line."
  sed --in-place "s|^$1=.*|$1=$2|" "$folder/.env"
}
fail() {
  echo "The compose check failed: $*" >&2
  compose logs >&2 || true
  exit 1
}
cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  # The data folder and what The Office wrote in it are uid 10001's, so root in a container removes them.
  docker run --rm --user 0:0 --entrypoint rm --volume "$work:$work" "$image:$version" -rf "$data" \
    >/dev/null 2>&1 || true
  docker image rm "$image:$update_version" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

health() {
  curl --silent --max-time 5 "http://127.0.0.1:$port/api/health" || true
}
container_of() {
  compose ps --quiet "$1"
}

echo "Setting up the Compose install in $folder"
mkdir -p "$folder"
cp dist/release/docker-compose.yml "$folder/docker-compose.yml"
cp dist/release/the-office.env "$folder/.env"
grep --quiet "^OFFICE_VERSION=$version$" "$folder/.env" || fail "the-office.env isn't stamped with $version."
set_env OFFICE_DATA_DIR "$data"
set_env OFFICE_PORT "$port"
set_env POSTGRES_PORT 55433
set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
set_env DOCKER_GID "$(stat -c %g /var/run/docker.sock)"
echo "OFFICE_IMAGE=$image" >>"$folder/.env"

compose config --quiet
compose up --detach --wait || fail "docker compose up didn't bring the install up healthy."

answer=$(health)
[[ $answer == '{"database":"up","testInstance":false}' ]] || fail "/api/health answered '$answer'."
echo "The Office answered $answer on 127.0.0.1:$port."

compose logs office 2>&1 | grep --quiet --ignore-case 'setup token' ||
  fail "docker compose logs office holds no setup token."
token=$(compose exec -T office npm run --silent setup-token -- --quiet) ||
  fail "npm run setup-token -- --quiet failed."
[[ -n $token ]] || fail "npm run setup-token -- --quiet printed nothing."
echo "The first start logged a setup token, and setup-token --quiet printed a new one."

user=$(compose exec -T office id -u)
[[ $user == 10001 ]] || fail "The Office runs as uid $user, not 10001."
compose exec -T office docker version >/dev/null || fail "The Office doesn't reach the Docker daemon."
echo "The Office runs as uid 10001 and reaches the Docker daemon."

owner=$(stat -c %u "$data")
[[ $owner == 10001 ]] || fail "the data folder's top is owned by uid $owner, not 10001."
# shellcheck disable=SC2016 # Expanded in the container.
compose exec -T office sh -c 'echo same-path >"$OFFICE_DATA_DIR/compose-check"'
seen=$(docker run --rm --entrypoint cat --volume "$data:$data" "$image:$version" "$data/compose-check")
[[ $seen == same-path ]] || fail "a container mounting $data doesn't see what The Office wrote there."
echo "The data folder is uid 10001's, at the same path on the host and in the container."

echo "Moving The Office to $update_version as the Office updater does"
docker tag "$image:$version" "$image:$update_version"
office_before=$(container_of office)
postgres_before=$(container_of postgres)
set_env OFFICE_VERSION "$update_version"
compose up --detach --no-deps --wait office || fail "The Office didn't come up healthy at $update_version."
office_after=$(container_of office)
[[ $office_after != "$office_before" ]] || fail "docker compose up --no-deps office didn't recreate The Office."
[[ $(container_of postgres) == "$postgres_before" ]] || fail "moving The Office recreated Postgres."
running=$(docker inspect --format '{{.Config.Image}}' "$office_after")
[[ $running == "$image:$update_version" ]] || fail "The Office runs $running, not $image:$update_version."
answer=$(health)
[[ $answer == '{"database":"up","testInstance":false}' ]] || fail "after the move /api/health answered '$answer'."
echo "Only The Office was recreated, at $update_version, and it is healthy."
