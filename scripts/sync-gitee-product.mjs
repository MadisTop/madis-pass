import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 仓库与分支是受审阅的固定协议，不接受 workflow 输入、URL 或用户配置覆盖。
export const SOURCE_URL = 'https://github.com/MadisTop/madis-pass.git';
export const GITEE_URL = 'https://gitee.com/madis/madis-pass.git';
const BRANCH = 'refs/heads/main';
const SOURCE_REF = 'refs/heads/source-main';
const MIRROR_REF = 'refs/remotes/gitee/main';
const SHA = /^[a-f0-9]{40}$/;

/**
 * 按阶段严格核对 HTTPS 主机、用户名与仓库；未知 Git 提示绝不返回凭据。
 * Git 的认证提示来自远端交互，不能直接信任相似主机名、端口或 URL userinfo。
 * 返回值仅由 askpass 写到 Git 的受控管道，禁止作为诊断记录。
 */
export function credentialForPrompt(prompt, phase, token) {
  assert.ok(['source', 'mirror'].includes(phase), '未知认证阶段');
  assert.ok(typeof token === 'string' && token.length > 0 && !/[\r\n\0]/.test(token), '缺少有效专用凭据');
  const match = /^(Username|Password) for '(https:\/\/[^'\s]+)': ?$/.exec(prompt);
  assert.ok(match, '拒绝未知认证提示');
  const url = new URL(match[2]);
  const expected = new URL(phase === 'source' ? SOURCE_URL : GITEE_URL);
  const username = phase === 'source' ? 'x-access-token' : 'madis';
  assert.equal(url.protocol, 'https:', '拒绝非 HTTPS 认证');
  // host 而非 hostname 同时拒绝显式非标准端口；href 检查拒绝 URL 规范化绕过。
  assert.equal(url.host, expected.host, '拒绝非授权凭据主机');
  assert.equal(url.password, '', '拒绝 URL 内凭据');
  assert.equal(url.search + url.hash, '', '拒绝认证 URL 参数');
  assert.ok(['', '/', expected.pathname].includes(url.pathname), '拒绝非授权凭据仓库');
  assert.equal(url.href, match[2] + (url.pathname === '/' && !match[2].endsWith('/') ? '/' : ''), '拒绝非规范认证 URL');
  // Username 不可带 userinfo，Password 必须明确绑定本阶段用户名。
  assert.equal(url.username, match[1] === 'Username' ? '' : username, '拒绝非授权凭据用户名');
  return match[1] === 'Username' ? username : token;
}

/**
 * 短期 helper 的唯一入口：只将当前阶段凭据交给 Git，不输出异常详情。
 * helper 环境由 gitEnvironment 构造；源码阶段无法读取 Gitee 写令牌。
 * 认证提示不匹配时固定失败，既不回退认证存储，也不打印原始提示。
 */
export function askpassMain() {
  try {
    const phase = process.env.MIRROR_AUTH_PHASE;
    const token = phase === 'source' ? process.env.SOURCE_READ_TOKEN : process.env.GITEE_PRODUCT_MIRROR_TOKEN;
    process.stdout.write(credentialForPrompt(process.argv[2], phase, token));
  } catch {
    // Git 的提示或异常可能含敏感 URL，不回显原始文本。
    process.stderr.write('拒绝不受信任的凭据请求\n');
    process.exitCode = 1;
  }
}

/**
 * 最小化子进程环境：不继承宿主凭据、代理、配置注入、SSH agent 或调试开关。
 * 本地 Git 步骤完全不接收 token，两个网络阶段分别只接收一种凭据。
 * HOME/XDG/Git 全局配置均指向独占临时目录，不借用 Runner 登录状态。
 */
export function gitEnvironment({ base, stage, askpass, phase, token }) {
  const env = {
    PATH: base.PATH ?? base.Path ?? '', HOME: stage, XDG_CONFIG_HOME: stage,
    LANG: 'C', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(stage, 'empty-config'),
    GIT_ASKPASS: askpass, GIT_ALLOW_PROTOCOL: 'https',
  };
  // Windows 离线测试需要系统根路径；不读取其它环境项或本机认证存储。
  if (base.SystemRoot) env.SystemRoot = base.SystemRoot;
  if (phase !== 'none') {
    // 只给网络步骤相应的一种凭据；source 永远拿不到 Gitee 写令牌。
    assert.ok(['source', 'mirror'].includes(phase), '未知 Git 阶段');
    env.MIRROR_AUTH_PHASE = phase;
    env[phase === 'source' ? 'SOURCE_READ_TOKEN' : 'GITEE_PRODUCT_MIRROR_TOKEN'] = token;
  }
  return env;
}

/**
 * 所有 Git 命令禁用配置/凭据 helper/重定向/hooks；失败只报固定命令名。
 * 操作目标是本次新建裸仓，不执行 checkout 中的 Git 配置或产品代码。
 * 凭据只在子进程环境传递，不拼到命令、远端地址或错误诊断中。
 */
export function createGitRunner({ stage, askpass, sourceToken, mirrorToken, base = process.env, spawn = spawnSync }) {
  const directory = join(stage, 'repository.git');
  return (args, phase = 'none') => {
    const env = gitEnvironment({ base, stage, askpass, phase, token: phase === 'source' ? sourceToken : mirrorToken });
    const result = spawn('git', [
      '-c', 'credential.helper=', '-c', 'credential.useHttpPath=true',
      '-c', 'http.extraHeader=', '-c', 'http.followRedirects=false',
      '-c', `core.hooksPath=${join(stage, 'empty-hooks')}`,
      '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
      '-C', directory, ...args,
    ], { env, encoding: 'utf8', timeout: 90_000, maxBuffer: 1024 * 1024, windowsHide: true });
    // stderr 不进入日志：HTTP/Git 错误或远端响应可能包含敏感文本。
    // 只暴露白名单诊断类别，不输出可能包含凭据的原始远端信息。
    if (result.error || result.status !== 0) {
      const stderr = result.stderr ?? '';
      const reason = /error in libcrypto|invalid format/i.test(stderr) ? '密钥格式错误'
        : /Host key verification failed/i.test(stderr) ? '主机密钥校验失败'
        : stderr.includes('Permission denied (publickey)') ? '公钥认证失败'
        : /Connection (?:timed out|refused)|Network is unreachable/i.test(stderr) ? '网络连接失败'
        : '其他错误';
      throw new Error(`Git ${args[0]} 失败：${reason}`);
    }
    return (result.stdout ?? '').trim();
  };
}

/** 仅接受完整提交 ID，拒绝损坏或意外的远端输出。 */
function commitId(value) {
  assert.match(value, SHA, '远端提交 ID 无效');
  return value;
}

/**
 * 仅 fetch 已存在的 main，校验祖先后普通 push；不检出/运行源码，不创建远端仓。
 * 镜像必须等于或落后于 source；分叉、无共同历史与镜像领先均不可覆盖。
 * push 前后回读用于发现并发修改；删除竞态仍必须由服务端禁止删除保证。
 */
export function synchronize(git, sourceUrl = SOURCE_URL) {
  assert.equal(sourceUrl, SOURCE_URL, '拒绝未知源码仓');
  git(['init', '--bare', '--template=']);
  git(['remote', 'add', 'origin', sourceUrl]);
  git(['remote', 'add', 'gitee', GITEE_URL]);
  // 显式完整 refspec、不使用 shallow 或通配符；缺任一 main 都由 fetch 非零拒绝。
  git(['fetch', '--no-tags', '--no-recurse-submodules', 'origin', `${BRANCH}:${SOURCE_REF}`], 'source');
  const sourceSha = commitId(git(['rev-parse', '--verify', `${SOURCE_REF}^{commit}`]));
  git(['fetch', '--no-tags', '--no-recurse-submodules', 'gitee', `${BRANCH}:${MIRROR_REF}`], 'mirror');
  const previousSha = commitId(git(['rev-parse', '--verify', `${MIRROR_REF}^{commit}`]));
  // 分叉、无共同历史或镜像领先均拒绝；相等属于合法幂等同步。
  git(['merge-base', '--is-ancestor', previousSha, sourceSha]);
  // 推送前再核对分支仍存在且未变化；并发变更必须重新取证，不盲目重试。
  const before = git(['ls-remote', '--exit-code', '--heads', 'gitee', BRANCH], 'mirror');
  assert.equal(before, `${previousSha}\t${BRANCH}`, 'Gitee main 已变化或不存在；停止同步');
  if (sourceSha !== previousSha) {
    // 无 +、无 force、无 --mirror；服务端必须禁止 main 删除以封闭检查后的删除竞态。
    git(['push', '--porcelain', 'gitee', `${SOURCE_REF}:${BRANCH}`], 'mirror');
  }
  const after = git(['ls-remote', '--exit-code', '--heads', 'gitee', BRANCH], 'mirror');
  assert.equal(after, `${sourceSha}\t${BRANCH}`, '推送后 Gitee main 回读不一致；不自动回滚');
  return { sourceSha, previousSha, giteeSha: sourceSha };
}

/**
 * 只接受公开 product 仓 main 上的自有定时/手工任务；源码仓、build 仓及复用调用一律拒绝。
 * 此处与工作流 job 条件形成双层限制；缺失任一平台上下文都失败关闭。
 * 上下文只作入口校验，仓库当前公开性还必须通过实时 API 单独回读。
 */
export function validateExecutionContext(env) {
  assert.equal(env.GITHUB_ACTIONS, 'true', '同步仅允许 GitHub Actions');
  assert.equal(env.GITHUB_REPOSITORY, 'MadisTop/madis-pass', '同步只能由 product 自身运行');
  assert.equal(env.GITHUB_REF, BRANCH, '同步仅允许 main');
  assert.ok(['schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME), '拒绝非同步事件');
  // READY 必须在镜像公开性、已有 main 与受限写入者人工核验后设置。
  assert.equal(env.GITEE_PRODUCT_SYNC_READY, 'true', '缺少 product 仓同步就绪门禁');
}

/**
 * 每次运行只读回查两端身份与镜像 main 保护；不创建仓库、分支或修改可见性/保护。
 * 三个端点是固定白名单；只发 GET，拒绝认证重定向且不返回认证 URL。
 * 注入 request 仅用于无凭据离线测试，CLI 使用标准 fetch。
 */
export async function verifyRepositories({ sourceToken, mirrorToken }, request = fetch) {
  const endpoints = [
    ['https://api.github.com/repos/MadisTop/madis-pass', 'source'],
    ['https://gitee.com/api/v5/repos/madis/madis-pass', 'mirror'],
    ['https://gitee.com/api/v5/repos/madis/madis-pass/branches/main', 'branch'],
  ];
  for (const [endpoint, phase] of endpoints) {
    const url = new URL(endpoint);
    const headers = { Accept: 'application/json', 'User-Agent': 'madis-pass-product-mirror' };
    if (phase === 'source') {
      // GitHub 只收到本仓 contents:read 的自动短期 token，绝不收到 Gitee token。
      headers.Authorization = 'Bearer ' + sourceToken;
    } else {
      // Gitee v5 的 GET 认证参数只在内存使用，错误不得打印含 token 的 URL。
      url.searchParams.set('access_token', mirrorToken);
    }
    const response = await request(url.href, {
      method: 'GET', headers, redirect: 'error', credentials: 'omit', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200, '仓库只读核验请求失败');
    const info = await response.json();
    if (phase === 'source') {
      // 对 API 回读而非事件快照核验公开性，防止上下文生成后被改为私有。
      assert.ok(info.full_name === 'MadisTop/madis-pass' && info.private === false && info.default_branch === 'main', 'GitHub product 公开性或身份不符');
    } else if (phase === 'mirror') {
      // 固定命名空间与仓名，不能仅凭成功认证就把代码推向任意仓库。
      assert.ok(info.path === 'madis-pass' && info.namespace?.path === 'madis' && info.private === false, 'Gitee mirror 公开性或身份不符');
    } else {
      // 保护是必要条件；受限写入者仍由 READY 对应的服务端配置保证。
      assert.ok(info.name === 'main' && info.protected === true, 'Gitee main 必须已存在且受保护');
    }
  }
}

/**
 * CI 入口：固定 HTTPS 源码来源，凭据分阶段隔离，短期受限文件在 finally 清理。
 * 自动短期 GitHub token 读取本仓，唯一项目 Secret 只负责写入固定 Gitee mirror。
 * 预检失败不创建 Git 工作目录；成功路径也不会把凭据写入 Git 配置或磁盘。
 */
export async function main(args = process.argv.slice(2), { env = process.env, request = fetch } = {}) {
  assert.equal(args.length, 0, '拒绝未知参数');
  validateExecutionContext(env);
  // 只读取两种对应用途的凭据；不复制或回退到 SSH 私钥/宿主登录状态。
  const sourceToken = env.SOURCE_READ_TOKEN;
  const mirrorToken = env.GITEE_PRODUCT_MIRROR_TOKEN;
  for (const token of [sourceToken, mirrorToken]) {
    assert.ok(typeof token === 'string' && token.length > 0 && !/[\r\n\0]/.test(token), '缺少有效专用凭据');
  }
  assert.equal(process.platform, 'linux', '同步 CLI 仅支持 Linux Runner');
  const root = env.RUNNER_TEMP;
  assert.ok(isAbsolute(root ?? ''), '必须提供 RUNNER_TEMP 绝对路径');
  // 公开性或保护校验失败时，尚未 fetch 源码、创建临时目录或执行 push。
  await verifyRepositories({ sourceToken, mirrorToken }, request);
  const stage = mkdtempSync(join(root, 'madis-pass-product-mirror-'));
  try {
    chmodSync(stage, 0o700);
    mkdirSync(join(stage, 'repository.git'), { mode: 0o700 });
    mkdirSync(join(stage, 'empty-hooks'), { mode: 0o700 });
    writeFileSync(join(stage, 'empty-config'), '', { flag: 'wx', mode: 0o600 });
    const askpass = join(stage, 'askpass.mjs');
    const moduleUrl = pathToFileURL(fileURLToPath(import.meta.url)).href;
    writeFileSync(askpass, '#!' + process.execPath + '\nimport { askpassMain } from ' + JSON.stringify(moduleUrl) + ';\naskpassMain();\n', { flag: 'wx', mode: 0o700 });
    const git = createGitRunner({ stage, askpass, sourceToken, mirrorToken, base: env });
    const result = synchronize(git);
    console.log('产品 main: ' + result.sourceSha + '\nGitee main: ' + result.giteeSha);
  } finally {
    // 只删除本次 mkdtemp 生成并验证在 RUNNER_TEMP 下的目录，不能传入外部路径。
    assert.ok(resolve(stage).startsWith(resolve(root) + '/'), '临时目录超出 Runner 范围');
    rmSync(stage, { recursive: true, force: true });
  }
}

// helper 仅导入不会同步；CLI 的 API/断言/远端错误全部脱敏，不输出栈或认证 URL。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    // 仅允许受审阅 Git 命令名和固定错误类别进入日志，不传播任意远端文本。
    const message = String(error?.message ?? '');
    if (/^Git (?:init|remote|fetch|rev-parse|merge-base|ls-remote|push) 失败：(?:密钥格式错误|主机密钥校验失败|公钥认证失败|网络连接失败|其他错误)$/.test(message)) console.error(message);
    else console.error('安全产品同步失败；请检查 product 公开性、专用 Secret、就绪门禁、已有 main 和快进条件。');
    process.exitCode = 1;
  }
}
