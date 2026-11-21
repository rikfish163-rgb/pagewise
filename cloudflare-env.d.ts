declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    hts01?: string;
    PAGEWISE_LEGACY_EMAILS?: string;
    PAGEWISE_ADMIN_EMAILS?: string;
    AUTHING_ISSUER?: string;
    AUTHING_CLIENT_ID?: string;
    AUTHING_CLIENT_SECRET?: string;
    AUTHING_GOOGLE_CONNECTION_ID?: string;
    AUTHING_WECHAT_CONNECTION_ID?: string;
    SITE_AUTH_ORIGIN?: string;
  }
}
