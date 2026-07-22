import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliPath = path.join(projectRoot, "index-incremental.js");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createRemote(root, name, files) {
  const sourcePath = path.join(root, `${name}-source`);
  const remotePath = path.join(root, `${name}.git`);
  fs.mkdirSync(sourcePath, { recursive: true });
  git(sourcePath, "init", "-q");
  git(sourcePath, "config", "user.name", "fixture-user");
  git(sourcePath, "config", "user.email", "fixture@example.com");

  for (const [filePath, content] of Object.entries(files)) {
    const absolutePath = path.join(sourcePath, filePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }

  git(sourcePath, "add", ".");
  git(sourcePath, "commit", "-qm", "initial");
  git(sourcePath, "branch", "-M", "main");
  git(root, "clone", "-q", "--bare", sourcePath, remotePath);
  git(remotePath, "symbolic-ref", "HEAD", "refs/heads/main");
  return remotePath;
}

test("预存的非 Git 临时目录不会把分支创建到业务项目", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mergeintoorigin-test-"));

  try {
    const parentRemote = createRemote(root, "parent", {
      ".gitignore": "linshi_nodejs_maingit/\n",
      "tracked.txt": "parent\n",
    });
    const targetRemote = createRemote(root, "target", {
      "opd/r-app/index.html": "<html>old.js</html>\n",
      "opd/r-app/old.js": "old\n",
    });
    const businessProject = path.join(root, "business-project");
    git(root, "clone", "-q", parentRemote, businessProject);

    const sourceFolder = path.join(root, "dist");
    fs.mkdirSync(sourceFolder);
    fs.writeFileSync(path.join(sourceFolder, "index.html"), "<html>new-hash.js</html>\n");
    fs.writeFileSync(path.join(sourceFolder, "new-hash.js"), "new\n");

    const staleRepoPath = path.join(businessProject, "linshi_nodejs_maingit", "target");
    fs.mkdirSync(staleRepoPath, { recursive: true });

    const gitConfigPath = path.join(root, "gitconfig");
    fs.writeFileSync(gitConfigPath, "[user]\n\tname = fixture-user\n\temail = fixture@example.com\n");

    const result = spawnSync(process.execPath, [
      cliPath,
      `--repoUrl=${targetRemote}`,
      "--baseBranch=main",
      "--targetFolder=opd/r-app",
      `--sourceFolder=${sourceFolder}`,
      "--buildCmd=true",
    ], {
      cwd: businessProject,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: gitConfigPath },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(git(businessProject, "branch", "--show-current"), "main");

    const targetBranches = git(targetRemote, "for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n");
    assert.equal(targetBranches.length, 2, `目标仓库分支异常：${targetBranches.join(", ")}\n${result.stdout}\n${result.stderr}`);
    const releaseBranch = targetBranches.find((branchName) => branchName !== "main");
    assert.equal(git(targetRemote, "show", `${releaseBranch}:opd/r-app/index.html`), "<html>new-hash.js</html>");
    assert.equal(git(targetRemote, "show", `${releaseBranch}:opd/r-app/new-hash.js`), "new");
    assert.equal(git(targetRemote, "show", `${releaseBranch}:opd/r-app/old.js`), "old");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
