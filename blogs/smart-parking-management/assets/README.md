# Article assets

The article embeds nine images: four reused setup and connection illustrations, and five parking-specific images. All image positions currently used in `../blog.md` have corresponding files in this directory.

## Reused assets

| File | Use | Original source |
| --- | --- | --- |
| `notification-provider-url.png` | External Notification Provider URL location | `assets/notification-provider-url.png` |
| `network-access.png` | Native GridDB IP access configuration | `assets/network-access.png` |
| `griddb-cloud-lib-plugin.png` | GridDB Cloud library download location | `assets/griddb-cloud-lib-plugin.png` |
| `native-connection-sequence.webp` | Shared Node.js/Python/JPype/Java native-client pattern | `assets/native-connection-sequence.webp` |

These illustrate common setup and architecture, not parking-specific results. The library screenshot's release notices are historical portal content, not a claim that those versions are currently the latest.

The original `notification-provider-url.png` and `network-access.png` are reused unchanged at the author's explicit request. Their thin redaction marks leave portions of connection tokens and identifying details visible; fully obscure complete sensitive fields before public publication. Energy dashboards, container listings, schemas, architecture and cover art are application-specific and have not been reused.

## Parking-specific assets

The generated `blog-cover.png` is embedded at the top of the article. It is conceptual cover artwork, not an application screenshot or evidence of native Cloud validation. Generation details and the final prompt are recorded in `blog-cover-prompt.md`.

| File | Article section | Content |
| --- | --- | --- |
| `blog-cover.png` | Article opening | Conceptual parking cover illustration |
| `smart-parking-five-system-responsibilities.png` | System Architecture | Architecture diagram based on the article's five responsibilities |
| `griddb-schema.webp` | GridDB Schema | All fields and row keys for the three Collections and two TimeSeries schemas; one sensor schema represents 24 containers |
| `containers.png` | GridDB Schema | This project's GridDB Cloud container list |
| `park-app-dashboard.png` | Reading Results in Node.js | Parking dashboard screenshot |

The dashboard screenshot is used in place of the previously planned `dashboard.png` and `dashboard-sessions.png`. The architecture PNG replaces the planned `system-architecture.webp`. These old names are not required assets.

Archify diagram candidates, interactive HTML and verification receipts are retained in the repository's `.archify/` directory. The schema WebP is a static export; its relationship lines describe application references, not database-enforced foreign keys. Container prefixes are omitted, and the 24 sensor containers share one displayed schema.

When replacing screenshots, retain accurate captions and fully redact sensitive Cloud details. Label demo-mode screenshots as demo previews. Setup illustrations, schema diagrams and cover artwork do not establish a live Cloud connection; live verification must be described separately. The redaction issue noted above remains outstanding.
