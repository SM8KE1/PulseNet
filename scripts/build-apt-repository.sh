#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 DEB_DIRECTORY OUTPUT_DIRECTORY" >&2
  exit 2
fi

deb_directory="$1"
output_directory="$2"
signing_key="${APT_REPO_SIGNING_KEY:-}"
public_key="${APT_REPO_PUBLIC_KEY:-}"
signing_passphrase="${APT_REPO_SIGNING_KEY_PASSPHRASE:-}"

if [[ -z "$signing_key" || -z "$public_key" ]]; then
  echo "APT_REPO_SIGNING_KEY and APT_REPO_PUBLIC_KEY must be set." >&2
  exit 1
fi
output_directory="$(realpath -m "$output_directory")"
pages_directory="$(dirname "$output_directory")"

mapfile -t packages < <(find "$deb_directory" -maxdepth 1 -type f -name '*.deb' -print | sort)
if [[ ${#packages[@]} -ne 1 ]]; then
  echo "Expected exactly one Debian package in $deb_directory." >&2
  exit 1
fi

package_arch="$(dpkg-deb -f "${packages[0]}" Architecture)"
if [[ "$package_arch" != "amd64" ]]; then
  echo "APT repository currently supports amd64 only; package architecture is $package_arch." >&2
  exit 1
fi

rm -rf "$output_directory"
mkdir -p "$pages_directory"
cat > "$pages_directory/index.html" <<'EOF'
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>PulseNet APT Repository</title></head>
  <body>
    <h1>PulseNet APT Repository</h1>
    <p>Signed APT packages for 64-bit Ubuntu and Debian systems.</p>
    <p>Installation instructions are available in the <a href="https://github.com/SM8KE1/PulseNet#install-from-the-apt-repository">PulseNet README</a>.</p>
  </body>
</html>
EOF
pool_directory="$output_directory/pool/main/p/pulsenet"
distribution_directory="$output_directory/dists/stable/main/binary-amd64"
mkdir -p "$pool_directory" "$distribution_directory"
install -m 0644 "${packages[0]}" "$pool_directory/"
if [[ "$public_key" == *"-----BEGIN PGP PUBLIC KEY BLOCK-----"* ]]; then
  printf '%s\n' "$public_key" > "$output_directory/pulsenet-archive-keyring.asc"
else
  printf '%s' "$public_key" | base64 --decode > "$output_directory/pulsenet-archive-keyring.asc"
fi
gpg --dearmor --yes --output "$output_directory/pulsenet-archive-keyring.gpg" "$output_directory/pulsenet-archive-keyring.asc"
rm "$output_directory/pulsenet-archive-keyring.asc"

pushd "$output_directory" >/dev/null
dpkg-scanpackages --arch amd64 pool /dev/null > dists/stable/main/binary-amd64/Packages
gzip -9n -c "$distribution_directory/Packages" > "$distribution_directory/Packages.gz"

release_file="$output_directory/dists/stable/Release"
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin="PulseNet" \
  -o APT::FTPArchive::Release::Label="PulseNet" \
  -o APT::FTPArchive::Release::Suite="stable" \
  -o APT::FTPArchive::Release::Codename="stable" \
  -o APT::FTPArchive::Release::Architectures="amd64" \
  -o APT::FTPArchive::Release::Components="main" \
  release dists/stable > dists/stable/Release
popd >/dev/null

gnupg_home="$(mktemp -d)"
public_gnupg_home="$(mktemp -d)"
chmod 0700 "$gnupg_home"
chmod 0700 "$public_gnupg_home"
trap 'rm -rf "$gnupg_home" "$public_gnupg_home"' EXIT
if [[ "$signing_key" == *"-----BEGIN PGP PRIVATE KEY BLOCK-----"* ]]; then
  printf '%s\n' "$signing_key" > "$gnupg_home/private.asc"
else
  printf '%s' "$signing_key" | base64 --decode > "$gnupg_home/private.asc"
fi
gpg --batch --homedir "$gnupg_home" --import "$gnupg_home/private.asc" >/dev/null 2>&1
signing_fingerprint="$(gpg --batch --homedir "$gnupg_home" --with-colons --list-secret-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
if [[ -z "$signing_fingerprint" ]]; then
  echo "No signing key was imported." >&2
  exit 1
fi
gpg --batch --homedir "$public_gnupg_home" --import "$output_directory/pulsenet-archive-keyring.gpg" >/dev/null 2>&1
public_fingerprint="$(gpg --batch --homedir "$public_gnupg_home" --with-colons --list-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
if [[ "$signing_fingerprint" != "$public_fingerprint" ]]; then
  echo "APT_REPO_SIGNING_KEY and APT_REPO_PUBLIC_KEY do not match." >&2
  exit 1
fi

signing_options=(--batch --yes --homedir "$gnupg_home" --local-user "$signing_fingerprint")
if [[ -n "$signing_passphrase" ]]; then
  passphrase_file="$gnupg_home/passphrase"
  printf '%s' "$signing_passphrase" > "$passphrase_file"
  chmod 0600 "$passphrase_file"
  signing_options+=(--pinentry-mode loopback --passphrase-file "$passphrase_file")
fi

gpg "${signing_options[@]}" \
  --clearsign --output "$output_directory/dists/stable/InRelease" "$release_file"
gpg "${signing_options[@]}" \
  --armor --detach-sign --output "$output_directory/dists/stable/Release.gpg" "$release_file"

echo "Signed APT repository written to $output_directory"
