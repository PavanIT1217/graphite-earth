# Releasing to Google Play and the App Store

The iOS and Android apps are [Capacitor](https://capacitorjs.com) shells around the same web build
(`dist/`). Native projects live in `android/` and `ios/` and are committed to the repo.

```
npm run build && npx cap sync      # copy the web build into both native projects
npx cap open android               # Android Studio
npx cap open ios                   # Xcode (macOS only)
```

Two workflows publish builds:

| Workflow | Trigger | Result |
| --- | --- | --- |
| `android-release.yml` | Actions → *Run workflow*, or push a `v*` tag | Signed `.aab` uploaded to a Google Play track |
| `ios-release.yml` | Actions → *Run workflow*, or push a `v*` tag | Signed build uploaded to App Store Connect (TestFlight) |

Build numbers come from the workflow run number; the version name comes from the tag (`v1.2.0` → `1.2.0`).

## One-time setup: Google Play

1. **Create a Google Play developer account** (one-off US$25) at <https://play.google.com/console>.
2. **Create the app** in Play Console with package name `io.github.pavanit1217.graphiteearth`
   (must match `appId` in `capacitor.config.ts`).
3. **Create an upload keystore** (keep it safe — you need it for every update):
   ```bash
   keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 upload.jks > upload.jks.b64     # macOS: base64 -i upload.jks -o upload.jks.b64
   ```
4. **Create a service account** for publishing: Google Cloud console → IAM → Service accounts → create,
   add a JSON key. In Play Console → *Users and permissions* → invite the service-account email and grant
   *Release apps to testing tracks* (and *production* if you want CI to publish there).
5. **Add repository secrets** (GitHub → Settings → Secrets and variables → Actions):

   | Secret | Value |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | contents of `upload.jks.b64` |
   | `ANDROID_KEYSTORE_PASSWORD` | keystore password |
   | `ANDROID_KEY_ALIAS` | `upload` (or your alias) |
   | `ANDROID_KEY_PASSWORD` | key password |
   | `PLAY_SERVICE_ACCOUNT_JSON` | full JSON key of the service account |

6. **First upload is manual** (a Play API limitation): run the workflow once, download the
   `app-release-aab` artifact, and upload it in Play Console → *Internal testing*. Enrol in
   *Play App Signing* when asked. After that, CI uploads work (`status: draft` until the app passes review once,
   then `completed`).
7. Complete the store listing, content rating, data-safety form ("Location: approximate — search text and map area are sent to OSM services; nothing is collected by the developer") and target audience,
   using [`store-listing.md`](store-listing.md) and the privacy policy at `/privacy.html`.

## One-time setup: Apple App Store

1. **Enrol in the Apple Developer Program** (US$99/year) at <https://developer.apple.com/programs/>.
2. **Register the bundle ID** `io.github.pavanit1217.graphiteearth` (Certificates, IDs & Profiles → Identifiers).
3. **Create the app** in App Store Connect → *Apps* → *+* with that bundle ID.
4. **Create an App Store Connect API key** (Users and Access → Integrations → App Store Connect API) with the
   **Admin** role (needed for Xcode cloud-managed signing to create certificates/profiles). Download the `.p8`.
5. **Add repository secrets**:

   | Secret | Value |
   | --- | --- |
   | `APPLE_TEAM_ID` | 10-character Team ID (Membership details) |
   | `APP_STORE_CONNECT_KEY_ID` | the key's ID |
   | `APP_STORE_CONNECT_ISSUER_ID` | issuer ID shown above the keys list |
   | `APP_STORE_CONNECT_API_KEY` | full text of the `.p8` file |

6. Run **iOS release**. The build appears in TestFlight after processing (~10–30 min). Add screenshots
   (see `docs/screenshots/`), the listing text, privacy details ("Data Not Collected") and submit for review.

## Release checklist

- [ ] Bump the version: `git tag v1.1.0 && git push origin v1.1.0` (triggers both store workflows)
- [ ] Screenshots: `npm run build && npm run screenshots` (phone shots at 390×844 @2x / 3x as required)
- [ ] Update `store-listing.md` "What's new"
