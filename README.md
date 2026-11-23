# Tuya Brand

A responsive, single-owner online store in Mongolian with prices in Mongolian tögrög. Customers can browse, filter discounts, check stock, add items to a bag and submit pickup or delivery orders. The owner confirms payment and fulfillment separately. The store does not collect card details or process online payments.

## Local preview

Requires Node.js 24 and npm.

```bash
npm ci
npm run db:local
npm run demo:local
npm run dev
```

Open the local URL printed by Wrangler. To try the product dashboard, create a local ignored file called `.dev.vars` before starting the server and set `ADMIN_PASSWORD` to your own password of at least 16 characters. Sign in at `/admin` as `dorjster`.

Sample products and AI-generated product photography are for development. The remote database starts with an empty catalog. The storefront hero uses separate decorative lifestyle imagery.

## Deploy from GitHub

Use a dedicated repository under the Dorjster account, with this project at the root and the default branch named `main`. The workflow in `.github/workflows/deploy.yml` validates each push to `main` and deploys to Cloudflare Workers when the production D1 database is configured.

1. In Cloudflare, activate a Workers subdomain and create a D1 database named `tuya-brand`. Copy the Cloudflare account ID and the D1 database ID.
2. Create a Cloudflare API token scoped to the account with Workers Scripts Edit and D1 Edit permissions. The token grants GitHub Actions deployment access.
3. In the GitHub repository under **Settings → Secrets and variables → Actions**, add repository variables `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_DATABASE_ID`. Add repository secrets `CLOUDFLARE_API_TOKEN` and `STORE_ADMIN_PASSWORD`. Use a unique 16–256 character admin password.
4. Open the **Actions** tab, select **Validate and deploy store**, and run it on `main`. The production URL appears in the **Publish store** step after a successful deployment.
5. Open `/admin` on the live URL and sign in as `dorjster`. Add products as drafts. Enter their category, description, price, stock and up to four photos. Enable **Дэлгүүрт харуулах** when ready.

## Бараа нэмэх

1. `/admin` руу орж, **Бараа → Бараа нэмэх**-ийг сонгоно.
2. Нэр, ангилал, тайлбар, үндсэн үнэ болон үлдэгдэл тоогоо оруулна. Хямдралтай бол үндсэн үнээс бага үнийг **Хямдралын үнэ** талбарт бичнэ.
3. JPEG, PNG, WebP форматаар 4 хүртэл зураг сонгоно. Эхний зураг жагсаалтад нүүр зураг болно.
4. Нийтлэх бол **Дэлгүүрт харуулах**-ыг идэвхжүүлээд **Бараа хадгалах**-ыг дарна. Уг сонголтыг идэвхжүүлээгүй бол бараа ноорог хэвээр хадгалагдана.

## Store operations

- Set an optional sale price below the regular price. The product will appear in the sale filter while it has a sale price.
- Use **Дэлгүүрт харуулах** to publish or unpublish a product. Product availability updates across devices. Photo uploads are resized in the browser and replace the current image set.
- New orders reserve stock at submission. Mark an order fulfilled when it is complete. Cancelling an open order restores its items to inventory.
- The admin account uses a persistent server-side session with automatic expiry. Set or change the password through the GitHub Actions secret and rerun deployment. Existing sessions expire after eight hours.
