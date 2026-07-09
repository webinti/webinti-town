// Génère la paire de clés Ed25519 du système de licence Webinti.
//
//   • CLÉ PRIVÉE  -> license-server/keys/private-key.pem
//     Reste UNIQUEMENT sur le serveur de licence de Webinti (ton infra).
//     Ne jamais committer, ne jamais livrer au client. C'est elle qui signe
//     les jetons : qui l'a peut fabriquer des licences valides.
//
//   • CLÉ PUBLIQUE -> server/src/license/publicKey.ts
//     Compilée dans le build livré au client self-host. Elle ne permet QUE de
//     vérifier une signature, pas d'en produire. Identique chez tous les clients.
//
// Usage :  node scripts/license-keygen.mjs [--force]
//   --force  écrase une clé privée existante (ATTENTION : invalide toutes les
//            licences déjà émises, il faudra redéployer tous les clients).

import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const keysDir = path.join(root, 'license-server', 'keys');
const privPath = path.join(keysDir, 'private-key.pem');
const pubTsPath = path.join(root, 'server', 'src', 'license', 'publicKey.ts');

if (existsSync(privPath) && !process.argv.includes('--force')) {
  console.error('⚠️  Une clé privée existe déjà :', privPath);
  console.error('    Relance avec --force pour l\'écraser (invalide toutes les licences émises).');
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

mkdirSync(keysDir, { recursive: true });
writeFileSync(privPath, privPem, { mode: 0o600 });

mkdirSync(path.dirname(pubTsPath), { recursive: true });
writeFileSync(
  pubTsPath,
  `// GÉNÉRÉ par scripts/license-keygen.mjs — ne pas éditer à la main.
// Clé PUBLIQUE de licence Webinti, compilée dans le build livré au client
// self-host. La clé privée correspondante reste sur le serveur de licence de
// Webinti et ne quitte jamais ton infra.
export const LICENSE_PUBLIC_KEY = ${JSON.stringify(pubPem)};
`,
);

console.log('✅ Paire de clés Ed25519 générée.');
console.log('   • Clé privée  :', privPath, '  (SECRET — ne jamais committer)');
console.log('   • Clé publique:', pubTsPath, '  (compilée dans le build client)');
