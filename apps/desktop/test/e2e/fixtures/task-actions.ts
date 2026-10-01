import type { Page } from '@playwright/test';

/** Use the visible task menu, including its real focus and popover lifecycle. */
export async function taskAction(page: Page, label: string) {
  await page.locator('.toolbar .task-actions-trigger').click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}
