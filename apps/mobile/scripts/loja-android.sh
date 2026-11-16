#!/usr/bin/env bash
# Gera o pacote do Google Play (.aab) já assinado com a chave de envio.
# Uso (dentro de apps/mobile): pnpm loja:android
# Opcional: ORGANIZEUP_NDK=28.1.13356709 pnpm loja:android, se o NDK padrão estiver quebrado.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! grep -qs '^ORGANIZEUP_UPLOAD_STORE_FILE=' "$HOME/.gradle/gradle.properties"; then
  echo "Falta a chave de envio. Rode antes: bash scripts/chave-android.sh"
  exit 1
fi

# O build de loja sempre fala com a produção (src/lib/config.ts); mesmo assim, nada de servidor
# local no pacote final.
export NODE_ENV=production
npx expo prebuild --platform android --clean --no-install

EXTRA=()
if [ -n "${ORGANIZEUP_NDK:-}" ]; then EXTRA+=("-Porganizeup.ndkVersion=$ORGANIZEUP_NDK"); fi

(cd android && ./gradlew bundleRelease "${EXTRA[@]}")

AAB="android/app/build/outputs/bundle/release/app-release.aab"
echo
echo "Pronto: $(pwd)/$AAB"
echo "Envie esse arquivo na Play Console (Testes > Teste interno ou fechado > Criar versão)."
