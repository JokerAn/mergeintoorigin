import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import minimist from 'minimist';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = minimist(process.argv.slice(2), {
  string: ['repoUrl', 'targetFolder', 'sourceFolder', 'buildCmd', 'baseBranch']
});

function checkArgs(requiredArgs) {
  let missing = [];
  for (const key of requiredArgs) {
    if (!args[key]) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    console.error(
      `以下参数必须显式传递，缺失：${missing.join(', ')}\n` +
      `示例：node ./nodejs/index.mjs --repoUrl=xxx --targetFolder=xxx --sourceFolder=xxx --buildCmd="npm run build" --baseBranch=main`
    );
    process.exit(1);
  }
}

const requiredArgs = ['repoUrl', 'targetFolder', 'sourceFolder', 'buildCmd', 'baseBranch'];
checkArgs(requiredArgs);

const giteeRepoUrl = args.repoUrl;
let giturlSplit = giteeRepoUrl.split('.git')[0].split('/');
const repoName = giturlSplit[giturlSplit.length - 1];

const targetFolder = args.targetFolder;
const sourceFolder = args.sourceFolder;
const buildCmd = args.buildCmd;
const baseBranch = args.baseBranch;

const currentDir = process.cwd();
const nodejsDir = path.join(currentDir, 'nodejs');
if (!fs.existsSync(nodejsDir)) {
  fs.mkdirSync(nodejsDir);
}
const repoPath = path.join(nodejsDir, repoName);

function isSafeToDelete(p) {
  if (!p) return false;
  if (p === '/' || p.length < 10) return false;
  if (!path.isAbsolute(p)) return false;
  if (path.basename(p) !== repoName) return false;
  if (!p.startsWith(nodejsDir)) return false;
  return true;
}

function execPromise(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject(error + '\n' + stderr);
      } else {
        resolve(stdout);
      }
    });
  });
}

async function buildAndClone() {
  const buildPromise = execPromise(buildCmd);
  let clonePromise;
  if (fs.existsSync(repoPath)) {
    console.log('主要仓库文件夹已存在');
    clonePromise = Promise.resolve();
  } else {
    console.log('主要仓库文件夹不存在，克隆Gitee仓库');
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

    const gitUserName = (await execPromise('git config user.name')).trim();

    const getFormattedDate = () => {
      const currentDate = new Date();
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const hours = String(currentDate.getHours()).padStart(2, '0');
      const minutes = String(currentDate.getMinutes()).padStart(2, '0');
      const seconds = String(currentDate.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
    };

    const currentDate = getFormattedDate();
    const outerFolderName = path.basename(currentDir);
    const newBranchName = `${gitUserName}-${currentDate}-${outerFolderName}`;

    await execPromise(`git checkout -b ${newBranchName}`);

    // 绝对路径处理
    const sourceFolderAbs = path.isAbsolute(sourceFolder)
      ? sourceFolder
      : path.resolve(currentDir, sourceFolder);

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
      await execPromise(`mkdir -p ${targetFolderPath}`);
    }

    await execPromise(`rm -rf ${targetFolderPath}/*`);
    await execPromise(`cp -r ${sourceFolderAbs}/* ${targetFolderPath}`);

    const statusOutput = await execPromise('git status --porcelain');
    if (statusOutput.trim() === '') {
      console.log('代码没有变动，无需提交');
      return;
    }

    await execPromise(`git add . && git commit -m '系统自动复制子集Git到${targetFolder}文件夹${currentDate}'`);
    await execPromise(`git push --set-upstream origin ${newBranchName}`);

    console.log(`提交信息推送到新分支 ${newBranchName} 成功`);

    if (isSafeToDelete(repoPath)) {
      console.log(`正在删除本地仓库文件夹: ${repoPath}`);
      await execPromise(`rm -rf ${repoPath}`);
      console.log(`本地仓库文件夹已删除: ${repoPath}`);
    } else {
      throw new Error(`删除操作被禁止，repoPath 不安全: ${repoPath}`);
    }
  } catch (error) {
    console.error('推送提交信息到Gitee失败:', error);
  }
}

(async () => {
  try {
    await buildAndClone();
    await pushToParentGit();
  } catch (error) {
    console.error('主流程错误', error);
  }
})();
