import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import minimist from "minimist";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = minimist(process.argv.slice(2), {
  string: ["repoUrl", "targetFolder", "sourceFolder", "buildCmd", "baseBranch"],
});

function checkArgs(requiredArgs) {
  let missing = [];
  for (const key of requiredArgs) {
    if (!args[key]) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    console.error(`以下参数必须显式传递，缺失：${missing.join(", ")}\n` + `示例：node ./node_modules/mergeintoorigin/index-incremental.js --repoUrl=xxx --targetFolder=xxx --sourceFolder=xxx --buildCmd="npm run build" --baseBranch=main`);
    process.exit(1);
  }
}

const requiredArgs = ["repoUrl", "targetFolder", "sourceFolder", "buildCmd", "baseBranch"];
checkArgs(requiredArgs);

const giteeRepoUrl = args.repoUrl;
let giturlSplit = giteeRepoUrl.split(".git")[0].split("/");
const repoName = giturlSplit[giturlSplit.length - 1];

const targetFolder = args.targetFolder;
const sourceFolder = args.sourceFolder;
const buildCmd = args.buildCmd;
const baseBranch = args.baseBranch;

const currentDir = process.cwd();
const nodejsDir = path.join(currentDir, "linshi_nodejs_maingit");
if (!fs.existsSync(nodejsDir)) {
  fs.mkdirSync(nodejsDir);
}
const repoPath = path.join(nodejsDir, repoName);

function isSafeToDelete(p) {
  if (!p) return false;
  if (p === "/" || p.length < 10) return false;
  if (!path.isAbsolute(p)) return false;
  if (!p.startsWith(nodejsDir)) return false;
  return true;
}

function execPromise(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject(error + "\n" + stderr);
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * 增量复制文件夹
 * - 保留目标文件夹中已有的文件（不删除旧文件）
 * - 如果源文件夹中有同名文件，则覆盖目标文件夹中的文件
 * - index.html 始终使用新版本
 * @param {string} srcDir 源目录
 * @param {string} destDir 目标目录
 */
function incrementalCopy(srcDir, destDir) {
  // 确保目标目录存在
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const items = fs.readdirSync(srcDir);
  let copiedFiles = 0;
  let skippedFiles = 0;
  let overwrittenFiles = 0;

  for (const item of items) {
    const srcPath = path.join(srcDir, item);
    const destPath = path.join(destDir, item);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      // 递归处理子目录
      const result = incrementalCopy(srcPath, destPath);
      copiedFiles += result.copiedFiles;
      skippedFiles += result.skippedFiles;
      overwrittenFiles += result.overwrittenFiles;
    } else {
      // 处理文件
      const destExists = fs.existsSync(destPath);

      // index.html 必须覆盖，其他文件如果存在则检查是否需要覆盖
      if (item === "index.html") {
        // index.html 始终使用新版本
        fs.copyFileSync(srcPath, destPath);
        if (destExists) {
          overwrittenFiles++;
          console.log(`[覆盖] index.html (入口文件必须更新)`);
        } else {
          copiedFiles++;
          console.log(`[新增] index.html`);
        }
      } else if (destExists) {
        // 同名文件存在，用新的覆盖
        fs.copyFileSync(srcPath, destPath);
        overwrittenFiles++;
        console.log(`[覆盖] ${item}`);
      } else {
        // 新文件，直接复制
        fs.copyFileSync(srcPath, destPath);
        copiedFiles++;
        console.log(`[新增] ${item}`);
      }
    }
  }

  return { copiedFiles, skippedFiles, overwrittenFiles };
}

async function buildAndClone() {
  const buildPromise = execPromise(buildCmd);
  let clonePromise;
  if (fs.existsSync(repoPath)) {
    console.log("主要仓库文件夹已存在");
    clonePromise = Promise.resolve();
  } else {
    console.log(`主要仓库文件夹不存在，克隆主git仓库${giteeRepoUrl}`);
    clonePromise = execPromise(`git clone ${giteeRepoUrl} ${repoPath}`);
  }
  await Promise.all([buildPromise, clonePromise]);
}

async function pushToParentGit() {
  try {
    if (!isSafeToDelete(repoPath)) {
      throw new Error(`repoPath 不安全: ${repoPath}`);
    }
    process.chdir(repoPath);

    await execPromise(`git checkout ${baseBranch} && git pull`);

    const gitUserName = (await execPromise("git config user.name")).trim();

    const getFormattedDate = () => {
      const currentDate = new Date();
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, "0");
      const day = String(currentDate.getDate()).padStart(2, "0");
      const hours = String(currentDate.getHours()).padStart(2, "0");
      const minutes = String(currentDate.getMinutes()).padStart(2, "0");
      const seconds = String(currentDate.getSeconds()).padStart(2, "0");
      return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
    };

    const currentDate = getFormattedDate();
    const outerFolderName = path.basename(currentDir);
    const newBranchName = `${gitUserName}-${currentDate}-${outerFolderName}`;

    await execPromise(`git checkout -b ${newBranchName}`);

    // 绝对路径处理
    const sourceFolderAbs = path.isAbsolute(sourceFolder) ? sourceFolder : path.resolve(currentDir, sourceFolder);

    const targetFolderPath = path.join(repoPath, targetFolder);

    // 校验目录存在且不为空
    if (!fs.existsSync(sourceFolderAbs)) {
      throw new Error(`sourceFolder 目录不存在: ${sourceFolderAbs}`);
    }
    const files = fs.readdirSync(sourceFolderAbs);
    if (files.length === 0) {
      throw new Error(`sourceFolder 目录为空: ${sourceFolderAbs}`);
    }

    if (!fs.existsSync(targetFolderPath)) {
      fs.mkdirSync(targetFolderPath, { recursive: true });
    }

    // ========== 核心变化：使用增量复制替代全量替换 ==========
    // 旧逻辑（全量替换，会导致旧文件被删除，用户访问404）:
    // await execPromise(`rm -rf ${targetFolderPath}/*`);
    // await execPromise(`cp -r ${sourceFolderAbs}/* ${targetFolderPath}`);

    // 新逻辑（增量复制）:
    // - 保留旧文件
    // - 同名文件用新的覆盖
    // - index.html 必须更新
    console.log("\n========== 开始增量复制 ==========");
    console.log(`源目录: ${sourceFolderAbs}`);
    console.log(`目标目录: ${targetFolderPath}`);
    console.log("");

    const copyResult = incrementalCopy(sourceFolderAbs, targetFolderPath);

    console.log("\n========== 增量复制完成 ==========");
    console.log(`新增文件: ${copyResult.copiedFiles}`);
    console.log(`覆盖文件: ${copyResult.overwrittenFiles}`);
    console.log(`跳过文件: ${copyResult.skippedFiles}`);
    console.log("");
    // ========== 核心变化结束 ==========

    const statusOutput = await execPromise("git status --porcelain");
    if (statusOutput.trim() === "") {
      console.log("本地代码与远程主Git仓库中的一样，没有变动，无需提交，即将删除主git文件夹");
      await execPromise(`cd ${currentDir}`);
      // 删除主git文件夹 包含父级文件夹 linshi_nodejs_maingit
      if (isSafeToDelete(nodejsDir)) {
        console.log(`正在删除本地仓库文件夹: ${nodejsDir}`);
        await execPromise(`rm -rf ${nodejsDir}`);
        console.log(`本地仓库文件夹已删除: ${nodejsDir}`);
      } else {
        throw new Error(`删除操作被禁止，repoPath 不安全: ${nodejsDir}`);
      }
      return;
    }
    await execPromise(`git add . && git commit -m '[增量发版] 系统自动复制子集Git到${targetFolder}文件夹${currentDate}'`);
    await execPromise(`git push --set-upstream origin ${newBranchName}`);

    console.log(`提交信息推送到新分支 ${newBranchName} 成功`);

    if (isSafeToDelete(nodejsDir)) {
      await execPromise(`cd ${currentDir}`);
      if (isSafeToDelete(nodejsDir)) {
        console.log(`正在删除本地仓库文件夹: ${nodejsDir}`);
        await execPromise(`rm -rf ${nodejsDir}`);
        console.log(`本地仓库文件夹已删除: ${nodejsDir}`);
      } else {
        throw new Error(`删除操作被禁止，repoPath 不安全: ${nodejsDir}`);
      }
    } else {
      throw new Error(`删除操作被禁止，repoPath 不安全: ${nodejsDir}`);
    }
  } catch (error) {
    console.error(`推送提交信息到主git${giteeRepoUrl}失败:`, error);
  }
}

(async () => {
  try {
    console.log("========== 增量发版模式 ==========");
    console.log("特点：");
    console.log("  1. 保留旧文件（避免用户访问旧JS时404）");
    console.log("  2. 同名文件用新版本覆盖");
    console.log("  3. index.html 始终更新为最新版本");
    console.log("==================================\n");

    await buildAndClone();
    await pushToParentGit();
  } catch (error) {
    console.error("主流程错误", error);
  }
})();
