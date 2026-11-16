#!/usr/bin/env bash
# Cria a chave de envio do Google Play (uma vez só). Quem roda é o fundador: o keytool pede a
# senha no terminal e ela não passa por nenhum arquivo do repositório.
#
# Guarde a pasta ~/.organizeup num lugar seguro (cofre de senhas, backup). Se perder a chave, dá
# para pedir outra ao Google (a Play guarda a chave que assina de verdade), mas leva dias.
set -euo pipefail

DIR="$HOME/.organizeup"
STORE="$DIR/organizeup-upload.jks"
ALIAS="organizeup-upload"

if [ -f "$STORE" ]; then
  echo "A chave já existe em $STORE. Nada a fazer."
  exit 0
fi

mkdir -p "$DIR"
chmod 700 "$DIR"
echo "Vou criar a chave de envio. O keytool vai pedir uma senha (use a mesma nas duas perguntas)."
keytool -genkeypair -v -storetype PKCS12 -keystore "$STORE" -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=OrganizeUp, O=CrownTech, C=BR"
chmod 600 "$STORE"

cat <<EOF

Chave criada em $STORE.

Agora abra ~/.gradle/gradle.properties (crie o arquivo se não existir) e acrescente estas
quatro linhas, trocando SUA_SENHA pela senha que você acabou de digitar:

ORGANIZEUP_UPLOAD_STORE_FILE=$STORE
ORGANIZEUP_UPLOAD_KEY_ALIAS=$ALIAS
ORGANIZEUP_UPLOAD_STORE_PASSWORD=SUA_SENHA
ORGANIZEUP_UPLOAD_KEY_PASSWORD=SUA_SENHA
EOF
