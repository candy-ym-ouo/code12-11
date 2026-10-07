import { expect, test, type Page } from "@playwright/test";

const stamp = Date.now();
const email = `e2e-${stamp}@example.com`;
const password = "Nature#2025";
const siteName = `端到端观察点 ${stamp}`;
const observationTitle = `银杏发芽 ${stamp}`;

test.describe.configure({ mode: "serial" });

/** Element Plus 的 select 需要先点触发器再选下拉项，这里封装成稳定操作。 */
async function selectFromFormItem(page: Page, label: string, option: string | RegExp) {
  const item = page
    .locator(".el-form-item")
    .filter({ has: page.locator(".el-form-item__label", { hasText: label }) })
    .first();
  await item.locator(".el-select__wrapper").first().click();
  await page.locator(".el-select-dropdown:visible").getByText(option).first().click();
}

test("注册 → 建地点 → 导入物种 → 记录 → 时间线可见", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("昵称").fill("端到端测试");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码").fill(password);
  await page.getByRole("button", { name: "注册" }).click();

  await expect(page.getByRole("heading", { name: "观察时间线" })).toBeVisible({ timeout: 20_000 });

  // 1. 新建观察地点
  await page.getByRole("link", { name: "地点", exact: true }).click();
  await page.getByRole("button", { name: /新建地点/ }).first().click();
  await page.getByLabel("地点名称").fill(siteName);
  await page.getByLabel("生境").fill("校园绿地");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: siteName })).toBeVisible({ timeout: 20_000 });

  // 2. 从预置库导入银杏（连同物候阶段一起复制）
  await page.getByRole("link", { name: "物种", exact: true }).click();
  await page.locator("label.el-radio-button", { hasText: "系统预置库" }).click();
  const ginkgoCard = page.locator("article", { hasText: "银杏" }).first();
  await ginkgoCard.getByRole("button", { name: "添加到我的物种" }).click();
  await expect(page.getByText("已将「银杏」加入我的物种")).toBeVisible({ timeout: 20_000 });

  // 3. 新建一条观测记录
  await page.getByRole("link", { name: "时间线", exact: true }).click();
  // 桌面端是页头按钮，移动端是右下角悬浮按钮，两者名称不同
  await page.getByRole("button", { name: /新增(观察)?记录/ }).first().click();
  await selectFromFormItem(page, "观察地点", siteName);
  await selectFromFormItem(page, "物种", "银杏");
  await selectFromFormItem(page, "物候阶段", "发芽");
  await page.getByLabel("标题").fill(observationTitle);
  await page.getByLabel("文字记录").fill("芽鳞裂开，约三分之一芽已显绿");
  await page.getByRole("button", { name: "保存记录" }).click();

  // 4. 保存后进入详情页
  await expect(page.getByRole("heading", { name: observationTitle })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("芽鳞裂开，约三分之一芽已显绿")).toBeVisible();

  // 5. 时间线上可以看到这条记录
  await page.goto("/");
  await expect(page.getByText(observationTitle)).toBeVisible({ timeout: 20_000 });

  // 6. 跨年对比：只有一年数据时要给出明确提示
  await page.goto("/compare");
  await page.locator(".el-select__wrapper").first().click();
  await page.locator(".el-select-dropdown:visible").getByText(siteName).first().click();
  await page.locator(".el-select__wrapper").nth(1).click();
  await page.locator(".el-select-dropdown:visible").getByText("银杏").first().click();
  await expect(page.getByText("可用年份不足 2 年，暂不计算基准")).toBeVisible({ timeout: 20_000 });
});

test("匿名分享页只读可访问", async ({ page, request }) => {
  const login = await request.post("/api/v1/auth/login", {
    data: { email: "demo@nature.local", password: "Nature#2025" },
  });
  expect(login.ok()).toBeTruthy();
  const token = (await login.json()).data.accessToken as string;

  const sites = await request.get("/api/v1/sites", { headers: { Authorization: `Bearer ${token}` } });
  const site = (await sites.json()).data[0] as { id: string; name: string };
  const siteId = site.id;

  const share = await request.post(`/api/v1/sites/${siteId}/share`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { scope: "TIMELINE_AND_COMPARE", expiresInDays: 7 },
  });
  expect(share.ok()).toBeTruthy();
  const { token: shareToken } = (await share.json()).data;

  await page.goto(`/share/${shareToken}`);
  await expect(page.getByText("只读分享")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: site.name })).toBeVisible();
  await expect(page.getByText("由 演示观察者 分享", { exact: false })).toBeVisible();
});
