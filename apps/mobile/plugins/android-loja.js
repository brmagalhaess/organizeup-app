// Ajusta o Android gerado por `expo prebuild` para o build de loja (ADR-0045).
//
// 1. Assinatura: a versão final usa a chave de envio do Google Play quando
//    ~/.gradle/gradle.properties tem as quatro linhas ORGANIZEUP_UPLOAD_* (ver
//    scripts/chave-android.sh). Sem elas continua com a chave de teste, que serve para rodar no
//    emulador mas a Play Console recusa. A chave e as senhas nunca entram no repositório.
// 2. NDK: `-Porganizeup.ndkVersion=...` troca a versão do NDK, para máquinas em que a padrão
//    está quebrada (nesta, a 27.1 ficou vazia).
// O Expo carrega este arquivo com o `require` do Node, fora do Metro: precisa ser CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAppBuildGradle, withProjectBuildGradle } = require("expo/config-plugins");

const SIGNING = `
        release {
            if (project.hasProperty('ORGANIZEUP_UPLOAD_STORE_FILE')) {
                storeFile file(ORGANIZEUP_UPLOAD_STORE_FILE)
                storePassword ORGANIZEUP_UPLOAD_STORE_PASSWORD
                keyAlias ORGANIZEUP_UPLOAD_KEY_ALIAS
                keyPassword ORGANIZEUP_UPLOAD_KEY_PASSWORD
            }
        }`;

function patch(gradle) {
  if (gradle.includes("ORGANIZEUP_UPLOAD_STORE_FILE")) return gradle;
  let out = gradle.replace(/(signingConfigs \{\n)/, `$1${SIGNING.slice(1)}\n`);
  out = out.replace(
    /(release \{\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/,
    "$1signingConfig project.hasProperty('ORGANIZEUP_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
  );
  if (!out.includes("signingConfigs.release : signingConfigs.debug")) {
    throw new Error("android-loja: não achei onde trocar a assinatura no build.gradle gerado");
  }
  return out;
}

// As bibliotecas também leem `rootProject.ext.ndkVersion`: a troca é na raiz, antes do plugin do Expo
// que define a versão padrão.
const NDK = `ext { if (findProperty('organizeup.ndkVersion')) ndkVersion = findProperty('organizeup.ndkVersion') }\n`;

function patchRoot(gradle) {
  if (gradle.includes("organizeup.ndkVersion")) return gradle;
  const anchor = 'apply plugin: "expo-root-project"';
  if (!gradle.includes(anchor)) throw new Error("android-loja: não achei o plugin raiz do Expo");
  return gradle.replace(anchor, `${NDK}${anchor}`);
}

module.exports = (config) =>
  withProjectBuildGradle(
    withAppBuildGradle(config, (mod) => {
      mod.modResults.contents = patch(mod.modResults.contents);
      return mod;
    }),
    (mod) => {
      mod.modResults.contents = patchRoot(mod.modResults.contents);
      return mod;
    },
  );
module.exports.patch = patch;
module.exports.patchRoot = patchRoot;
