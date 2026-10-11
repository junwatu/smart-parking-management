#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${project_dir}/.build/python_client"
griddb_version="5.9.0"
arrow_version="17.0.0"
python_client_ref="32f2b0133515383ce74dcc1d644d7fbae7fda87c"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required: https://brew.sh" >&2
  exit 1
fi

brew install openjdk@21 maven

java_prefix="$(brew --prefix openjdk@21)"
export JAVA_HOME="${java_prefix}/libexec/openjdk.jdk/Contents/Home"
export PATH="${JAVA_HOME}/bin:${PATH}"

python_bin="$(command -v python3.12 || command -v python3)"
"${python_bin}" -m venv "${project_dir}/.venv"
"${project_dir}/.venv/bin/python" -m pip install --upgrade pip setuptools wheel
"${project_dir}/.venv/bin/python" -m pip install jpype1 pyarrow

mkdir -p "${project_dir}/.build" "${project_dir}/lib"
if [[ ! -d "${source_dir}/.git" ]]; then
  git clone --depth 1 https://github.com/griddb/python_client.git "${source_dir}"
fi
git -C "${source_dir}" fetch --depth 1 origin "${python_client_ref}"
git -C "${source_dir}" checkout --detach "${python_client_ref}"

mvn -f "${source_dir}/java/pom.xml" install -DskipTests
"${project_dir}/.venv/bin/python" -m pip install \
  --no-build-isolation "${source_dir}/python"

cp "${HOME}/.m2/repository/com/github/griddb/gridstore/${griddb_version}/gridstore-${griddb_version}.jar" \
  "${project_dir}/lib/gridstore.jar"
cp "${source_dir}/java/target/gridstore-arrow-${griddb_version}.jar" \
  "${project_dir}/lib/gridstore-arrow.jar"
curl -fL \
  "https://repo.maven.apache.org/maven2/org/apache/arrow/arrow-memory-netty/${arrow_version}/arrow-memory-netty-${arrow_version}.jar" \
  -o "${project_dir}/lib/arrow-memory-netty.jar"

cd "${project_dir}"
npm install --ignore-scripts

echo
echo "Public dependencies are installed."
if [[ ! -f "${project_dir}/lib/gridstore-advanced.jar" ]]; then
  echo "Manual Cloud step still required:"
  echo "  1. In GridDB Cloud, open Help / Downloads / Support."
  echo "  2. Download the GridDB Cloud Library and Plugin RPM."
  echo "  3. Extract gridstore-advanced.jar and copy it to:"
  echo "     ${project_dir}/lib/gridstore-advanced.jar"
  echo "  4. From apps/, run: npm run doctor"
else
  echo "From apps/, run: npm run doctor"
fi
