import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test';
import { type Bootstrap, defaultData, modelProviderSchema, providerModelSchema, threadSchema } from '../../src/shared/contracts.ts';

test.afterAll(cleanupTemporaryDirectories);

test('Windows desktop: streaming, approvals, review, terminals, preview, themes and restart', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'pi-desktop-e2e-'));
  const projectPath = join(storage, 'demo-project');
  await mkdir(projectPath);
  execFileSync('git', ['init', '-b', 'main', projectPath]);
  execFileSync('git', ['-C', projectPath, 'config', 'core.autocrlf', 'false']);
  execFileSync('git', ['-C', projectPath, 'config', 'user.name', 'Desktop Test']);
  execFileSync('git', ['-C', projectPath, 'config', 'user.email', 'test@example.invalid']);
  await writeFile(join(projectPath, 'README.md'), '# 示例项目\n');
  execFileSync('git', ['-C', projectPath, 'add', '--', 'README.md']);
  execFileSync('git', ['-C', projectPath, 'commit', '-m', 'initial']);
  let toolSent = false;
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<h1>Pi 本地预览</h1>');
      return;
    }
    for await (const _chunk of request) {
      /* consume request */
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta: object, finish: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'fake-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    send({ role: 'assistant' });
    if (!toolSent) {
      toolSent = true;
      send({ content: '我会先创建示例文件，然后检查本地执行环境。' });
      send({
        tool_calls: [
          {
            index: 0,
            id: 'create-file',
            type: 'function',
            function: {
              name: 'powershell',
              arguments: JSON.stringify({
                command:
                  "Set-Content -LiteralPath 'hello.txt' -Value 'Hello Pi Desktop'; Write-Output 'DESKTOP_COMMAND_OK'",
              }),
            },
          },
        ],
      });
      send({}, 'tool_calls');
    } else {
      send({
        content:
          '已完成示例任务。\n\n- 在项目中创建了 `hello.txt`\n- PowerShell 已执行\n- 可在右侧 Review 面板查看文件差异\n\n这是本地假供应商的测试回复。',
      });
      send({}, 'stop');
    }
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server');
  const url = `http://127.0.0.1:${address.port}`;
  const data = defaultData();
  data.projects.push({
    id: 'project',
    name: '示例项目',
    path: projectPath,
    trusted: false,
    createdAt: Date.now(),
  });
  data.settings.modelProviders.push(
    modelProviderSchema.parse({
      id: 'fake-provider',
      name: 'Local Test',
      kind: 'custom',
      namespace: 'desktop-fake-provider',
      baseUrl: `${url}/v1`,
    }),
  );
  data.settings.models.push(
    providerModelSchema.parse({
      id: 'fake',
      provider: 'fake-provider',
      name: 'Local Test',
      model: 'fake-model',
      reasoning: false,
    }),
  );
  data.settings.modelId = 'fake';
  data.settings.theme = 'light';
  data.settings.keepInTray = false;
  data.threads.push(
    threadSchema.parse({
      id: 'thread',
      title: '新任务',
      projectId: 'project',
      cwd: projectPath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelId: 'fake',
      thinking: 'off',
      policy: 'ask',
    }),
  );
  await writeFile(join(storage, 'desktop.json'), JSON.stringify(data));
  const env = { ...process.env, PI_DESKTOP_USER_DATA: storage } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () =>
    electron.launch({
      ...(process.env.PI_DESKTOP_EXECUTABLE
        ? { executablePath: process.env.PI_DESKTOP_EXECUTABLE, args: [`--user-data-dir=${storage}`] }
        : { args: [resolve('out/main/index.js')] }),
      env,
      timeout: 30000,
    });
  let application: ElectronApplication | undefined;
  const shots = resolve('../../.artifacts/screenshots');
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  try {
    application = await launch();
    const page = await application.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('heading', { name: '在 示例项目 中构建' })).toBeVisible();
    await expect(page.getByLabel('向 Pi 发送消息')).toBeEnabled();
    await expect(page).toHaveScreenshot('welcome-light.png', {
      mask: [page.locator('.statusbar')],
      maxDiffPixelRatio: 0.003,
    });
    await page.screenshot({ path: join(shots, 'welcome-light.png') });
    await page.getByLabel('向 Pi 发送消息').fill('请创建示例文件并检查 PowerShell。');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.getByLabel('待审批操作')).toBeVisible();
    await page.screenshot({ path: join(shots, 'approval-light.png') });
    await page.getByRole('button', { name: '允许这一次' }).click();
    await expect(page.getByText('已完成示例任务。', { exact: false })).toBeVisible();
    await expect
      .poll(async () => readFile(join(projectPath, 'hello.txt'), 'utf8'))
      .toContain('Hello Pi Desktop');
    await page.getByLabel('刷新 Git').click();
    await page
      .getByRole('button', { name: /hello.txt/ })
      .first()
      .click();
    await expect(page.locator('.diff')).toContainText('+Hello Pi Desktop');
    await page.screenshot({ path: join(shots, 'workspace-light.png') });
    await page.getByLabel('集成终端').click();
    await page.getByRole('button', { name: /在当前项目启动/ }).click();
    await page.locator('.xterm-helper-textarea').fill('Write-Output TERMINAL_OK');
    await page.locator('.xterm-helper-textarea').press('Enter');
    await expect
      .poll(async () =>
        ((await page.evaluate(() => window.desktop.invoke({ op: 'bootstrap' }))) as Bootstrap).terminals
          .map((t) => t.output)
          .join(''),
      )
      .toContain('TERMINAL_OK');
    await page.getByLabel('新建终端').click();
    await expect(page.locator('.terminal-tabs>button').filter({ hasText: 'PowerShell' })).toHaveCount(2);
    await page.getByLabel('终止终端').click();
    await expect(page.locator('.terminal-tabs')).toContainText('已退出');
    await page.getByLabel('隐藏终端').click();
    await page.getByLabel('浏览器预览').click();
    await page.getByLabel('预览地址').fill(url);
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await expect
      .poll(async () =>
        application!.evaluate(
          ({ webContents }, target) =>
            webContents.getAllWebContents().some((contents) => contents.getURL() === `${target}/`),
          url,
        ),
      )
      .toBe(true);
    await expect
      .poll(async () =>
        application!.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].contentView.children.at(-1)?.getBounds().width || 0,
        ),
      )
      .toBeGreaterThan(100);
    await page.screenshot({ path: join(shots, 'preview-light.png') });
    await page.getByLabel('关闭预览').click();
    await page.keyboard.press('Control+,');
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '通用', exact: true }).click();
    await page.getByLabel('主题', { exact: true }).click();
    await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: join(shots, 'settings-dark.png') });
    await page.locator('.thread-row').first().click();
    await page
      .getByRole('button', { name: /hello.txt/ })
      .first()
      .click();
    await expect(page.locator('.diff')).toContainText('+Hello Pi Desktop');
    await page.screenshot({ path: join(shots, 'workspace-dark.png') });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1050, 720));
    await expect(page.getByLabel('向 Pi 发送消息')).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.getByLabel('搜索任务', { exact: true })).toBeFocused();
    await page.getByLabel('归档任务').click();
    await expect(page.locator('.thread-row')).toHaveCount(0);
    await page.getByRole('button', { name: '已归档任务' }).click();
    await expect(page.locator('.thread-row')).toHaveCount(1);
    await page.getByLabel('恢复任务', { exact: true }).click();
    await page.getByRole('button', { name: '查看活跃任务' }).click();
    await page.evaluate(() =>
      window.desktop.invoke({
        op: 'automation.save',
        automation: {
          id: 'restart-job',
          name: '重启检查',
          projectId: 'project',
          prompt: '检查项目',
          intervalMinutes: 60,
          enabled: true,
          nextRunAt: Date.now() - 1000,
        },
      }),
    );
    await application.close();
    application = await launch();
    const restoredPage = await application.firstWindow();
    await expect
      .poll(
        async () =>
          ((await restoredPage.evaluate(() => window.desktop.invoke({ op: 'bootstrap' }))) as Bootstrap).data
            .automations[0]?.lastThreadId,
      )
      .toBeTruthy();
    await expect(restoredPage.locator('.thread-row')).toHaveCount(2);
    await expect(restoredPage.locator('html')).toHaveAttribute('data-theme', 'dark');
    await restoredPage.getByRole('button', { name: /待审阅/ }).click();
    await expect(restoredPage.getByRole('heading', { name: '待审阅', exact: true })).toBeVisible();
    await expect(restoredPage.getByRole('button', { name: '查看结果' })).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await application?.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('first run registers a project and saves a model key through Windows encryption', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'pi-desktop-first-'));
  const projectPath = join(storage, '新项目');
  await mkdir(projectPath);
  const env = { ...process.env, PI_DESKTOP_USER_DATA: storage } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({
    ...(process.env.PI_DESKTOP_EXECUTABLE
      ? { executablePath: process.env.PI_DESKTOP_EXECUTABLE, args: [`--user-data-dir=${storage}`] }
      : { args: [resolve('out/main/index.js')] }),
    env,
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole('heading', { name: '开始你的下一个想法' })).toBeVisible();
    await application.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, projectPath);
    await page.getByRole('button', { name: '添加本地项目' }).click();
    await expect(page.getByRole('heading', { name: '在 新项目 中构建' })).toBeVisible();
    await page.getByRole('button', { name: /配置 API Key 和模型/ }).click();
    await page.getByRole('button', { name: '添加提供商' }).click();
    await page.getByLabel('显示名称', { exact: true }).fill('测试提供商');
    await page.getByRole('button', { name: '创建提供商' }).click();
    await page.getByRole('button', { name: '添加模型' }).click();
    await page.locator('.model-catalog-options').getByRole('checkbox').first().check();
    await page.getByRole('button', { name: '添加所选模型' }).click();
    await page.getByLabel(/^API Key/).fill('desktop-fake-secret-for-test');
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.getByRole('status')).toContainText('设置已保存');
    await expect
      .poll(
        async () =>
          ((await page.evaluate(() => window.desktop.invoke({ op: 'bootstrap' }))) as Bootstrap).data.settings
            .modelProviders[0].hasKey,
      )
      .toBe(true);
    expect(await readFile(join(storage, 'secrets.json'), 'utf8')).not.toContain(
      'desktop-fake-secret-for-test',
    );
    await page.getByRole('button', { name: '通用', exact: true }).click();
    await page.getByLabel('主题', { exact: true }).click();
    await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
    await page.getByRole('button', { name: '保存设置' }).click();
    await page.locator('.thread-row').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page).toHaveScreenshot('welcome-dark.png', {
      mask: [page.locator('.statusbar')],
      maxDiffPixelRatio: 0.003,
    });
  } finally {
    await application.close();
  }
});
