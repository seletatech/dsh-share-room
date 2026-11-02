# Seleta maintenance fork

Upstream: https://github.com/yillkid/dsh-share-room, commit
95a78ae79467e523df9d1f32cff3a3917acb1af5, npm release 0.3.3. The original MIT
license and authorship are retained. This fork adds localized owner/guest UI;
it does not change sharing permissions, invitation validation or AI execution.

Edit `src/client.js`, `src/guest.js`, `src/i18n.js` and `locale/*.json`, then run
`npm run build` and `npm test`. Generated browser bundles and `lib/i18n.js` are
checked in so DSH installation still needs no build or extra runtime dependency.
Dictionary keys are gettext-style source messages. Dynamic values are explicit
placeholders; names, conversations and files are never character-converted.

The owner uses DSH's native locale service and subscribes to changes. Guest links
carry `lang` (without moving invitation secrets out of the URL fragment); otherwise
the guest uses browser language. Supported languages: Simplified Chinese, English,
Traditional Chinese. Unsupported locales fall back to English. Server-created
shared-copy titles retain the creation language. Existing shares retain their old
language; original conversation titles and historical messages are not rewritten.

The companion image-export plugin is maintained upstream at
https://github.com/hellodigua/dsh-share and already supports native zh/en switching.
