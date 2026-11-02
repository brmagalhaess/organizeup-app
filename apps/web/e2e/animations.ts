import type { Page } from "@playwright/test";

/**
 * Espera as animações e transições em curso. O axe lê a cor do jeito que está: no meio de um fade, ou de um
 * botão que acabou de ligar, ele mede um contraste que a tela não tem depois de parada. Animação sem fim, como
 * a de carregando, não entra na espera.
 */
export async function animationsDone(page: Page) {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
}
