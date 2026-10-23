declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    REGISTRATION_ELIGIBILITY_ENABLED?: string;
    REGISTRATION_GUEST_CODE?: string;
    BUCKET?: R2Bucket;
  }
}
