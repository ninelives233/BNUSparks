# 给其他 Agent 的 GitHub 新仓库操作指南

这份文档用于指导其他项目中的 Agent：在获得用户明确授权后，如何在用户的 GitHub 账号或组织下创建新仓库，并把本地项目文件安全地提交、推送进去。

本文默认使用 GitHub CLI（命令名为 gh）和 Git。优先使用 gh，因为它可以处理 GitHub 登录和仓库创建，避免把访问令牌写进命令、远程地址或项目文件。

## 1. 先确认任务边界

创建 GitHub 仓库和推送代码都会改变外部账户状态。Agent 只有在用户明确要求时才能执行；不能根据“帮我整理一下项目”之类的表述自行创建远程仓库或上传文件。

开始前必须确认：

- GitHub 仓库所有者：个人账号或组织名，例如 <OWNER>。
- 仓库名，例如 <REPO_NAME>。
- 可见性：private、public，或者组织允许时的 internal。
- 要上传的本地目录，例如 <LOCAL_PROJECT>。
- 是否允许把当前工作区未提交的改动一起提交。
- 初始分支名称。没有特别要求时使用 main。
- 是否需要 README、许可证或 .gitignore。

如果仓库名、所有者或可见性没有确定，先向用户确认；不要猜测，也不要默认公开仓库。

## 2. 安全规则

### 必须遵守

- 不要要求用户把 Personal Access Token（PAT）、SSH 私钥或密码粘贴到聊天中。
- 不要把 token 放进命令行参数、Git remote URL、源代码、.env、日志或提交记录。
- 不要执行 gh auth token，因为它会把凭证直接打印出来。
- 不要把数据库、上传文件、构建产物、私密配置或测试密钥推送到公开仓库。
- 推送前检查 git status、暂存文件列表和即将提交的 diff。
- 不要执行 git reset --hard、git clean -fd 或 git push --force，除非用户明确指定目标和后果。
- 已有 origin 时不要覆盖它；先查看远程地址，再决定使用现有远程、增加新远程，还是向用户确认。

### 推荐原则

- 新项目默认创建为私有仓库：--private。
- 认证优先使用 gh auth login 的浏览器流程，或者由运行环境安全注入的 GH_TOKEN / GITHUB_TOKEN。
- 新仓库第一次推送前先创建一次清晰的初始提交，例如 Initial commit。
- 仓库已存在且包含文件时，优先 clone 后复制文件，避免两个互不相关的 Git 历史强行合并。

## 3. 执行前检查

进入要上传的本地项目目录后，先执行只读检查：

~~~bash
cd <LOCAL_PROJECT>

command -v gh
gh --version
git rev-parse --show-toplevel
git status --short
git branch --show-current
git remote -v
~~~

如果当前目录还不是 Git 仓库，后面需要先执行：

~~~bash
git init -b main
~~~

如果目录已经是 Git 仓库，保留现有分支、提交和远程地址，不要为了“整齐”而重置历史。

## 4. 登录 GitHub

先查看当前登录状态：

~~~bash
gh auth status --active --hostname github.com
~~~

如果尚未登录，推荐使用浏览器登录：

~~~bash
gh auth login --hostname github.com --git-protocol https --web
~~~

如果用户明确希望使用 SSH：

~~~bash
gh auth login --hostname github.com --git-protocol ssh --web
~~~

无浏览器的自动化环境可以使用运行环境中的 token：

~~~bash
GH_TOKEN="由运行环境安全注入的 token" gh auth status --hostname github.com
~~~

不要在文档、脚本或聊天内容中写入真实 token。对于组织仓库，还要确认当前账号对该组织具有创建仓库和推送代码的权限。

如果 Git 本身没有使用 gh 的认证配置，可以执行：

~~~bash
gh auth setup-git
~~~

## 5. 场景 A：从当前本地项目创建新仓库并推送

这是最常见的流程。下面的例子创建一个私有仓库，并把当前目录的现有提交推送到 GitHub：

~~~bash
cd <LOCAL_PROJECT>

# 如果当前目录还不是 Git 仓库，先初始化；已经是仓库时跳过
git init -b main

# 再次确认要提交的文件
git status --short
git add .
git diff --cached --stat
git diff --cached --name-only

# 确认没有密钥、密码、数据库或不应上传的文件后再提交
git commit -m "Initial commit"

# 创建 GitHub 仓库，并把当前提交推送到 origin
gh repo create <OWNER>/<REPO_NAME> --private --source=. --remote=origin --push
~~~

公开仓库只有在用户明确要求时才使用：

~~~bash
gh repo create <OWNER>/<REPO_NAME> --public --source=. --remote=origin --push
~~~

组织内部仓库只有在目标组织支持且用户明确要求时使用：

~~~bash
gh repo create <OWNER>/<REPO_NAME> --internal --source=. --remote=origin --push
~~~

如果需要仓库描述，可以增加：

~~~bash
--description "仓库用途的一句话说明"
~~~

### 目录没有任何提交时

gh repo create --source=. --push 需要本地已有提交。最小流程是：

~~~bash
git init -b main
git add <需要上传的文件或目录>
git commit -m "Initial commit"
gh repo create <OWNER>/<REPO_NAME> --private --source=. --remote=origin --push
~~~

### 不希望把整个目录都提交时

不要直接使用 git add .，而是明确列出文件或目录：

~~~bash
git add README.md src/ docs/
git diff --cached --name-only
git commit -m "Add project files"
gh repo create <OWNER>/<REPO_NAME> --private --source=. --remote=origin --push
~~~

## 6. 场景 B：GitHub 仓库已经存在且为空

如果仓库已由用户在网页上创建，但没有 README、许可证或其他初始文件，可以把它接到本地仓库：

~~~bash
cd <LOCAL_PROJECT>
git remote add origin https://github.com/<OWNER>/<REPO_NAME>.git
git remote -v
git push -u origin HEAD
~~~

如果本地当前分支不是 main，但用户要求远程默认分支为 main，先确认是否允许改名：

~~~bash
git branch -M main
git push -u origin main
~~~

如果 origin 已存在但指向别的仓库，不要直接覆盖，改用新的远程名：

~~~bash
git remote add github https://github.com/<OWNER>/<REPO_NAME>.git
git push -u github HEAD
~~~

## 7. 场景 C：GitHub 仓库已经存在并且有内容

如果远程仓库已有 README、.gitignore、许可证或其他提交，推荐先 clone：

~~~bash
gh repo clone <OWNER>/<REPO_NAME> <DESTINATION_DIR>
cd <DESTINATION_DIR>
~~~

然后把用户允许上传的文件复制到这个 clone 目录中，检查并提交：

~~~bash
git status --short
git add <文件或目录>
git diff --cached --stat
git diff --cached --name-only
git commit -m "Add project files"
git push -u origin HEAD
~~~

不要为了绕过 non-fast-forward 错误而直接使用 git push --force。若本地和远程是两个需要合并的历史，先向用户说明冲突，并选择合并、重新 clone，或由用户明确授权其他处理方式。

## 8. 场景 D：只创建仓库，不上传文件

如果用户只要求新建仓库，不要自动提交或推送本地文件：

~~~bash
gh repo create <OWNER>/<REPO_NAME> --private --description "仓库用途"
~~~

创建后验证：

~~~bash
gh repo view <OWNER>/<REPO_NAME>
~~~

## 9. README、.gitignore 和许可证

如果本地目录已经有 README，不要在 gh repo create 中额外使用 --add-readme，否则可能产生重复或冲突。空仓库需要 README 时可以使用：

~~~bash
gh repo create <OWNER>/<REPO_NAME> --private --add-readme
~~~

但如果接下来还要推送一个已有本地提交，通常更简单的做法是：本地先创建 README、提交，再使用 --source=. --push。

不要盲目套用 .gitignore 模板。先检查项目技术栈和已有忽略规则，确认不会忽略必须上传的源文件，也不会上传构建产物、缓存、虚拟环境或密钥。

如果新仓库尚未有 .gitignore，且确认模板适合当前项目，可以使用：

~~~bash
gh repo create <OWNER>/<REPO_NAME> --private --source=. --gitignore Python --remote=origin --push
~~~

许可证会影响其他人如何使用代码。用户没有指定时，不要替用户选择开源许可证；私有仓库也不应擅自添加许可证。

## 10. 推送前的最终检查

至少检查以下内容：

~~~bash
git status --short
git diff --cached --name-only
git log -1 --oneline
git remote -v
git branch --show-current
~~~

重点排查：

- .env、.env.*、私钥、云服务凭证、数据库密码。
- data/、上传目录、用户导出数据、生产数据库备份。
- 大型构建目录、依赖目录、缓存和系统生成文件。
- 日志中的 token、Cookie、邮箱密码和内部 URL。
- 不属于用户本次授权范围的其他项目文件。

如果发现敏感信息已经进入提交，不能只删除工作区文件后继续推送；应停止操作并告诉用户，因为敏感内容可能仍存在于 Git 历史中，需要单独清理和轮换凭证。

## 11. 推送后的验证

~~~bash
git status --short
git ls-remote --heads origin
gh repo view <OWNER>/<REPO_NAME>
~~~

预期结果：

- git status --short 没有意外的未提交改动。
- git ls-remote --heads origin 能看到刚推送的分支。
- gh repo view 显示的所有者、仓库名和可见性与用户要求一致。
- 仓库网页中能看到预期文件和最新提交。

如果需要把仓库链接交给用户，可以使用：

~~~bash
gh repo view <OWNER>/<REPO_NAME> --web
~~~

## 12. 常见问题

### gh: command not found

说明当前环境没有 GitHub CLI。可以请求用户安装 GitHub CLI，或让用户先在 GitHub 网页创建空仓库，再使用 git remote add 和 git push。不要为了绕过缺少 CLI 而把 token 写入脚本或远程 URL。

### not logged in 或 authentication failed

先运行：

~~~bash
gh auth status --hostname github.com
~~~

如果账号不对，让用户在本机完成 gh auth login，或切换到用户明确指定的账号。不要让 Agent 代为猜测账号。

### HTTP 403 或没有权限创建组织仓库

可能原因包括：当前账号不是组织成员、组织禁止成员创建仓库、token 没有足够权限，或组织启用了额外的 SSO/审批。把错误原文和目标组织告诉用户，请用户处理权限；不要反复重试或更换成公开仓库。

### remote origin already exists

先查看：

~~~bash
git remote -v
~~~

如果现有 origin 不是目标仓库，使用 github 等新远程名；只有用户明确要求更换现有远程时，才使用 git remote set-url。

### rejected 或 non-fast-forward

远程已有本地没有的提交。先停止强推，检查远程是否包含 README 或其他初始化提交；通常重新 clone 远程仓库，再复制本地文件，是最安全的处理方式。

### 需要从某个分支推送

明确指定分支：

~~~bash
git push -u origin <BRANCH_NAME>
~~~

如果只是 Agent 的开发改动，建议使用独立分支并让用户决定是否合并：

~~~bash
git switch -c agent/<short-task-name>
git push -u origin agent/<short-task-name>
~~~

不要擅自创建 Pull Request，除非用户也明确要求。

## 13. Agent 最小执行模板

当用户已经明确给出所有必要参数时，可以按下面的模板执行。把尖括号占位符替换成真实值；不要把 token 填进任何一行：

~~~bash
cd <LOCAL_PROJECT>
gh auth status --active --hostname github.com
git status --short
git remote -v

# 仅在确认暂存内容安全后执行
git add <允许上传的文件或目录>
git diff --cached --name-only
git commit -m "Initial commit"

gh repo create <OWNER>/<REPO_NAME> --private --source=. --remote=origin --push

git status --short
git ls-remote --heads origin
gh repo view <OWNER>/<REPO_NAME>
~~~

## 官方参考

- GitHub CLI：gh auth login — https://cli.github.com/manual/gh_auth_login
- GitHub CLI：gh auth status — https://cli.github.com/manual/gh_auth_status
- GitHub CLI：gh repo create — https://cli.github.com/manual/gh_repo_create
- GitHub Docs：Managing remote repositories — https://docs.github.com/en/get-started/git-basics/managing-remote-repositories

