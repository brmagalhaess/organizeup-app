#!/usr/bin/env bash
# Prepara o projeto do iPhone para enviar à App Store e abre o Xcode.
# Uso (dentro de apps/mobile): pnpm loja:ios
# No Xcode: escolha o seu time em Signing & Capabilities, destino "Any iOS Device",
# depois Product > Archive e, na janela que abre, Distribute App > App Store Connect.
set -euo pipefail
cd "$(dirname "$0")/.."

export NODE_ENV=production
# O CocoaPods falha com texto acentuado sem UTF-8.
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
npx expo prebuild --platform ios --clean
open ios/OrganizeUp.xcworkspace
