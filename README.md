# Nuxt on Hetzner with SST, Caddy and Cloudflare

This is just a simple starter to deploy your [Nuxt](https://nuxt.com) app on a [Hetzner Cloud](https://www.hetzner.com/cloud) server.

## Getting started

You will need:

 - Hetzner Cloud account & create and API Token
 - CloudFlare Account & create 2 API Tokens:
   1. One with `DNS::edit` permissions on a specific zone
   2. One with `Zone::read` permissions on all zones
- You will also need to get your CloudFlare Zone ID and Account ID for the env vars

## Setup

1. Clone this repo

        git clone https://github.com/Eckhardt-D/nuxt-hetzner.git

2. Install dependencies

        cd nuxt-hetzner && bun install

3. Copy the .env.example file to .env and fill in the required values

        cp .env.example .env

4. Edit your app in `./nuxt` folder (you will have to install these deps too)

5. Run the deploy script

        bun run deploy

## What happens?

The deploy script is pretty self-explanatory in the `sst.config.ts` file on what it creates. But in short:

 - It creates a new Hetzner Cloud server
 - It creates a new CloudFlare DNS record
 - It builds and runs Nuxt in a docker container
 - It sets up a reverse proxy with Caddy in a different container that points to nuxt

## Delete everything

        bunx sst remove --stage=production


## NB

This was just an experiment on self-hosting Nuxt with SST. There may be bugs or limitations. Feel free to fork and improve it.
        
