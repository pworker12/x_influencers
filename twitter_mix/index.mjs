// index.mjs (multi-webhook, multi-username-group)

import "dotenv/config";
import fs from "fs/promises";
import { WebhookClient } from "discord.js";
import { fetchLatestPosts } from "../x.com/fetchPosts.mjs";

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function getEnvList(key) {
  const v = process.env[key];
  if (!v) return [];
  return v
    .split(/\r?\n|\\n/g) // real newlines OR literal "\n"
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- URL normalization to avoid duplicates ---
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url.replace(/\?.*$/, "").replace(/\/$/, "");
  }
}

async function loadSent(file) {
  try {
    const txt = await fs.readFile(file, "utf-8");
    return JSON.parse(txt);
  } catch {
    return [];
  }
}

async function saveSent(file, sent) {
  await fs.writeFile(file, JSON.stringify(sent, null, 2), "utf-8");
}

function buildGroupsFromEnv() {
  const groups = [];
  for (let i = 1; i <= 50; i++) {
    const webhookKey = `DISCORD_WEBHOOK_${i}`;
    const usernamesKey = `X_USERNAMES${i}`;

    const webhookUrl = process.env[webhookKey];
    const usernames = getEnvList(usernamesKey);

    if (!webhookUrl && usernames.length === 0) continue;

    if (!webhookUrl) {
      console.error(`Missing env ${webhookKey} for group ${i}`);
      process.exit(1);
    }
    if (usernames.length === 0) {
      console.error(`Missing/empty env ${usernamesKey} for group ${i}`);
      process.exit(1);
    }

    groups.push({
      id: i,
      webhookKey,
      usernamesKey,
      webhookUrl,
      usernames,
    });
  }

  if (groups.length === 0) {
    console.error("No groups configured. Expected env like DISCORD_WEBHOOK_1 and X_USERNAMES1.");
    process.exit(1);
  }

  return groups;
}

async function processUsername({ groupId, webhook, username }) {
  const safeUser = username.replace(/[^\w.-]/g, "_");
  const stateFile = `./twitter_mix/group_${groupId}_last_link_${safeUser}.json`;

  const sent = await loadSent(stateFile);
  const normalizedSent = sent.map(normalizeUrl);

  const links = await fetchLatestPosts(username, 10);
  console.log(`[G${groupId}] Fetched links for ${username}:`, links);

  let newLinks = links.filter((link) => !normalizedSent.includes(normalizeUrl(link)));
  if (!newLinks.length) return;

  newLinks = Array.from(new Set(newLinks)).reverse();

  for (const link of newLinks) {
    const fixedLink = link.replace(/x\.com/, "fixupx.com");
    console.log(`[G${groupId}] Sending link for ${username}:`, fixedLink);
    await webhook.send({ content: fixedLink, allowed_mentions: { parse: [] } });
    await sleep(1000);
  }

  const updatedSent = Array.from(
    new Set([...normalizedSent, ...newLinks.map(normalizeUrl)])
  );
  await saveSent(stateFile, updatedSent);
}

async function main() {
  const groups = buildGroupsFromEnv();

  const webhooks = new Map();
  for (const g of groups) {
    webhooks.set(g.id, new WebhookClient({ url: g.webhookUrl }));
  }

  try {
    for (const g of groups) {
      const webhook = webhooks.get(g.id);

      console.log(
        `Processing group ${g.id}: ${g.usernames.length} usernames -> ${g.webhookKey}`
      );

      for (const username of g.usernames) {
        try {
          await processUsername({ groupId: g.id, webhook, username });
        } catch (err) {
          console.error(`[G${g.id}] Error processing user ${username}:`, err);
        }
      }
    }
  } catch (error) {
    console.error("Error in main execution:", error);
  } finally {
    console.log("Finished processing all groups.");
    for (const wh of webhooks.values()) {
      await wh.destroy?.();
    }
  }
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
