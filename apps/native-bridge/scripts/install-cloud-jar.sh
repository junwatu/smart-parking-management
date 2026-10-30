#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/gridstore-advanced.jar-or-GridDB-Cloud-RPM" >&2
  exit 1
fi

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
input_file="$1"
destination="${project_dir}/lib/gridstore-advanced.jar"
if [[ ! -f "${input_file}" ]]; then
  echo "File not found: ${input_file}" >&2
  exit 1
fi

mkdir -p "${project_dir}/lib"
case "${input_file}" in
  *.jar)
    cp "${input_file}" "${destination}"
    ;;
  *.rpm)
    input_file="$(cd -- "$(dirname -- "${input_file}")" && pwd)/$(basename -- "${input_file}")"
    extract_dir="$(mktemp -d "${TMPDIR:-/tmp}/griddb-cloud.XXXXXX")"
    trap 'rm -rf "${extract_dir}"' EXIT
    if command -v bsdtar >/dev/null 2>&1; then
      bsdtar -xf "${input_file}" -C "${extract_dir}"
    elif command -v rpm2cpio >/dev/null 2>&1 && command -v cpio >/dev/null 2>&1; then
      (cd "${extract_dir}" && rpm2cpio "${input_file}" | cpio -idm --quiet)
    else
      echo "RPM extraction requires bsdtar or both rpm2cpio and cpio." >&2
      exit 1
    fi
    # The unversioned file can be an absolute symlink; select a real file.
    cloud_jar="$(find "${extract_dir}" -type f \( -name gridstore-advanced.jar -o -name 'gridstore-advanced-*.jar' \) -print -quit)"
    if [[ -z "${cloud_jar}" ]]; then
      echo "GridDB Cloud JAR not found in ${input_file}" >&2
      exit 1
    fi
    cp "${cloud_jar}" "${destination}"
    ;;
  *)
    echo "Expected a .jar or .rpm file: ${input_file}" >&2
    exit 1
    ;;
esac

echo "Installed ${destination}"
echo "From apps/, run npm run doctor to check the remaining prerequisites."
