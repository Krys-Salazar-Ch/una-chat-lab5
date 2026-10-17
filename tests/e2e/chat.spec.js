// @ts-check
// Pruebas end-to-end: navegador real (Chromium) + frontend + backend de UNA Chat.
const { test, expect } = require('@playwright/test');

// Medios de prueba conocidos y estables, servidos por el propio backend.
const IMAGEN = 'http://localhost:3000/media/una.png';
const VIDEO = 'http://localhost:3000/media/una.webm';
const SCRIPT = "<script>alert('Inyección de script');</script>";

async function enviarMensaje(page, texto) {
  await page.getByRole('textbox', { name: 'Usuario' }).fill('Krys');
  await page.getByRole('textbox', { name: 'Mensaje' }).fill(texto);
  await page.getByRole('button', { name: 'Send' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('enviar una URL de imagen la muestra y termina de cargar', async ({ page }) => {
  await enviarMensaje(page, IMAGEN);

  const imagen = page.getByRole('img', { name: 'Imagen compartida' }).last();
  await expect(imagen).toBeVisible();
  await expect(imagen).toHaveAttribute('src', IMAGEN);

  // la imagen terminó de cargar y tiene dimensiones reales
  await expect.poll(() =>
    imagen.evaluate((img) => img.complete && img.naturalWidth > 0)
  ).toBe(true);
});

test('enviar una URL de video muestra el reproductor y carga el contenido', async ({ page }) => {
  await enviarMensaje(page, VIDEO);

  const video = page.locator('#messages video').last();
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('src', VIDEO);
  await expect(video).toHaveAttribute('controls', '');

  // readyState >= 1 (HAVE_METADATA): el navegador cargó el video y conoce su duración
  await expect.poll(() =>
    video.evaluate((v) => v.readyState >= 1 && v.duration > 0)
  ).toBe(true);
});

test('el script del paso 2 no se ejecuta y el mensaje queda bloqueado', async ({ page }) => {
  // Registrar el listener ANTES de enviar: si aparece un alert, la prueba falla.
  const dialogos = [];
  page.on('dialog', async (dialog) => {
    dialogos.push(dialog.message());
    await dialog.dismiss();
  });

  await enviarMensaje(page, SCRIPT);

  const ultimo = page.locator('#messages li').last();
  await expect(ultimo).toContainText('mensaje bloqueado');
  // el script se muestra como texto, no como código
  await expect(ultimo).toContainText(SCRIPT);
  await expect(page.locator('#messages script')).toHaveCount(0);
  await expect(ultimo).toHaveAttribute('data-tipo', 'bloqueado');

  // margen para que un alert tardío se dispare si existiera
  await page.waitForTimeout(1000);
  expect(dialogos, `Se ejecutó un alert: ${dialogos.join(', ')}`).toHaveLength(0);
});
