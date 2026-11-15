#!/usr/bin/env bash
# Installs The Office from a released tarball on Debian 12/13 or Ubuntu 22.04/24.04 (x64 or arm64),
# with what it needs that is missing: Node 22, Docker Engine, PostgreSQL 18, git and ssh. Run it as
# root, as a Release's one-liner does:
#
#   curl -fsSL https://github.com/przemczan/the-office/releases/latest/download/install.sh | sudo bash
#
# Running it again is safe: it keeps the answers, the database password, the installed version and
# the lines a user added to office.env, and restarts The Office only when something changed.
# `install.sh --help` lists its options. Spec §5.1 Defaults, "Installing on Debian/Ubuntu".
set -euo pipefail

# Stamped by tools/release/prepare.sh; a copy from a checkout keeps the placeholders.
readonly STAMPED_VERSION='@OFFICE_VERSION@'
readonly STAMPED_REPOSITORY='@OFFICE_REPOSITORY@'
readonly DEFAULT_REPOSITORY=przemczan/the-office

readonly SUPPORTED_SYSTEMS="debian:bookworm debian:trixie ubuntu:jammy ubuntu:noble"

readonly DEFAULT_HOST=127.0.0.1
readonly DEFAULT_PORT=4310
readonly DEFAULT_DATA_DIR=/var/lib/the-office

readonly SERVICE_USER=the-office
readonly SERVICE_HOME=/home/the-office
readonly SERVICE_NAME=the-office
readonly INSTALL_DIR=/opt/the-office
readonly CONFIG_DIR=/etc/the-office
readonly ENV_FILE=/etc/the-office/office.env
readonly UNIT_FILE=/etc/systemd/system/the-office.service
readonly LOG_FILE=/var/log/the-office-install.log
readonly NODE=/usr/bin/node

readonly DATABASE_ROLE=office
readonly DATABASE_NAME=the_office
readonly POSTGRES_MAJOR=18

readonly NODE_MAJOR=22
readonly NODE_MINIMUM_MINOR=18

# Docker Engine at the versions docs/container-runtime.md holds: change both in one commit.
readonly DOCKER_ENGINE_VERSION=5:29.9.3-1
readonly CONTAINERD_VERSION=2.4.2-3
readonly DOCKER_BUILDX_VERSION=0.38.1-1
readonly DOCKER_COMPOSE_VERSION=5.7.0-1
readonly DOCKER_PACKAGES="docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"

# Each apt repository's signing key, as `gpg --show-keys` prints its fingerprint.
readonly DOCKER_KEY_FINGERPRINT=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
readonly PGDG_KEY_FINGERPRINT=B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
readonly NODESOURCE_KEY_FINGERPRINT=6F71F525282841EEDAF851B42F59B5F99B1BE0B4

readonly BASE_PACKAGES="ca-certificates curl gnupg git openssh-client"

# How long the start may take to report the database up; the tests shorten it.
readonly HEALTH_TIMEOUT_SECONDS=${THE_OFFICE_INSTALL_HEALTH_SECONDS:-180}

# ---------------------------------------------------------------------------------------------
# Pure functions: they read only their arguments (and files named in them) and change nothing.
# ---------------------------------------------------------------------------------------------

# A system path under THE_OFFICE_INSTALL_ROOT, which the tests set to a folder of their own.
root_path() {
  printf '%s%s\n' "${THE_OFFICE_INSTALL_ROOT:-}" "$1"
}

# `dpkg --print-architecture`'s answer as the release tarballs name it.
arch_of() {
  case $1 in
    amd64) echo x64 ;;
    arm64) echo arm64 ;;
    *) return 1 ;;
  esac
}

# Succeeds when the system (os-release's ID and VERSION_CODENAME) is one the installer supports.
supported_codename() {
  local system
  for system in $SUPPORTED_SYSTEMS; do
    [[ $system == "$1:$2" ]] && return 0
  done
  return 1
}

# A release version, with or without its leading v, printed without it.
parse_version() {
  local version=${1#v}
  [[ $version =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$ ]] || return 1
  echo "$version"
}

# Prints -1, 0 or 1 as the first version is older than, the same as or newer than the second.
compare_versions() {
  local left=$1 right=$2
  local left_core=${left%%-*} right_core=${right%%-*}
  local left_pre="" right_pre=""
  [[ $left == *-* ]] && left_pre=${left#*-}
  [[ $right == *-* ]] && right_pre=${right#*-}
  local -a left_parts right_parts
  IFS=. read -ra left_parts <<<"$left_core"
  IFS=. read -ra right_parts <<<"$right_core"
  local index
  for index in 0 1 2; do
    if ((left_parts[index] < right_parts[index])); then echo -1 && return; fi
    if ((left_parts[index] > right_parts[index])); then echo 1 && return; fi
  done
  # A pre-release comes before its release.
  if [[ $left_pre == "$right_pre" ]]; then echo 0
  elif [[ -z $left_pre ]]; then echo 1
  elif [[ -z $right_pre ]]; then echo -1
  elif [[ $left_pre < $right_pre ]]; then echo -1
  else echo 1
  fi
}

tarball_name() {
  echo "the-office-$1-linux-$2.tar.gz"
}

# asset_url <repository> <version> <file>
asset_url() {
  echo "https://github.com/$1/releases/download/v$2/$3"
}

# docker_package_version <upstream> <id> <version_id> <codename>: Docker's apt version for a
# distro, such as 5:29.9.3-1~debian.13~trixie.
docker_package_version() {
  echo "$1~$2.$3~$4"
}

valid_ipv4() {
  local -a octets
  [[ $1 =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  IFS=. read -ra octets <<<"$1"
  local octet
  for octet in "${octets[@]}"; do
    [[ $octet == 0 || $octet != 0* ]] || return 1
    ((octet <= 255)) || return 1
  done
}

valid_ipv6() {
  local address=$1
  [[ $address == *:* && $address =~ ^[0-9A-Fa-f:]+$ ]] || return 1
  local rest=${address//::/}
  # At most one "::", and no ":::".
  ((${#address} - ${#rest} <= 2)) || return 1
  [[ $address != *:::* ]] || return 1
  local -a groups
  IFS=: read -ra groups <<<"$address"
  local group count=0
  for group in "${groups[@]}"; do
    [[ -z $group ]] && continue
    ((${#group} <= 4)) || return 1
    count=$((count + 1))
  done
  if [[ $address == *::* ]]; then ((count <= 7)); else ((count == 8)) && [[ $address != :* && $address != *: ]]; fi
}

# The service listens only on an IP address (OFFICE_HOST in apps/service's office-config.ts).
valid_host() {
  valid_ipv4 "$1" || valid_ipv6 "$1"
}

# A port a user may listen on without root.
valid_port() {
  [[ $1 =~ ^[1-9][0-9]*$ ]] && (($1 >= 1024 && $1 <= 65535))
}

# An absolute folder, as a plain word office.env and systemd both read as it is.
valid_data_dir() {
  [[ $1 =~ ^/[A-Za-z0-9._/-]+$ ]] || return 1
  [[ /$1/ != */../* && /$1/ != */./* && $1 != *//* ]] || return 1
  [[ ${1%/} != "" ]]
}

# env_value <file> <key>: the key's value in an env file (the last line setting it), unquoted.
env_value() {
  [[ -f $1 ]] || return 0
  local line value=""
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line == "$2="* ]] && value=${line#"$2="}
  done <"$1"
  value=${value#\"}
  value=${value%\"}
  value=${value#\'}
  value=${value%\'}
  echo "$value"
}

# env_with <file> <key> <value>: the env file's text with the key set to the value, replacing its
# line where it has one (the first; later ones are dropped) and appending it otherwise. Every other
# line stays as it is.
env_with() {
  local file=$1 key=$2 value=$3 line written=false
  if [[ -f $file ]]; then
    while IFS= read -r line || [[ -n $line ]]; do
      if [[ $line == "$key="* ]]; then
        [[ $written == false ]] && echo "$key=$value"
        written=true
      else
        echo "$line"
      fi
    done <"$file"
  fi
  [[ $written == true ]] || echo "$key=$value"
}

# health_url <host> <port>: where /api/health answers on this machine.
health_url() {
  local host=$1
  case $host in
    0.0.0.0) host=127.0.0.1 ;;
    ::) host=::1 ;;
  esac
  [[ $host == *:* ]] && host="[$host]"
  echo "http://$host:$2/api/health"
}

# open_address <host> <port> <machine ips>: the address to open The Office at. Listening on every
# address, that is the machine's first address of the same family, as others on the network reach it.
open_address() {
  local host=$1 port=$2 machine_ips=$3 candidate
  if [[ $host == 0.0.0.0 || $host == :: ]]; then
    local chosen=""
    for candidate in $machine_ips; do
      if [[ $host == 0.0.0.0 && $candidate != *:* ]] || [[ $host == :: && $candidate == *:* ]]; then
        chosen=$candidate
        break
      fi
    done
    if [[ -n $chosen ]]; then host=$chosen
    elif [[ $host == 0.0.0.0 ]]; then host=127.0.0.1
    else host=::1
    fi
  fi
  [[ $host == *:* ]] && host="[$host]"
  echo "http://$host:$port"
}

# cluster_port <pg_lsclusters --no-header output>: the port of the PostgreSQL 18 cluster.
cluster_port() {
  local version port
  while read -r version _ port _; do
    if [[ $version == "$POSTGRES_MAJOR" ]]; then
      echo "$port"
      return 0
    fi
  done <<<"$1"
  return 1
}

# node_version_fits <node --version output>: 22.18 or later, below 23 (the root package's engines).
node_version_fits() {
  [[ $1 =~ ^v([0-9]+)\.([0-9]+)\. ]] || return 1
  ((BASH_REMATCH[1] == NODE_MAJOR && BASH_REMATCH[2] >= NODE_MINIMUM_MINOR))
}

# The systemd unit, per the shared install layout.
unit_text() {
  cat <<EOF
[Unit]
Description=The Office
After=network-online.target postgresql.service docker.service
Wants=network-online.target postgresql.service docker.service

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
SupplementaryGroups=docker
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$NODE $INSTALL_DIR/current/tools/office-launcher/src/main.ts
Restart=always
RestartSec=5
KillMode=mixed
TimeoutStopSec=15min

[Install]
WantedBy=multi-user.target
EOF
}

# The first argument that isn't empty.
first_of() {
  local value
  for value in "$@"; do
    if [[ -n $value ]]; then
      echo "$value"
      return
    fi
  done
}

# answer_from <flag> <environment> <existing> <default>: the first value given, and where it
# came from (flag, environment, existing or default).
answer_from() {
  if [[ -n $1 ]]; then echo "$1 flag"
  elif [[ -n $2 ]]; then echo "$2 environment"
  elif [[ -n $3 ]]; then echo "$3 existing"
  else echo "$4 default"
  fi
}

# resolve_answers <env file>: sets HOST, PORT and DATA_DIR from the flags (FLAG_*), else the
# environment, else the existing env file, else the defaults; *_SOURCE says which.
resolve_answers() {
  local file=$1
  read -r HOST HOST_SOURCE < <(answer_from "$FLAG_HOST" "${OFFICE_HOST:-}" \
    "$(env_value "$file" OFFICE_HOST)" "$DEFAULT_HOST")
  read -r PORT PORT_SOURCE < <(answer_from "$FLAG_PORT" "${OFFICE_PORT:-}" \
    "$(env_value "$file" OFFICE_PORT)" "$DEFAULT_PORT")
  read -r DATA_DIR DATA_DIR_SOURCE < <(answer_from "$FLAG_DATA_DIR" "${OFFICE_DATA_DIR:-}" \
    "$(env_value "$file" OFFICE_DATA_DIR)" "$DEFAULT_DATA_DIR")
}

# ---------------------------------------------------------------------------------------------
# Output and running commands.
# ---------------------------------------------------------------------------------------------

FLAG_HOST="" FLAG_PORT="" FLAG_DATA_DIR="" FLAG_VERSION=""
HOST="" PORT="" DATA_DIR=""
HOST_SOURCE="" PORT_SOURCE="" DATA_DIR_SOURCE=""
LOG=""
TTY_OPEN=false
ASSUME_YES=false
WORK_DIR=""

step() {
  echo "==> $*"
}

note() {
  echo "    $*"
}

warn() {
  echo "Warning: $*" >&2
}

die() {
  echo "Error: $*" >&2
  exit 1
}

# Runs a command with its output in the install log; on failure shows the log's tail and stops.
run() {
  if ! "$@" </dev/null >>"$LOG" 2>&1; then
    echo "Error: this failed: $*" >&2
    echo "The end of $LOG:" >&2
    tail -n 20 "$LOG" >&2 || true
    exit 1
  fi
}

ask() {
  local prompt=$1 default=$2 answer
  printf '%s [%s]: ' "$prompt" "$default" >&2
  IFS= read -r -u 3 answer || answer=""
  echo "${answer:-$default}"
}

usage() {
  cat <<EOF
Installs The Office on Debian 12/13 or Ubuntu 22.04/24.04 (x64 or arm64). Run it as root:

  curl -fsSL https://github.com/$DEFAULT_REPOSITORY/releases/latest/download/install.sh | sudo bash

Options (each also read from the variable named after it):
  --host <ip>         The address The Office listens on (OFFICE_HOST, default $DEFAULT_HOST;
                      0.0.0.0 for every address of this machine).
  --port <port>       Its port, 1024 to 65535 (OFFICE_PORT, default $DEFAULT_PORT).
  --data-dir <path>   The Office data folder (OFFICE_DATA_DIR, default $DEFAULT_DATA_DIR);
                      it can't be changed once installed.
  --version <x.y.z>   The release to install (OFFICE_VERSION); a rerun keeps the installed one
                      unless a newer version is given.
  --yes               Ask nothing: take the values given, else the installed ones, else the defaults.
  --help              Show this.

Running it again is safe: it keeps the answers, the installed version and office.env's other lines.
EOF
}

# ---------------------------------------------------------------------------------------------
# The steps of main.
# ---------------------------------------------------------------------------------------------


parse_arguments() {
  while (($# > 0)); do
    case $1 in
      --host | --port | --data-dir | --version)
        (($# >= 2)) || die "$1 needs a value."
        case $1 in
          --host) FLAG_HOST=$2 ;;
          --port) FLAG_PORT=$2 ;;
          --data-dir) FLAG_DATA_DIR=$2 ;;
          --version) FLAG_VERSION=$2 ;;
        esac
        shift 2
        ;;
      --yes | -y) ASSUME_YES=true && shift ;;
      --help | -h) usage && exit 0 ;;
      *) die "Unknown option $1. See --help." ;;
    esac
  done
}

SYSTEM_ID="" SYSTEM_VERSION_ID="" SYSTEM_CODENAME="" ARCH="" IN_CONTAINER=false

preflight() {
  if [[ $(id -u) != 0 ]]; then
    echo "The installer changes the system, so it runs as root. Run it with sudo:" >&2
    echo "  curl -fsSL https://github.com/$(repository)/releases/latest/download/install.sh | sudo bash" >&2
    exit 1
  fi
  [[ -d $(root_path /run/systemd/system) ]] ||
    die "This machine doesn't run systemd, which runs The Office as a service."
  local os_release
  os_release=$(root_path /etc/os-release)
  [[ -f $os_release ]] || die "No /etc/os-release, so the system can't be told."
  SYSTEM_ID=$(env_value "$os_release" ID)
  SYSTEM_VERSION_ID=$(env_value "$os_release" VERSION_ID)
  SYSTEM_CODENAME=$(env_value "$os_release" VERSION_CODENAME)
  supported_codename "$SYSTEM_ID" "$SYSTEM_CODENAME" ||
    die "$SYSTEM_ID $SYSTEM_VERSION_ID ($SYSTEM_CODENAME) isn't supported: Debian 12 or 13, or Ubuntu 22.04 or 24.04."
  local dpkg_arch
  dpkg_arch=$(dpkg --print-architecture)
  ARCH=$(arch_of "$dpkg_arch") || die "The $dpkg_arch architecture isn't supported: amd64 or arm64."
  if [[ $(systemd-detect-virt --container 2>/dev/null || true) == lxc ]]; then
    IN_CONTAINER=true
    warn "this is an LXC guest: Docker needs nesting turned on for it (on the Proxmox host: pct set <id> --features nesting=1,keyctl=1)."
  fi
}

repository() {
  if [[ $STAMPED_REPOSITORY == @* ]]; then echo "$DEFAULT_REPOSITORY"; else echo "$STAMPED_REPOSITORY"; fi
}

open_terminal() {
  [[ $ASSUME_YES == true ]] && return
  if { exec 3<"$(root_path /dev/tty)"; } 2>/dev/null; then TTY_OPEN=true; fi
}

port_in_use() {
  command -v ss >/dev/null || return 1
  [[ -n $(ss -ltnH "sport = :$1") ]]
}

# The port is taken unless The Office itself runs on it.
check_port_free() {
  local port=$1 existing_port
  port_in_use "$port" || return 0
  existing_port=$(env_value "$(root_path "$ENV_FILE")" OFFICE_PORT)
  [[ $port == "$existing_port" ]] && systemctl is-active --quiet "$SERVICE_NAME" && return 0
  return 1
}

check_answer() {
  local name=$1 value=$2
  case $name in
    HOST) valid_host "$value" || { echo "$value isn't an IP address The Office can listen on." && return 1; } ;;
    PORT)
      valid_port "$value" || { echo "$value isn't a port from 1024 to 65535." && return 1; }
      check_port_free "$value" || { echo "Port $value is already in use on this machine." && return 1; }
      ;;
    DATA_DIR) valid_data_dir "$value" || { echo "$value isn't an absolute folder (letters, digits, . _ - and /)." && return 1; } ;;
  esac
}

# ask_answer <name> <its source> <prompt>: asks for an answer that only has its default, again
# until it is valid; an answer given or kept that isn't valid stops the installer.
ask_answer() {
  local name=$1 source=$2 prompt=$3 value problem
  value=${!name}
  if [[ $TTY_OPEN == true && $source == default ]]; then
    while true; do
      value=$(ask "$prompt" "$value")
      problem=$(check_answer "$name" "$value") && break
      echo "$problem" >&2
    done
  else
    problem=$(check_answer "$name" "$value") || die "$problem"
  fi
  printf -v "$name" '%s' "$value"
}

gather_answers() {
  local env_file existing_data_dir
  env_file=$(root_path "$ENV_FILE")
  resolve_answers "$env_file"
  if [[ $TTY_OPEN == true && $HOST_SOURCE == default ]]; then
    note "The Office listens on 127.0.0.1, this machine alone, unless you open it up:"
    note "0.0.0.0 for every address, or one of this machine's: $(hostname -I 2>/dev/null || true)"
  fi
  ask_answer HOST "$HOST_SOURCE" "Address to listen on"
  ask_answer PORT "$PORT_SOURCE" "Port"
  ask_answer DATA_DIR "$DATA_DIR_SOURCE" "Office data folder"
  DATA_DIR=${DATA_DIR%/}
  existing_data_dir=$(env_value "$env_file" OFFICE_DATA_DIR)
  if [[ -n $existing_data_dir && $existing_data_dir != "$DATA_DIR" ]]; then
    die "The Office's data folder is $existing_data_dir and can't be changed by the installer; moving the data is done by hand."
  fi
  check_data_dir_free
  REQUESTED_VERSION=""
  local given_version
  given_version=$(first_of "$FLAG_VERSION" "${OFFICE_VERSION:-}")
  if [[ -n $given_version ]]; then
    REQUESTED_VERSION=$(parse_version "$given_version") || die "$given_version isn't a version such as 1.2.3."
  fi
}

confirm() {
  echo
  note "Address:      $HOST"
  note "Port:         $PORT"
  note "Data folder:  $DATA_DIR"
  local version=${REQUESTED_VERSION:-$CURRENT_VERSION}
  [[ -z $version && $STAMPED_VERSION != @* ]] && version=$STAMPED_VERSION
  note "Version:      ${version:-the newest release}"
  echo
  if [[ $TTY_OPEN == true ]]; then
    local answer
    printf 'Continue? [Y/n] '
    IFS= read -r -u 3 answer || answer=""
    [[ -z $answer || $answer == [Yy]* ]] || die "Stopped; nothing was installed."
  fi
}

package_installed() {
  [[ $(dpkg-query -W -f='${Status}' "$1" 2>/dev/null || true) == "install ok installed" ]]
}

# add_apt_repository <name> <key url> <fingerprint> <uris> <suite> <components>
add_apt_repository() {
  local name=$1 key_url=$2 fingerprint=$3 uris=$4 suite=$5 components=$6
  local keyrings key sources downloaded
  keyrings=$(root_path /etc/apt/keyrings)
  key=$keyrings/$name.asc
  sources=$(root_path "/etc/apt/sources.list.d/$name.sources")
  run install -m 0755 -d "$keyrings" "$(dirname "$sources")"
  downloaded=$WORK_DIR/$name.asc
  run curl -fsSL -o "$downloaded" "$key_url"
  local found
  found=$(gpg --show-keys --with-colons "$downloaded" 2>>"$LOG" | awk -F: '$1 == "fpr" { print $10; exit }')
  [[ $found == "$fingerprint" ]] ||
    die "The $name signing key from $key_url has the fingerprint '$found', not $fingerprint."
  install -m 0644 "$downloaded" "$key"
  cat >"$sources" <<EOF
Types: deb
URIs: $uris
Suites: $suite
Components: $components
Signed-By: /etc/apt/keyrings/$name.asc
EOF
  APT_SOURCES_CHANGED=true
}

apt_update_if_needed() {
  if [[ $APT_SOURCES_CHANGED == true ]]; then
    run apt-get update
    APT_SOURCES_CHANGED=false
  fi
}

apt_install() {
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}

install_base_packages() {
  local package missing=()
  for package in $BASE_PACKAGES; do
    package_installed "$package" || missing+=("$package")
  done
  if ((${#missing[@]} == 0)); then
    step "Base packages are installed"
    return
  fi
  step "Installing ${missing[*]}"
  run apt-get update
  apt_install "${missing[@]}"
}

installed_node_fits() {
  local node
  node=$(root_path "$NODE")
  [[ -x $node ]] && node_version_fits "$("$node" --version 2>/dev/null || true)"
}

install_node() {
  if installed_node_fits; then
    step "Node $("$(root_path "$NODE")" --version) is installed"
    return
  fi
  step "Installing Node $NODE_MAJOR from NodeSource"
  add_apt_repository nodesource https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    "$NODESOURCE_KEY_FINGERPRINT" "https://deb.nodesource.com/node_$NODE_MAJOR.x" nodistro main
  apt_update_if_needed
  apt_install nodejs
  installed_node_fits || die "Node at $NODE isn't $NODE_MAJOR.$NODE_MINIMUM_MINOR or later after installing it."
}

docker_version() {
  docker_package_version "$1" "$SYSTEM_ID" "$SYSTEM_VERSION_ID" "$SYSTEM_CODENAME"
}

install_docker() {
  if command -v docker >/dev/null; then
    local missing=()
    docker compose version >/dev/null 2>&1 || missing+=("Docker Compose (docker compose)")
    docker buildx version >/dev/null 2>&1 || missing+=("buildx (docker buildx)")
    if ((${#missing[@]} > 0)); then
      local lacking=${missing[0]}
      ((${#missing[@]} > 1)) && lacking+=" and ${missing[1]}"
      die "Docker is installed but lacks $lacking, which run environments need. Install them, or remove this Docker for the installer to put in Docker's own, then run the installer again."
    fi
    step "Docker is installed"
  else
    step "Installing Docker Engine from Docker's repository"
    add_apt_repository docker "https://download.docker.com/linux/$SYSTEM_ID/gpg" "$DOCKER_KEY_FINGERPRINT" \
      "https://download.docker.com/linux/$SYSTEM_ID" "$SYSTEM_CODENAME" stable
    apt_update_if_needed
    apt_install "docker-ce=$(docker_version "$DOCKER_ENGINE_VERSION")" \
      "docker-ce-cli=$(docker_version "$DOCKER_ENGINE_VERSION")" \
      "containerd.io=$(docker_version "$CONTAINERD_VERSION")" \
      "docker-buildx-plugin=$(docker_version "$DOCKER_BUILDX_VERSION")" \
      "docker-compose-plugin=$(docker_version "$DOCKER_COMPOSE_VERSION")"
    # shellcheck disable=SC2086 # the list of packages, split on purpose
    run apt-mark hold $DOCKER_PACKAGES
  fi
  run systemctl enable --now docker
  if ! docker info >>"$LOG" 2>&1; then
    if [[ $IN_CONTAINER == true ]]; then
      die "Docker can't start in this LXC guest. On the Proxmox host run: pct set <id> --features nesting=1,keyctl=1, restart the guest and run the installer again."
    fi
    die "Docker doesn't answer (docker info failed); see $LOG and journalctl -u docker."
  fi
}

CLUSTER_PORT=""

install_postgres() {
  if package_installed "postgresql-$POSTGRES_MAJOR"; then
    step "PostgreSQL $POSTGRES_MAJOR is installed"
  else
    step "Installing PostgreSQL $POSTGRES_MAJOR from the PostgreSQL apt repository (PGDG)"
    add_apt_repository pgdg https://www.postgresql.org/media/keys/ACCC4CF8.asc "$PGDG_KEY_FINGERPRINT" \
      https://apt.postgresql.org/pub/repos/apt "$SYSTEM_CODENAME-pgdg" main
    apt_update_if_needed
    apt_install "postgresql-$POSTGRES_MAJOR"
  fi
  if ! CLUSTER_PORT=$(cluster_port "$(pg_lsclusters --no-header 2>>"$LOG")"); then
    run pg_createcluster "$POSTGRES_MAJOR" main
    CLUSTER_PORT=$(cluster_port "$(pg_lsclusters --no-header)") || die "No PostgreSQL $POSTGRES_MAJOR cluster after creating one."
  fi
  run systemctl enable --now "postgresql@$POSTGRES_MAJOR-main"
}

create_service_user() {
  if getent passwd "$SERVICE_USER" >/dev/null; then
    step "The user $SERVICE_USER exists"
  else
    step "Creating the user $SERVICE_USER"
    run useradd --system --user-group --create-home --home-dir "$SERVICE_HOME" --shell /bin/bash "$SERVICE_USER"
  fi
  run usermod -aG docker "$SERVICE_USER"
}

CURRENT_VERSION=""
REQUESTED_VERSION=""
RELEASE_CHANGED=false

read_current_version() {
  local current
  current=$(root_path "$INSTALL_DIR/current")
  [[ -L $current ]] && CURRENT_VERSION=$(basename "$(readlink "$current")")
  return 0
}

latest_version() {
  local url
  url=$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$(repository)/releases/latest" 2>>"$LOG") ||
    die "The newest release of $(repository) couldn't be read from GitHub."
  parse_version "${url##*/}" || die "GitHub's newest release, ${url##*/}, isn't a version."
}

# The version to install, or nothing when the installed one stays.
version_to_install() {
  if [[ -n $CURRENT_VERSION ]]; then
    [[ -z $REQUESTED_VERSION ]] && return
    case $(compare_versions "$REQUESTED_VERSION" "$CURRENT_VERSION") in
      0) return ;;
      1) echo "$REQUESTED_VERSION" ;;
      -1) die "The Office $CURRENT_VERSION is installed; the installer doesn't go back to the older $REQUESTED_VERSION." ;;
    esac
  elif [[ -n $REQUESTED_VERSION ]]; then
    echo "$REQUESTED_VERSION"
  elif [[ $STAMPED_VERSION != @* ]]; then
    echo "$STAMPED_VERSION"
  else
    latest_version
  fi
}

install_release() {
  local version
  version=$(version_to_install)
  if [[ -z $version ]]; then
    step "The Office $CURRENT_VERSION is installed"
    return
  fi
  step "Installing The Office $version"
  local name download releases unpack top stamp_version
  name=$(tarball_name "$version" "$ARCH")
  download=$WORK_DIR/release
  mkdir -p "$download"
  run curl -fsSL -o "$download/$name" "$(asset_url "$(repository)" "$version" "$name")"
  run curl -fsSL -o "$download/$name.sha256" "$(asset_url "$(repository)" "$version" "$name.sha256")"
  [[ $(awk '{ print $2 }' "$download/$name.sha256") == "$name" ]] || die "$name.sha256 doesn't name $name."
  (cd "$download" && sha256sum --check --quiet "$name.sha256" >>"$LOG" 2>&1) || die "$name doesn't match its sha256."

  releases=$(root_path "$INSTALL_DIR/releases")
  unpack=$releases/.unpack-$version
  run mkdir -p "$releases"
  rm -rf "$unpack"
  run mkdir "$unpack"
  run tar --extract --gzip --no-same-owner --file "$download/$name" --directory "$unpack"
  top=$(find "$unpack" -mindepth 1 -maxdepth 1 -printf '%f\n')
  [[ $top == "the-office-$version" ]] || die "$name holds '$top', not the single folder the-office-$version."
  stamp_version=$(sed -n '/"version"/{s/^.*"version": *"\([^"]*\)".*$/\1/p;q}' "$unpack/$top/office-release.json" 2>/dev/null || true)
  [[ $stamp_version == "$version" ]] || die "$name is stamped '$stamp_version', not $version."
  rm -rf "${releases:?}/$version"
  mv "$unpack/$top" "$releases/$version"
  rmdir "$unpack"

  # Switch in one rename, so `current` is always a whole release.
  local current
  current=$(root_path "$INSTALL_DIR/current")
  ln -sfn "releases/$version" "$current.next"
  mv -T "$current.next" "$current"
  run chown -R "$SERVICE_USER:$SERVICE_USER" "$(root_path "$INSTALL_DIR")"
  CURRENT_VERSION=$version
  RELEASE_CHANGED=true
}

# Checked with the answers, before anything changes: a folder holding someone else's files isn't
# handed to the service user.
check_data_dir_free() {
  local folder owner
  folder=$(root_path "$DATA_DIR")
  [[ -e $folder ]] || return 0
  [[ -d $folder ]] || die "$DATA_DIR isn't a folder; choose another data folder."
  [[ -n $(ls -A "$folder") ]] || return 0
  owner=$(stat -c %U "$folder")
  [[ $owner == "$SERVICE_USER" ]] ||
    die "$DATA_DIR isn't empty and belongs to $owner, not $SERVICE_USER; choose another data folder."
}

prepare_data_dir() {
  local folder
  folder=$(root_path "$DATA_DIR")
  step "Preparing the data folder $DATA_DIR"
  run install -d -m 0750 "$folder"
  run chown "$SERVICE_USER:$SERVICE_USER" "$folder"
}

psql_admin() {
  runuser -u postgres -- psql -X -q -A -t -v ON_ERROR_STOP=1 -p "$CLUSTER_PORT" "$@"
}

random_password() {
  local password=""
  while ((${#password} < 32)); do
    password+=$(head -c 64 /dev/urandom | tr -dc 'A-Za-z0-9')
  done
  echo "${password:0:32}"
}

DATABASE_URL_VALUE=""

prepare_database() {
  step "Preparing the database $DATABASE_NAME"
  local existing_url password="" role_exists
  existing_url=$(env_value "$(root_path "$ENV_FILE")" DATABASE_URL)
  if [[ $existing_url =~ ^postgres://$DATABASE_ROLE:([A-Za-z0-9]+)@127\.0\.0\.1:[0-9]+/$DATABASE_NAME$ ]]; then
    password=${BASH_REMATCH[1]}
  fi
  role_exists=$(psql_admin -c "select 1 from pg_roles where rolname = '$DATABASE_ROLE'" 2>>"$LOG") ||
    die "PostgreSQL doesn't answer on port $CLUSTER_PORT; see $LOG."
  if [[ $role_exists != 1 || -z $password ]]; then
    password=$(random_password)
    local verb=create
    [[ $role_exists == 1 ]] && verb=alter
    # The password goes through stdin, never the command line.
    psql_admin >>"$LOG" 2>&1 <<<"$verb role $DATABASE_ROLE with login password '$password';" ||
      die "The database role $DATABASE_ROLE couldn't be set up; see $LOG."
  fi
  if [[ $(psql_admin -c "select 1 from pg_database where datname = '$DATABASE_NAME'" 2>>"$LOG") != 1 ]]; then
    run psql_admin -c "create database $DATABASE_NAME owner $DATABASE_ROLE"
  fi
  DATABASE_URL_VALUE=postgres://$DATABASE_ROLE:$password@127.0.0.1:$CLUSTER_PORT/$DATABASE_NAME
}

ENV_CHANGED=false

write_env_file() {
  local config env_file text
  config=$(root_path "$CONFIG_DIR")
  env_file=$(root_path "$ENV_FILE")
  install -d -m 0700 "$config"
  chmod 0700 "$config"
  local scratch=$WORK_DIR/office.env
  if [[ -f $env_file ]]; then cp "$env_file" "$scratch"; else : >"$scratch"; fi
  local key value
  for key in OFFICE_HOST OFFICE_PORT OFFICE_DATA_DIR DATABASE_URL; do
    case $key in
      OFFICE_HOST) value=$HOST ;;
      OFFICE_PORT) value=$PORT ;;
      OFFICE_DATA_DIR) value=$DATA_DIR ;;
      DATABASE_URL) value=$DATABASE_URL_VALUE ;;
    esac
    text=$(env_with "$scratch" "$key" "$value")
    printf '%s\n' "$text" >"$scratch"
  done
  if [[ -f $env_file ]] && cmp -s "$scratch" "$env_file"; then
    step "office.env is up to date"
  else
    step "Writing $ENV_FILE"
    install -m 0600 "$scratch" "$env_file"
    ENV_CHANGED=true
  fi
  chmod 0600 "$env_file"
  run chown root:root "$config" "$env_file"
}

UNIT_CHANGED=false

write_unit() {
  local unit
  unit=$(root_path "$UNIT_FILE")
  mkdir -p "$(dirname "$unit")"
  if [[ -f $unit ]] && cmp -s <(unit_text) "$unit"; then
    step "The unit $SERVICE_NAME.service is up to date"
    return
  fi
  step "Writing $UNIT_FILE"
  unit_text >"$unit"
  chmod 0644 "$unit"
  run systemctl daemon-reload
  UNIT_CHANGED=true
}

SETUP_TOKEN=""

# A setup token made before the start, so the service's first start prints none (spec §2.10).
make_setup_token() {
  local -a variables=()
  local line output status=0
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] && variables+=("$line")
  done <"$(root_path "$ENV_FILE")"
  # Exported rather than given to `env`, so the database password stays off the command line, which
  # every user of the machine can read; runuser keeps the environment but HOME, SHELL, USER and LOGNAME.
  output=$(
    export "${variables[@]}"
    runuser -u "$SERVICE_USER" -- "$NODE" \
      "$(root_path "$INSTALL_DIR/current/apps/service/dist/setup-token.js")" --quiet 2>"$WORK_DIR/setup-token.err"
  ) || status=$?
  cat "$WORK_DIR/setup-token.err" >>"$LOG"
  if ((status == 0)); then
    SETUP_TOKEN=$output
  # setup-token exits with 1 for a user that exists, and with 1 for a failure too: its words tell.
  elif ((status == 1)) && grep -q "already has its first user" "$WORK_DIR/setup-token.err"; then
    SETUP_TOKEN=""
  else
    echo "Error: the setup token couldn't be made:" >&2
    cat "$WORK_DIR/setup-token.err" >&2
    exit 1
  fi
}

start_service() {
  run systemctl enable "$SERVICE_NAME"
  if [[ $RELEASE_CHANGED == true || $ENV_CHANGED == true || $UNIT_CHANGED == true ]]; then
    step "Starting The Office"
    run systemctl restart "$SERVICE_NAME"
  else
    step "Checking that The Office runs"
    run systemctl start "$SERVICE_NAME"
  fi
  local url deadline
  url=$(health_url "$HOST" "$PORT")
  deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  while true; do
    if [[ $(curl -fsS --max-time 5 "$url" 2>/dev/null || true) == *'"database":"up"'* ]]; then
      return
    fi
    if ((SECONDS >= deadline)); then
      echo "Error: The Office didn't report its database up at $url within $HEALTH_TIMEOUT_SECONDS seconds. Its log:" >&2
      journalctl -u "$SERVICE_NAME" -n 50 --no-pager >&2 || true
      echo "See all of it with: journalctl -u $SERVICE_NAME" >&2
      exit 1
    fi
    sleep 2
  done
}

print_result() {
  echo
  echo "The Office $CURRENT_VERSION is running."
  echo "Open: $(open_address "$HOST" "$PORT" "$(hostname -I 2>/dev/null || true)")"
  echo
  if [[ -n $SETUP_TOKEN ]]; then
    echo "Setup token: $SETUP_TOKEN"
    echo "Give it to The Office to create the first user. Until a user exists, running the"
    echo "installer again prints a new one, and the earlier one stops working."
  else
    echo "The Office already has its first user: sign in."
    echo "For a lost password, set a new one with:"
    echo "  sudo bash -c 'set -a; . $ENV_FILE; cd $INSTALL_DIR/current && runuser -u $SERVICE_USER -- npm run set-password -- --email <email>'"
  fi
}

cleanup() {
  [[ -n $WORK_DIR ]] && rm -rf "$WORK_DIR"
  return 0
}

APT_SOURCES_CHANGED=false

main() {
  parse_arguments "$@"
  preflight

  LOG=$(root_path "$LOG_FILE")
  mkdir -p "$(dirname "$LOG")"
  echo "--- $(date -u '+%Y-%m-%dT%H:%M:%SZ') install.sh $*" >>"$LOG"
  WORK_DIR=$(mktemp -d)
  trap cleanup EXIT

  open_terminal
  read_current_version
  gather_answers
  confirm

  install_base_packages
  install_node
  install_docker
  install_postgres
  create_service_user
  install_release
  prepare_data_dir
  prepare_database
  write_env_file
  write_unit
  make_setup_token
  start_service
  print_result
}

# Sourced (by the tests), it only defines; a download cut short never reaches this line.
# Piped into bash, the script has no file name; sourced, its file name isn't $0.
if [[ -z ${BASH_SOURCE[0]:-} || ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
