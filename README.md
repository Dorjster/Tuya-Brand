# Tuya Brand

A responsive, single-owner online store in Mongolian with prices in Mongolian tögrög. Customers can browse, filter discounts, check stock, add items to a bag and submit pickup or delivery orders. The owner confirms payment and fulfillment separately. The store does not collect card details or process online payments.

## Local preview

Requires Node.js 24 and npm.

```bash
npm ci
npm run db:local
npm run dev
```

Open the local URL printed by Wrangler. To try the product dashboard, create a local ignored file called `.dev.vars` before starting the server and set `ADMIN_PASSCODE` to your own password of exactly four digits. Enter that value in the single admin code field at `/admin`.

When the shop has no published products, it displays example Mongolian clothing designed from Tuya Brand garment reference photos. The example prices are illustrative and the samples are for browsing. Publishing a real product switches the storefront to the live catalog. The sample imagery shows the garments on their own.

## Deploy from GitHub

Use a dedicated repository under the Dorjster account, with this project at the root and the default branch named `main`. The workflow in `.github/workflows/deploy.yml` validates each push to `main` and deploys to Cloudflare Workers when the production D1 database is configured.

1. In Cloudflare, activate a Workers subdomain and create a D1 database named `tuya-brand`. Copy the Cloudflare account ID and the D1 database ID.
2. Create a Cloudflare API token scoped to the account with Workers Scripts Edit and D1 Edit permissions. The token grants GitHub Actions deployment access.
3. In the GitHub repository under **Settings → Secrets and variables → Actions**, add repository variables `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_DATABASE_ID`. Add repository secrets `CLOUDFLARE_API_TOKEN`, `STORE_ADMIN_PASSCODE`,. Use a unique four-digit admin PIN for `STORE_ADMIN_PASSCODE`.
4. Open the **Actions** tab, select **Validate and deploy store**, and run it on `main`. The production URL appears in the **Publish store** step after a successful deployment.
5. Open `/admin` on the live URL and sign in with the admin code saved as `STORE_ADMIN_PASSCODE`. Add products as drafts. Enter their category, description, price, stock and up to four photos. Enable **Дэлгүүрт харуулах** when ready.

## Бараа нэмэх

1. `/admin` руу орж, **Бараа → Бараа нэмэх**-ийг сонгоно.
2. Нэр, ангилал, тайлбар, үндсэн үнэ болон үлдэгдэл тоогоо оруулна. Хямдралтай бол үндсэн үнээс бага үнийг **Хямдралын үнэ** талбарт бичнэ.
3. JPEG, PNG, WebP форматаар 4 хүртэл зураг сонгоно. Эхний зураг жагсаалтад нүүр зураг болно.
4. Өнгөнүүдээ сонгоод хүсвэл өнгө бүрт тохирох зургийн дугаар онооно.
5. Нийтлэх бол **Дэлгүүрт харуулах**-ыг идэвхжүүлээд **Бараа хадгалах**-ыг дарна. Уг сонголтыг идэвхжүүлээгүй бол бараа ноорог хэвээр хадгалагдана.

Барааны мэдээллийг Markdown-аар оруулахдаа [Tuya Brand-ийн Markdown загвар](public/TUYA_PRODUCT_IMPORT.md)-ыг ашиглана.

## Store operations

- Use **Нүүр хуудас** in the admin dashboard to change the cover image, wording, theme, and photo focal point. Settings apply to the next storefront visit.
- Use **Ангилал** to manage product types. Removing a type moves its products to **Ангилалгүй**. Archived products leave the storefront, retain their order history, and can be restored as drafts.
- The storefront filters by product type and actual price, including discounts. Products can offer sizes and colors with a shared inventory total. The product page can show measurements, material, care instructions, and a close-up image.

- Set an optional sale price below the regular price. The product will appear in the sale filter while it has a sale price.
- Use **Дэлгүүрт харуулах** to publish or unpublish a product. Product availability updates across devices. Photo uploads are resized in the browser and replace the current image set.
- New orders reserve stock at submission. Mark an order fulfilled when it is complete. Cancelling an open order restores its items to inventory.
- The admin account uses a persistent server-side session with automatic expiry. Set or change the password through the GitHub Actions secret and rerun deployment. Existing sessions expire after eight hours.
