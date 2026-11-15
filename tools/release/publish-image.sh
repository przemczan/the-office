#!/usr/bin/env bash
# `publish-image.sh <version>`, the Release workflow's publish step (docs/releasing.md): once the
# tag v<version> is pushed, points $IMAGE:latest at the $IMAGE:<version> prepare.sh pushed, for
# both platforms.
set -euo pipefail

version=${1:?Give the version released, such as 1.2.3.}
image=${IMAGE:?Set IMAGE to the image, such as ghcr.io/<owner>/the-office.}

cd "$(dirname "$0")/../.."
git ls-remote --exit-code --tags origin "refs/tags/v$version" >/dev/null ||
  { echo "The tag v$version isn't pushed, so $image:latest stays where it is." >&2; exit 1; }
docker buildx imagetools create --tag "$image:latest" "$image:$version"
