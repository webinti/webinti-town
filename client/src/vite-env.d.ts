/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  readonly VITE_POCKETBASE_URL?: string;
  readonly VITE_HOST_EMAIL?: string;
  // 'selfhosted' sur une instance client auto-hébergée (masque l'UI SaaS).
  readonly VITE_EDITION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
