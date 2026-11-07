#!/usr/bin/env bash
# Installs the language servers every session uses, at the pinned versions docs/language-servers.md
# names, into /opt/language-servers, with each command linked into /usr/local/bin, which sessions'
# PATH holds. Run it as root; running it again installs what a version change needs and no more.
set -euo pipefail

readonly INSTALL_FOLDER=/opt/language-servers
readonly COMMANDS_FOLDER=/usr/local/bin

readonly TYPESCRIPT_LANGUAGE_SERVER_VERSION=6.0.3
# typescript-language-server drives tsserver, which TypeScript 7 no longer has.
readonly TYPESCRIPT_VERSION=6.0.3

readonly CLANGD_VERSION=23.1.0
readonly CLANGD_SHA256=e53b1a96196095faedb7642cf64964f7fb9ad4a0c1f00dd2c172a3d9dcbafdfd

readonly KOTLIN_SERVER_VERSION=263.7084.0
readonly KOTLIN_SERVER_SHA256=ae0c4b01e17ab73a4a5227a78ea99e6dcbe3e499600315b22759a4e4cddd11df

download() {
  local url=$1 sha256=$2 file=$3
  curl --fail --location --silent --show-error --output "$file" "$url"
  echo "$sha256  $file" | sha256sum --check --quiet
}

install_typescript() {
  local folder=$INSTALL_FOLDER/typescript-language-server-$TYPESCRIPT_LANGUAGE_SERVER_VERSION
  if [[ ! -x $folder/node_modules/.bin/typescript-language-server ]]; then
    mkdir -p "$folder"
    npm install --prefix "$folder" --save-exact --no-audit --no-fund \
      "typescript-language-server@$TYPESCRIPT_LANGUAGE_SERVER_VERSION" \
      "typescript@$TYPESCRIPT_VERSION"
  fi
  ln -sfn "$folder/node_modules/.bin/typescript-language-server" \
    "$COMMANDS_FOLDER/typescript-language-server"
}

install_clangd() {
  local folder=$INSTALL_FOLDER/clangd_$CLANGD_VERSION
  if [[ ! -x $folder/bin/clangd ]]; then
    local archive
    archive=$(mktemp)
    download \
      "https://github.com/clangd/clangd/releases/download/$CLANGD_VERSION/clangd-linux-$CLANGD_VERSION.zip" \
      "$CLANGD_SHA256" "$archive"
    unzip -q "$archive" -d "$INSTALL_FOLDER"
    rm "$archive"
  fi
  ln -sfn "$folder/bin/clangd" "$COMMANDS_FOLDER/clangd"
}

install_kotlin() {
  local folder=$INSTALL_FOLDER/kotlin-server-$KOTLIN_SERVER_VERSION
  if [[ ! -x $folder/kotlin-lsp.sh ]]; then
    local archive
    archive=$(mktemp)
    download \
      "https://download.jetbrains.com/language-server/kotlin-server/$KOTLIN_SERVER_VERSION/kotlin-server-$KOTLIN_SERVER_VERSION.tar.gz" \
      "$KOTLIN_SERVER_SHA256" "$archive"
    tar --extract --gzip --file "$archive" --directory "$INSTALL_FOLDER"
    rm "$archive"
    chmod +x "$folder/kotlin-lsp.sh"
  fi
  ln -sfn "$folder/kotlin-lsp.sh" "$COMMANDS_FOLDER/kotlin-lsp"
}

mkdir -p "$INSTALL_FOLDER"
install_typescript
install_clangd
install_kotlin

typescript-language-server --version
clangd --version
kotlin-lsp --version
