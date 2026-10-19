# Deploying `kukulu.tech`

The site is `site/`, served as-is by Cloudflare Pages. There is no build step: Pages uploads the directory and applies `site/_headers`. Everything below is one-time setup except the launch checklist, which you run against a preview before the first production deploy and again after it.

## 1. Put the domain on Cloudflare

Pages can serve an apex domain such as `kukulu.tech` only when the domain is a zone on the same Cloudflare account as the Pages project ([custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)).

1. In the Cloudflare dashboard, add `kukulu.tech` as a site on the Free plan.
2. At the registrar where you bought `kukulu.tech`, replace its nameservers with the two Cloudflare assigns.
3. Wait for the zone to show **Active**.

Then set these zone options, because the page's Content-Security-Policy blocks any script Cloudflare injects, and the page promises no tracking:

| Setting | Where | Value |
|---|---|---|
| SSL/TLS encryption mode | SSL/TLS → Overview | Full |
| Always Use HTTPS | SSL/TLS → Edge Certificates | On |
| Email Address Obfuscation | Scrape Shield | Off |
| Rocket Loader | Speed → Optimization | Off |
| Web Analytics / Browser Insights | Analytics | Off for this site |

If the live page's console ever reports a CSP violation for a `/cdn-cgi/` script, a zone feature is injecting it. Turn that feature off rather than loosening the CSP.

## 2. Create the Pages project

Use the Git integration so every push to `main` deploys and every other branch, including Kūkulu's `build/<date>` branches, gets a preview. It works while the repository is still private.

1. **Workers & Pages → Create → Pages → Connect to Git.** Authorize the Cloudflare GitHub app for the `DisplaceTech` organization and pick the `kukulu` repository.
2. **Build settings:**

   | Field | Value |
   |---|---|
   | Project name | `kukulu` (gives `kukulu.pages.dev` if it is free) |
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | leave blank |
   | Build output directory | `site` |
   | Root directory | leave blank |

   With no framework, Cloudflare's guidance is to leave the build command blank ([build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)).
3. **Settings → Build → Build watch paths:** include `site/*`, exclude nothing. Pushes that only touch the plugin then skip the deploy ([build watch paths](https://developers.cloudflare.com/pages/configuration/build-watch-paths/)). Pages still builds when a push has no file changes, 3,000 or more changed files, or 20 or more commits.
4. Leave Pages Functions, environment variables and Web Analytics unset.

**Alternative: direct upload.** `npx wrangler pages deploy site --project-name kukulu --branch main` deploys from your machine without connecting GitHub. A project created this way cannot be switched to the Git integration later, so choose one before creating the project.

## 3. Attach the domain

1. Pages project → **Custom domains → Set up a domain** → `kukulu.tech`. Because the zone is on the same account, Cloudflare creates the DNS record.
2. Repeat for `www.kukulu.tech`.
3. In the zone, **Rules → Redirect Rules**, add a rule that sends `www.kukulu.tech/*` to `https://kukulu.tech/${1}` with status 301, preserving the query string.

`site/_headers` already marks every `*.pages.dev` copy of the site `noindex`, so only `kukulu.tech` is indexed.

## 4. Launch checklist

Run it against the branch preview URL that Cloudflare shows on the deployment, then against `https://kukulu.tech` after merging to `main`. Replace `$URL` with the address you are checking.

1. **Checks are green** on the deployed commit: `npm run check:site` and `npm run check:site:browser` (CI's `site` workflow runs both).
2. **Headers.**

   ```bash
   curl -sI "$URL/" | grep -iE 'content-security-policy|x-content-type-options|referrer-policy|strict-transport'
   curl -sI "$URL/marketplace.json" | grep -i 'content-type'      # application/json; charset=utf-8
   curl -s -o /dev/null -w '%{http_code}\n' "$URL/no-such-page"    # 404, not 200
   curl -sI "$URL/" | grep -i 'x-robots-tag'                       # present on pages.dev, absent on kukulu.tech
   ```

3. **The marketplace file validates.**

   ```bash
   mkdir -p /tmp/kukulu-mk/.claude-plugin
   curl -fsSL "$URL/marketplace.json" -o /tmp/kukulu-mk/.claude-plugin/marketplace.json
   claude plugin validate /tmp/kukulu-mk
   ```

4. **The install command works.** `DisplaceTech/kukulu` must be public, or your machine's git credentials must reach it. Claude Code allows only one marketplace per name, so if you already added the repo's `displacetech` marketplace, test from a second machine or account. Removing it with `claude plugin marketplace remove displacetech` also uninstalls the plugin. In a Claude Code session:

   ```text
   /plugin marketplace add $URL/marketplace.json
   /plugin install kukulu@displacetech
   ```

   Start a new session. `/kukulu:go-flight` should be available.
5. **The page, by eye.** Check a desktop browser and a phone, in light and dark system settings. Confirm:
   - nothing scrolls sideways;
   - the kahakō renders in every Kūkulu, including the figure caption and the footer;
   - the copy buttons copy;
   - Tab shows a focus ring on every link and button, starting with the skip link.
6. **The social card.** Paste `https://kukulu.tech/` into a draft post on Mastodon or Slack. The card shows `og.png` and the title.
7. **Before announcing,** make `DisplaceTech/kukulu`, `ericmann/cleanflate` and `ericmann/cleanflate-bench` public. The install command and the Proof section's links depend on them.

## Rolling back

Pages project → **Deployments**, pick the last good production deployment, then **Rollback to this deployment**. The rollback takes effect immediately and doesn't need a rebuild.
