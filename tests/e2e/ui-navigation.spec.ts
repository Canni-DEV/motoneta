import { expect, test } from '@playwright/test';
import { nav, ready } from './ui-helpers';

test('back restores gallery scroll and focus; calendar selection follows reorder and shared conditions', async ({
  page,
}) => {
  await ready(page);
  await page.setViewportSize({ width: 640, height: 360 });
  await nav(page, 'quick');
  const scroll = page.locator('.track-grid');
  const before = await scroll.evaluate((el) => {
    el.scrollTop = 90;
    return el.scrollTop;
  });
  expect(before).toBeGreaterThan(0);
  await page.locator('[data-action="generator"]').click();
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  expect(await scroll.evaluate((el) => el.scrollTop)).toBe(before);
  await expect(page.locator('[data-action="generator"]')).toBeFocused();
  await nav(page, 'tournament');
  await page.locator('[data-action="setup-next"]').click();
  for (let i = 0; i < 3; i++) await page.locator('.track-card').nth(i).click();
  await page.locator('[data-action="course-select"][data-value="1"]').click();
  await page.locator('[data-course="1"][data-field="weather"]').selectOption('snow');
  await page.locator('[data-course="1"][data-field="laps"]').selectOption('4');
  await page.locator('[data-action="apply-all"]').click();
  const courses = await page.evaluate(() => (window as any).__motoneta.setup.courses);
  expect(courses.every((c: any) => c.weather === 'snow' && c.track.laps === 4)).toBe(true);
  await page.locator('[data-action="course-down"][data-value="1"]').click();
  await expect(page.locator('[data-action="course-select"][data-value="2"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('[data-action="course-remove"][data-value="0"]').click();
  await expect(page.locator('[data-action="course-select"][data-value="1"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await nav(page, 'quick');
  await page.locator('[data-action="start"]').click();
  await expect(page.locator('#position')).toBeInViewport();
  await expect(page.locator('#position')).toHaveText('1 / 1');
});
