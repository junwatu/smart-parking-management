import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const workerPath = fileURLToPath(
  new URL("../python/griddb_worker.py", import.meta.url),
);
const projectPython = process.platform === 'win32'
  ? join(projectRoot, '.venv', 'Scripts', 'python.exe')
  : join(projectRoot, '.venv', 'bin', 'python');

function workerEnvironment() {
  const env = { ...process.env };

  if (process.platform === "darwin" && !env.JAVA_HOME) {
    const prefixes = process.arch === "arm64"
      ? ["/opt/homebrew"]
      : ["/usr/local", "/opt/homebrew"];
    const javaHome = prefixes
      .map((prefix) => join(
        prefix,
        "opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
      ))
      .find(existsSync);
    if (javaHome) env.JAVA_HOME = javaHome;
  }

  const arrowOpen = "--add-opens=java.base/java.nio=ALL-UNNAMED";
  if (!env.JAVA_TOOL_OPTIONS?.includes("java.base/java.nio")) {
    env.JAVA_TOOL_OPTIONS = [env.JAVA_TOOL_OPTIONS, arrowOpen]
      .filter(Boolean)
      .join(" ");
  }

  return env;
}

export class GridDBClient {
  #child;
  #nextId = 1;
  #pending = new Map();
  #closed = false;
  #timeoutMs;
  #failure;

  constructor({
    python = process.env.PYTHON_BIN
      || (existsSync(projectPython) ? projectPython : "python3"),
    timeoutMs = Number(process.env.GRIDDB_REQUEST_TIMEOUT_MS || 30_000),
  } = {}) {
    this.#timeoutMs = timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid GridDB timeout');
    const interpreter = python.includes('/') || python.includes('\\') ? resolve(projectRoot, python) : python;
    this.#child = spawn(interpreter, [workerPath], {
      env: workerEnvironment(),
      stdio: ["pipe", "pipe", "inherit"],
    });

    const lines = createInterface({ input: this.#child.stdout });
    lines.on("line", (line) => this.#handleLine(line));

    this.#child.once("error", (error) => this.#failAll(error));
    this.#child.stdin.on('error', error => this.#failAll(error));
    this.#child.once("exit", (code, signal) => {
      if (!this.#closed) {
        this.#failAll(
          new Error(
            `GridDB worker exited unexpectedly (code=${code}, signal=${signal})`,
          ),
        );
      }
    });
  }

  async ready() {
    return this.request("ready");
  }

  async query(container, tql) {
    return this.request("query", { container, tql });
  }

  async get(container, key) {
    return this.request("get", { container, key });
  }

  async put(container, row) {
    return this.request("put", { container, row });
  }

  request(operation, payload = {}) {
    if (this.#failure) return Promise.reject(this.#failure);
    if (this.#closed) {
      return Promise.reject(new Error("GridDB client is closed"));
    }

    const id = this.#nextId++;
    const message = JSON.stringify({ ...payload, id, operation });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`GridDB operation ${operation} timed out; the write outcome may be unknown. Restart the API and reconcile sessions before retrying.`);
        this.#failAll(error);
        this.#child.kill('SIGKILL');
      }, this.#timeoutMs);

      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(`${message}\n`, (error) => {
        if (!error) return;
        const pending = this.#pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        pending.reject(error);
      });
    });
  }

  async close() {
    if (this.#closed) return;

    try {
      if (!this.#failure) await this.request("close");
    } finally {
      this.#closed = true;
      this.#child.stdin.end();
      const killTimer = setTimeout(() => this.#child.kill('SIGKILL'), 1000);
      killTimer.unref();
      this.#child.once('exit', () => clearTimeout(killTimer));
    }
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.#failAll(new Error(`Invalid response from GridDB worker: ${line}`));
      return;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.#pending.delete(message.id);

    if (message.ok) {
      pending.resolve(message.result);
    } else {
      const error = new Error(message.error?.message || "GridDB request failed");
      error.name = message.error?.type || "GridDBError";
      error.details = message.error;
      pending.reject(error);
    }
  }

  #failAll(error) {
    this.#failure = error;
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.#pending.clear();
  }
}
