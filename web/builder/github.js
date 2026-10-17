// The builder's way to git: files read from and committed to a GitHub repository through its REST
// API, from the browser, with a personal access token (fine-grained, "Contents: read and write" on
// the one repository). A push puts all its files into one commit on the branch (main), on top of
// what is there now; a file that was changed on GitHub since it was opened here is not overwritten
// unless asked. No DOM here: tested in Node with a fetch of its own.

const API = "https://api.github.com";

/** Base64 of bytes (Uint8Array) or of a text (UTF-8). */
export function toBase64(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A text (UTF-8) from base64, as GitHub sends file contents (with line breaks). */
export function fromBase64(b64) {
  const s = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** A request GitHub refused or that could not be made, with what to tell the person. */
export class GitHubError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, kind?: string}} [info] kind: "token", "access", "missing", "conflict", "network", "other"
   */
  constructor(message, { status = 0, kind = "other" } = {}) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.kind = kind;
  }
}

export class GitHub {
  /**
   * @param {{owner: string, repo: string, branch?: string, token?: string, fetch?: typeof fetch}} options
   */
  constructor({ owner, repo, branch = "main", token = "", fetch: f = globalThis.fetch?.bind(globalThis) }) {
    Object.assign(this, { owner, repo, branch, token });
    this._fetch = f;
  }

  /** The repository as owner/repo. */
  get name() {
    return `${this.owner}/${this.repo}`;
  }

  async _request(method, path, body) {
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await this._fetch(`${API}/repos/${this.owner}/${this.repo}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    } catch (err) {
      throw new GitHubError(`GitHub cannot be reached: ${err.message}`, { kind: "network" });
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.ok) return data;
    const why = data?.message || res.statusText || "";
    if (res.status === 401) throw new GitHubError("GitHub did not accept the token. Check it, or make a new one.", { status: 401, kind: "token" });
    if (res.status === 403 && /rate limit/i.test(why)) throw new GitHubError("Too many requests to GitHub without a token. Connect with a token, or wait an hour.", { status: 403, kind: "access" });
    if (res.status === 403 || (res.status === 404 && this.token && method !== "GET")) throw new GitHubError(`The token may not write to ${this.name}: give it “Contents: read and write” on this repository. (${why})`, { status: res.status, kind: "access" });
    if (res.status === 404) throw new GitHubError(`Not found on GitHub: ${path}`, { status: 404, kind: "missing" });
    if (res.status === 409 || res.status === 422) throw new GitHubError(why || "GitHub refused the change.", { status: res.status, kind: "conflict" });
    throw new GitHubError(`GitHub answered ${res.status}: ${why}`, { status: res.status });
  }

  /** Who the token belongs to and whether it may push here: {login, push}. */
  async check() {
    const repo = await this._request("GET", "");
    return { name: repo.full_name, push: !!repo.permissions?.push, branch: repo.default_branch };
  }

  /** The commit the branch is at now. */
  async head() {
    const ref = await this._request("GET", `/git/ref/heads/${encodeURIComponent(this.branch)}`);
    return ref.object.sha;
  }

  /**
   * A text file of the branch: {text, sha} (sha: of its contents, to tell later whether it was changed).
   * @param {string} path from the root of the repository
   */
  async readText(path) {
    const f = await this._request("GET", `/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`);
    if (Array.isArray(f) || f.type !== "file") throw new GitHubError(`${path} is not a file.`, { kind: "missing" });
    if (f.content || !f.git_url) return { text: fromBase64(f.content || ""), sha: f.sha };
    // larger than 1 MB: from its blob
    const blob = await this._request("GET", `/git/blobs/${f.sha}`);
    return { text: fromBase64(blob.content), sha: f.sha };
  }

  /** The files of a folder of the branch: [{name, path, sha, type}]. */
  async list(path) {
    const items = await this._request("GET", `/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`);
    return (Array.isArray(items) ? items : []).map(({ name, path: p, sha, type }) => ({ name, path: p, sha, type }));
  }

  /** The sha of the contents of each file asked for in a tree (of a commit), null where there is no such file. */
  async shasAt(treeSha, paths) {
    const tree = await this._request("GET", `/git/trees/${treeSha}?recursive=1`);
    const byPath = new Map((tree.tree || []).filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
    return Object.fromEntries(paths.map((p) => [p, byPath.get(p) ?? null]));
  }

  /**
   * Commit files to the branch in one commit, on top of what it has now.
   * @param {Array<{path: string, content: string | Uint8Array, base?: string | null}>} files
   *   content: a text (UTF-8) or bytes; base: the sha of the file as it was opened (null: a new
   *   file, undefined: not checked). A file changed on GitHub since then stops the push
   *   (kind "conflict", `changed` lists the paths), unless `overwrite`.
   * @param {string} message
   * @param {{overwrite?: boolean}} [options]
   * @returns {Promise<{commit: string, url: string, files: Object<string, string>}>} files: the new sha of each
   */
  async commit(files, message, { overwrite = false } = {}) {
    if (!this.token) throw new GitHubError("Connect to GitHub with a token first.", { kind: "token" });
    if (!files.length) throw new GitHubError("Nothing to push.", { kind: "other" });
    const blobs = [];
    for (const f of files) {
      const blob = await this._request("POST", "/git/blobs", { content: toBase64(f.content), encoding: "base64" });
      blobs.push({ path: f.path, sha: blob.sha });
    }
    // the branch may move while this runs (CI, another push): then once more on top of the new one
    for (let attempt = 0; attempt < 3; attempt++) {
      const parent = await this.head();
      const base = await this._request("GET", `/git/commits/${parent}`);
      const checked = files.filter((f) => f.base !== undefined);
      if (checked.length && !overwrite) {
        const now = await this.shasAt(base.tree.sha, checked.map((f) => f.path));
        const changed = checked.filter((f) => now[f.path] !== (f.base ?? null) && now[f.path] !== blobs.find((b) => b.path === f.path).sha).map((f) => f.path);
        if (changed.length) {
          const err = new GitHubError(`Changed on GitHub since you opened it: ${changed.join(", ")}.`, { kind: "conflict" });
          err.changed = changed;
          throw err;
        }
      }
      const tree = await this._request("POST", "/git/trees", { base_tree: base.tree.sha, tree: blobs.map((b) => ({ path: b.path, mode: "100644", type: "blob", sha: b.sha })) });
      const commit = await this._request("POST", "/git/commits", { message, tree: tree.sha, parents: [parent] });
      try {
        await this._request("PATCH", `/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: commit.sha, force: false });
      } catch (err) {
        if (err.kind === "conflict" && attempt < 2) continue; // not a fast forward: the branch moved
        throw err;
      }
      return { commit: commit.sha, url: commit.html_url || `https://github.com/${this.name}/commit/${commit.sha}`, files: Object.fromEntries(blobs.map((b) => [b.path, b.sha])) };
    }
    throw new GitHubError("The branch kept moving; try again.", { kind: "conflict" });
  }
}

/** A path of the repository for a URL: each part encoded, the slashes kept. */
function encodePath(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}
