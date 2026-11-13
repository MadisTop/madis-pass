import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { SOURCE_URL, GITEE_URL, credentialForPrompt, gitEnvironment, createGitRunner, synchronize, validateExecutionContext, verifyRepositories, main } from '../scripts/sync-gitee-product.mjs';

const workflow = readFileSync(new URL('../.github/workflows/sync-gitee-product.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const dummy = 'TEST-ONLY-NOT-A-CREDENTIAL';

/**
 * 测试只传显式测试字符串，不从环境读取 token；不连接 GitHub/Gitee。
 * 分别验证两个阶段的精确主机、仓库和用户名，以及所有非规范提示的拒绝行为。
 */
test('askpass 只向精确 HTTPS 主机、仓库和用户名返回当前阶段凭据', () => {
  for (const [phase, host, username, repo] of [
    ['source', 'github.com', 'x-access-token', 'MadisTop/madis-pass.git'],
    ['mirror', 'gitee.com', 'madis', 'madis/madis-pass.git'],
  ]) {
    assert.equal(credentialForPrompt(`Username for 'https://${host}/${repo}': `, phase, dummy), username);
    assert.equal(credentialForPrompt(`Password for 'https://${username}@${host}/${repo}': `, phase, dummy), dummy);
    // 主机相似、跨主机、端口、userinfo、URL 编码与重定向参数均不受信任。
    for (const url of [
      `http://${username}@${host}/${repo}`, `https://${username}@${host}.evil.invalid/${repo}`,
      `https://${host}@evil.invalid/${repo}`, `https://${username}@${host}:444/${repo}`,
      `https://wrong@${host}/${repo}`, `https://${username}@${host}/other/repo.git`,
      `https://${username}@${host}/${repo}?redirect=1`, `https://${username}@${host}/${repo}#frag`,
      `https://${username}@${host}:443/${repo}`, `https://${username}@${host.toUpperCase()}/${repo}`,
      `https://${username}@${phase === 'source' ? 'gitee.com' : 'github.com'}/${repo}`,
    ]) assert.throws(() => credentialForPrompt(`Password for '${url}': `, phase, dummy));
  }
  for (const prompt of ['', 'Password:', "Password for 'ssh://gitee.com': ", 'evil\nPassword:']) {
    assert.throws(() => credentialForPrompt(prompt, 'mirror', dummy));
  }
  assert.throws(() => credentialForPrompt("Username for 'https://gitee.com': ", 'other', dummy));
  assert.throws(() => credentialForPrompt("Username for 'https://gitee.com': ", 'mirror', ''));
});

/**
 * helper 入口也必须脱敏：测试直接启动 Node，不需要 shell、真实 Token 或远端连接。
 * 子进程只能返回当前阶段的人工测试凭据；恶意提示不得通过 stdout/stderr 被回显。
 */
test('askpass 进程按当前阶段供给凭据，未知主机只报固定错误', () => {
  const moduleUrl = new URL('../scripts/sync-gitee-product.mjs', import.meta.url).href;
  const code = 'process.argv[2] = process.env.TEST_PROMPT; const { askpassMain } = await import(' + JSON.stringify(moduleUrl) + '); askpassMain();';
  for (const [phase, host, username] of [['source', 'github.com', 'x-access-token'], ['mirror', 'gitee.com', 'madis']]) {
    const env = { SystemRoot: process.env.SystemRoot ?? '', MIRROR_AUTH_PHASE: phase,
      SOURCE_READ_TOKEN: 'SOURCE-TEST-ONLY', GITEE_PRODUCT_MIRROR_TOKEN: 'MIRROR-TEST-ONLY',
      TEST_PROMPT: "Password for 'https://" + username + '@' + host + "': " };
    // 两种值均为人工测试字符串，明确验证 helper 不会串用另一阶段的凭据。
    const good = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8', windowsHide: true });
    assert.equal(good.status, 0); assert.equal(good.stderr, '');
    assert.equal(good.stdout, phase === 'source' ? 'SOURCE-TEST-ONLY' : 'MIRROR-TEST-ONLY');
    env.TEST_PROMPT = "Password for 'https://SENSITIVE-PROMPT@evil.invalid': ";
    const bad = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8', windowsHide: true });
    assert.equal(bad.status, 1); assert.equal(bad.stdout, '');
    assert.equal(bad.stderr, '拒绝不受信任的凭据请求\n');
  }
});

/**
 * 恶意宿主环境不进入 git；一个步骤不会同时获得两种专用凭据。
 * 模拟代理、trace、配置注入和 SSH agent，验证白名单环境而非按黑名单删几个变量。
 */
test('Git 环境按阶段隔离，不继承 helper、代理、trace、header 或其它凭据', () => {
  const base = { PATH: '/bin', SOURCE_READ_TOKEN: 'DO-NOT-INHERIT', GITEE_PRODUCT_MIRROR_TOKEN: 'DO-NOT-INHERIT',
    GIT_CONFIG_COUNT: '1', GIT_TRACE: '1', HTTPS_PROXY: 'https://evil.invalid', SSH_AUTH_SOCK: '/evil', GITHUB_TOKEN: 'DO-NOT-INHERIT' };
  for (const phase of ['source', 'mirror', 'none']) {
    const env = gitEnvironment({ base, stage: '/isolated', askpass: '/isolated/askpass', phase, token: dummy });
    assert.equal(env.GIT_TERMINAL_PROMPT, '0'); assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(env.GIT_ALLOW_PROTOCOL, 'https'); assert.equal(env.GIT_CONFIG_GLOBAL, join('/isolated', 'empty-config'));
    for (const key of ['HTTPS_PROXY', 'GIT_TRACE', 'GIT_CONFIG_COUNT', 'SSH_AUTH_SOCK', 'GITHUB_TOKEN']) assert.equal(env[key], undefined);
    assert.equal(env.SOURCE_READ_TOKEN, phase === 'source' ? dummy : undefined);
    assert.equal(env.GITEE_PRODUCT_MIRROR_TOKEN, phase === 'mirror' ? dummy : undefined);
  }
});

/**
 * 子进程适配器可离线检查配置，测试失败时也不得把 Git/远端回显带入异常。
 * 检查禁用 helper、headers、重定向及本地配置；命令参数中不能出现人工 token。
 */
test('Git 禁止重定向/凭据持久化，错误脱敏，命令不含凭据', () => {
  let command;
  const run = createGitRunner({ stage: '/isolated', askpass: '/isolated/askpass', sourceToken: dummy, mirrorToken: dummy,
    base: { PATH: '/bin' }, spawn: (...args) => { command = args; return { status: 0, stdout: 'ok\n' }; } });
  assert.equal(run(['fetch', 'origin'], 'source'), 'ok');
  assert.equal(command[0], 'git'); assert.ok(!JSON.stringify(command[1]).includes(dummy));
  for (const config of ['credential.helper=', 'credential.useHttpPath=true', 'http.extraHeader=', 'http.followRedirects=false', 'protocol.allow=never']) {
    assert.ok(command[1].includes(config));
  }
  assert.equal(command[2].env.GITEE_PRODUCT_MIRROR_TOKEN, undefined);
  const fail = createGitRunner({ stage: '/isolated', askpass: '/askpass', base: {}, spawn: () => ({ status: 1, stderr: dummy }) });
  assert.throws(() => fail(['fetch']), (error) => error.message.includes('Git fetch 失败') && !error.message.includes(dummy));
});

/** 本地真实 Git 图夹具；所有写入限制在独立临时目录，finally 校验范围后删除。 */
function withRepositories(body) {
  const tempRoot = process.env.AI_AGENT_TEMP_DIR || (process.platform === 'win32' ? 'C:/'+'.temp' : process.env.RUNNER_TEMP || '/tmp/madis-pass-tests');
  assert.ok(isAbsolute(tempRoot), '测试临时目录必须为绝对路径');
  mkdirSync(tempRoot, { recursive: true });
  const stage = mkdtempSync(join(tempRoot, 'sync-test-'));
  // 不继承认证环境；本地 file transport 仅存在于测试适配器，生产仅允许 HTTPS。
  const env = { PATH: process.env.PATH ?? process.env.Path, SystemRoot: process.env.SystemRoot ?? '',
    HOME: stage, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(stage, 'no-config'), GIT_TERMINAL_PROMPT: '0',
    LANG: 'C', LC_ALL: 'C' };
  /** 用空模板/禁用 hooks 运行本地 Git；任一非零退出都明确失败。 */
  const gitAt = (cwd, args) => {
    const child = spawnSync('git', ['-c', `core.hooksPath=${join(stage, 'no-hooks')}`, '-c', 'credential.helper=',
      '-c', 'user.name=Sync Test', '-c', 'user.email=sync-test@invalid', '-c', 'commit.gpgSign=false', '-C', cwd, ...args],
    { env, encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 0, `${args[0]}: ${child.stderr}`);
    return child.stdout.trim();
  };
  try {
    const source = join(stage, 'source.git'); const mirror = join(stage, 'mirror.git'); const work = join(stage, 'work.git');
    for (const dir of [source, mirror, work]) { mkdirSync(dir); gitAt(dir, ['init', '--bare', '--template=']); }
    const tree = gitAt(source, ['mktree']);
    const a = gitAt(source, ['commit-tree', tree, '-m', 'base']);
    const b = gitAt(source, ['commit-tree', tree, '-p', a, '-m', 'source-next']);
    gitAt(source, ['update-ref', 'refs/heads/main', b]); gitAt(mirror, ['fetch', source, 'refs/heads/main']);
    gitAt(mirror, ['update-ref', 'refs/heads/main', a]);
    const calls = [];
    /** 只替换两个固定 URL 为本地夹具，其余 refspec/祖先检查/推送均由真实 Git 执行。 */
    const git = (args, phase = 'none') => {
      calls.push({ args, phase });
      return gitAt(work, args.map((arg) => arg === SOURCE_URL ? source : arg === GITEE_URL ? mirror : arg));
    };
    body({ git, gitAt, source, mirror, work, a, b, tree, calls });
  } finally {
    // 只删除本次创建的夹具；绝不把远端/测试参数拼成删除路径。
    assert.equal(resolve(stage).startsWith(resolve(tempRoot) + (process.platform === 'win32' ? '\\' : '/')), true);
    rmSync(stage, { recursive: true, force: true });
  }
}

/**
 * 正例证明保留 origin、不检出源码、只改已有 main，不复制标签或其它分支。
 * 第一轮必须真实快进，第二轮必须不再 push；额外分支和 tag 不能被同步。
 */
test('本地真实 Git：快进成功、回读一致且第二次运行幂等', () => withRepositories(({ git, gitAt, source, mirror, work, b, calls }) => {
  gitAt(source, ['update-ref', 'refs/heads/not-for-mirror', b]); gitAt(source, ['tag', 'not-for-mirror', b]);
  assert.equal(synchronize(git).giteeSha, b);
  assert.equal(gitAt(mirror, ['rev-parse', 'refs/heads/main']), b);
  assert.equal(gitAt(work, ['remote', 'get-url', 'origin']), source);
  assert.equal(gitAt(mirror, ['for-each-ref', '--format=%(refname)']), 'refs/heads/main');
  assert.ok(calls.every(({ args }) => !args.some((arg) => /^(?:--force|--mirror|checkout|reset|clean|\+)/.test(arg))));
  assert.ok(calls.filter(({ args }) => args[0] === 'fetch' && args[3] === 'origin').every(({ phase }) => phase === 'source'));
  // 新建另一轮工作裸仓，模拟独立 runner；不复用已添加的 remote。
  gitAt(work, ['remote', 'remove', 'origin']); gitAt(work, ['remote', 'remove', 'gitee']);
  const pushCount = calls.filter(({ args }) => args[0] === 'push').length;
  assert.equal(synchronize(git).giteeSha, b);
  assert.equal(calls.filter(({ args }) => args[0] === 'push').length, pushCount);
}));

/**
 * 不存在的任一 main 不是初始化请求：必须在 push 前停止。
 * 直接删除本地夹具的对应 ref，要求真实 fetch 失败且不能补建分支。
 */
for (const missing of ['source', 'mirror']) {
  test(`本地真实 Git：${missing} 缺 main 拒绝推送和自动建分支`, () => withRepositories(({ git, gitAt, source, mirror, calls }) => {
    gitAt(missing === 'source' ? source : mirror, ['update-ref', '-d', 'refs/heads/main']);
    assert.throws(() => synchronize(git));
    assert.equal(calls.filter(({ args }) => args[0] === 'push').length, 0);
    assert.equal(gitAt(missing === 'source' ? source : mirror, ['for-each-ref', '--format=%(refname)']), '');
  }));
}

/**
 * 镜像独立提交、领先或不相关历史都不允许覆盖；无 force 回退。
 * 通过 commit-tree 建立三种不同 Git 图，逐一确认镜像原提交不发生变化。
 */
for (const mode of ['diverged', 'ahead', 'unrelated']) {
  test(`本地真实 Git：${mode} 拒绝并保留镜像`, () => withRepositories(({ git, gitAt, source, mirror, a, b, tree, calls }) => {
    const parent = mode === 'diverged' ? a : b;
    const changed = gitAt(source, ['commit-tree', tree, ...(mode === 'unrelated' ? [] : ['-p', parent]), '-m', mode]);
    gitAt(mirror, ['fetch', source, changed]); gitAt(mirror, ['update-ref', 'refs/heads/main', changed]);
    assert.throws(() => synchronize(git));
    assert.equal(calls.filter(({ args }) => args[0] === 'push').length, 0);
    assert.equal(gitAt(mirror, ['rev-parse', 'refs/heads/main']), changed);
  }));
}

/**
 * 最后检查之后发生独立提交时，真实 Git 的普通推送必须拒绝，不能通过强推掩盖竞态。
 * 在 push 前修改镜像 main，验证拒绝来自 Git 非快进协议，而不是模拟的返回码。
 */
test('本地真实 Git：推送前并发分叉由非强制 push 拒绝', () => withRepositories(({ git, gitAt, source, mirror, a, tree }) => {
  const concurrent = gitAt(source, ['commit-tree', tree, '-p', a, '-m', 'concurrent-mirror']);
  gitAt(mirror, ['fetch', source, concurrent]);
  /** 在同步完成最后一次 ls-remote 后、实际 push 前模拟另一写入者，不模拟 Git 推送结果。 */
  const racedGit = (args, phase) => {
    if (args[0] === 'push') gitAt(mirror, ['update-ref', 'refs/heads/main', concurrent]);
    return git(args, phase);
  };
  assert.throws(() => synchronize(racedGit));
  assert.equal(gitAt(mirror, ['rev-parse', 'refs/heads/main']), concurrent);
}));

/**
 * 缺 Secret 在创建临时目录/任何网络操作之前失败；不继承测试进程实际认证环境。
 * 完整 CLI 仅得到有效测试上下文和人工凭据，缺失任一种都只能输出固定脱敏错误。
 */
test('同步 CLI 缺专用 Secret 安全退出且不回显测试凭据', () => {
  const script = fileURLToPath(new URL('../scripts/sync-gitee-product.mjs', import.meta.url));
  for (const missing of ['SOURCE_READ_TOKEN', 'GITEE_PRODUCT_MIRROR_TOKEN']) {
    const env = { ...validContext(), SystemRoot: process.env.SystemRoot ?? '', SOURCE_READ_TOKEN: dummy, GITEE_PRODUCT_MIRROR_TOKEN: dummy };
    env[missing] = '';
    const child = spawnSync(process.execPath, [script], { env, encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 1); assert.equal(child.stdout, '');
    assert.match(child.stderr, /安全产品同步失败/); assert.ok(!child.stderr.includes(dummy));
  }
});

/**
 * 模拟检查前删除/变更与推送后不一致，既不新建 main 也不掩盖失败。
 * 协议级异常与上方真实 Git 图互补；回读失败不能宣称完成或自动回滚。
 */
test('检查前远端消失/变化及推送后回读不一致均失败', () => {
  for (const scenario of ['missing', 'changed', 'readback']) {
    const a = 'a'.repeat(40); const b = 'b'.repeat(40); let reads = 0; let pushes = 0;
    /** 模拟协议输出，不替代上方真实 Git 图正负例。 */
    const git = (args) => {
      if (args[0] === 'rev-parse') return args[2].includes('source-main') ? b : a;
      if (args[0] === 'push') pushes++;
      if (args[0] === 'ls-remote') {
        reads++;
        if (scenario === 'missing') throw new Error('test missing');
        if (scenario === 'changed' || reads === 2) return `${b}\trefs/heads/not-main`;
        return `${a}\trefs/heads/main`;
      }
      return '';
    };
    assert.throws(() => synchronize(git));
    assert.equal(pushes, scenario === 'readback' ? 1 : 0);
  }
});

/**
 * 文本契约与 actionlint 配合：不新增第三方 action、浮动 ref、公开同步或发版触发器。
 * 核对单一 cron、公开 main 条件、只读 token、固定 checkout 和 Secret 的唯一使用步骤。
 */
test('product 工作流每日 UTC19:07、只读自有 token、仅 product main 定时或手工运行', () => {
  assert.match(workflow, /workflow_dispatch:\n  schedule:/);
  assert.deepEqual([...workflow.matchAll(/cron: '([^']+)'/g)].map((m) => m[1]), ['7 19 * * *']);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /github.repository == 'MadisTop\/madis-pass'/);
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github.event_name == 'schedule' \|\| github.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /repository: MadisTop\/madis-pass/);
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  assert.match(workflow, /token: \$\{\{ github.token \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /SOURCE_READ_TOKEN: \$\{\{ github.token \}\}/);
  assert.match(workflow, /GITEE_PRODUCT_SYNC_READY: \$\{\{ vars.GITEE_PRODUCT_SYNC_READY \}\}/);
  assert.deepEqual([...workflow.matchAll(/uses: ([\w/-]+)@([^\s]+)/g)].map((m) => m.slice(1)), [
    ['actions/checkout', '11d5960a326750d5838078e36cf38b85af677262'],
  ]);
  assert.doesNotMatch(workflow, /\n  (?:push|pull_request|pull_request_target|workflow_call|repository_dispatch):|contents: write|write-all|gh api|temporary_public|BUILD_REPOSITORY_ADMIN_TOKEN|DISTRIBUTION_TOKEN|npm install/);
  assert.deepEqual([...workflow.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]), ['GITEE_PRODUCT_MIRROR_TOKEN']);
  const steps = workflow.split('\n      - name: ');
  assert.equal(steps.filter((step) => step.includes('secrets.')).length, 1);
  const regressionStep = steps.find((step) => step.includes('node --test'));
  assert.ok(regressionStep); assert.doesNotMatch(regressionStep, /env:|github.token|secrets\./);
  assert.ok(workflow.indexOf('if [ "$SYNC_READY"') < workflow.indexOf('uses: actions/checkout@'));
});

/** 模拟平台自动注入的非敏感上下文；凭据始终由测试显式提供。 */
function validContext() {
  return { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'MadisTop/madis-pass',
    GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'schedule', GITEE_PRODUCT_SYNC_READY: 'true' };
}

/**
 * 双层拒绝：即使绕过 job if，脚本也不接受 build、fork、标签、复用事件或未就绪运行。
 * 每个反例都携带人工 token，要求上下文检查先失败且测试请求器调用次数为零。
 */
test('product CLI 上下文在任何凭据使用或网络访问前失败关闭', async () => {
  validateExecutionContext(validContext());
  validateExecutionContext({ ...validContext(), GITHUB_EVENT_NAME: 'workflow_dispatch' });
  let requests = 0;
  for (const patch of [
    { GITHUB_ACTIONS: 'false' }, { GITHUB_REPOSITORY: 'MadisTop/madis-pass-build' },
    { GITHUB_REPOSITORY: 'MadisTop/madis-pass-source' }, { GITHUB_REPOSITORY: 'other/madis-pass' },
    { GITHUB_REF: 'refs/tags/v1' }, { GITHUB_REF: 'refs/heads/other' },
    { GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'workflow_call' },
    { GITEE_PRODUCT_SYNC_READY: '' }, { GITEE_PRODUCT_SYNC_READY: 'false' },
  ]) {
    // 传入显式假 token 证明失败不是因为认证缺失，并禁止调用测试请求器。
    const env = { ...validContext(), SOURCE_READ_TOKEN: dummy, GITEE_PRODUCT_MIRROR_TOKEN: dummy, ...patch };
    assert.throws(() => validateExecutionContext(env));
    await assert.rejects(main([], { env, request: () => { requests++; throw new Error('不应请求'); } }));
  }
  assert.equal(requests, 0);
});

/**
 * 缺少或带换行的任一种凭据都不能进入 API 或 Git；不从测试宿主读取 Secret。
 * 额外传入 SSH key 与通用 GITHUB_TOKEN 也不能掩盖缺失的显式用途凭据。
 */
test('product CLI 拒绝缺失/非法 token、旧 SSH 参数和环境回退', async () => {
  let requests = 0;
  for (const key of ['SOURCE_READ_TOKEN', 'GITEE_PRODUCT_MIRROR_TOKEN']) {
    for (const token of [undefined, '', 'TEST\nONLY', 'TEST\0ONLY']) {
      const env = { ...validContext(), SOURCE_READ_TOKEN: dummy, GITEE_PRODUCT_MIRROR_TOKEN: dummy,
        SOURCE_DEPLOY_KEY: dummy, GITHUB_TOKEN: dummy, [key]: token };
      await assert.rejects(main([], { env, request: () => { requests++; throw new Error('不应请求'); } }));
    }
  }
  await assert.rejects(main(['--probe-source'], { env: validContext() }));
  assert.equal(requests, 0);
});

/** 公开性与保护响应由本地假数据组成，绝不读取本机认证状态或访问远端。 */
function productResponses() {
  return [
    { full_name: 'MadisTop/madis-pass', private: false, default_branch: 'main' },
    { path: 'madis-pass', namespace: { path: 'madis' }, private: false },
    { name: 'main', protected: true },
  ];
}

/**
 * 每次只读实时核验，两平台凭据不串用；Gitee token 只存在该固定主机的内存 URL 中。
 * 全部响应由假请求器提供，检查三个 GET 的路径、认证阶段、禁止重定向及缓存策略。
 */
test('同步前实时验证两端公开性和已有 main 保护，所有 API 均为固定 GET 且拒绝重定向', async () => {
  const calls = []; const info = productResponses();
  await verifyRepositories({ sourceToken: 'SOURCE-TEST-ONLY', mirrorToken: 'MIRROR-TEST-ONLY' }, async (url, options) => {
    calls.push({ url, options });
    return { status: 200, json: async () => info[calls.length - 1] };
  });
  assert.equal(calls.length, 3);
  for (const [index, { url, options }] of calls.entries()) {
    const parsed = new URL(url);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.equal(options.referrerPolicy, 'no-referrer'); assert.ok(options.signal instanceof AbortSignal);
    if (index === 0) {
      // GitHub 没有 Gitee 凭据；Gitee 也不携带 GitHub Authorization 头。
      assert.equal(url, 'https://api.github.com/repos/MadisTop/madis-pass');
      assert.equal(options.headers.Authorization, 'Bearer SOURCE-TEST-ONLY');
      assert.ok(!JSON.stringify({url, options}).includes('MIRROR-TEST-ONLY'));
    } else {
      // 仓库查询和分支查询之外，不存在可见性或保护写接口。
      assert.equal(parsed.origin, 'https://gitee.com');
      assert.equal(parsed.pathname, '/api/v5/repos/madis/madis-pass' + (index === 2 ? '/branches/main' : ''));
      assert.equal(parsed.searchParams.get('access_token'), 'MIRROR-TEST-ONLY');
      assert.equal(options.headers.Authorization, undefined);
      assert.ok(!JSON.stringify({url, options}).includes('SOURCE-TEST-ONLY'));
    }
  }
});

/**
 * 任一 API 失败、非公开、仓名错误、main 消失或保护关闭，都在 fetch/push 之前停止。
 * 除拒绝错误元信息外，还验证 HTTP 失败、JSON 解析失败以及网络失败不能继续下一步。
 */
test('实时公开性/保护核验拒绝私有仓、身份不符、缺失分支与错误响应', async () => {
  const variants = [
    [0, { private: true }], [0, { full_name: 'other/madis-pass' }],
    [0, { default_branch: 'dev' }], [1, { private: true }], [1, { path: 'other' }],
    [1, { namespace: { path: 'other' } }], [2, { name: 'other' }], [2, { protected: false }],
  ];
  for (const [index, patch] of variants) {
    const data = productResponses(); data[index] = { ...data[index], ...patch }; let calls = 0;
    await assert.rejects(verifyRepositories({ sourceToken: dummy, mirrorToken: dummy }, async () => {
      const info = data[calls++]; return { status: 200, json: async () => info };
    }));
    assert.equal(calls, index + 1);
  }
  for (const status of [301, 401, 403, 404, 500]) {
    await assert.rejects(verifyRepositories({ sourceToken: dummy, mirrorToken: dummy }, async () => ({ status })));
  }
  await assert.rejects(verifyRepositories({ sourceToken: dummy, mirrorToken: dummy }, async () => ({ status: 200, json: async () => { throw new Error('invalid JSON'); } })));
  await assert.rejects(verifyRepositories({ sourceToken: dummy, mirrorToken: dummy }, async () => { throw new Error('redirect/network'); }));
});

/**
 * 源码远端只允许固定 GitHub HTTPS；不执行 SSH，不接收工作流输入、本机 origin 或替代 URL。
 * 协议白名单断言必须先于 Git 调用，源码脚本不能依赖 build 专用模块或浅 fetch。
 */
test('生产同步固定 HTTPS product main，拒绝 SSH/任意 URL且不含旧部署密钥路径', () => {
  for (const url of ['git@github.com:MadisTop/madis-pass.git', 'https://evil.invalid/repo', 'file:///repo']) {
    assert.throws(() => synchronize(() => '', url));
  }
  const script = readFileSync(new URL('../scripts/sync-gitee-product.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /SOURCE_DEPLOY_KEY|SOURCE_KNOWN_HOSTS|SOURCE_SSH_URL|verify-native|exec ssh|--depth/);
  assert.match(script, /const result = synchronize\(git\)/);
});

/**
 * 原始 stderr 即使包含测试敏感文本也不能被 Git 适配器直接传播。
 * 仅固定网络诊断类别可以向上抛出，未知远端文本必须被统一隐藏。
 */
test('Git 失败只输出固定诊断类别，不泄露原始 stderr', () => {
  for (const [stderr, reason] of [
    ['Connection timed out SENSITIVE', '网络连接失败'], ['SENSITIVE arbitrary output', '其他错误'],
  ]) {
    const git = createGitRunner({ stage: '/isolated', askpass: '/askpass', base: {}, spawn: () => ({status: 1, stderr}) });
    assert.throws(() => git(['fetch']), (error) => error.message === 'Git fetch 失败：' + reason && !error.message.includes('SENSITIVE'));
  }
});
