export function checkEnv(env: NodeJS.ProcessEnv) {
  const required = [
    "HCLOUD_TOKEN",
    "DOMAIN_NAME",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ZONE_TOKEN",
    "CLOUDFLARE_DEFAULT_ACCOUNT_ID",
    "CLOUDFLARE_ZONE_ID",
  ];

  const missing = required.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

