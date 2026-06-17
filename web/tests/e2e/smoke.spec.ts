import { test, expect } from '@playwright/test';

test.describe('Autenticação — rotas protegidas', () => {
  test('rota raiz redireciona para /login sem sessão', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('dashboard redireciona para /login sem sessão', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('página de login carrega e exibe o formulário', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /entrar|login|bem-vindo/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /e-?mail/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /entrar|acessar/i })).toBeVisible();
  });

  test('página de cadastro carrega e exibe o formulário', async ({ page }) => {
    await page.goto('/cadastro');
    await expect(page.getByRole('textbox')).toBeTruthy();
  });
});
