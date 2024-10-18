/// <reference path="./.sst/platform/config.d.ts" />
import { env } from "node:process";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { checkEnv } from "./utils/env";
checkEnv(env);
export default $config({
  app(input) {
    return {
      name: "nuxt-hetzner",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "local",
      providers: {
        tls: "5.0.9",
        hcloud: "1.20.5",
        docker: "4.5.7",
        cloudflare: "5.41.0",
        "@pulumi/command": "1.0.1",
      },
    };
  },
  async run() {
    // Set up CloudFlare DNS for the Nuxt App
    const domain =
      {
        production: `${env.DOMAIN_NAME}`,
        dev: `dev.${env.DOMAIN_NAME}`,
      }[$app.stage] || `${$app.stage}.dev.${env.DOMAIN_NAME}`;

    // Set up Caddy to reverse proxy to the Nuxt App et al.
    const defaultCaddyfile = `
      # Catch-all for any other requests
      :80, :443 {
        respond "Not Found" 404
      }
    `;

    // The text to write to the Caddyfile
    const caddyfile =
      defaultCaddyfile +
      `
      https://${domain} {
        reverse_proxy nuxt_app_container:3000

        tls {
          dns cloudflare {
            zone_token {env.CF_ZONE_TOKEN}
            api_token {env.CF_API_TOKEN}
          }
        }
      }
    `;

    // Create local SSH Key for the Server
    const sshKeyLocal = new tls.PrivateKey("SSH Key - Local", {
      algorithm: "ED25519",
    });

    // Create an SSH Key on the Hetzner Cloud
    const sshKeyRemote = new hcloud.SshKey("SSH Key - Remote", {
      publicKey: sshKeyLocal.publicKeyOpenssh,
    });

    // Create a Firewall with a rule to allow SSH
    const firewall = new hcloud.Firewall("Server Firewall", {
      rules: [
        {
          direction: "in",
          protocol: "tcp",
          port: "22",
          sourceIps: ["0.0.0.0/0", "::/0"],
        },
        {
          direction: "in",
          protocol: "tcp",
          port: "443",
          sourceIps: ["0.0.0.0/0", "::/0"],
        }
      ],
    });

    // Create a Server with the SSH Key that
    // houses all the necessary services
    const server = new hcloud.Server("NuxtStackServer", {
      image: "debian-12",
      serverType: "cax11",
      sshKeys: [sshKeyRemote.id],
      userData: [
        `#!/bin/bash`,
        `apt-get update`,
        `apt-get install -y docker.io apparmor`,
        `systemctl enable --now docker`,
        `usermod -aG docker debian`,
      ].join("\n"),
    });

    // Point the domain to the Server's IP Address
    new cloudflare.Record("Server DNS record", {
      name: domain,
      zoneId: env.CLOUDFLARE_ZONE_ID!,
      type: "A",
      content: server.ipv4Address,
      // This requires you to set DNS SSL to Full (Strict)
      // set to false if you don't want to do that
      proxied: true,
    }, { dependsOn: [server] });

    // Attach Firewall to the Server
    new hcloud.FirewallAttachment("Server Firewall Attachment", {
      firewallId: firewall.id.apply((id) => +id),
      serverIds: [server.id.apply((id) => +id)],
    });

    // Write the SSH Private Key to a File locally when doing first run
    const keyPath = sshKeyLocal.privateKeyOpenssh.apply((key) => {
      const path = "deploy_key";
      writeFileSync(path, key, { mode: 0o600 });
      return resolve(path);
    });

    // Wait for docker to be ready
    const dockerReady = new command.remote.Command(
      "Docker Ready",
      {
        connection: {
          host: server.ipv4Address,
          user: "root",
          privateKey: sshKeyLocal.privateKeyOpenssh,
        },
        create: $interpolate`until systemctl is-active --quiet docker; do sleep 5; done`
      },
      { dependsOn: [server] },
    );
    
    // Create a Docker Provider (reusable for more Docker resources)
    const dockerProvider = new docker.Provider("Docker", {
      host: $interpolate`ssh://root@${server.ipv4Address}`,
      sshOpts: ["-i", keyPath, "-o", "StrictHostKeyChecking=no"],
    }, {dependsOn: [server, dockerReady]});

    // Build the Nuxt Docker Image
    const nuxt = new docker.Image(
      "NuxtApp",
      {
        imageName: "nuxt-hetzner/nuxt",
        build: {
          context: resolve("./nuxt"),
          dockerfile: resolve("./nuxt/Dockerfile"),
          platform: "linux/arm64",
        },
        skipPush: true,
      },
      { provider: dockerProvider, dependsOn: [server] },
    );

    // Create a Private Docker Network for the Nuxt App
    const dockerNetworkNuxt = new docker.Network(
      "Nuxt Docker Network - Private",
      { name: "nuxt_app_network_private" },
      { provider: dockerProvider, dependsOn: [server] },
    );

    // Create a Docker Volume for the Nuxt App Build Output
    const dockerVolumeNuxt = new docker.Volume(
      "Nuxt Docker Volume",
      { name: "nuxt_app_volume" },
      { provider: dockerProvider, dependsOn: [server] },
    );

    // Start the Nuxt Docker Container
    new docker.Container(
      "Nuxt Docker Container",
      {
        name: "nuxt_app_container",
        image: nuxt.imageName,
        volumes: [
          {
            volumeName: dockerVolumeNuxt.name,
            containerPath: "/usr/src/app/.output",
          },
        ],
        networksAdvanced: [{ name: dockerNetworkNuxt.id }],
        mustRun: true,
        restart: "always",
        ports: [
          {
            internal: 3000,
            external: 3000,
          },
        ],
        healthcheck: {
          tests: ["CMD", "curl", "-f", "http://localhost:3000"],
          interval: "30s",
          timeout: "5s",
          retries: 5,
          startPeriod: "30s",
        },
      },
      { provider: dockerProvider, dependsOn: [server, dockerNetworkNuxt]},
    );

    // Set up the Caddy Server
    // Data volume
    const caddyDataVolume = new docker.Volume("Caddy Data Volume", {
      name: "caddy_data_volume",
    }, { dependsOn: [server] });

    // Config volume
    const caddyConfigVolume = new docker.Volume("Caddy Config Volume", {
      name: "caddy_config_volume",
    }, { dependsOn: [server] });

    // Build the Caddy Docker Image
    const caddy = new docker.Image(
      "Caddy",
      {
        imageName: "nuxt-hetzner/caddy",
        build: {
          context: resolve("./caddy"),
          dockerfile: resolve("./caddy/Dockerfile"),
          platform: "linux/arm64",
        },
        skipPush: true,
      },
      { provider: dockerProvider, dependsOn: [server] },
    );

    // Write the Caddyfile to the remote
    const writeCaddyFile = new command.remote.Command(
      "Write Caddyfile",
      {
        connection: {
          host: server.ipv4Address,
          user: "root",
          privateKey: sshKeyLocal.privateKeyOpenssh,
        },
        create: `echo '${caddyfile}' > /root/Caddyfile`,
      },
      { dependsOn: [server, sshKeyLocal] },
    );

    // Start the caddy reverse_proxy container
    new docker.Container(
      "Caddy Docker Container",
      {
        name: "caddy_container",
        image: caddy.imageName,
        envs: [
          `CF_API_TOKEN=${env.CLOUDFLARE_API_TOKEN}`,
          `CF_ZONE_TOKEN=${env.CLOUDFLARE_ZONE_TOKEN}`,
        ],
        ports: [
          { internal: 80, external: 80 },
          { internal: 443, external: 443 },
          { internal: 2019, external: 2019 },
          { internal: 8080, external: 8080 },
        ],
        networksAdvanced: [{ name: dockerNetworkNuxt.id }],
        volumes: [
          {
            containerPath: "/etc/caddy/Caddyfile",
            hostPath: "/root/Caddyfile",
          },
          { containerPath: "/data", volumeName: caddyDataVolume.id },
          { containerPath: "/config", volumeName: caddyConfigVolume.id },
        ],
        restart: "always",
        mustRun: true,
      },
      { provider: dockerProvider, dependsOn: [server, writeCaddyFile, dockerNetworkNuxt] },
    );
  },
});
