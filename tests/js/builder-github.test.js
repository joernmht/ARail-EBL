// The builder's GitHub client (web/builder/github.js) against a small GitHub in memory: reading
// files, one commit for all files of a push, a file changed on GitHub meanwhile, a branch that
// moved, a token that may not write.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { GitHub, fromBase64, toBase64 } from "../../web/builder/github.js";

const sha = (s) => createHash("sha1").update(s).digest("hex");

/** A repository with one branch, as far as the client uses GitHub's API. */
function fakeGitHub({ files = {}, push = true, token = "good" } = {}) {
  const blobs = new Map(), trees = new Map(), commits = new Map();
  const putBlob = (b64) => {
    const s = sha(`blob:${b64}`);
    blobs.set(s, b64);
    return s;
  };
  const putTree = (entries) => {
    const s = sha(`tree:${JSON.stringify([...entries].sort())}`);
    trees.set(s, new Map(entries));
    return s;
  };
  const putCommit = (tree, parents, message) => {
    const s = sha(`commit:${tree}:${parents}:${message}:${commits.size}`);
    commits.set(s, { tree, parents, message });
    return s;
  };
  const first = putCommit(putTree(Object.entries(files).map(([p, text]) => [p, putBlob(toBase64(text))])), [], "first");
  const repo = { ref: first, calls: [], blobs, trees, commits, onPatch: null };
  repo.fileAt = (path) => {
    const b = trees.get(commits.get(repo.ref).tree).get(path);
    return b ? fromBase64(blobs.get(b)) : null;
  };
  repo.change = (path, text) => {
    const t = new Map(trees.get(commits.get(repo.ref).tree));
    t.set(path, putBlob(toBase64(text)));
    repo.ref = putCommit(putTree([...t]), [repo.ref], "someone else");
  };
  repo.fetch = async (url, { method = "GET", headers = {}, body } = {}) => {
    const path = url.replace("https://api.github.com/repos/o/r", "");
    repo.calls.push(`${method} ${path}`);
    const reply = (status, data) => ({ ok: status < 300, status, statusText: "", json: async () => data });
    if (headers.Authorization && headers.Authorization !== `Bearer ${token}`) return reply(401, { message: "Bad credentials" });
    const b = body ? JSON.parse(body) : null;
    if (method === "GET" && path === "") return reply(200, { full_name: "o/r", default_branch: "main", permissions: { push: !!headers.Authorization && push } });
    if (method === "GET" && path === "/git/ref/heads/main") return reply(200, { object: { sha: repo.ref } });
    let m;
    if (method === "GET" && (m = path.match(/^\/contents\/(.+)\?ref=main$/))) {
      const p = decodeURIComponent(m[1]), t = trees.get(commits.get(repo.ref).tree);
      if (t.has(p)) return reply(200, { type: "file", sha: t.get(p), content: blobs.get(t.get(p)), git_url: "x" });
      const dir = [...t.keys()].filter((k) => k.startsWith(`${p}/`)).map((k) => ({ name: k.slice(p.length + 1), path: k, sha: t.get(k), type: "file" }));
      return dir.length ? reply(200, dir) : reply(404, { message: "Not Found" });
    }
    if (method === "GET" && (m = path.match(/^\/git\/commits\/(\w+)$/))) return reply(200, { sha: m[1], tree: { sha: commits.get(m[1]).tree } });
    if (method === "GET" && (m = path.match(/^\/git\/trees\/(\w+)\?recursive=1$/))) {
      if (!trees.has(m[1])) return reply(404, { message: "Not Found" });
      return reply(200, { tree: [...trees.get(m[1])].map(([p, s]) => ({ path: p, sha: s, type: "blob" })) });
    }
    if (!push) return reply(403, { message: "Resource not accessible by personal access token" });
    if (method === "POST" && path === "/git/blobs") return reply(201, { sha: putBlob(b.content) });
    if (method === "POST" && path === "/git/trees") {
      const t = new Map(trees.get(b.base_tree));
      for (const e of b.tree) t.set(e.path, e.sha);
      return reply(201, { sha: putTree([...t]) });
    }
    if (method === "POST" && path === "/git/commits") return reply(201, { sha: putCommit(b.tree, b.parents, b.message) });
    if (method === "PATCH" && path === "/git/refs/heads/main") {
      repo.onPatch?.();
      if (commits.get(b.sha).parents[0] !== repo.ref) return reply(422, { message: "Update is not a fast forward" });
      repo.ref = b.sha;
      return reply(200, { object: { sha: b.sha } });
    }
    return reply(404, { message: `no route ${method} ${path}` });
  };
  return repo;
}

test("base64 both ways, text in UTF-8 and bytes", () => {
  assert.equal(fromBase64(toBase64("Straße → Bf Neustadt")), "Straße → Bf Neustadt");
  assert.equal(toBase64(new Uint8Array([0, 255, 128])), "AP+A");
  const big = new Uint8Array(100_000).map((_, i) => i % 251);
  assert.equal(Buffer.from(toBase64(big), "base64").equals(Buffer.from(big)), true);
});

test("reads a file and a folder of the branch, and whether the token may push", async () => {
  const repo = fakeGitHub({ files: { "web/layouts/a.json": '{"name":"Ä"}', "web/layouts/b.json": "{}" } });
  const gh = new GitHub({ owner: "o", repo: "r", token: "good", fetch: repo.fetch });
  const { text, sha: s } = await gh.readText("web/layouts/a.json");
  assert.equal(JSON.parse(text).name, "Ä");
  assert.match(s, /^[0-9a-f]{40}$/);
  assert.deepEqual((await gh.list("web/layouts")).map((f) => f.name), ["a.json", "b.json"]);
  assert.deepEqual(await gh.check(), { name: "o/r", push: true, branch: "main" });
});

test("a push is one commit with all its files, on top of the branch", async () => {
  const repo = fakeGitHub({ files: { "web/layouts/a.json": "{}", "README.md": "hi" } });
  const gh = new GitHub({ owner: "o", repo: "r", token: "good", fetch: repo.fetch });
  const { sha: base } = await gh.readText("web/layouts/a.json");
  const before = repo.ref;
  const photo = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const res = await gh.commit([
    { path: "web/layouts/a.json", content: '{"name":"new"}', base },
    { path: "web/media/a-covered.png", content: photo, base: null },
  ], "Builder: streets of A");
  assert.equal(repo.ref, res.commit);
  assert.deepEqual(repo.commits.get(res.commit).parents, [before]);
  assert.equal(repo.commits.get(res.commit).message, "Builder: streets of A");
  assert.equal(repo.fileAt("web/layouts/a.json"), '{"name":"new"}');
  assert.equal(repo.fileAt("README.md"), "hi"); // the rest of the tree is kept
  assert.deepEqual([...Buffer.from(repo.blobs.get(res.files["web/media/a-covered.png"]), "base64")], [...photo]);
  assert.equal(repo.calls.filter((c) => c.startsWith("PATCH")).length, 1);
});

test("a file changed on GitHub since it was opened is not overwritten, unless asked", async () => {
  const repo = fakeGitHub({ files: { "web/layouts/a.json": "{}" } });
  const gh = new GitHub({ owner: "o", repo: "r", token: "good", fetch: repo.fetch });
  const { sha: base } = await gh.readText("web/layouts/a.json");
  repo.change("web/layouts/a.json", '{"by":"someone"}');
  await assert.rejects(gh.commit([{ path: "web/layouts/a.json", content: '{"by":"me"}', base }], "mine"),
    (err) => err.kind === "conflict" && err.changed[0] === "web/layouts/a.json");
  assert.equal(repo.fileAt("web/layouts/a.json"), '{"by":"someone"}');
  await gh.commit([{ path: "web/layouts/a.json", content: '{"by":"me"}', base }], "mine", { overwrite: true });
  assert.equal(repo.fileAt("web/layouts/a.json"), '{"by":"me"}');
  // a new file that someone else added meanwhile is a conflict too
  repo.change("web/layouts/new.json", "{}");
  await assert.rejects(gh.commit([{ path: "web/layouts/new.json", content: "[]", base: null }], "new"), (err) => err.kind === "conflict");
});

test("when the branch moves during a push (another file), the commit goes on top of the new one", async () => {
  const repo = fakeGitHub({ files: { "web/layouts/a.json": "{}", "x.txt": "1" } });
  const gh = new GitHub({ owner: "o", repo: "r", token: "good", fetch: repo.fetch });
  const { sha: base } = await gh.readText("web/layouts/a.json");
  let once = true;
  repo.onPatch = () => {
    if (once) repo.change("x.txt", "2");
    once = false;
  };
  await gh.commit([{ path: "web/layouts/a.json", content: '{"v":2}', base }], "mine");
  assert.equal(repo.fileAt("web/layouts/a.json"), '{"v":2}');
  assert.equal(repo.fileAt("x.txt"), "2"); // the other change is kept
  assert.equal(repo.calls.filter((c) => c.startsWith("PATCH")).length, 2);
});

test("a wrong token, a token that may not write, no token: the error says what to do", async () => {
  const repo = fakeGitHub({ files: { "a.json": "{}" }, push: false });
  await assert.rejects(new GitHub({ owner: "o", repo: "r", token: "bad", fetch: repo.fetch }).readText("a.json"), (err) => err.kind === "token" && /token/.test(err.message));
  const gh = new GitHub({ owner: "o", repo: "r", token: "good", fetch: repo.fetch });
  assert.equal((await gh.check()).push, false);
  await assert.rejects(gh.commit([{ path: "a.json", content: "[]" }], "x"), (err) => err.kind === "access" && /Contents: read and write/.test(err.message));
  await assert.rejects(new GitHub({ owner: "o", repo: "r", fetch: repo.fetch }).commit([{ path: "a.json", content: "[]" }], "x"), (err) => err.kind === "token");
  const offline = new GitHub({ owner: "o", repo: "r", token: "good", fetch: async () => { throw new Error("offline"); } });
  await assert.rejects(offline.head(), (err) => err.kind === "network");
});
