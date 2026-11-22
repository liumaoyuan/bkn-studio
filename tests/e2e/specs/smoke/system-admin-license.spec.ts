/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { expect, test, type Page } from "@playwright/test";

async function expectConsoleShell(page: Page) {
  await expect(page.locator(".console-shell")).toBeVisible();
  await expect(page.locator(".console-main")).toBeVisible();
  await expect(page.locator(".console-main")).not.toContainText(/Not Found|Error|Failed/);
}

test.describe("system-admin license management", () => {
  test("renders license summary on a direct visit and keeps permission management naming separate", async ({
    page,
  }) => {
    await page.goto("/studio/system/license", { waitUntil: "domcontentloaded" });
    await expectConsoleShell(page);

    const main = page.locator(".console-main");
    await expect(main.getByText("授权管理", { exact: true })).toBeVisible();
    await expect(main.getByText("设备指纹", { exact: true })).toBeVisible();
    await expect(main.getByText("激活方式")).toBeVisible();
    // Community-only 前端不展示版本与订阅入口。
    await expect(main.getByRole("button", { name: "查看授权范围" })).toHaveCount(0);

    // The community distribution does not offer a license entry in the
    // system-admin menu; the page stays reachable by direct link and by the
    // subscription page's import action.
    await expect(page.getByRole("button", { name: /授权管理/ })).toHaveCount(0);

    // Permission management (权限管理) and license management (授权管理) remain
    // separate concepts: the sidebar entry is still there once the system group
    // is expanded.
    await page.getByRole("button", { name: /系统管理/ }).click();
    await expect(page.getByRole("button", { name: /权限管理/ })).toBeVisible();
  });
});
